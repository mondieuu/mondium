'use strict';
// Bridge for legacy (MV2) extension pages (uBlock Origin).
// electron-chrome-extensions adds APIs like chrome.browserAction / webNavigation / contextMenus / tabs.query
// in its own preload; but on an MV2 background page (context isolation off) the "chrome" object it patches
// is not the one the page uses later, so the APIs vanish. This preload exposes the library's message channel
// (crx-msg / crx-add-listener) to the page; the extension's first script (mondium-ece.js) wires the APIs to the real object.
// The channel opens only on extension pages; the main process verifies the sending extension on every request.
const { ipcRenderer, contextBridge } = require('electron');

if (location.protocol === 'chrome-extension:') {
  const counts = new Map();
  const handlers = new Map();   // listener -> ipc wrapper (so it can be removed)
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
