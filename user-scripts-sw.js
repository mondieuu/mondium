'use strict';
// Mondium uyumluluk katmani (uzanti service worker'i tarafi).
// Electron'da Chrome'un chrome.userScripts API'si yok. Imagus Reborn gibi uzantilar sayfaya kodlarini bununla ekliyor;
// API olmayinca calismiyor ve her acilista ayar sayfasini aciyordu. Bu dosya API'yi uzantiya taklit eder,
// asil isi ana surecteki user-scripts.js yapar. Sadece uzanti service worker'larinda calisir, web sitelerinde degil.
const { contextBridge, ipcRenderer } = require('electron');

// Preload'un kendi ortaminda "location" yok; adres, worker'in kendi dunyasindan okunur.
let isExtension = false;
try { isExtension = process.type === 'service-worker' && contextBridge.executeInMainWorld({ func: () => globalThis.location.protocol }) === 'chrome-extension:'; } catch {}
if (isExtension) {
  const deliverers = [];
  ipcRenderer.on('mondium-us-deliver', (_e, reqId, msg, sender) => { for (const fn of deliverers) fn(reqId, msg, sender); });
  contextBridge.exposeInMainWorld('__mondiumUS', {
    call: (op, ...args) => ipcRenderer.invoke('mondium-us', op, ...args),
    reply: (reqId, value) => ipcRenderer.send('mondium-us-reply', reqId, value),
    onDeliver: (fn) => { deliverers.push(fn); }
  });
  contextBridge.executeInMainWorld({ func: mainWorld });
}

// Uzantinin kendi dunyasinda calisir (disaridaki degiskenleri goremez, kendi basina yazilmistir)
function mainWorld() {
  const bridge = globalThis.__mondiumUS;
  const c = globalThis.chrome;
  if (!bridge || !c || !c.runtime) return;
  const man = (c.runtime.getManifest && c.runtime.getManifest()) || {};
  const perms = man.permissions || [];
  if (!perms.includes('userScripts')) return;          // sadece bu izni isteyen uzantilar
  const done = (p, cb) => { if (typeof cb === 'function') { p.then((v) => cb(v), () => cb()); return undefined; } return p; };
  const fail = (r) => { if (r && r.error) throw new Error(r.error); return r; };

  // ---- Kullanici betiklerinden gelen mesajlar (chrome.runtime.onUserScriptMessage)
  const listeners = new Set();
  const queue = [];
  function dispatch(reqId, msg, sender) {
    if (!listeners.size) {   // uzanti dinleyicisini henuz eklemediyse kisa sure beklet
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
  try { Object.defineProperty(c.runtime, 'onUserScriptMessage', { value: onUserScriptMessage, configurable: true, writable: true }); } catch (e) { console.warn('onUserScriptMessage eklenemedi', e); }

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

  // ---- chrome.history yoksa zararsiz bos surum (gecmise ekleme Mondium'un kendi gecmisine karismaz)
  if (perms.includes('history') && !c.history) {
    const nop = (a, cb) => done(Promise.resolve(undefined), typeof a === 'function' ? a : cb);
    c.history = { addUrl: nop, deleteUrl: nop, getVisits: (a, cb) => done(Promise.resolve([]), cb), search: (a, cb) => done(Promise.resolve([]), cb) };
  }

  // ---- Sekmeye mesaj: uzantinin gercek icerik betigi yok, mesajlar kullanici betigi dunyasina gider
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
    setTimeout(patchTabs, 0);   // diger preload'lar chrome.tabs'i sonradan degistirdiyse tekrar
  }
}
