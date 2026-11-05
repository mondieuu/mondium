// Mondium: first script of uBlock Origin pages (tools/ublock-guncelle.js prepends it to every HTML file).
// Wires missing chrome.* APIs to electron-chrome-extensions' main process implementation (bridge: mv2-bridge.js).
// Leaves existing (Electron's own) APIs alone; only adds or extends missing ones.
(() => {
  'use strict';
  const b = self.__mondiumCrx;
  if (!b || !self.chrome || !chrome.runtime || !chrome.runtime.id) return;
  const id = chrome.runtime.id;
  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
  const call = (fn, opts = {}) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (opts.noop) { if (cb) cb(opts.def); return Promise.resolve(opts.def); }
    if (opts.serialize) args = opts.serialize(...args);
    const p = b.invoke(id, fn, ...args).catch((e) => { console.error(fn, e); return undefined; });
    if (cb) { p.then((r) => cb(r)); return undefined; }
    return p;
  };
  const ev = (name) => ({
    addListener: (cb) => b.addListener(id, name, cb),
    removeListener: (cb) => b.removeListener(id, name, cb),
    hasListener: () => false,
    hasListeners: () => false
  });
  const setting = () => ({ get: (_d, cb) => { const r = { value: false, levelOfControl: 'not_controllable' }; if (cb) cb(r); return Promise.resolve(r); }, set: (_d, cb) => { if (cb) cb(); return Promise.resolve(); }, clear: (_d, cb) => { if (cb) cb(); return Promise.resolve(); }, onChange: { addListener() {}, removeListener() {} } });
  // Newer Chromium also defines a separate 'browser' object; uBO prefers it over chrome (vapi.js) and the
  // added APIs were lost. The separate 'browser' is removed; uBO then sets 'browser = chrome' and uses this object.
  if (self.browser && self.browser !== self.chrome) { try { delete self.browser; } catch {} if (self.browser) { try { self.browser = undefined; } catch {} } }
  const put = (name, value) => { try { Object.defineProperty(chrome, name, { value, configurable: true, enumerable: true, writable: true }); } catch {} };
  const has = (name) => !!chrome[name];

  // Icon image (ImageData) is sent to the main process as a string
  const img64 = (d) => { const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d, 0, 0); return c.toDataURL(); };
  if (manifest.browser_action && !has('browserAction')) {
    put('browserAction', {
      setTitle: call('browserAction.setTitle'), getTitle: call('browserAction.getTitle'),
      setIcon: call('browserAction.setIcon', { serialize: (d) => {
        if (d && d.imageData) d.imageData = typeof ImageData !== 'undefined' && d.imageData instanceof ImageData ? img64(d.imageData)
          : Object.fromEntries(Object.entries(d.imageData).map(([k, v]) => [k, img64(v)]));
        return [d];
      } }),
      setPopup: call('browserAction.setPopup'), getPopup: call('browserAction.getPopup'),
      setBadgeText: call('browserAction.setBadgeText'), getBadgeText: call('browserAction.getBadgeText'),
      setBadgeBackgroundColor: call('browserAction.setBadgeBackgroundColor'), getBadgeBackgroundColor: call('browserAction.getBadgeBackgroundColor'),
      setBadgeTextColor: call('browserAction.setBadgeTextColor', { noop: true }),
      enable: call('browserAction.enable', { noop: true }), disable: call('browserAction.disable', { noop: true }),
      openPopup: call('browserAction.openPopup'), onClicked: ev('browserAction.onClicked')
    });
  }
  // Tabs: Electron's own executeScript/insertCSS/sendMessage are kept, the rest are added
  const tabsBase = chrome.tabs || {};
  put('tabs', Object.assign({}, tabsBase, {
    create: call('tabs.create'), get: call('tabs.get'), getCurrent: call('tabs.getCurrent'),
    query: call('tabs.query'), reload: call('tabs.reload'), update: call('tabs.update'), remove: call('tabs.remove'),
    move: call('tabs.move', { noop: true, def: [] }), goBack: call('tabs.goBack'), goForward: call('tabs.goForward'),
    executeScript: tabsBase.executeScript ? tabsBase.executeScript.bind(tabsBase) : call('tabs.executeScript'),
    insertCSS: tabsBase.insertCSS ? tabsBase.insertCSS.bind(tabsBase) : call('tabs.insertCSS'),
    removeCSS: tabsBase.removeCSS ? tabsBase.removeCSS.bind(tabsBase) : call('tabs.removeCSS', { noop: true }),
    sendMessage: tabsBase.sendMessage ? tabsBase.sendMessage.bind(tabsBase) : call('tabs.sendMessage', { noop: true }),
    connect: tabsBase.connect ? tabsBase.connect.bind(tabsBase) : undefined,
    onCreated: ev('tabs.onCreated'), onRemoved: ev('tabs.onRemoved'), onUpdated: ev('tabs.onUpdated'),
    onActivated: ev('tabs.onActivated'), onReplaced: ev('tabs.onReplaced')
  }));
  if (!has('windows')) put('windows', {
    WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2,
    get: call('windows.get'), getCurrent: call('windows.getCurrent'), getLastFocused: call('windows.getLastFocused'),
    getAll: call('windows.getAll'), create: call('windows.create'), update: call('windows.update'), remove: call('windows.remove'),
    onCreated: ev('windows.onCreated'), onRemoved: ev('windows.onRemoved'), onFocusChanged: ev('windows.onFocusChanged')
  });
  if (!has('webNavigation')) put('webNavigation', {
    getFrame: call('webNavigation.getFrame'), getAllFrames: call('webNavigation.getAllFrames'),
    onBeforeNavigate: ev('webNavigation.onBeforeNavigate'), onCommitted: ev('webNavigation.onCommitted'),
    onCompleted: ev('webNavigation.onCompleted'), onCreatedNavigationTarget: ev('webNavigation.onCreatedNavigationTarget'),
    onDOMContentLoaded: ev('webNavigation.onDOMContentLoaded'), onErrorOccurred: ev('webNavigation.onErrorOccurred'),
    onHistoryStateUpdated: ev('webNavigation.onHistoryStateUpdated'), onReferenceFragmentUpdated: ev('webNavigation.onReferenceFragmentUpdated'),
    onTabReplaced: ev('webNavigation.onTabReplaced')
  });
  if (!has('contextMenus')) {
    let n = 0;
    const cbs = {};
    let internal = false;
    const menus = {
      create(props, cb) {
        if (props.id === undefined) props.id = String(++n);
        if (props.onclick) {
          if (!internal) { internal = true; menus.onClicked.addListener((info, tab) => { const f = cbs[info.menuItemId]; if (f && tab) f(info, tab); }); }
          cbs[props.id] = props.onclick; delete props.onclick;
        }
        call('contextMenus.create')(props, cb || (() => {}));
        return props.id;
      },
      update: call('contextMenus.update', { noop: true }), remove: call('contextMenus.remove'), removeAll: call('contextMenus.removeAll'),
      onClicked: ev('contextMenus.onClicked')
    };
    put('contextMenus', menus);
  }
  if (!has('commands')) put('commands', { getAll: call('commands.getAll', { noop: true, def: [] }), onCommand: ev('commands.onCommand') });
  if (!has('privacy')) put('privacy', {
    network: { networkPredictionEnabled: setting(), webRTCIPHandlingPolicy: setting() },
    services: { autofillAddressEnabled: setting(), autofillCreditCardEnabled: setting(), passwordSavingEnabled: setting() },
    websites: { hyperlinkAuditingEnabled: setting() }
  });
  if (chrome.storage && chrome.storage.local) {
    const st = chrome.storage;
    // In Electron storage.managed (admin policy) returns the ENTIRE local store. uBO writes it back at startup as
    // 'cachedManagedStorage': each launch the store contained a copy of itself and grew exponentially
    // (158 MB after 3 launches, 10+ s startup). managed always answers empty; sync maps to local.
    // storage.session is left alone (missing in Electron; uBO uses its own in-memory fallback).
    const emptyGet = function (_k, cb) { if (typeof _k === 'function') cb = _k; if (cb) cb({}); return Promise.resolve({}); };
    const empty = { get: emptyGet, getBytesInUse: (_k, cb) => { if (typeof _k === 'function') cb = _k; if (cb) cb(0); return Promise.resolve(0); }, onChanged: { addListener() {}, removeListener() {} } };
    const setp = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, configurable: true, enumerable: true, writable: true }); } catch {} try { if (o[k] !== v) o[k] = v; } catch {} };
    // chrome.storage can't always be modified; replace managed first, else replace managed.get itself
    setp(st, 'managed', empty);
    if (st.managed !== empty && st.managed) setp(st.managed, 'get', emptyGet);
    if (st.sync !== st.local) setp(st, 'sync', st.local);
    self.__mondiumManagedFix = st.managed === empty || (st.managed && st.managed.get === emptyGet);
  }
})();
