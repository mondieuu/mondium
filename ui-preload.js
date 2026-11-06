'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserApi', {
  platform: process.platform,
  lang: ipcRenderer.sendSync('mondium-lang'),
  send: (cmd, arg) => ipcRenderer.send('ui', cmd, arg),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onFound: (fn) => ipcRenderer.on('found', (_e, r) => fn(r)),
  onFocusUrl: (fn) => ipcRenderer.on('focus-url', (_e, d) => fn(d || {})),
  onOmni: (fn) => ipcRenderer.on('omni-results', (_e, d) => fn(d)),
  onFindStep: (fn) => ipcRenderer.on('find-step', (_e, f) => fn(f)),
  onOpenMenu: (fn) => ipcRenderer.on('open-menu', () => fn()),
  onFocusFind: (fn) => ipcRenderer.on('focus-find', () => fn()),
  onMenuOpen: (fn) => ipcRenderer.on('menu-open', (_e, d) => fn(d)),
  onMenuData: (fn) => ipcRenderer.on('menu-data', (_e, d) => fn(d)),
  onMenuClosed: (fn) => ipcRenderer.on('menu-closed', () => fn()),
  onChooserOpen: (fn) => ipcRenderer.on('chooser-open', (_e, d) => fn(d)),
  onChooserData: (fn) => ipcRenderer.on('chooser-data', (_e, d) => fn(d)),
  onPromptOpen: (fn) => ipcRenderer.on('prompt-open', (_e, d) => fn(d)),
  onPromptClose: (fn) => ipcRenderer.on('prompt-close', () => fn()),
  onNewTabResults: (fn) => ipcRenderer.on('newtab-results', (_e, d) => fn(d)),
  onNewTabPrompt: (fn) => ipcRenderer.on('newtab-prompt', (_e, d) => fn(d)),
  onSideReveal: (fn) => ipcRenderer.on('side-reveal', (_e, v) => fn(v))
});

// <browser-action-list> element for extension icons
try {
  let mod;
  try { mod = require('electron-chrome-extensions/browser-action'); }
  catch { mod = require('electron-chrome-extensions/dist/browser-action'); }
  mod.injectBrowserAction();
} catch (e) {
  console.warn('Could not load extension icons:', e.message);
}
