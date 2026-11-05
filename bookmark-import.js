'use strict';
// Baska tarayicidan yer isareti aktarma (sadece bu bilgisayarda okunur, hicbir yere gonderilmez; kaynak dosyalara yazilmaz).
// - Chromium tabanlilar (Chrome, Edge, Brave, Opera, Vivaldi, Yandex, Chromium): profil klasorundeki "Bookmarks" JSON
// - Firefox: places.sqlite (tarayici aciksa kilitli olabilir: gecici kopyasi okunur)
// - Diger her sey: disari aktarilmis HTML dosyasi (Netscape yer isareti bicimi; Safari, Firefox, Chrome hepsi uretir)
// Cikti: [{ title, url, path: ['Klasor', 'Alt klasor'] }]  (path bos = kok)
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

// Kullanici veri klasoru (icinde Local State + profil klasorleri) olan tarayicilar
const CHROMIUM_FAMILY = [
  { key: 'chrome', name: 'Google Chrome', dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data') },
  { key: 'edge', name: 'Microsoft Edge', dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data') },
  { key: 'brave', name: 'Brave', dir: path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { key: 'vivaldi', name: 'Vivaldi', dir: path.join(LOCAL, 'Vivaldi', 'User Data') },
  { key: 'yandex', name: 'Yandex Browser', dir: path.join(LOCAL, 'Yandex', 'YandexBrowser', 'User Data') },
  { key: 'chromium', name: 'Chromium', dir: path.join(LOCAL, 'Chromium', 'User Data') },
  { key: 'thorium', name: 'Thorium', dir: path.join(LOCAL, 'Thorium', 'User Data') }
];
// Opera: profil dogrudan bu klasor (yeni surumlerde "Default" alt klasoru de olabilir)
const OPERA_FAMILY = [
  { key: 'opera', name: 'Opera', dir: path.join(ROAMING, 'Opera Software', 'Opera Stable') },
  { key: 'operagx', name: 'Opera GX', dir: path.join(ROAMING, 'Opera Software', 'Opera GX Stable') }
];

const okUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 4096;
const clean = (s, max = 200) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ---------------------------------------------------------------- Chromium "Bookmarks" JSON
function readChromiumBookmarks(file) {
  const j = readJson(file);
  if (!j || !j.roots) return null;
  const out = [];
  const visit = (node, trail) => {
    if (!node || out.length > 20000) return;
    if (node.type === 'url') { if (okUrl(node.url)) out.push({ title: clean(node.name) || node.url, url: node.url, path: trail }); return; }
    for (const c of node.children || []) visit(c, c.type === 'folder' ? trail.concat(clean(c.name, 80) || 'Klasör') : trail);
  };
  // Yer isaretleri cubugu kokte, digerleri kendi klasorlerinde (Chrome'un "Diger yer isaretleri" gibi)
  visit(j.roots.bookmark_bar, []);
  if (j.roots.other && (j.roots.other.children || []).length) visit(j.roots.other, ['Diğer yer işaretleri']);
  if (j.roots.synced && (j.roots.synced.children || []).length) visit(j.roots.synced, ['Mobil yer işaretleri']);
  return out;
}
function chromiumProfiles(b) {
  const out = [];
  if (!fs.existsSync(b.dir)) return out;
  const state = readJson(path.join(b.dir, 'Local State'));
  const cache = (state && state.profile && state.profile.info_cache) || {};
  let dirs = [];
  try { dirs = fs.readdirSync(b.dir).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)); } catch {}
  for (const d of dirs) {
    const file = path.join(b.dir, d, 'Bookmarks');
    if (!fs.existsSync(file)) continue;
    const label = (cache[d] && cache[d].name) || (d === 'Default' ? 'Varsayılan profil' : d);
    out.push({ id: `${b.key}:${d}`, browser: b.name, profile: label, kind: 'chromium', file });
  }
  return out;
}
function operaProfiles(b) {
  const out = [];
  for (const f of [path.join(b.dir, 'Bookmarks'), path.join(b.dir, 'Default', 'Bookmarks')]) {
    if (fs.existsSync(f)) { out.push({ id: `${b.key}:${out.length}`, browser: b.name, profile: out.length ? 'Default' : 'Varsayılan profil', kind: 'chromium', file: f }); }
  }
  return out;
}

// ---------------------------------------------------------------- Firefox places.sqlite
function firefoxProfiles() {
  const out = [];
  const root = path.join(ROAMING, 'Mozilla', 'Firefox');
  const profilesDir = path.join(root, 'Profiles');
  let dirs = [];
  try { dirs = fs.readdirSync(profilesDir); } catch { return out; }
  for (const d of dirs) {
    const file = path.join(profilesDir, d, 'places.sqlite');
    if (fs.existsSync(file)) out.push({ id: `firefox:${d}`, browser: 'Mozilla Firefox', profile: d.replace(/^[a-z0-9]+\./i, ''), kind: 'firefox', file });
  }
  return out;
}
function readFirefoxBookmarks(file) {
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch { return null; }
  // Firefox aciksa veritabani kilitli ve son degisiklikler -wal dosyasinda: ikisini birlikte gecici klasore kopyala
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-ff-'));
  const copy = path.join(tmp, 'places.sqlite');
  try {
    fs.copyFileSync(file, copy);
    for (const ext of ['-wal', '-shm']) { try { fs.copyFileSync(file + ext, copy + ext); } catch {} }
    const db = new sqlite.DatabaseSync(copy, { readOnly: false });
    try {
      const rows = db.prepare(`SELECT b.id, b.type, b.parent, b.title AS btitle, b.position, b.guid, p.url, p.title AS ptitle
        FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const kids = new Map();
      for (const r of rows) { if (!kids.has(r.parent)) kids.set(r.parent, []); kids.get(r.parent).push(r); }
      const out = [];
      const visit = (id, trail) => {
        for (const r of kids.get(id) || []) {
          if (out.length > 20000) return;
          if (r.type === 1 && okUrl(r.url)) out.push({ title: clean(r.btitle || r.ptitle) || r.url, url: r.url, path: trail });
          else if (r.type === 2) visit(r.id, trail.concat(clean(r.btitle, 80) || 'Klasör'));
        }
      };
      const root = (guid) => rows.find((r) => r.guid === guid);
      const toolbar = root('toolbar_____'), menu = root('menu________'), unfiled = root('unfiled_____'), mobile = root('mobile______');
      if (toolbar) visit(toolbar.id, []);
      if (menu) visit(menu.id, ['Yer işaretleri menüsü']);
      if (unfiled) visit(unfiled.id, ['Diğer yer işaretleri']);
      if (mobile) visit(mobile.id, ['Mobil yer işaretleri']);
      void byId;
      return out;
    } finally { db.close(); }
  } catch { return null; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// ---------------------------------------------------------------- HTML (Netscape) dosyasi
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});
function parseBookmarksHtml(html) {
  const out = [];
  const trail = [];
  let pending = null;   // <H3> okundu, <DL> bekleniyor
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
  let m, depth = 0;
  const stack = [];   // her <DL> icin klasor adi eklendi mi
  while ((m = re.exec(html)) && out.length <= 20000) {
    const tag = m[0].slice(0, 3).toLowerCase();
    if (m[1] !== undefined) { pending = clean(unent(m[1].replace(/<[^>]+>/g, '')), 80) || 'Klasör'; continue; }
    if (m[2] !== undefined) {
      const href = /href\s*=\s*"([^"]*)"/i.exec(m[2]) || /href\s*=\s*'([^']*)'/i.exec(m[2]);
      const url = href ? unent(href[1]) : '';
      if (okUrl(url)) out.push({ title: clean(unent(m[3].replace(/<[^>]+>/g, ''))) || url, url, path: trail.slice() });
      continue;
    }
    if (tag === '<dl') {
      depth++;
      // Ilk <DL> kok; "Bookmarks bar"/"Favorites bar" gibi cubuk klasoru koke acilir
      if (pending && depth > 1) {
        const isBar = /^(bookmarks bar|bookmarks toolbar|favorites bar|yer işaretleri çubuğu|sık kullanılanlar çubuğu|favoriler çubuğu)$/i.test(pending);
        if (!isBar || depth > 2) { trail.push(pending); stack.push(true); } else stack.push(false);
      } else stack.push(false);
      pending = null;
      continue;
    }
    if (tag === '</d') { depth--; if (stack.pop()) trail.pop(); pending = null; }
  }
  return out;
}

// ---------------------------------------------------------------- Disari
function listSources() {
  const out = [];
  for (const b of CHROMIUM_FAMILY) out.push(...chromiumProfiles(b));
  for (const b of OPERA_FAMILY) out.push(...operaProfiles(b));
  out.push(...firefoxProfiles());
  for (const s of out) {
    const items = readSource(s);
    s.count = items ? items.length : 0;
    s.ok = !!items;
    delete s.file;   // dosya yolu sayfaya gitmez
  }
  return out;
}
const fileOf = new Map();
function readSource(s) {
  if (s.file) fileOf.set(s.id, { file: s.file, kind: s.kind });
  const f = fileOf.get(s.id);
  if (!f) return null;
  return f.kind === 'firefox' ? readFirefoxBookmarks(f.file) : readChromiumBookmarks(f.file);
}
function readSourceById(id) {
  if (!fileOf.size) listSources();
  const f = fileOf.get(id);
  if (!f) return null;
  return f.kind === 'firefox' ? readFirefoxBookmarks(f.file) : readChromiumBookmarks(f.file);
}
function readHtmlFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 50 * 1024 * 1024) return null;
    return parseBookmarksHtml(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

module.exports = { listSources, readSourceById, readHtmlFile, parseBookmarksHtml, readChromiumBookmarks, readFirefoxBookmarks };
