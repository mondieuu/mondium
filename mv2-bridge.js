'use strict';
// Eski tip (MV2) uzantı sayfaları icin kopru (uBlock Origin).
// electron-chrome-extensions, chrome.browserAction / webNavigation / contextMenus / tabs.query gibi API'leri
// kendi onyukleyicisinde ekliyor; ama MV2 arka plan sayfasinda (baglam yalitimi kapali) ekledigi "chrome" nesnesi
// sayfanin sonra kullandigi nesne degil ve API'ler kayboluyor. Bu onyukleyici kutuphanenin mesaj kanalini
// (crx-msg / crx-add-listener) sayfaya acar; uzantinin ilk betigi (mondium-ece.js) API'leri gercek nesneye baglar.
// Kanal sadece uzanti sayfalarinda acilir; ana surec her istekte gonderen uzantiyi kendisi denetler.
const { ipcRenderer, contextBridge } = require('electron');

if (location.protocol === 'chrome-extension:') {
  const counts = new Map();
  const handlers = new Map();   // dinleyici -> ipc sarmalayici (kaldirabilmek icin)
  const api = {
    invoke: (extensionId, fnName, ...args) => ipcRenderer.invoke('crx-msg', extensionId, fnName, ...args),
    addListener: (extensionId, name, callback) => {
      const n = counts.get(name) || 0;
      if (n === 0) ipcRenderer.send('crx-add-listener', extensionId, name);
      counts.set(name, n + 1);
      const h = (_e, ...args) => { try { callback(...args); } catch (err) { console.error(err); } };
      handlers.set(callback, h);
      ipcRenderer.on('crx-' + name, h);
    },
    removeListener: (extensionId, name, callback) => {
      const h = handlers.get(callback);
      if (!h) return;
      handlers.delete(callback);
      ipcRenderer.removeListener('crx-' + name, h);
      const n = (counts.get(name) || 1) - 1;
      if (n <= 0) { counts.delete(name); ipcRenderer.send('crx-remove-listener', extensionId, name); } else counts.set(name, n);
    }
  };
  try {
    if (process.contextIsolated) contextBridge.exposeInMainWorld('__mondiumCrx', api);
    else window.__mondiumCrx = api;
  } catch {}
}
