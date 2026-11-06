'use strict';
// Mondium compatibility layer (extension service worker side).
// Electron lacks Chrome's chrome.userScripts API. Extensions like Imagus Reborn inject their code with it;
// without it they broke and opened their options page on every launch. This file emulates the API for the extension;
// the real work is done by user-scripts.js in the main process. Runs only in extension service workers, not on websites.
const { contextBridge, ipcRenderer } = require('electron');

// The preload's own context has no "location"; the URL is read from the worker's own world.
let isExtension = false;
try { isExtension = process.type === 'service-worker' && contextBridge.executeInMainWorld({ func: () => globalThis.location.protocol }) === 'chrome-extension:'; } catch {}
let allowed = false;
if(isExtension) { try { allowed = contextBridge.executeInMainWorld({func:()=>!!globalThis.chrome?.runtime?.getManifest()?.permissions?.includes('userScripts')}); } catch {} }
if (isExtension && allowed) {
  const deliverers = [];
  ipcRenderer.on('mondium-us-deliver', (_e, reqId, msg, sender) => { for (const fn of deliverers) fn(reqId, msg, sender); });
  contextBridge.exposeInMainWorld('__mondiumUS', {
    call: (op, ...args) => ipcRenderer.invoke('mondium-us', op, ...args),
    reply: (reqId, value) => ipcRenderer.send('mondium-us-reply', reqId, value),
    onDeliver: (fn) => { deliverers.push(fn); }
  });
  contextBridge.executeInMainWorld({ func: mainWorld });
}

// Runs in the extension's own world (cannot see outer variables, written to be self-contained)
function mainWorld() {
  const bridge = globalThis.__mondiumUS;
  const c = globalThis.chrome;
  if (!bridge || !c || !c.runtime) return;
  const man = (c.runtime.getManifest && c.runtime.getManifest()) || {};
  const perms = man.permissions || [];
  if (!perms.includes('userScripts')) return;          // only extensions requesting this permission
  const done = (p, cb) => { if (typeof cb === 'function') { p.then((v) => cb(v), () => cb()); return undefined; } return p; };
  const fail = (r) => { if (r && r.error) throw new Error(r.error); return r; };

  // ---- Messages from user scripts (chrome.runtime.onUserScriptMessage)
  const listeners = new Set();
  const queue = [];
  function dispatch(reqId, msg, sender) {
    if (!listeners.size) {   // hold briefly if the extension hasn't added its listener yet
      queue.push([reqId, msg, sender]);
      setTimeout(() => { const i = queue.findIndex((q) => q[0] === reqId); if (i >= 0) { queue.splice(i, 1); bridge.reply(reqId, undefined); } }, 4000);
      return;
    }
    let isAsync = false, answered = false;
    const respond = (v) => { if (answered) return; answered = true; bridge.reply(reqId, v); };
    for (const fn of [...listeners]) {
      try {
        const r = fn(msg, sender, respond);
        if (r === true) isAsync = true;
        else if (r && typeof r.then === 'function') { isAsync = true; r.then(respond, () => respond(undefined)); }
      } catch (e) { console.error(e); }
    }
    if (!isAsync) respond(undefined);
  }
  const flush = () => { while (queue.length && listeners.size) dispatch(...queue.shift()); };
  bridge.onDeliver(dispatch);
  const onUserScriptMessage = {
    addListener(fn) { listeners.add(fn); flush(); },
    removeListener(fn) { listeners.delete(fn); },
    hasListener(fn) { return listeners.has(fn); },
    hasListeners() { return listeners.size > 0; }
  };
  try { Object.defineProperty(c.runtime, 'onUserScriptMessage', { value: onUserScriptMessage, configurable: true, writable: true }); } catch (e) { console.warn('Could not add onUserScriptMessage', e); }

  // ---- chrome.userScripts
  if (!c.userScripts) {
    const opt = (a, b) => (typeof a === 'function' ? [undefined, a] : [a, b]);
    c.userScripts = {
      configureWorld: (cfg, cb) => done(bridge.call('configureWorld', cfg || {}).then(fail).then(() => undefined), cb),
      resetWorldConfiguration: (a, b) => { const [, cb] = opt(a, b); return done(bridge.call('configureWorld', {}).then(() => undefined), cb); },
      getWorldConfigurations: (cb) => done(Promise.resolve([]), cb),
      register: (scripts, cb) => done(bridge.call('register', scripts || []).then(fail).then(() => undefined), cb),
      update: (scripts, cb) => done(bridge.call('update', scripts || []).then(fail).then(() => undefined), cb),
      unregister: (a, b) => { const [filter, cb] = opt(a, b); return done(bridge.call('unregister', filter || null).then(() => undefined), cb); },
      getScripts: (a, b) => { const [filter, cb] = opt(a, b); return done(bridge.call('getScripts', filter || null), cb); }
    };
  }

  // ---- Harmless stub if chrome.history is missing (adding to history never touches Mondium's own history)
  if (perms.includes('history') && !c.history) {
    const nop = (a, cb) => done(Promise.resolve(undefined), typeof a === 'function' ? a : cb);
    c.history = { addUrl: nop, deleteUrl: nop, getVisits: (a, cb) => done(Promise.resolve([]), cb), search: (a, cb) => done(Promise.resolve([]), cb) };
  }

  // ---- Message to tab: the extension has no real content script, so messages go to the user script world
  if (!(man.content_scripts && man.content_scripts.length)) {
    const patchTabs = () => {
      if (!c.tabs || c.tabs.__mondiumUS) return;
      try {
        c.tabs.sendMessage = function (tabId, msg, opts, cb) {
          if (typeof opts === 'function') { cb = opts; opts = undefined; }
          return done(bridge.call('tabMessage', tabId, msg), cb);
        };
        c.tabs.__mondiumUS = true;
      } catch {}
    };
    patchTabs();
    setTimeout(patchTabs, 0);   // retry in case other preloads replaced chrome.tabs later
  }
}
