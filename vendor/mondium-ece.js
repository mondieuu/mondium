// Mondium: uBlock Origin sayfalarinin ilk betigi (tools/ublock-guncelle.js her HTML'in basina ekler).
// Eksik chrome.* API'lerini electron-chrome-extensions'in ana surecteki uygulamasina baglar (kopru: mv2-bridge.js).
// Var olan (Electron'un kendi) API'lere dokunmaz; sadece eksikleri ekler ya da genisletir.
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
  // Yeni Chromium 'browser' adli ayri bir nesne de koyuyor; uBO onu varsa chrome'un yerine kullaniyor (vapi.js) ve
  // eklenen API'ler kayboluyordu. Ayri 'browser' kaldirilir; uBO 'browser = chrome' yapar ve bu nesneyi kullanir.
  if (self.browser && self.browser !== self.chrome) { try { delete self.browser; } catch {} if (self.browser) { try { self.browser = undefined; } catch {} } }
  const put = (name, value) => { try { Object.defineProperty(chrome, name, { value, configurable: true, enumerable: true, writable: true }); } catch {} };
  const has = (name) => !!chrome[name];

  // Simge resmi (ImageData) ana surece metin olarak gider
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
  // Sekmeler: Electron'un kendi executeScript/insertCSS/sendMessage'i korunur, gerisi eklenir
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
    // Electron'da storage.managed (yonetici ayarlari) yerel deponun TAMAMINI donduruyor. uBO acilista bunu
    // 'cachedManagedStorage' olarak yerel depoya geri yaziyor: depo her acilista kendi kopyasini icerip katlanarak
    // buyuyordu (3 acilista 158 MB, acilis 10+ sn). managed her zaman bos cevap verir; sync yerel depoya gider.
    // storage.session'a dokunulmaz (Electron'da yok; uBO kendi bellek ici yedegini kullanir).
    const emptyGet = function (_k, cb) { if (typeof _k === 'function') cb = _k; if (cb) cb({}); return Promise.resolve({}); };
    const empty = { get: emptyGet, getBytesInUse: (_k, cb) => { if (typeof _k === 'function') cb = _k; if (cb) cb(0); return Promise.resolve(0); }, onChanged: { addListener() {}, removeListener() {} } };
    const setp = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, configurable: true, enumerable: true, writable: true }); } catch {} try { if (o[k] !== v) o[k] = v; } catch {} };
    // chrome.storage nesnesi her zaman degistirilemiyor; once icinden, olmazsa managed.get'in kendisi degistirilir
    setp(st, 'managed', empty);
    if (st.managed !== empty && st.managed) setp(st.managed, 'get', emptyGet);
    if (st.sync !== st.local) setp(st, 'sync', st.local);
    self.__mondiumManagedFix = st.managed === empty || (st.managed && st.managed.get === emptyGet);
  }
})();
