'use strict';
// Mondium uyumluluk katmani (ana surec tarafi): chrome.userScripts.
// Uzanti service worker'i (user-scripts-sw.js) betik kaydeder; burada saklanir ve her web sayfasi acilirken
// page-preload.js istedigi betikleri alip uzantiya ozel ayrik bir dunyada calistirir. Mesajlar iki yonde aktarilir:
//   sayfa  -> chrome.runtime.sendMessage -> burasi -> uzanti (onUserScriptMessage)
//   uzanti -> chrome.tabs.sendMessage    -> burasi -> sayfa  (chrome.runtime.onMessage)
// Bellek: bekleyen istekler zaman asiminda silinir, betik kodlari uzanti basina bir kez okunur.
const fs = require('fs');
const path = require('path');
const { ipcMain, webContents } = require('electron');

const DEFAULT_CSP = "script-src 'self' 'unsafe-eval'";
const WORLD_BASE = 1200;
const TIMEOUT = 30e3;

function matchPattern(pattern, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;              // sadece web sayfalari
  if (pattern === '<all_urls>') return true;
  const m = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  if (m[1] !== '*' && m[1] + ':' !== u.protocol) return false;
  const host = m[2].replace(/:\d+$/, '');
  if (host !== '*') {
    if (host.startsWith('*.')) { const h = host.slice(2); if (u.hostname !== h && !u.hostname.endsWith('.' + h)) return false; }
    else if (u.hostname !== host) return false;
  }
  const re = new RegExp('^' + m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(u.pathname + u.search);
}

function setupUserScripts({ ses, storeFile }) {
  const extApi = ses.extensions && typeof ses.extensions.getExtension === 'function' ? ses.extensions : ses;
  if (typeof ses.registerPreloadScript !== 'function' || !ses.serviceWorkers) return false;
  ses.registerPreloadScript({ id: 'mondium-userscripts-sw', type: 'service-worker', filePath: path.join(__dirname, 'user-scripts-sw.js') });

  // ---- Kayitlar (yeniden baslatmada da gecerli, uzanti calismadan ilk sayfalar da betik alsin)
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(storeFile, 'utf8')) || {}; } catch {}
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.promises.writeFile(storeFile, JSON.stringify(reg)).catch(() => {}), 500); };
  const entry = (extId) => (reg[extId] = reg[extId] || { world: {}, scripts: [] });

  const codeCache = new Map();   // dosya yolu -> kod
  function readCode(ext, file) {
    const full = path.resolve(ext.path, String(file).replace(/^\//, ''));
    if (!full.startsWith(path.resolve(ext.path) + path.sep)) return null;   // uzanti klasorunun disina cikma
    if (!codeCache.has(full)) { try { codeCache.set(full, fs.readFileSync(full, 'utf8')); } catch { codeCache.set(full, null); } }
    return codeCache.get(full);
  }
  const loadedExt = (extId) => { try { return extApi.getExtension(extId) || null; } catch { return null; } };
  if (typeof extApi.on === 'function') {
    extApi.on('extension-loaded', () => codeCache.clear());     // guncellenen uzanti yeni kodunu kullansin
    extApi.on('extension-unloaded', () => codeCache.clear());
  }

  const normalize = (s) => ({
    id: String(s.id || ''), matches: Array.isArray(s.matches) ? s.matches.map(String) : [],
    excludeMatches: Array.isArray(s.excludeMatches) ? s.excludeMatches.map(String) : [],
    allFrames: !!s.allFrames, runAt: ['document_start', 'document_end', 'document_idle'].includes(s.runAt) ? s.runAt : 'document_idle',
    js: Array.isArray(s.js) ? s.js.filter((j) => j && (typeof j.file === 'string' || typeof j.code === 'string')).map((j) => (j.file ? { file: j.file } : { code: j.code })) : []
  });

  // ---- Uzanti service worker'lari
  const attached = new WeakSet();
  const workers = new Map();                       // uzanti kimligi -> calisan worker
  const pending = new Map();                       // istek no -> { resolve, timer }
  let nextReq = 1;
  const wait = (reqId) => new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(reqId); resolve(undefined); }, TIMEOUT);
    pending.set(reqId, { resolve, timer });
  });
  const settle = (reqId, value) => { const p = pending.get(reqId); if (!p) return; pending.delete(reqId); clearTimeout(p.timer); p.resolve(value); };

  function swCall(extId, op, args) {
    const e = entry(extId);
    switch (op) {
      case 'configureWorld': e.world = { csp: typeof args[0].csp === 'string' ? args[0].csp : undefined, messaging: !!args[0].messaging }; save(); return {};
      case 'register': {
        const list = (Array.isArray(args[0]) ? args[0] : []).map(normalize);
        for (const s of list) {
          if (!s.id) return { error: 'Script id must not be empty' };
          if (e.scripts.some((x) => x.id === s.id)) return { error: `Duplicate script ID '${s.id}': is already registered` };
        }
        e.scripts.push(...list); save(); return {};
      }
      case 'update': {
        for (const s of (Array.isArray(args[0]) ? args[0] : [])) {
          const i = e.scripts.findIndex((x) => x.id === s.id);
          if (i < 0) return { error: `Script with ID '${s.id}' does not exist` };
          e.scripts[i] = normalize({ ...e.scripts[i], ...s });
        }
        save(); return {};
      }
      case 'unregister': {
        const ids = args[0] && Array.isArray(args[0].ids) ? args[0].ids : null;
        e.scripts = ids ? e.scripts.filter((x) => !ids.includes(x.id)) : [];
        save(); return {};
      }
      case 'getScripts': {
        const ids = args[0] && Array.isArray(args[0].ids) ? args[0].ids : null;
        return e.scripts.filter((x) => !ids || ids.includes(x.id)).map((x) => ({ ...x, world: 'USER_SCRIPT' }));
      }
      case 'tabMessage': {
        const wc = webContents.fromId(Number(args[0]));
        if (!wc || wc.isDestroyed()) return undefined;
        const reqId = nextReq++;
        try { wc.send('mondium-us-tabmsg', extId, reqId, args[1]); } catch { return undefined; }
        return wait(reqId);
      }
    }
    return { error: 'Bilinmeyen işlem' };
  }

  function attach(versionId) {
    let w;
    try { w = ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { return; }
    if (!w || !w.scope || !w.scope.startsWith('chrome-extension://')) return;
    const extId = new URL(w.scope).host;
    workers.set(extId, w);
    if (attached.has(w)) return;
    attached.add(w);
    w.ipc.handle('mondium-us', (_e, op, ...args) => swCall(extId, op, args));   // kimlik worker'in kendi adresinden alinir
    w.ipc.on('mondium-us-reply', (_e, reqId, value) => settle(reqId, value));
  }
  ses.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
    if (runningStatus === 'starting' || runningStatus === 'running') attach(versionId);
  });
  try { for (const id of Object.keys(ses.serviceWorkers.getAllRunning())) attach(Number(id)); } catch {}

  async function workerFor(extId) {
    const w = workers.get(extId);
    if (w && !(w.isDestroyed && w.isDestroyed())) return w;
    workers.delete(extId);
    try { const started = await ses.serviceWorkers.startWorkerForScope(`chrome-extension://${extId}/`); attach(started.versionId); return started; }
    catch { return null; }
  }

  // ---- Sayfa tarafi
  // Sayfa acilirken (preload, senkron): bu adrese uyan betikler
  ipcMain.on('mondium-us-get', (e, url) => {
    const out = [];
    try {
      if (e.senderFrame && e.senderFrame.parent) { e.returnValue = out; return; }   // simdilik sadece ana kare
      Object.keys(reg).forEach((extId, i) => {
        const ext = loadedExt(extId);
        if (!ext || !reg[extId].scripts.length) return;
        const pack = { extId, worldId: WORLD_BASE + i, name: ext.name || extId, csp: reg[extId].world.csp || DEFAULT_CSP, start: [], end: [], idle: [] };
        for (const s of reg[extId].scripts) {
          if (!s.matches.some((p) => matchPattern(p, url)) || s.excludeMatches.some((p) => matchPattern(p, url))) continue;
          const slot = s.runAt === 'document_start' ? pack.start : s.runAt === 'document_end' ? pack.end : pack.idle;
          for (const j of s.js) {
            const code = j.code != null ? j.code : readCode(ext, j.file);
            if (code) slot.push({ code, url: `chrome-extension://${extId}/${j.file || s.id}` });
          }
        }
        if (pack.start.length || pack.end.length || pack.idle.length) out.push(pack);
      });
    } catch (err) { console.warn('Kullanici betikleri hazirlanamadi:', err.message); }
    e.returnValue = out;
  });

  // Sayfadan uzantiya mesaj
  ipcMain.handle('mondium-us-msg', async (e, extId, msg) => {
    if (!reg[extId] || !loadedExt(extId)) return undefined;
    const wc = e.sender;
    const frame = e.senderFrame;
    const sender = {
      id: extId, url: frame ? frame.url : wc.getURL(), origin: frame ? frame.origin : undefined,
      frameId: frame && frame.parent ? frame.routingId : 0,
      tab: { id: wc.id, url: wc.getURL(), title: wc.getTitle(), active: true, index: 0, windowId: 1, incognito: false, status: wc.isLoading() ? 'loading' : 'complete' }
    };
    const w = await workerFor(extId);
    if (!w) return undefined;
    const reqId = nextReq++;
    try { w.send('mondium-us-deliver', reqId, msg, sender); } catch { return undefined; }
    return wait(reqId);
  });
  // Sayfanin uzantiya cevabi (chrome.tabs.sendMessage karsiligi)
  ipcMain.on('mondium-us-tabreply', (_e, reqId, value) => settle(reqId, value));

  // Kaldirilmis uzantilarin kayitlarini temizle
  setTimeout(() => {
    let changed = false;
    for (const extId of Object.keys(reg)) {
      if (!loadedExt(extId) && !fs.existsSync(path.join(path.dirname(storeFile), 'Extensions', extId))) { delete reg[extId]; changed = true; }
    }
    if (changed) save();
  }, 60e3);
  return true;
}

module.exports = { setupUserScripts, matchPattern };
