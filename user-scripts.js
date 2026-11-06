'use strict';
// Mondium compatibility layer (main process side): chrome.userScripts.
// The extension service worker (user-scripts-sw.js) registers scripts; they are stored here, and as each web page
// opens page-preload.js fetches matching scripts and runs them in an extension-specific isolated world. Messages flow both ways:
//   page      -> chrome.runtime.sendMessage -> here -> extension (onUserScriptMessage)
//   extension -> chrome.tabs.sendMessage    -> here -> page      (chrome.runtime.onMessage)
// Memory: pending requests are dropped on timeout, script code is read once per extension.
const fs = require('fs');
const path = require('path');
const { ipcMain, webContents } = require('electron');

const DEFAULT_CSP = "script-src 'self' 'unsafe-eval'";
const WORLD_BASE = 1200;
const TIMEOUT = 30e3;

function matchPattern(pattern, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;              // web pages only
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

  // ---- Registrations (persist across restarts so the first pages get scripts before the extension runs)
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(storeFile, 'utf8')) || {}; } catch {}
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.promises.writeFile(storeFile, JSON.stringify(reg)).catch(() => {}), 500); };
  const entry = (extId) => (reg[extId] = reg[extId] || { world: {}, scripts: [] });

  const codeCache = new Map();   // file path -> code
  function readCode(ext, file) {
    let full;
    try { full=fs.realpathSync(path.resolve(ext.path, String(file).replace(/^\//, ''))); } catch { return null; }
    let root;try{root=fs.realpathSync(ext.path);}catch{return null;}
    const relative=path.relative(root,full);if(relative.startsWith('..')||path.isAbsolute(relative))return null;
    if(fs.statSync(full).size>1024*1024)return null;   // don't escape the extension folder
    if (!codeCache.has(full)) { try { codeCache.set(full, fs.readFileSync(full, 'utf8')); } catch { codeCache.set(full, null); } }
    return codeCache.get(full);
  }
  const permitted = (ext) => !!ext && (ext.manifest?.permissions || []).includes('userScripts');
  const hostAllowed = (ext, url) => permitted(ext) && [...(ext.manifest.host_permissions || []), ...(ext.manifest.permissions || []).filter(p => p === '<all_urls>' || p.includes('://'))].some(p => matchPattern(p, url));
  const issued = new Map(); // WebContents -> extensions actually injected into the current document
  const loadedExt = (extId) => { try { return extApi.getExtension(extId) || null; } catch { return null; } };
  if (typeof extApi.on === 'function') {
    extApi.on('extension-loaded', () => codeCache.clear());     // updated extensions use their new code
    extApi.on('extension-unloaded', () => codeCache.clear());
  }

  const normalize = (s) => ({
    id: String(s.id || ''), matches: Array.isArray(s.matches) ? s.matches.map(String) : [],
    excludeMatches: Array.isArray(s.excludeMatches) ? s.excludeMatches.map(String) : [],
    allFrames: !!s.allFrames, runAt: ['document_start', 'document_end', 'document_idle'].includes(s.runAt) ? s.runAt : 'document_idle',
    js: Array.isArray(s.js) ? s.js.filter((j) => j && (typeof j.file === 'string' || typeof j.code === 'string')).map((j) => (j.file ? { file: j.file } : { code: j.code })) : []
  });

  // ---- Extension service workers
  const attached = new WeakSet();
  const workers = new Map();                       // extension id -> running worker
  const pending = new Map();                       // request no -> { resolve, timer }
  let nextReq = 1;
  const wait = (reqId, owner) => new Promise((resolve) => {
    if(pending.size>=256){resolve(undefined);return;}
    const timer = setTimeout(() => { pending.delete(reqId); resolve(undefined); }, TIMEOUT);
    pending.set(reqId, { resolve, timer, owner });
  });
  const settle = (reqId, value, owner) => { const p = pending.get(reqId); if (!p || p.owner !== owner) return; pending.delete(reqId); clearTimeout(p.timer); p.resolve(value); };

  function swCall(extId, op, args) {
    const ext=loadedExt(extId);
    if (!permitted(ext)) return { error: 'userScripts permission required' };
    const e = entry(extId);
    switch (op) {
      case 'configureWorld': e.world = { csp: typeof args[0].csp === 'string' ? args[0].csp : undefined, messaging: !!args[0].messaging }; save(); return {};
      case 'register': {
        if(!Array.isArray(args[0])||args[0].length>128)return {error:'Invalid script batch'};
        const list = args[0].map(normalize);
        if (e.scripts.length + list.length > 128) return { error: 'Too many scripts' };
        for (const s of list) {
          if (!s.matches.length || s.js.reduce((n,j)=>n+(j.code?.length||0),0)>1024*1024) return { error: 'Invalid or oversized script' };
          if (!s.id) return { error: 'Script id must not be empty' };
          if (e.scripts.some((x) => x.id === s.id)) return { error: `Duplicate script ID '${s.id}': is already registered` };
        }
        e.scripts.push(...list); save(); return {};
      }
      case 'update': {
        if(!Array.isArray(args[0])||args[0].length>128)return {error:'Invalid script batch'};
        const changes=[];
        for (const s of args[0]) {
          const i = e.scripts.findIndex((x) => x.id === s.id);
          if (i < 0) return { error: `Script with ID '${s.id}' does not exist` };
          const next=normalize({ ...e.scripts[i], ...s });
          if(!next.matches.length||next.js.reduce((n,j)=>n+(j.code?.length||0),0)>1024*1024)return {error:'Invalid or oversized script'};
          changes.push([i,next]);
        }
        for(const [i,next]of changes)e.scripts[i]=next;
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
        if (!wc || wc.isDestroyed() || wc.session !== ses || !hostAllowed(ext,wc.getURL()) || !issued.get(wc.id)?.has(extId)) return undefined;
        const reqId = nextReq++;
        try { wc.send('mondium-us-tabmsg', extId, reqId, args[1]); } catch { return undefined; }
        return wait(reqId, wc.id);
      }
    }
    return { error: 'Unknown action' };
  }

  function attach(versionId) {
    let w;
    try { w = ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { return; }
    if (!w || !w.scope || !w.scope.startsWith('chrome-extension://')) return;
    const extId = new URL(w.scope).host;
    workers.set(extId, w);
    if (attached.has(w)) return;
    attached.add(w);
    w.ipc.handle('mondium-us', (_e, op, ...args) => swCall(extId, op, args));   // id is taken from the worker's own URL
    w.ipc.on('mondium-us-reply', (_e, reqId, value) => settle(reqId, value, extId));
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

  // ---- Page side
  // On page open (preload, sync): scripts matching this URL
  ipcMain.on('mondium-us-get', (e, url) => {
    const out = [];
    try {
      if (e.sender.session !== ses || !e.senderFrame || e.senderFrame.url !== url) { e.returnValue = out; return; }
      if (e.senderFrame.parent) { e.returnValue=out;return; }
      if(!issued.has(e.sender.id))e.sender.once('destroyed',()=>issued.delete(e.sender.id));
      issued.set(e.sender.id,new Set());
      if (e.senderFrame && e.senderFrame.parent) { e.returnValue = out; return; }   // main frame only for now
      Object.keys(reg).forEach((extId, i) => {
        const ext = loadedExt(extId);
        if (!hostAllowed(ext,url) || !reg[extId].scripts.length) return;
        const pack = { extId, worldId: WORLD_BASE + i, name: ext.name || extId, csp: reg[extId].world.csp || DEFAULT_CSP, start: [], end: [], idle: [] };
        for (const s of reg[extId].scripts) {
          if (!s.matches.some((p) => matchPattern(p, url)) || s.excludeMatches.some((p) => matchPattern(p, url))) continue;
          const slot = s.runAt === 'document_start' ? pack.start : s.runAt === 'document_end' ? pack.end : pack.idle;
          for (const j of s.js) {
            const code = j.code != null ? j.code : readCode(ext, j.file);
            if (code) slot.push({ code, url: `chrome-extension://${extId}/${j.file || s.id}` });
          }
        }
        if (pack.start.length || pack.end.length || pack.idle.length) { out.push(pack);issued.get(e.sender.id).add(extId); }
      });
    } catch (err) { console.warn('Could not prepare user scripts:', err.message); }
    e.returnValue = out;
  });

  // Page -> extension message
  ipcMain.handle('mondium-us-msg', async (e, extId, msg) => {
    if (e.sender.session !== ses || !reg[extId] || !hostAllowed(loadedExt(extId), e.senderFrame?.url || '') || !issued.get(e.sender.id)?.has(extId)) return undefined;
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
    return wait(reqId, extId);
  });
  // Page's reply to the extension (for chrome.tabs.sendMessage)
  ipcMain.on('mondium-us-tabreply', (e, reqId, value) => { if(e.sender.session===ses)settle(reqId, value, e.sender.id); });

  // Purge registrations of removed extensions
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
