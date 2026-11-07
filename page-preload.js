'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Run in the main world BEFORE the page's own scripts
function inMainWorld(fn) {
  try {
    if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({ func: fn });
    else webFrame.executeJavaScript(`(${fn.toString()})()`);
  } catch {}
}

// 1) The browser's own local pages (new tab, welcome, history, downloads): shortcuts, theme, list API.
//    This API is never created on other sites. The main process also checks the sender page on every command.
if (location.protocol === 'file:' && /\/(newtab|welcome|history|downloads|settings|extensions|taskmanager|securitywarning)\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('pageApi', {
    lang: ipcRenderer.sendSync('mondium-lang'),   // UI language: 'tr' | 'en' (see i18n.js)
    platform: process.platform,
    get: () => ipcRenderer.invoke('page', 'get'),
    call: (cmd, arg) => ipcRenderer.invoke('page', cmd, arg),
    onUpdate: (fn) => { ipcRenderer.removeAllListeners('page-update'); ipcRenderer.on('page-update', (_e, d) => fn(d)); }
  });
}

// Capture visible link labels; no background page or media needs to load just for a title.
if (/^https?:$/.test(location.protocol)) {
  window.addEventListener('mousedown', (e) => {
    if (!e.isTrusted || !(e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey)))) return;
    const link = e.composedPath().find((el) => el?.tagName === 'A' && el.href);
    if (!link || !/^https?:/i.test(link.href)) return;
    const card = link.closest('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,yt-lockup-view-model');
    const named = card?.querySelector('a#video-title,a#video-title-link,[role="heading"]');
    const title = named?.getAttribute('title') || named?.textContent || link.getAttribute('title') || link.getAttribute('aria-label') || link.textContent;
    if (title?.trim()) ipcRenderer.sendSync('mondium-link-title', { url: link.href, title: title.slice(0, 300) });
  }, { capture: true, passive: true });
}

// 2) Passkeys fully disabled: sites see no passkey support,
//    Windows Hello / "use a passkey" dialogs never open. Sites fall back to password sign-in.
inMainWorld(() => {
  try {
    const c = navigator.credentials;
    if (c) {
      const deny = () => Promise.reject(new DOMException('Passkeys are disabled in this browser', 'NotAllowedError'));
      const og = c.get && c.get.bind(c), oc = c.create && c.create.bind(c);
      Object.defineProperty(c, 'get', { value: (o) => (o && o.publicKey ? deny() : og(o)), configurable: true, writable: true });
      Object.defineProperty(c, 'create', { value: (o) => (o && o.publicKey ? deny() : oc(o)), configurable: true, writable: true });
    }
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true, writable: true });
  } catch {}
});

// Ad blocker in-page scripts (uBlock Origin scriptlets): like uBO, run BEFORE the page's own code
// (see main.js 'mondium-scriptlets'). Each runs in its own function scope so they don't clobber each other.
if (/^https?:$/.test(location.protocol)) {
  let scripts = [];
  try { scripts = ipcRenderer.sendSync('mondium-scriptlets', location.href) || []; } catch {}
  for (const code of scripts) {
    try { contextBridge.executeInMainWorld({ func: new Function(code) }); } catch {}
  }
}

// Vertical tabs auto-hide: when the mouse touches the page's left edge the main process is notified once (sidebar
// opens). Ignored if the setting is off. Re-arms after leaving the edge; no continuous messages.
{
  let atEdge = false, edge = 2;
  try { edge = ipcRenderer.sendSync('mondium-edge-px') || 2; } catch {}
  window.addEventListener('mouseleave', () => { atEdge = false; });
  ipcRenderer.on('mondium-edge-px', (_e, v) => { edge = v; });
  window.addEventListener('mousemove', (e) => {
    if (e.clientX < edge) { if (!atEdge) { atEdge = true; ipcRenderer.send('mondium-edge'); } }
    else if (e.clientX > edge + 12) atEdge = false;
  }, { capture: true, passive: true });
}

// Built-in image zoom world (1014, see hoverzoom.js): separate img/media rule so the site's CSP doesn't block
// the large image from another server (extension content scripts work this way in Chrome too).
if (/^https?:$/.test(location.protocol)) {
  contextBridge.exposeInIsolatedWorld(1014, 'mondiumZoomDownload', (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) ipcRenderer.send('mondium-zoom-download', url);
  });
  try { webFrame.setIsolatedWorldInfo(1014, { name: 'Mondium resim büyütme', securityOrigin: location.origin, csp: "default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline'" }); } catch {}
}

// 3) Extension user scripts (chrome.userScripts compatibility, see user-scripts.js).
//    Runs only on web pages and only if an extension registered scripts; each extension in its own isolated world.
//    The listener list lives in the extension's world (bridge function copies would break removeListener
//    and listeners would pile up); only a single dispatcher function crosses the bridge.
if (/^https?:$/.test(location.protocol)) {
  let packs = [];
  try { packs = ipcRenderer.sendSync('mondium-us-get', location.href) || []; } catch {}
  if (packs.length) {
    const dispatchers = new Map();   // extension -> dispatcher in its world
    ipcRenderer.on('mondium-us-tabmsg', (_e, extId, reqId, msg) => {
      const d = dispatchers.get(extId);
      if (!d) { ipcRenderer.send('mondium-us-tabreply', reqId, undefined); return; }
      try { d(reqId, msg); } catch { ipcRenderer.send('mondium-us-tabreply', reqId, undefined); }
    });
    for (const p of packs) {
      try {
        // With a CSP Electron also requires a security origin; the page's own origin is used (as Chrome does)
        webFrame.setIsolatedWorldInfo(p.worldId, { name: p.name, csp: p.csp, securityOrigin: location.origin });
        // Each world already has Chromium's own "chrome" object; the bridge uses a separate name, then chrome.runtime is set up
        contextBridge.exposeInIsolatedWorld(p.worldId, '__mondiumRuntime', {
          id: p.extId,
          send: (msg) => ipcRenderer.invoke('mondium-us-msg', p.extId, msg),
          reply: (reqId, value) => ipcRenderer.send('mondium-us-tabreply', reqId, value),
          setDispatcher: (fn) => { dispatchers.set(p.extId, fn); }
        });
      } catch { continue; }
      const run = (list) => { if (list.length) webFrame.executeJavaScriptInIsolatedWorld(p.worldId, list).catch(() => {}); };
      run([{ code: `(() => {
        const b = globalThis.__mondiumRuntime; delete globalThis.__mondiumRuntime;
        const listeners = new Set();
        const runtime = {
          id: b.id,
          lastError: undefined,
          getURL: (f) => 'chrome-extension://' + b.id + '/' + String(f || '').replace(/^\\//, ''),
          sendMessage: (...a) => {
            const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null;
            const msg = a.length > 1 && typeof a[0] === 'string' ? a[1] : a[0];   // (extensionId, message) form also allowed
            const pr = b.send(msg);
            if (cb) { pr.then((v) => cb(v), () => cb()); return undefined; }
            return pr;
          },
          onMessage: {
            addListener: (fn) => { listeners.add(fn); },
            removeListener: (fn) => { listeners.delete(fn); },
            hasListener: (fn) => listeners.has(fn),
            hasListeners: () => listeners.size > 0
          }
        };
        b.setDispatcher((reqId, msg) => {
          let isAsync = false, answered = false;
          const respond = (v) => { if (answered) return; answered = true; b.reply(reqId, v); };
          for (const fn of [...listeners]) {
            try {
              const r = fn(msg, { id: b.id }, respond);
              if (r === true) isAsync = true;
              else if (r && typeof r.then === 'function') { isAsync = true; r.then(respond, () => respond(undefined)); }
            } catch (e) { console.error(e); }
          }
          if (!isAsync) respond(undefined);
        });
        const c = globalThis.chrome || (globalThis.chrome = {});
        try { Object.defineProperty(c, 'runtime', { value: runtime, configurable: true, writable: true }); } catch { c.runtime = runtime; }
      })()` }].concat(p.start));
      if (p.end.length || p.idle.length) {
        const later = () => { run(p.end); setTimeout(() => run(p.idle), 0); };
        if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', later, { once: true }); else later();
      }
    }
  }
}
