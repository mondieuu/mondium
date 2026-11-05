'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Sayfanin kendi betiklerinden ONCE ana dunyada calistir
function inMainWorld(fn) {
  try {
    if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({ func: fn });
    else webFrame.executeJavaScript(`(${fn.toString()})()`);
  } catch {}
}

// 1) Tarayicinin kendi yerel sayfalari (yeni sekme, karsilama, gecmis, indirilenler): kisayol, tema, liste API'si.
//    Diger sitelerde bu API hic olusturulmaz. Ana surec ayrica her komutta gonderen sayfayi denetler.
if (location.protocol === 'file:' && /\/(newtab|welcome|history|downloads|settings|extensions)\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('pageApi', {
    lang: ipcRenderer.sendSync('mondium-lang'),   // arayuz dili: 'tr' | 'en' (bkz. i18n.js)
    get: () => ipcRenderer.invoke('page', 'get'),
    call: (cmd, arg) => ipcRenderer.invoke('page', cmd, arg),
    onUpdate: (fn) => { ipcRenderer.removeAllListeners('page-update'); ipcRenderer.on('page-update', (_e, d) => fn(d)); }
  });
}

// 2) Passkey (gecis anahtari) tamamen kapali: siteler passkey destegi gormez,
//    Windows Hello / "passkey kullan" pencereleri hic acilmaz. Siteler sifreyle girise doner.
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

// Reklam engelleyicinin sayfa ici betikleri (uBlock Origin scriptlet'leri): uBO gibi sayfanin kendi kodundan ONCE
// calisir (bkz. main.js 'mondium-scriptlets'). Her betik kendi fonksiyon kapsaminda; birbirinin tanimlarini ezmez.
if (/^https?:$/.test(location.protocol)) {
  let scripts = [];
  try { scripts = ipcRenderer.sendSync('mondium-scriptlets', location.href) || []; } catch {}
  for (const code of scripts) {
    try { contextBridge.executeInMainWorld({ func: new Function(code) }); } catch {}
  }
}

// Dikey sekmelerin saklanma modu: fare sayfanin sol kenarina degince ana surece bir kez haber verilir (kenar cubugu
// acilir). Ana surec ayar kapaliysa yok sayar. Kenardan uzaklasinca tekrar kurulur; surekli mesaj gonderilmez.
{
  let atEdge = false, edge = 2;
  try { edge = ipcRenderer.sendSync('mondium-edge-px') || 2; } catch {}
  ipcRenderer.on('mondium-edge-px', (_e, v) => { edge = v; });
  window.addEventListener('mousemove', (e) => {
    if (e.clientX < edge) { if (!atEdge) { atEdge = true; ipcRenderer.send('mondium-edge'); } }
    else if (e.clientX > edge + 12) atEdge = false;
  }, { capture: true, passive: true });
}

// Yerlesik resim buyutme dunyasi (1014, bkz. hoverzoom.js): sitenin CSP'si baska sunucudaki buyuk resmi
// engellemesin diye resim/video icin ayri kural (uzanti icerik betikleri de Chrome'da boyle calisir).
if (/^https?:$/.test(location.protocol)) {
  try { webFrame.setIsolatedWorldInfo(1014, { name: 'Mondium resim büyütme', securityOrigin: location.origin, csp: "default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline'" }); } catch {}
}

// 3) Uzanti kullanici betikleri (chrome.userScripts uyumlulugu, bkz. user-scripts.js).
//    Sadece web sayfalarinda ve bir uzanti betik kaydettiyse calisir; her uzanti kendi ayrik dunyasinda.
//    Dinleyici listesi uzantinin kendi dunyasinda tutulur (kopru fonksiyon kopyalari yuzunden removeListener
//    calismaz ve dinleyiciler birikirdi); kopruden sadece tek bir dagitici fonksiyon gecer.
if (/^https?:$/.test(location.protocol)) {
  let packs = [];
  try { packs = ipcRenderer.sendSync('mondium-us-get', location.href) || []; } catch {}
  if (packs.length) {
    const dispatchers = new Map();   // uzanti -> dunyadaki dagitici
    ipcRenderer.on('mondium-us-tabmsg', (_e, extId, reqId, msg) => {
      const d = dispatchers.get(extId);
      if (!d) { ipcRenderer.send('mondium-us-tabreply', reqId, undefined); return; }
      try { d(reqId, msg); } catch { ipcRenderer.send('mondium-us-tabreply', reqId, undefined); }
    });
    for (const p of packs) {
      try {
        // Electron, CSP verilince kaynak adresini de istiyor; sayfanin kendi adresi kullanilir (Chrome da boyle yapar)
        webFrame.setIsolatedWorldInfo(p.worldId, { name: p.name, csp: p.csp, securityOrigin: location.origin });
        // Her dunyada Chromium'un kendi "chrome" nesnesi zaten var; kopru ayri adla eklenir, sonra chrome.runtime kurulur
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
            const msg = a.length > 1 && typeof a[0] === 'string' ? a[1] : a[0];   // (uzantiKimligi, mesaj) bicimi de olur
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
