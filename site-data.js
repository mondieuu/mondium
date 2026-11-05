'use strict';
// Protected Sites and selective site data clearing (main process).
//
// Engine tools (Electron 44 / Chromium 152, measured):
//  - Cookies: CDP Network.getAllCookies (with partitionKey of partitioned CHIPS cookies) and
//    Network.deleteCookies (ONE cookie by name + domain + path + partitionKey). Electron's cookies API
//    gives no partitionKey; session.clearData's exclude list deletes a protected site's partitioned cookies.
//  - Storage: CDP Storage.clearDataForStorageKey -> full storage key (incl. partition). "https://embed/^0https://a"
//    deletes only the embed partition under a. session.clearData(excludeOrigins) cannot protect subdomains or
//    other ports/schemes, so it is not used.
//  - Inventory: Chromium QuotaManager database (WebStorage/QuotaManager, read-only COPY, node:sqlite) =
//    IndexedDB / Cache Storage / service worker / OPFS buckets with last-use times. localStorage is outside quota:
//    only META:<storage key> keys are read from "Local Storage/leveldb" files (values are not read).
//  - Usage: CDP Storage.getUsageAndQuota for first-party origins (engine-measured), on-disk size of the
//    WebStorage/<bucket> folder for partitioned buckets. localStorage size cannot be measured per site.
// Security: cookie VALUES are never kept/logged; internal (chrome-extension:, file:) origins are untouched;
// no protected target ever enters the delete list (protected data is safe even if the run is interrupted).
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

let parseTld = null;
try { ({ parse: parseTld } = require('tldts-experimental')); } catch {}

// ---------------------------------------------------------------- Site rules
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[?[0-9a-f:]+\]?$/i.test(h) && h.includes(':');
// A host's "site": registrable domain (private suffixes included: user.github.io is its own site),
// an IP is itself, localhost and its subdomains are "localhost". Invalid/public suffix -> null.
function siteOfHost(host) {
  host = String(host || '').toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host) return null;
  if (isIp(host)) return host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost';
  if (!parseTld) return host.split('.').slice(-2).join('.');
  const p = parseTld(host, { allowPrivateDomains: true });
  return p.domain || null;
}
const siteOfOrigin = (o) => { try { const u = new URL(o); return /^(https?|wss?):$/.test(u.protocol) ? siteOfHost(u.hostname) : null; } catch { return null; } };
const displaySite = (s) => { try { return url.domainToUnicode(s) || s; } catch { return s; } };

// Turn user input into a protection entry. Handles URLs, uppercase, leading/trailing dots, IDNs
// (converted to punycode); port/path are stripped. Public suffixes ("com", "co.uk", "github.io") are rejected.
function normalizeInput(text) {
  let raw = String(text || '').trim();
  if (!raw) return { error: 'Bir alan adı ya da adres yazın.' };
  if (/\s/.test(raw)) return { error: 'Alan adında boşluk olamaz.' };
  raw = raw.replace(/^\.+/, '');
  let host;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw);
    if (!/^(https?|wss?):$/.test(u.protocol)) return { error: 'Sadece web siteleri korunabilir (http/https).' };
    host = u.hostname.replace(/\.+$/, '');
  } catch { return { error: 'Geçerli bir alan adı değil.' }; }
  if (!host) return { error: 'Geçerli bir alan adı değil.' };
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIp(host)) return { site: bare, display: bare, kind: 'ip', note: 'IP adresi: sadece bu adres korunur (tüm port ve protokoller).' };
  if (host === 'localhost' || host.endsWith('.localhost')) return { site: 'localhost', display: 'localhost', kind: 'localhost', note: 'localhost ve alt adları korunur (tüm portlar).' };
  if (!parseTld) return { site: host, display: displaySite(host), kind: 'domain' };
  const p = parseTld(host, { allowPrivateDomains: true });
  if (!p.domain) {
    const priv = p.isPrivate || parseTld(host).domain;   // private suffix? (like github.io)
    return { error: priv
      ? `"${displaySite(host)}" ortak bir barındırma adı: altındaki her kullanıcı sitesi ayrıdır. Kendi sitenizi yazın (ör. kullaniciadi.${displaySite(host)}).`
      : `"${displaySite(host)}" bir genel son ek (ör. com, co.uk); site olarak korunamaz.` };
  }
  const site = p.domain;
  const note = host !== site ? `${displaySite(host)} yerine ${displaySite(site)} korunur (tüm alt alan adlarıyla birlikte).` : 'Tüm alt alan adları da korunur.';
  return { site, display: displaySite(site), kind: 'domain', note, private: !!p.isPrivate };
}

// Known identity provider dependencies: shown as suggestions, NEVER added automatically.
const IDP_DEPS = {
  'youtube.com': ['google.com'], 'gmail.com': ['google.com'], 'blogger.com': ['google.com'], 'google.com.tr': ['google.com'],
  'outlook.com': ['live.com', 'microsoftonline.com'], 'office.com': ['microsoftonline.com', 'live.com'], 'xbox.com': ['live.com'],
  'microsoft.com': ['microsoftonline.com', 'live.com'], 'sharepoint.com': ['microsoftonline.com'], 'skype.com': ['live.com'],
  'icloud.com': ['apple.com'], 'instagram.com': ['facebook.com'], 'messenger.com': ['facebook.com'], 'threads.net': ['instagram.com']
};
const IDP_NAMES = { 'google.com': 'Google', 'live.com': 'Microsoft hesabı', 'microsoftonline.com': 'Microsoft iş/okul hesabı', 'apple.com': 'Apple Kimliği', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram' };

// ---------------------------------------------------------------- Storage key
// "https://a.test:8443/" | "https://embed.test:8443/^0https://a.test" | localStorage form (no trailing /)
function parseStorageKey(key) {
  const parts = String(key).split('^');
  const origin = parts[0].replace(/\/$/, '');
  const top = parts.slice(1).find((p) => p[0] === '0');
  const nonce = parts.slice(1).some((p) => p[0] === '1');
  return { origin, topSite: top ? top.slice(1) : null, nonce, canonical: origin + '/' + (parts.length > 1 ? '^' + parts.slice(1).join('^') : '') };
}
const isWebOrigin = (o) => /^https?:\/\//i.test(o);

// ---------------------------------------------------------------- LevelDB key reader (localStorage inventory)
// Only keys are read. Log (.log) + table (.ldb) files, Snappy decompressor. The record with the highest
// sequence number wins for each key (deletion markers included).
function snappy(buf) {
  let pos = 0, len = 0, shift = 0;
  for (;;) { const b = buf[pos++]; len += (b & 0x7f) * 2 ** shift; if (b < 0x80) break; shift += 7; }
  const out = Buffer.alloc(len); let op = 0;
  while (pos < buf.length && op < len) {
    const tag = buf[pos++], t = tag & 3;
    if (t === 0) {
      let l = tag >> 2;
      if (l >= 60) { const n = l - 59; l = 0; for (let i = 0; i < n; i++) l += buf[pos++] * 2 ** (8 * i); }
      l += 1; buf.copy(out, op, pos, pos + l); pos += l; op += l;
    } else {
      let l, off;
      if (t === 1) { l = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | buf[pos++]; }
      else if (t === 2) { l = (tag >> 2) + 1; off = buf[pos] | (buf[pos + 1] << 8); pos += 2; }
      else { l = (tag >> 2) + 1; off = buf.readUInt32LE(pos); pos += 4; }
      for (let i = 0; i < l; i++, op++) out[op] = out[op - off];
    }
  }
  return out;
}
function varint(b, p) { let v = 0, s = 0; for (;;) { const x = b[p++]; v += (x & 0x7f) * 2 ** s; if (x < 0x80) return [v, p]; s += 7; } }
function blockEntries(block, cb) {
  if (block.length < 4) return;
  const n = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - n * 4;
  let p = 0, key = Buffer.alloc(0);
  while (p < end) {
    let shared, ns, vl;
    [shared, p] = varint(block, p); [ns, p] = varint(block, p); [vl, p] = varint(block, p);
    key = Buffer.concat([key.subarray(0, shared), block.subarray(p, p + ns)]); p += ns;
    cb(key, block.subarray(p, p + vl)); p += vl;
  }
}
function readTable(file, add) {
  const f = fs.readFileSync(file);
  if (f.length < 48) return;
  const foot = f.subarray(f.length - 48);
  let p = 0, mo, ms, io, is;
  [mo, p] = varint(foot, p); [ms, p] = varint(foot, p); [io, p] = varint(foot, p); [is, p] = varint(foot, p);
  const blk = (o, s) => { const raw = f.subarray(o, o + s); return f[o + s] === 1 ? snappy(raw) : raw; };
  blockEntries(blk(io, is), (_k, handle) => {
    let q = 0, bo, bs;
    [bo, q] = varint(handle, q); [bs, q] = varint(handle, q);
    blockEntries(blk(bo, bs), (ikey) => {
      if (ikey.length < 8) return;
      const trailer = ikey.readBigUInt64LE(ikey.length - 8);
      add(ikey.subarray(0, ikey.length - 8), Number(trailer >> 8n), Number(trailer & 0xffn));
    });
  });
}
function readLog(file, add) {
  const f = fs.readFileSync(file);
  let rec = [];
  for (let blockStart = 0; blockStart < f.length; blockStart += 32768) {
    let p = blockStart;
    const blockEnd = Math.min(blockStart + 32768, f.length);
    while (p + 7 <= blockEnd) {
      const len = f.readUInt16LE(p + 4), type = f[p + 6];
      if (type === 0 && len === 0) break;
      const data = f.subarray(p + 7, p + 7 + len);
      p += 7 + len;
      if (type === 1) rec = [data]; else if (type === 2) rec = [data]; else if (type === 3) rec.push(data); else if (type === 4) rec.push(data);
      if (type === 1 || type === 4) {
        const b = Buffer.concat(rec); rec = [];
        if (b.length < 12) continue;
        const seq = Number(b.readBigUInt64LE(0)); const count = b.readUInt32LE(8);
        let q = 12;
        for (let i = 0; i < count && q < b.length; i++) {
          const tag = b[q++]; let kl, vl;
          [kl, q] = varint(b, q); const key = b.subarray(q, q + kl); q += kl;
          if (tag === 1) { [vl, q] = varint(b, q); q += vl; }
          add(key, seq + i, tag);
        }
      }
    }
  }
}
// Local Storage leveldb: live META:<storage key> list. null if unreadable (the inventory reports it).
function localStorageKeys(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((x) => /\.(log|ldb|sst)$/.test(x)); } catch { return null; }
  const latest = new Map();
  const add = (key, seq, type) => {
    if (key.length < 6 || key.toString('latin1', 0, 5) !== 'META:') return;
    const k = key.toString('utf8', 5);
    const cur = latest.get(k);
    if (!cur || seq > cur.seq) latest.set(k, { seq, type });
  };
  for (const x of files) {
    try { if (x.endsWith('.log')) readLog(path.join(dir, x), add); else readTable(path.join(dir, x), add); } catch { /* corrupt/partial file: skip */ }
  }
  return [...latest].filter(([, v]) => v.type === 1).map(([k]) => k);
}

// ---------------------------------------------------------------- QuotaManager (read-only copy)
const WIN_EPOCH_US = 11644473600000000n;
function quotaBuckets(storagePath) {
  const src = path.join(storagePath, 'WebStorage', 'QuotaManager');
  if (!fs.existsSync(src)) return [];
  const dst = path.join(os.tmpdir(), `mondium-qm-${process.pid}-${Date.now()}.db`);
  try {
    fs.copyFileSync(src, dst);
    try { fs.copyFileSync(src + '-journal', dst + '-journal'); } catch {}
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dst, { readOnly: true });
    const st = db.prepare('SELECT id, storage_key, host, last_accessed, last_modified FROM buckets');
    st.setReadBigInts(true);
    const rows = st.all().map((r) => ({
      id: Number(r.id), key: r.storage_key, host: r.host,
      lastAccessed: r.last_accessed > WIN_EPOCH_US ? Number((r.last_accessed - WIN_EPOCH_US) / 1000n) : null,
      lastModified: r.last_modified > WIN_EPOCH_US ? Number((r.last_modified - WIN_EPOCH_US) / 1000n) : null
    }));
    db.close();
    return rows;
  } finally {
    try { fs.rmSync(dst, { force: true }); fs.rmSync(dst + '-journal', { force: true }); } catch {}
  }
}
function dirSize(d) {
  let n = 0;
  try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {}
  return n;
}

// ---------------------------------------------------------------- Module
function createSiteData({ getSession, getProtected, setProtected, openTabUrls, makeDebugTarget }) {
  let busy = false;
  let progress = null;

  // Temporary hidden target for CDP commands (same session). Closed when done.
  async function withCdp(fn) {
    const t = await makeDebugTarget();
    try {
      t.debugger.attach('1.3');
      return await fn((m, p) => t.debugger.sendCommand(m, p || {}));
    } finally {
      try { t.debugger.detach(); } catch {}
      try { t.close(); } catch {}
    }
  }

  // Real inventory: each record maps to its owner site (the TOP-LEVEL site for partitioned data).
  async function collect(cdp, measure) {
    const ses = getSession();
    const storagePath = ses.getStoragePath();
    const items = [];   // { kind:'cookie'|'key', owner, ... }
    // Cookies (values are discarded immediately)
    const ck = await cdp('Network.getAllCookies');
    for (const c of ck.cookies || []) {
      const host = c.domain.replace(/^\./, '');
      const own = siteOfHost(host);
      const pk = c.partitionKey && c.partitionKey.topLevelSite;
      const owner = pk ? siteOfOrigin(pk) : own;
      if (!owner) continue;
      items.push({ kind: 'cookie', owner, dataSite: own, name: c.name, domain: c.domain, path: c.path, partitionKey: c.partitionKey || null,
        session: !!c.session, httpOnly: !!c.httpOnly, secure: !!c.secure, id: `${c.name}|${c.domain}|${c.path}|${pk || ''}` });
    }
    // Quota buckets (IndexedDB, Cache Storage, service worker, OPFS)
    let bucketsOk = true, buckets = [];
    try { buckets = quotaBuckets(storagePath); } catch { bucketsOk = false; }
    const keyMap = new Map();
    for (const b of buckets) {
      const k = parseStorageKey(b.key);
      if (!isWebOrigin(k.origin) || k.nonce) continue;
      const owner = k.topSite ? siteOfOrigin(k.topSite) : siteOfOrigin(k.origin);
      if (!owner) continue;
      const cur = keyMap.get(k.canonical) || { kind: 'key', key: k.canonical, origin: k.origin, topSite: k.topSite, owner, dataSite: siteOfOrigin(k.origin), sources: [], bucketIds: [], lastAccessed: null, lastModified: null };
      cur.sources.push('kota'); cur.bucketIds.push(b.id);
      cur.lastAccessed = Math.max(cur.lastAccessed || 0, b.lastAccessed || 0) || null;
      cur.lastModified = Math.max(cur.lastModified || 0, b.lastModified || 0) || null;
      keyMap.set(k.canonical, cur);
    }
    // localStorage (outside quota)
    const ls = localStorageKeys(path.join(storagePath, 'Local Storage', 'leveldb'));
    for (const raw of ls || []) {
      const k = parseStorageKey(raw);
      if (!isWebOrigin(k.origin) || k.nonce) continue;
      const owner = k.topSite ? siteOfOrigin(k.topSite) : siteOfOrigin(k.origin);
      if (!owner) continue;
      const cur = keyMap.get(k.canonical) || { kind: 'key', key: k.canonical, origin: k.origin, topSite: k.topSite, owner, dataSite: siteOfOrigin(k.origin), sources: [], bucketIds: [], lastAccessed: null, lastModified: null };
      cur.sources.push('localStorage');
      keyMap.set(k.canonical, cur);
    }
    // A bucket RECORD does not mean data exists: Chromium keeps it after deletion (measured). So each bucket
    // is measured by real usage: first-party -> engine quota usage, partitioned -> WebStorage/<bucket> size.
    // Records with 0 usage and no live localStorage key are not listed (no data).
    for (const it of keyMap.values()) {
      if (!it.topSite) {
        try { const r = await cdp('Storage.getUsageAndQuota', { origin: it.origin }); it.bytes = r.usage; it.types = (r.usageBreakdown || []).filter((x) => x.usage > 0).map((x) => x.storageType); } catch { it.bytes = null; }
      } else {
        it.bytes = it.bucketIds.reduce((n, id) => n + dirSize(path.join(storagePath, 'WebStorage', String(id))), 0);
        it.types = it.bytes ? ['bölümlenmiş'] : [];
      }
      const hasLs = it.sources.includes('localStorage');
      if (it.bytes === 0 && !hasLs) continue;                     // empty (deleted) bucket
      if (!it.bytes && hasLs && it.bytes !== null) it.bytes = null; // localStorage only: size unmeasurable
      items.push(it);
    }
    return { items, bucketsOk, lsOk: ls !== null };
  }

  function openSites() {
    const set = new Set();
    for (const u of openTabUrls()) { const s = siteOfOrigin(u); if (s) set.add(s); }
    return set;
  }

  // Per-site summary for the "Cookies and site data" list on the settings page
  async function inventory() {
    const P = new Set(getProtected());
    const open = openSites();
    const inv = await withCdp((cdp) => collect(cdp, true));
    const sites = new Map();
    const get = (s) => {
      if (!sites.has(s)) sites.set(s, { site: s, display: displaySite(s), protected: P.has(s), open: open.has(s), cookies: 0, partitionedCookies: 0, sessionCookies: 0,
        keys: 0, partitions: 0, embedded: new Set(), bytes: 0, unmeasured: 0, types: new Set(), lastUsed: null, lsOnly: 0 });
      return sites.get(s);
    };
    for (const it of inv.items) {
      const e = get(it.owner);
      if (it.kind === 'cookie') {
        e.cookies++; if (it.partitionKey) { e.partitionedCookies++; if (it.dataSite) e.embedded.add(it.dataSite); } if (it.session) e.sessionCookies++;
      } else {
        e.keys++;
        if (it.topSite) { e.partitions++; if (it.dataSite) e.embedded.add(it.dataSite); }
        if (it.bytes == null) e.unmeasured++; else e.bytes += it.bytes;
        for (const t of it.types || []) e.types.add(t);
        if (it.sources.includes('localStorage')) e.types.add('local_storage');
        if (it.sources.length === 1 && it.sources[0] === 'localStorage') e.lsOnly++;
        if (it.lastAccessed) e.lastUsed = Math.max(e.lastUsed || 0, it.lastAccessed);
      }
    }
    const list = [...sites.values()].map((e) => ({ ...e, embedded: [...e.embedded].filter((x) => x !== e.site).map(displaySite), types: [...e.types] }));
    return { sites: list, bucketsOk: inv.bucketsOk, lsOk: inv.lsOk, at: Date.now() };
  }

  const RANGE_MS = { hour: 3600e3, day: 864e5, week: 7 * 864e5, month: 28 * 864e5 };
  const STORAGE_TYPES = 'file_systems,indexeddb,local_storage,service_workers,cache_storage,storage_buckets,shared_storage';

  // Clearing. opts: { cookies, siteData, protect, range: 'all'|'hour'|'day'|'week'|'month', onlySite? }
  // onlySite: delete a single site from the list (explicit user choice; protection does not apply to it).
  async function clear(opts) {
    if (busy) return { error: 'Bir temizlik zaten sürüyor.' };
    busy = true;
    progress = { phase: 'envanter', done: 0, total: 0 };
    const P = new Set(opts.protect ? getProtected() : []);   // consistent snapshot
    const range = RANGE_MS[opts.range] ? opts.range : 'all';
    const cutoff = range === 'all' ? 0 : Date.now() - RANGE_MS[range];
    const notes = [];
    const errors = [];
    try {
      return await withCdp(async (cdp) => {
        const before = await collect(cdp, false);
        if (!before.bucketsOk) notes.push('Depolama kayıt veritabanı okunamadı; IndexedDB/önbellek gibi veriler bu temizlikte hedeflenemedi.');
        if (!before.lsOk) notes.push('localStorage kayıtları okunamadı; sadece başka depolaması olan sitelerin localStorage verisi temizlendi.');
        const inScope = (it) => (opts.onlySite ? it.owner === opts.onlySite : !P.has(it.owner));
        const targets = [];
        const kept = new Set();
        for (const it of before.items) {
          if (!inScope(it)) { if (P.has(it.owner)) kept.add(it.owner); continue; }
          if (it.kind === 'cookie') {
            if (!opts.cookies) continue;
            if (range !== 'all') continue;   // engine gives no cookie creation time (see note below)
            targets.push(it);
          } else {
            if (!opts.siteData) continue;
            if (range !== 'all') {
              if (!it.sources.includes('kota') || !it.lastModified || it.lastModified < cutoff) continue;   // unknown time / too old
            }
            targets.push(it);
          }
        }
        if (range !== 'all' && opts.cookies) notes.push('Çerezler silinmedi: motor çerezlerin oluşturulma zamanını vermiyor, zaman aralığı uygulanamıyor. Çerezleri silmek için "Tüm zamanlar"ı seçin.');
        if (range !== 'all' && opts.siteData) notes.push('Site depolamasında yalnızca motorun "son değişiklik" zamanını tuttuğu veriler (IndexedDB, Cache Storage, service worker, OPFS) aralığa göre seçildi; zamanı bilinmeyen localStorage verisine dokunulmadı.');
        progress = { phase: 'siliniyor', done: 0, total: targets.length };
        let sentCookies = 0, sentKeys = 0;
        for (const it of targets) {
          try {
            if (it.kind === 'cookie') {
              await cdp('Network.deleteCookies', { name: it.name, domain: it.domain, path: it.path, ...(it.partitionKey ? { partitionKey: it.partitionKey } : {}) });
              sentCookies++;
            } else {
              await cdp('Storage.clearDataForStorageKey', { storageKey: it.key, storageTypes: STORAGE_TYPES });
              sentKeys++;
            }
          } catch (e) {
            errors.push({ type: it.kind === 'cookie' ? 'çerez' : 'site verisi', site: displaySite(it.owner), detail: it.kind === 'cookie' ? it.name : it.origin, error: String(e.message || e).slice(0, 160) });
          }
          progress.done++;
        }
        // Verification: re-read the real inventory
        progress = { phase: 'doğrulanıyor', done: targets.length, total: targets.length };
        await new Promise((r) => setTimeout(r, 400));
        const after = await collect(cdp, false);
        const left = new Set(after.items.map((x) => (x.kind === 'cookie' ? 'c:' + x.id : 'k:' + x.key)));
        const open = openSites();
        const remaining = [];
        let goneCookies = 0, goneKeys = 0;
        for (const it of targets) {
          const id = it.kind === 'cookie' ? 'c:' + it.id : 'k:' + it.key;
          if (!left.has(id)) { if (it.kind === 'cookie') goneCookies++; else goneKeys++; continue; }
          remaining.push({ site: displaySite(it.owner), what: it.kind === 'cookie' ? `çerez "${it.name}"` : `depolama ${it.origin}${it.topSite ? ' (' + displaySite(siteOfOrigin(it.topSite) || it.topSite) + ' içinde)' : ''}`,
            reason: open.has(it.owner) || (it.dataSite && open.has(it.dataSite)) ? 'Bu sitenin açık sekmesi var; sayfa veriyi yeniden oluşturmuş olabilir.' : 'Silme isteği gönderildi ama veri hâlâ duruyor.' });
        }
        // Unprotected data newly created after clearing (not in the target list)
        const targetIds = new Set(targets.map((it) => (it.kind === 'cookie' ? 'c:' + it.id : 'k:' + it.key)));
        const recreated = [];
        for (const it of after.items) {
          const id = it.kind === 'cookie' ? 'c:' + it.id : 'k:' + it.key;
          if (targetIds.has(id) || !inScope(it)) continue;
          const existed = before.items.some((b) => (b.kind === 'cookie' ? 'c:' + b.id : 'k:' + b.key) === id);
          if (!existed) recreated.push(displaySite(it.owner));
        }
        return {
          ok: true, range,
          requested: { cookies: sentCookies, keys: sentKeys },
          deleted: { cookies: goneCookies, keys: goneKeys },
          remaining, errors, notes,
          protectedKept: [...kept].map(displaySite).sort(),
          newDuring: [...new Set(recreated)].sort()
        };
      });
    } catch (e) {
      return { error: 'Temizlik tamamlanamadı: ' + String(e.message || e).slice(0, 200), errors, notes };
    } finally {
      busy = false;
      progress = null;
    }
  }

  return {
    siteOfHost, siteOfOrigin, displaySite, normalizeInput, inventory, clear,
    status: () => ({ busy, progress }),
    depsFor(site) {
      const P = new Set(getProtected());
      return (IDP_DEPS[site] || []).filter((d) => !P.has(d)).map((d) => ({ site: d, display: displaySite(d), name: IDP_NAMES[d] || d }));
    },
    list: () => getProtected().map((s) => ({ site: s, display: displaySite(s) })),
    add(text) {
      const n = normalizeInput(text);
      if (n.error) return n;
      const cur = getProtected();
      if (cur.includes(n.site)) return { ...n, duplicate: true, error: `${n.display} zaten korunuyor.` };
      setProtected([...cur, n.site].sort());
      return { ok: true, ...n, deps: this.depsFor(n.site) };
    },
    remove(site) { setProtected(getProtected().filter((s) => s !== site)); return { ok: true }; },
    setSite(site, on) {
      const s = siteOfHost(site);
      if (!s) return { error: 'Geçersiz site' };
      const cur = getProtected().filter((x) => x !== s);
      setProtected(on ? [...cur, s].sort() : cur);
      return { ok: true, site: s, deps: on ? this.depsFor(s) : [] };
    }
  };
}

module.exports = { createSiteData, siteOfHost, siteOfOrigin, normalizeInput, parseStorageKey, localStorageKeys, displaySite };
