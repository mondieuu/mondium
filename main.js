'use strict';
/*
 * Mondium - hafif, gizlilik odakli tarayici (Electron / Chromium motoru)
 *  - Google hesabi / senkronizasyon / oturum acma zorunlulugu YOK
 *  - Telemetri, crash raporu, Safe Browsing, ceviri, yazim denetimi indirmesi KAPALI
 *  - Her zaman acik reklam/izleyici engelleyici (uBlock Origin filtre listeleri)
 *  - Google varsayilan arama; Google cerezleri/verileri kapanista silinir
 *  - WebHID / WebUSB / Web Serial / Web Bluetooth: tarayici tabanli cihaz yazilimi siteleri icin
 *  - Thorium'dan: DoH, DNT+GPC, paralel indirme, HEVC, yer isaretleri cubugu, ana sayfa dugmesi,
 *    yenile menusu (normal / sert / onbellegi temizle), tam URL gosterimi, sayfalari koyu gosterme
 */
const {
  app, BaseWindow, WebContentsView, session, ipcMain, Menu, clipboard,
  dialog, shell, nativeTheme, net, Notification, webFrameMain, webContents, screen
} = require('electron');
// castLabs Electron (Widevine DRM). Standart Electron'da yoktur; o durumda DRM'siz calisilir.
const { components } = require('electron');
const I18N = require('./i18n');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { createSiteData } = require('./site-data');
const bookmarkImport = require('./bookmark-import');

// Test icin ayri profil klasoru: kullanicinin acik Mondium'una ve verilerine dokunmaz (tek kopya kilidi de klasore bagli)
if (process.env.MONDIUM_PROFILE) app.setPath('userData', process.env.MONDIUM_PROFILE);

// Uzanti destegi (Chrome Web Magazasi + chrome.* API'leri). Yuklenemezse tarayici uzantisiz calismaya devam eder.
let ECE = null, CWS = null, extensions = null;
try { ({ ElectronChromeExtensions: ECE } = require('electron-chrome-extensions')); } catch (e) { console.warn('Uzanti kutuphanesi yok:', e.message); }
try { CWS = require('electron-chrome-web-store'); } catch (e) { console.warn('Web Magazasi kutuphanesi yok:', e.message); }

const isMac = process.platform === 'darwin';

(function migrateOldProfile() {
  const dst = app.getPath('userData');
  const src = path.join(path.dirname(dst), 'Chromium');
  if (fs.existsSync(path.join(dst, 'ayarlar.json')) || !fs.existsSync(path.join(src, 'ayarlar.json'))) return;
  const SKIP = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|GPUPersistentCache|GrShaderCache|ShaderCache|blob_storage|Crashpad|DevToolsActivePort|Singleton.*|lockfile|filtre-motoru\.bin)$/i;
  try {
    fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false, filter: (p) => !SKIP.test(path.basename(p)) });
    console.log('Eski Chromium profili Mondium klasorune tasindi.');
  } catch (e) { console.warn('Eski profil tasinamadi:', e.message); }
})();

// Reklam engelleyici kutuphanesi, kapanmis karelerde betik calistiramayinca yakalanmamis hata birakiyor.
// Zararsiz; terminali doldurmasin diye susturuluyor, diger hatalar yine gorunur.
process.on('unhandledRejection', (e) => {
  if (e && /Script failed to execute/.test(e.message || '')) return;
  console.error('Yakalanmamis hata:', e);
});

// ---------------------------------------------------------------- Kalici ayarlar
const SETTINGS_FILE = path.join(app.getPath('userData'), 'ayarlar.json');
const DEFAULTS = {
  searchEngine: 'google',
  bookmarksBar: true,        // Thorium: varsayilan acik
  fullUrl: true,             // Thorium: tam URL gosterimi
  forceDarkPages: false,
  strictIsolation: false,    // true = Chrome gibi her site ayri surecte (cok daha fazla RAM); false = sadece giris/odeme/korunan siteler ayri
  clearGoogleOnExit: false,  // acikken Google cerez/site verisi kapanista silinir (Google oturumu kapanir)
  keepLogins: true,          // sitelerdeki oturumlar kapanista kaybolmasin (oturum cerezleri kalici yapilir)
  newtabTitle: 'Mondium',    // yeni sekme sayfasindaki baslik (bos = gizli)
  theme: 'sistem',
  firstRunDone: false,
  shortcuts: [],             // yeni sekme sayfasindaki favoriler {title, url, icon}
  bookmarks: [],
  sitePerms: {},             // "origin|izin" -> true/false
  deviceGrants: [],          // {type, origin, vendorId, productId, serialNumber}
  unpackedExtensions: [],    // klasorden yuklenen uzantilar
  disabledExtensions: [],    // kapatilan uzantilar {id, path}: dosyalari durur, yuklenmez (RAM harcamaz)
  hiddenExtensions: [],      // arac cubugunda simgesi gizlenen uzanti kimlikleri
  hoverZoom: true,           // yerlesik resim buyutme (Imagus benzeri), varsayilan acik
  tabAudio: true,            // sekmelerde hoparlor simgesi + tiklayinca sessize alma (kapaliyken ikisi de yok)
  sleepTabs: true,           // kullanilmayan arka plan sekmelerini uyut (sleepMinutes sonra)
  verticalTabs: false,       // dikey sekmeler (solda kenar cubugu)
  verticalWidth: 240,        // dikey kenar cubugu genisligi (px); en dar halinde sadece simgeler
  verticalAutoHide: false,
  language: 'auto',         // arayuz dili: 'auto' (Windows dili) | 'tr' | 'en'
  sideEdge: 2,               // GECICI test ayari: saklanma modunda kenar cubugunu acan sol kenar genisligi (px)
  pitchBlack: false,         // koyu temada tam siyah
  protectedSites: [],        // Korunan Siteler: temizlikte cerez ve site verisi silinmeyen siteler (kayit edilebilir alan adi)
  clearPrefs: { range: 'all', history: true, downloads: false, cookies: true, cache: false, protect: true },   // temizleme penceresinin son secimi   // saklanma modu: kenar cubugu gizli, fare sol kenara gelince ayni genislikte acilir (Ctrl+S)
  adblockEngine: 'ubo',      // 'ubo' = yerlesik uBlock Origin (en guclu, ~250 MB daha fazla RAM), 'hafif' = Mondium motoru
  restoreSession: true,      // acilista onceki sekmeler (uyutulmus olarak) geri gelir
  sleepMinutes: 10,          // arka plan sekmesi bu kadar dakika sonra uyutulur
  downloadNotify: true       // indirme bitince Windows bildirimi
};
const SLEEP_CHOICES = [5, 10, 30, 60];
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function saveSettings(now = false) {
  clearTimeout(saveTimer);
  const write = () => { try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.warn('Ayarlar kaydedilemedi:', e.message); } };
  if (now) write(); else saveTimer = setTimeout(write, 300);
}
// Eski kurulumlarda bir kez: kullanici sitelerde oturumun acik kalmasini istedi; Google silme kapatilir
if (!settings.keepLoginsSet) { settings.clearGoogleOnExit = false; settings.keepLogins = true; settings.keepLoginsSet = true; saveSettings(true); }
// Kasim 2026: resim buyutme artik varsayilan acik (eski kurulumlarda dosyada "kapali" yazili oldugu icin bir kez acilir)
if (!settings.hoverZoomOnSet) { settings.hoverZoom = true; settings.hoverZoomOnSet = true; saveSettings(true); }
// Eski "Hicbir zaman" (0 dk) secimi artik ayri anahtar
if (!SLEEP_CHOICES.includes(settings.sleepMinutes)) { if (settings.sleepMinutes === 0) settings.sleepTabs = false; settings.sleepMinutes = 10; }
const SIDE_MIN = 56;    // en dar: sadece sekme simgeleri
const sideWidth = (winWidth) => Math.round(Math.max(SIDE_MIN, Math.min(settings.verticalWidth || 240, Math.max(SIDE_MIN, Math.min(560, (winWidth || 1280) * 0.6)))));

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?pws=0&udm=14&q=' }, // pws=0: kisisellestirilmemis, udm=14: AI ozeti yok
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  yandex: { name: 'Yandex', url: 'https://yandex.com.tr/search/?text=' }
};
const searchUrl = () => (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).url;

// ---------------------------------------------------------------- Filtre listeleri
const CUSTOM_LIST_URL = 'https://mondium.local/ozel-filtreler.txt';
const CUSTOM_FILTERS = [
  '! Google kullanim kayitlari ve izleme pingleri',
  '||google.com/gen_204',
  '||google.com/client_204',
  '||google.com.tr/gen_204',
  '||www.google.com/log?',
  '||play.google.com/log?',
  '||googleadservices.com^',
  '! Diger sitelerde cikan "Google ile oturum ac" acilir pencereleri',
  '||accounts.google.com/gsi/$third-party'
].join('\n');

const CONFIG = {
  filterUpdateDays: 4,
  filterLists: [
    'https://ublockorigin.github.io/uAssets/filters/filters.min.txt',
    'https://ublockorigin.github.io/uAssets/filters/badware.min.txt',
    'https://ublockorigin.github.io/uAssets/filters/privacy.min.txt',
    'https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt',
    'https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt',
    'https://ublockorigin.github.io/uAssets/filters/resource-abuse.txt',
    'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-ag-online.txt',   // uBO: Online Malicious URL Blocklist
    'https://easylist.to/easylist/easylist.txt',
    'https://easylist.to/easylist/easyprivacy.txt',
    'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    'https://filters.adtidy.org/extension/ublock/filters/13.txt', // AdGuard Turkce
    CUSTOM_LIST_URL
  ]
};
const NEWTAB_BASE = pathToFileURL(path.join(__dirname, 'newtab.html')).href;
const newtabUrl = () => NEWTAB_BASE + '#' + encodeURIComponent(searchUrl());
const isNewtab = (u) => typeof u === 'string' && u.split('#')[0] === NEWTAB_BASE;
const WELCOME_URL = pathToFileURL(path.join(__dirname, 'welcome.html')).href;
const HISTORY_URL = pathToFileURL(path.join(__dirname, 'history.html')).href;
const DOWNLOADS_URL = pathToFileURL(path.join(__dirname, 'downloads.html')).href;
const SETTINGS_URL = pathToFileURL(path.join(__dirname, 'settings.html')).href;
const EXTENSIONS_URL = pathToFileURL(path.join(__dirname, 'extensions.html')).href;
const baseOf = (u) => (typeof u === 'string' ? u.split('#')[0].split('?')[0] : '');
// Adres cubugunda gorunen ve yazilabilen kisa adlar
const PAGE_ALIASES = {
  'mondium://history': HISTORY_URL, 'mondium://gecmis': HISTORY_URL,
  'mondium://downloads': DOWNLOADS_URL, 'mondium://indirilenler': DOWNLOADS_URL,
  'mondium://settings': SETTINGS_URL, 'mondium://ayarlar': SETTINGS_URL,
  'mondium://extensions': EXTENSIONS_URL, 'mondium://uzantilar': EXTENSIONS_URL
};
function pageKind(u) {
  const b = baseOf(u);
  if (b === HISTORY_URL) return 'history';
  if (b === DOWNLOADS_URL) return 'downloads';
  if (b === SETTINGS_URL) return 'settings';
  if (b === EXTENSIONS_URL) return 'extensions';
  if (b === WELCOME_URL) return 'welcome';
  return isNewtab(u) ? 'newtab' : null;
}
const isInternal = (u) => !!pageKind(u);
function displayUrl(u) {
  const k = pageKind(u);
  if (k === 'history') return 'mondium://history';
  if (k === 'downloads') return 'mondium://downloads';
  if (k === 'settings') return 'mondium://settings';
  if (k === 'extensions') return 'mondium://extensions';
  return k ? '' : (u || '');
}

// ---------------------------------------------------------------- Gecmis ve indirme listesi (sadece bu bilgisayarda)
const HISTORY_FILE = path.join(app.getPath('userData'), 'gecmis.json');
const DOWNLOADS_FILE = path.join(app.getPath('userData'), 'indirilenler.json');
const HISTORY_MAX = 5000, HISTORY_DAYS = 90, DOWNLOADS_MAX = 100;
function readJsonArray(f) { try { const a = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } }
let history = readJsonArray(HISTORY_FILE).filter((h) => h && typeof h.url === 'string' && h.t > Date.now() - HISTORY_DAYS * 864e5);
const listTimers = {};
function writeList(f, data, now) {
  clearTimeout(listTimers[f]);
  const json = () => JSON.stringify(data());
  if (now) { try { fs.writeFileSync(f, json()); } catch (e) { console.warn('Yazilamadi:', f, e.message); } return; }
  listTimers[f] = setTimeout(() => { fsp.writeFile(f, json()).catch((e) => console.warn('Yazilamadi:', f, e.message)); }, 2000);
}
const saveHistory = (now = false) => writeList(HISTORY_FILE, () => history, now);
const saveDownloads = (now = false) => writeList(DOWNLOADS_FILE, () => downloads.filter((d) => !d.incognito).map(({ item, ...d }) => d), now);
// Oturum: acik sekmelerin adresleri. Yerel sayfalar kisa adlariyla (mondium://...) saklanir, klasor tasinsa da acilir.
const SESSION_FILE = path.join(app.getPath('userData'), 'oturum.json');
// Gizli pencereler kaydedilmez. Son normal pencere kapaninca (veya cikarken) son kayit korunur.
let lastSessionData = null, quitting = false;
function sessionData() {
  saveCtx();
  const ws = windows.filter((w) => !w.incognito);
  if (!ws.length || quitting && lastSessionData) return lastSessionData;
  lastSessionData = { windows: ws.map((w) => {
    const list = [];
    let active = 0;
    for (const t of w.tabs) {
      const k = pageKind(t.url);
      if (k === 'newtab' || k === 'welcome' || !t.url) continue;
      if (t.id === w.activeId) active = list.length;
      list.push({ url: k ? displayUrl(t.url) : t.url, title: t.title || '', favicon: t.favicon || null, pinned: !!t.pinned, muted: !!t.muted });
    }
    return { active, tabs: list };
  }).filter((x) => x.tabs.length) };
  return lastSessionData;
}
const saveSession = (now = false) => writeList(SESSION_FILE, sessionData, now);

// ------------------------------------------- Arayuz dili (i18n.js). Turkce kaynak; Ingilizce ceviri sozlukten.
// 'auto': Windows dili Turkce ise Turkce, degilse Ingilizce. Chromium'un kendi dili (siteye giden Accept-Language,
// yerlesik PDF goruntuleyici) secilen dile gore acilista ayarlanir; arayuz degisikligi aninda uygulanir.
let uiLangCache = null;
function uiLang() {
  if (uiLangCache) return uiLangCache;
  if (settings.language === 'tr' || settings.language === 'en') return (uiLangCache = settings.language);
  let sys = '';
  try { sys = (app.getPreferredSystemLanguages && app.getPreferredSystemLanguages()[0]) || app.getSystemLocale() || app.getLocale() || ''; } catch {}
  return (uiLangCache = /^tr/i.test(sys) ? 'tr' : 'en');
}
const T = (text) => I18N.translate(text, uiLang());
// Sayfaya enjekte edilen betiklerdeki (okuma modu, resim buyutme) arayuz yazilari: tek tirnakli dizeler cevrilir
const localizeSrc = (src) => (uiLang() === 'tr' ? src : src.replace(/'([^'\\\n]*)'/g, (m, x) => { const t = T(x); return t === x ? m : JSON.stringify(t); }));
ipcMain.on('mondium-lang', (e) => { e.returnValue = uiLang(); });
if (settings.language === 'en') app.commandLine.appendSwitch('lang', 'en-US');
else if (settings.language === 'tr') app.commandLine.appendSwitch('lang', 'tr');
// Yerel menuler, iletisim kutulari ve bildirimler secilen dilde
const trMenu = (list) => list.map((it) => ({ ...it, ...(it.label ? { label: T(it.label) } : {}), ...(Array.isArray(it.submenu) ? { submenu: trMenu(it.submenu) } : {}) }));
const trOpts = (o) => (o && typeof o === 'object' ? {
  ...o,
  ...(o.title ? { title: T(o.title) } : {}), ...(o.message ? { message: T(o.message) } : {}), ...(o.detail ? { detail: T(o.detail) } : {}),
  ...(o.checkboxLabel ? { checkboxLabel: T(o.checkboxLabel) } : {}), ...(Array.isArray(o.buttons) ? { buttons: o.buttons.map(T) } : {}),
  ...(Array.isArray(o.filters) ? { filters: o.filters.map((f) => ({ ...f, name: T(f.name) })) } : {})
} : o);
for (const k of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
  const orig = dialog[k];
  if (typeof orig === 'function') dialog[k] = (w, o) => (o === undefined ? orig.call(dialog, trOpts(w)) : orig.call(dialog, w, trOpts(o)));
}

// ------------------------------------------- Gizlilik + performans komut satiri anahtarlari
const cl = app.commandLine;
[
  // Not: 'disable-background-networking' ve 'disable-component-update' KULLANILMIYOR:
  // ikisi de Widevine DRM modulunun indirilmesini/guncellenmesini engelliyor (Netflix, Exxen, BluTV, Spotify...).
  // Electron'da zaten Safe Browsing, ceviri, senkronizasyon gibi arka plan servisleri yok.
  'disable-domain-reliability',
  'disable-breakpad', 'disable-client-side-phishing-detection', 'disable-default-apps',
  'disable-sync', 'no-pings', 'no-default-browser-check', 'no-first-run',
  'process-per-site'
].forEach((s) => cl.appendSwitch(s));
cl.appendSwitch('enable-features', [
  'ParallelDownloading',            // Thorium: paralel indirme
  'PlatformHEVCDecoderSupport',     // Thorium: HEVC/H.265 (donanim destekliyse)
  ...(settings.forceDarkPages ? ['WebContentsForceDark'] : [])
].join(','));
cl.appendSwitch('disable-features', [
  'BackForwardCache', 'SpareRendererForSitePerProcess', 'Translate', 'MediaRouter',
  'OptimizationHints', 'AutofillServerCommunication', 'CertificateTransparencyComponentUpdater',
  'BrowsingTopics', 'Fledge', 'InterestGroupStorage', 'PrivacySandboxAdsAPIs',
  'AttributionReportingCrossAppWeb', 'DialMediaRouteProvider',
  'WebAuthenticationConditionalUI', 'WebAuthenticationPasskeysUI'   // passkey acilir pencereleri
].join(','));
// RAM: tam site izolasyonu her ucuncu taraf iframe'i ayri surece koyuyor (olcum: 6 sitede 21 surec, 4,6 GB calisma
// bellegi; kapaliyken 8 surec, 2,8 GB). Android Chrome gibi kismi izolasyon: genel siteler surec paylasir, giris,
// odeme ve korunan siteler (oturum acilan yerler) yine kendi surecinde. Ayarlar > Gizlilik > tam izolasyon.
const ISOLATED_ORIGINS = ['https://accounts.google.com', 'https://login.microsoftonline.com', 'https://login.live.com', 'https://appleid.apple.com',
  'https://github.com', 'https://paypal.com', 'https://facebook.com', 'https://x.com', 'https://discord.com', 'https://web.whatsapp.com'];
if (!settings.strictIsolation) {
  cl.appendSwitch('disable-site-isolation-trials');
  const prot = (Array.isArray(settings.protectedSites) ? settings.protectedSites : []).filter((x) => /^[a-z0-9.-]+$/i.test(x) && x.includes('.')).map((x) => 'https://' + x);
  cl.appendSwitch('isolate-origins', [...new Set([...ISOLATED_ORIGINS, ...prot])].join(','));
}
cl.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');

// Tarayicinin degistirilmemis, orijinal kimligi (Electron ve uygulama adi ekleriyle).
// Google girisi SADECE bununla calisiyor (asagiya bakin).
const ORIGINAL_UA = app.userAgentFallback;

// Diger tum siteler icin User-Agent'i normal Chrome gibi goster
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(new RegExp('\\s?' + app.getName().replace(/[^\w]/g, '\\$&') + '\\/\\S+', 'i'), '');

if (!app.requestSingleInstanceLock()) { app.quit(); }

// ---------------------------------------------------------------- Google ile oturum acma duzeltmesi
// Google, birebir "duz Chrome" gorunen ama gercek Chrome olmayan tarayicilari e-posta adimindan sonra
// "This browser or app may not be secure" diyerek reddediyor. Firefox taklidi de yakalaniyor.
// Olculmus calisan yontem: giris sayfalarinda tarayicinin kendi, degistirilmemis kimligini kullanmak
// (Chrome surumu + uygulama adi + Electron ekleri). Istemci ipuclarina (Sec-CH-UA) dokunulmaz.
// Kaynak: github.com/stablyai/orca/issues/11518 (Eylul 2026, 12/12 olcum)
const LOGIN_UA = ORIGINAL_UA;
const GOOGLE_LOGIN_HOST = /^accounts\.(google|youtube)\.[a-z.]+$/i;
const isGoogleLogin = (u) => { try { return GOOGLE_LOGIN_HOST.test(new URL(u).hostname); } catch { return false; } };
// Google arama: AI ozetlerini (AI Overview) kapat. udm=14 = sadece web sonuclari.
const GOOGLE_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i;
function noAiUrl(u) {
  try {
    const x = new URL(u);
    if (!GOOGLE_HOST.test(x.hostname) || x.pathname !== '/search') return null;
    if (x.searchParams.has('udm') || x.searchParams.has('tbm')) return null;   // gorseller, haberler vb. sekmelere dokunma
    x.searchParams.set('udm', '14');
    return x.href;
  } catch { return null; }
}

// Bir adrese gitmeden once dogru kimlikle (User-Agent) yukle. Chromium, baslamis bir gezinmenin
// kimligini sonradan degistirmez; bu yuzden giris sayfasina gitmeden ONCE ayarlayip bastan yukluyoruz.
function prepareUrl(wc, url) {
  const fixed = noAiUrl(url) || url;
  const ua = isGoogleLogin(fixed) ? LOGIN_UA : app.userAgentFallback;
  if (wc.getUserAgent() !== ua) wc.setUserAgent(ua);
  return { url: fixed, ua };
}

function attachLoginFix(wc) {
  const reroute = (e, url) => {
    if (!url) return;
    const needsUa = isGoogleLogin(url) && wc.getUserAgent() !== LOGIN_UA;
    const fixed = noAiUrl(url);
    if (!needsUa && !fixed) return;
    e.preventDefault();
    const p = prepareUrl(wc, fixed || url);
    wc.loadURL(p.url, { userAgent: p.ua }).catch(() => {});
  };
  wc.on('will-navigate', (e, url) => reroute(e, e.url || url));
  wc.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
    const main = typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
    if (main) reroute(e, e.url || url);
  });
  // Giris bitince sonraki sayfalar icin normal Chrome kimligine don
  wc.on('did-start-navigation', (e) => {
    if (!e.isMainFrame || !e.url || e.isSameDocument) return;
    if (!isGoogleLogin(e.url) && wc.getUserAgent() === LOGIN_UA) wc.setUserAgent(app.userAgentFallback);
  });
}

// ---------------------------------------------------------------- Durum
let win = null, ui = null, ses = null, mainSes = null, blocker = null;
let findOpen = false, htmlFullscreen = false, overlayOpen = false, overlayKind = null;
const TAB_STRIP = 42, TOOLBAR = 46, BOOKMARKS = 32, FINDBAR = 40;
let tabs = [];
const byWcId = new Map();
const downloads = readJsonArray(DOWNLOADS_FILE)
  .filter((d) => d && d.file && d.id)
  .map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted', paused: false } : d));
let activeId = null, nextId = 1;

// ---------------------------------------------------------------- Pencereler
// Her pencerenin kendi sekmeleri, arayuzu, oturumu (gizli pencerede bellekte tutulan ayri oturum) ve durumu var.
// Kodun geri kalani "su anki pencere" degiskenleriyle (win, ui, ses, tabs, activeId...) calisir; her olayin
// basinda useWin() o olayin penceresine gecer. Bekleme (await) yoksa bu tek is parcacikli JS'de guvenlidir.
const windows = [];
let W = null, nextWinId = 1;
function saveCtx() { if (W) Object.assign(W, { activeId, findOpen, htmlFullscreen, overlayOpen, overlayKind, pushTimer }); }
function useWin(w) {
  if (!w || w === W || !windows.includes(w)) return W;
  saveCtx();
  W = w;
  ({ win, ui, ses, tabs, activeId, findOpen, htmlFullscreen, overlayOpen, overlayKind, closedTabs, pushTimer } = w);
  return w;
}
const winOfWc = (wc) => { const t = wc && !wc.isDestroyed() ? byWcId.get(wc.id) : null; return t ? t.w : null; };
const allTabs = () => windows.flatMap((w) => w.tabs);
// Bir isi baska pencerede yap, sonra eski pencereye don
function inWin(w, fn) {
  const prev = W;
  useWin(w);
  try { return fn(); } finally { if (prev && windows.includes(prev)) useWin(prev); }
}
const forEachWin = (fn) => { for (const w of [...windows]) inWin(w, () => fn(w)); };
const lastWin = (normalOnly) => windows.filter((w) => !normalOnly || !w.incognito).sort((a, b) => b.focusedAt - a.focusedAt)[0] || null;

const uiHeight = () => (htmlFullscreen ? 0
  : TAB_STRIP + TOOLBAR + (settings.bookmarksBar ? BOOKMARKS : 0) + (findOpen ? FINDBAR : 0));

// ---------------------------------------------------------------- Reklam engelleyici
const listSet = new Set(CONFIG.filterLists);
const safeFetch = async (url, opts) => {
  if (url === CUSTOM_LIST_URL) return new Response(CUSTOM_FILTERS);
  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  if (!listSet.has(url)) return doFetch(url, opts);
  try {
    const r = await doFetch(url, opts);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } catch (e) {
    console.warn('Liste atlandi:', url, e.message);
    return new Response('');
  }
};

let blockerReadyResolve;
const blockerReady = new Promise((r) => { blockerReadyResolve = r; });
// v3: uBO varsayilan listelerinin tamami (resource-abuse + kotu amacli adresler). Liste degisince ad degisir, motor yeniden kurulur.
const engineCache = () => path.join(app.getPath('userData'), 'filtre-motoru-v3.bin');
const oldEngineCache = () => path.join(app.getPath('userData'), 'filtre-motoru-v2.bin');   // yenisi kurulana kadar kullanilir

async function buildBlocker() {
  const b = await ElectronBlocker.fromLists(safeFetch, CONFIG.filterLists, {
    enableCompression: true, loadCosmeticFilters: true, loadNetworkFilters: true
  });
  await fsp.writeFile(engineCache(), b.serialize());
  fsp.rm(oldEngineCache(), { force: true }).catch(() => {});
  return b;
}

async function loadBlocker() {
  let cached = null, stale = true;
  for (const f of [engineCache(), oldEngineCache()]) {
    try {
      const st = await fsp.stat(f);
      cached = ElectronBlocker.deserialize(new Uint8Array(await fsp.readFile(f)));
      stale = f !== engineCache() || Date.now() - st.mtimeMs > CONFIG.filterUpdateDays * 864e5;   // eski surum: hemen yeniden kur
      break;
    } catch { /* yok: digerini dene / ilk calistirma */ }
  }
  try {
    if (cached) {
      attachBlocker(cached);
      if (stale) buildBlocker().then(attachBlocker).catch((e) => console.warn('Filtre guncellenemedi:', e.message));
    } else {
      try { attachBlocker(await buildBlocker()); }
      catch (e) { console.warn(e.message); attachBlocker(await ElectronBlocker.fromPrebuiltAdsAndTracking(safeFetch)); }
    }
  } catch (e) {
    console.error('Reklam engelleyici yuklenemedi:', e);
  }
  blockerReadyResolve();
  forEachWin(() => pushState());
}

// ---------------------------------------------------------------- Yerlesik uBlock Origin
// Normal pencerelerde engellemeyi gercek uBlock Origin yapar (vendor/ublock, resmi chromium paketi; guncellemek icin
// "node tools/ublock-guncelle.js"). Electron MV2 uzantilari ve engelleyen chrome.webRequest'i destekliyor; eksik API'ler
// mv2-bridge.js + vendor/mondium-ece.js ile electron-chrome-extensions'a baglaniyor. Mondium'un kendi motoru (Ghostery)
// bu durumda ana oturumda HIC yuklenmez (cift engelleyici yok, RAM yok); sadece gizli pencere acilinca o oturum icin
// yuklenir. uBO yuklenemezse ana oturum da eskisi gibi Mondium'un motoruna doner.
const UBO_DIR = path.join(__dirname, 'vendor', 'ublock').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');   // uzantilar asar icinden yuklenemez
let uboId = null;
let eceReadyResolve;
const eceReady = new Promise((r) => { eceReadyResolve = r; });
let mainBlockResolve;
const mainBlockReady = new Promise((r) => { mainBlockResolve = r; });
let ghosteryP = null;
const ensureGhostery = () => ghosteryP || (ghosteryP = loadBlocker());
const uboPage = (p) => (uboId ? `chrome-extension://${uboId}/${p}` : null);

async function startUBlock() {
  if (process.env.MONDIUM_NO_UBO || settings.adblockEngine === 'hafif' || !fs.existsSync(path.join(UBO_DIR, 'manifest.json'))) return false;
  await eceReady;   // arac cubugu simgesi icin uzanti kutuphanesi once kurulmali
  try { mainSes.registerPreloadScript({ id: 'mondium-mv2-bridge', type: 'frame', filePath: path.join(__dirname, 'mv2-bridge.js') }); } catch {}
  const e = await Promise.race([extApi().loadExtension(UBO_DIR, { allowFileAccess: false }), timeout(20000).then(() => { throw new Error('uBO yuklenemedi (20 sn)'); })]);
  uboId = e.id;
  // uBO filtreleri onbellekten yukleyip hazir olana kadar sayfalar bekler (ilk istekler engelsiz kacmasin). En fazla 10 sn.
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const bg = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(`chrome-extension://${uboId}/background.html`));
    if (bg) { try { if (await Promise.race([bg.executeJavaScript('!!(self.µBlock && self.µBlock.readyToFilter)'), timeout(1000)])) break; } catch {} }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`uBlock Origin ${e.version} hazir (${Date.now() - t0} ms)`);
  return true;
}
async function startBlocking() {
  let ok = false;
  try { ok = await startUBlock(); } catch (e) { console.warn('uBlock Origin baslatilamadi, Mondium motoru kullanilacak:', e.message); }
  if (!ok) { blockSession(mainSes); await ensureGhostery(); }
  mainBlockResolve();
  forEachWin(() => pushState());
}

async function forceUpdateFilters() {
  if (uboId && W && !W.incognito) { newTab(uboPage('dashboard.html#3p-filters.html')); return; }   // uBO kendi listelerini gunceller
  try {
    attachBlocker(await buildBlocker());
    dialog.showMessageBox(win, { message: 'Filtre listeleri güncellendi.' });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Güncellenemedi: ' + e.message });
  }
}

// Kutuphane sayfa ici (kozmetik) engelleme icin genel iki IPC kanali kaydediyor ve ikinci oturumda "zaten kayitli"
// hatasiyla yarida kaliyor (gizli pencerede ag engellemesi hic kurulmuyordu). Kanallar oturumdan bagimsiz
// (istegi yapan sayfaya cevap veriyor); ana oturum kaydeder, digerleri paylasir.
function withSharedIpc(fn) {
  const h = ipcMain.handle, r = ipcMain.removeHandler;
  ipcMain.handle = (ch, f) => { try { h.call(ipcMain, ch, f); } catch { /* ana oturumunki kullanilir */ } };
  ipcMain.removeHandler = () => {};
  try { return fn(); } finally { ipcMain.handle = h; ipcMain.removeHandler = r; }
}
function blockerToggle(b, s, on) {
  const run = () => (on ? b.enableBlockingInSession(s) : b.disableBlockingInSession(s));
  try { if (s === mainSes) run(); else withSharedIpc(run); } catch (e) { console.warn('Engelleyici:', e.message); }
}
const blockerSessions = new Set();
function blockSession(s) {
  if (blockerSessions.has(s)) return;
  blockerSessions.add(s);
  if (blocker) blockerToggle(blocker, s, true);
}
// Kutuphane hatasi: bir iframe'in istedigi sayfa ici betikleri (uBO scriptlet) o iframe'e degil ANA sayfaya
// calistiriyor (event.sender = tum sekme). YouTube gibi cok iframe'li sayfalarda ayni betikler ana sayfaya defalarca
// girip birbirini sariyor ("JSONPath zaten tanimli", sonsuz ozyineleme) ve oynatici bozulabiliyordu.
// Duzeltme: betik ve CSS istegi yapan karede (senderFrame) calistirilir.
// Zamanlama: uBlock Origin sayfa ici betikleri sayfanin kendi kodundan ONCE calistirir. Kutuphane ise sayfa
// yuklenmeye basladiktan sonra, ana surece gidip gelen bir mesajla enjekte ediyor; YouTube'un ilk satir ici betigi
// kaciyor ve oynatici ~8 sn zaman asimini bekliyordu. Bu yuzden ana karenin betiklerini page-preload esitlemeli
// olarak ister ve sayfanin kodundan once calistirir; kutuphanenin gec enjeksiyonu o kare icin atlanir.
let tldParse = null;
try { ({ parse: tldParse } = require('tldts-experimental')); } catch {}
// Sayfa onyukleyicisi sol kenar algilama genisligini acilista sorar (GECICI test ayari)
ipcMain.on('mondium-edge-px', (e) => { e.returnValue = settings.sideEdge || 2; });
// Saklanma modu: fare sayfanin sol kenarina gelince (page-preload bildirir) kenar cubugu acilir
ipcMain.on('mondium-edge', (e) => {
  const w = winOfWc(e.sender);
  if (!w || !settings.verticalTabs || !settings.verticalAutoHide) return;
  useWin(w);
  if (activeTab() && activeTab().view && activeTab().view.webContents === e.sender) openSide();
});
ipcMain.on('mondium-scriptlets', (e, url) => {
  e.returnValue = [];
  if (!blocker || !tldParse || typeof url !== 'string' || !/^https?:/i.test(url) || !blockerSessions.has(e.sender.session)) return;
  try {
    const p = tldParse(url);
    const { active, scripts } = blocker.getCosmeticsFilters({
      url, hostname: p.hostname || '', domain: p.domain || '',
      getBaseRules: false, getInjectionRules: true, getExtendedRules: false, getRulesFromHostname: true, getRulesFromDOM: false,
      callerContext: { frameId: e.frameId, processId: e.processId }
    });
    if (active === false) return;
    e.returnValue = scripts;
  } catch (err) { console.warn('Sayfa ici betikler alinamadi:', err.message); }
});
function fixCosmeticTarget(b) {
  if (b.mondiumFrameFix) return;
  b.mondiumFrameFix = true;
  const orig = b.onInjectCosmeticFilters;
  b.onInjectCosmeticFilters = (event, url, msg) => {
    const frame = event.senderFrame;
    if (!frame) return orig(event, url, msg);
    const isMain = !frame.parent;
    // Sekmelerimizin ana karesi betiklerini page-preload'dan zaten aldi (bu istek ondan once de gelebiliyor)
    const early = isMain && byWcId.has(event.sender.id);
    const sender = {
      insertCSS: (css, o) => (isMain ? event.sender.insertCSS(css, o).catch(() => {})
        : frame.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s); })()`).catch(() => {})),
      // Her betik kendi kapsaminda: motor YouTube icin 35 ayri betik uretiyor; ayni genel alanda calisinca
      // "class JSONPath" ikinci kez tanimlanamiyor (6 betik hic calismiyordu) ve ortak safeSelf() uzerine yazilinca
      // sarmalayicilar kendini cagirip sonsuz ozyinelemeye giriyordu. uBlock Origin de betikleri ayri kapsamda calistirir.
      executeJavaScript: (code, gesture) => { if (early) return; frame.executeJavaScript(`(function () {\n${code}\n})();`, gesture).catch(() => {}); }
    };
    return orig({ frameId: event.frameId, processId: event.processId, sender, senderFrame: frame }, url, msg);
  };
}
function attachBlocker(b) {
  fixCosmeticTarget(b);
  const list = [...blockerSessions].sort((x, y) => (y === mainSes) - (x === mainSes));   // ana oturum once
  if (blocker) for (const s of list) blockerToggle(blocker, s, false);
  for (const s of list) blockerToggle(b, s, true);
  blocker = b;
  blocker.on('request-blocked', (req) => {
    const t = byWcId.get(req.tabId);
    if (t) { t.blocked++; if (t.w) inWin(t.w, () => { if (t.id === activeId) schedulePush(); }); }
  });
  forEachWin(() => pushState());
}

// Acilista ilk istekler engelsiz kacmasin diye engelleyici kisa sure beklenir. Bekleme ASLA kullaniciyi kilitlememeli:
// en fazla 3 sn, ve bir kez dolunca (ya da hazir olunca) bir daha hic beklenmez. (Eskiden her gezinmede 15 sn'ye kadar
// bekleyebiliyordu: engelleyici takilirsa adres cubugunda Enter "hicbir sey yapmiyor" gibi gorunuyordu.)
let mainBlockSettled = false;
mainBlockReady.then(() => { mainBlockSettled = true; });
setTimeout(() => { mainBlockSettled = true; }, 12000);
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
async function go(wc, url) {
  if (!url.startsWith('file:')) {
    if (wc.session === mainSes) { if (!mainBlockSettled) await Promise.race([mainBlockReady, timeout(3000)]); }
    else await Promise.race([ensureGhostery(), timeout(3000)]);
  }
  if (wc.isDestroyed()) return;
  const p = prepareUrl(wc, url);
  wc.loadURL(p.url, { userAgent: p.ua }).catch(() => {});
}

// ---------------------------------------------------------------- Google verisi temizleme
const GOOGLE_DOMAIN = /(^|\.)google(\.[a-z]{2,3}){1,2}$/i;
async function clearGoogleData() {
  const ses = mainSes;
  if (!ses) return;
  try {
    const cookies = await ses.cookies.get({});
    await Promise.all(cookies
      .filter((c) => GOOGLE_DOMAIN.test((c.domain || '').replace(/^\./, '')))
      .map((c) => ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name).catch(() => {})));
    for (const origin of ['https://www.google.com', 'https://www.google.com.tr', 'https://google.com']) {
      await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql'] }).catch(() => {});
    }
    await ses.cookies.flushStore().catch(() => {});
  } catch (e) { console.warn('Google verisi temizlenemedi:', e.message); }
}

// ---------------------------------------------------------------- Oturumlari koru
// Bircok site girisi "oturum cerezi" (son kullanma tarihi olmayan) ile tutar. Bunlar tarayici kapaninca silinir
// ve her acilista yeniden giris gerekir. Chrome "kaldigin yerden devam et" acikken bunlari saklar; burada da
// kapanista (ve 15 dakikada bir, cokmeye karsi) 30 gunluk kalici cereze cevrilir. Hepsi sadece bu bilgisayarda kalir.
const KEEP_DAYS = 30;
async function keepSessionCookies() {
  const ses = mainSes;
  if (!ses || !settings.keepLogins) return 0;
  const exp = Math.floor(Date.now() / 1000) + KEEP_DAYS * 86400;
  let n = 0;
  try {
    const list = await ses.cookies.get({});
    await Promise.all(list.filter((c) => c.session && c.domain).map((c) => {
      const host = c.domain.replace(/^\./, '');
      const d = { url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`, name: c.name, value: c.value,
        path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, expirationDate: exp };
      if (!c.hostOnly) d.domain = c.domain;
      if (c.sameSite && c.sameSite !== 'unspecified') d.sameSite = c.sameSite;
      return ses.cookies.set(d).then(() => { n++; }, () => {});
    }));
    await ses.cookies.flushStore().catch(() => {});
  } catch (e) { console.warn('Oturumlar saklanamadi:', e.message); }
  return n;
}

// ---------------------------------------------------------------- Oturum
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return u || ''; } };

// ---------------------------------------------------------------- Izin balonu (Chrome gibi)
// Adres cubugunun sol altindan acilan balon: "<site> sunu istiyor: [simge] Konumunuzu bilmek  [Engelle] [Izin ver]".
// Ayni pencerede birden cok istek gelirse sirayla sorulur. Ayri pencere/surec acmaz, arayuz katmaninda cizilir.
const PERM_TEXT = {
  geolocation: { icon: 'location', text: 'Konumunuzu bilmek' },
  notifications: { icon: 'bell', text: 'Bildirim göstermek' },
  'display-capture': { icon: 'screen', text: 'Ekranınızı görmek' },
  openExternal: { icon: 'open', text: 'Bilgisayarınızdaki bir uygulamayı açmak' },
  media: { icon: 'camera', text: 'Kameranızı kullanmak' }
};
function mediaText(details) {
  const t = (details && details.mediaTypes) || [];
  const rows = [];
  if (t.includes('video') || !t.length) rows.push({ icon: 'camera', text: 'Kameranızı kullanmak' });
  if (t.includes('audio')) rows.push({ icon: 'mic', text: 'Mikrofonunuzu kullanmak' });
  return rows;
}
// Chrome'un uzanti ekleme penceresindeki "Sunlari yapabilir" listesi
function extPermissionRows(m) {
  m = m || {};
  const perms = new Set([...(m.permissions || []), ...(m.optional_permissions || [])].filter((p) => typeof p === 'string'));
  const hosts = new Set([...(m.host_permissions || []), ...(m.permissions || []).filter((p) => /[:/*]/.test(p))]);
  for (const cs of m.content_scripts || []) for (const x of cs.matches || []) hosts.add(x);
  const rows = [];
  const all = [...hosts].some((h) => h === '<all_urls>' || /^(\*|https?):\/\/\*\/\*$/.test(h));
  if (all || perms.has('debugger')) rows.push({ icon: 'globe', text: 'Tüm web sitelerindeki verilerinizi okuyup değiştirebilir' });
  else if (hosts.size) {
    const names = [...new Set([...hosts].map((h) => h.replace(/^[^:]+:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '')).filter(Boolean))];
    const more = names.length - 4;
    rows.push({ icon: 'globe', text: T('Şu sitelerdeki verilerinizi okuyup değiştirebilir:') + ' ' + names.slice(0, 4).join(', ') + (more > 0 ? (uiLang() === 'en' ? ` and ${more} more ${more === 1 ? 'site' : 'sites'}` : ` ve ${more} site daha`) : '') });
  }
  const map = [
    ['history', 'Tarama geçmişinizi okuyup değiştirebilir'], ['tabs', 'Tarama geçmişinizi okuyabilir'],
    ['bookmarks', 'Yer işaretlerinizi okuyup değiştirebilir'], ['downloads', 'İndirmelerinizi yönetebilir'],
    ['clipboardRead', 'Kopyaladığınız verileri okuyabilir'], ['clipboardWrite', 'Kopyala-yapıştır verilerini değiştirebilir'],
    ['geolocation', 'Konumunuzu bilebilir'], ['notifications', 'Bildirim gösterebilir'],
    ['management', 'Uygulamalarınızı, uzantılarınızı ve temalarınızı yönetebilir'], ['tabCapture', 'Ekranınızın içeriğini yakalayabilir'],
    ['desktopCapture', 'Ekranınızın içeriğini yakalayabilir'], ['privacy', 'Gizlilik ayarlarınızı değiştirebilir'],
    ['proxy', 'Ağ trafiğinizi başka sunucuya yönlendirebilir'], ['nativeMessaging', 'Bilgisayarınızdaki uygulamalarla iletişim kurabilir'],
    ['userScripts', 'Sayfalarda kendi betiklerini çalıştırabilir']
  ];
  const seen = new Set();
  for (const [p, text] of map) if (perms.has(p) && !seen.has(text) && !(p === 'tabs' && perms.has('history'))) { seen.add(text); rows.push({ icon: 'check', text }); }
  if (!rows.length) rows.push({ icon: 'check', text: 'Özel izin gerektirmiyor' });
  return rows;
}
const prompts = [];   // { id, w, data, resolve, shown }
let promptSeq = 1;
function askPrompt(data) {
  return new Promise((resolve) => {
    const p = { id: promptSeq++, w: W, data, resolve, shown: false };
    prompts.push(p);
    if (!prompts.some((x) => x !== p && x.w === p.w)) showPrompt(p);
  });
}
function showPrompt(p) {
  inWin(p.w, () => {
    if (!win || !ui) { settlePrompt(p, 'dismiss'); return; }
    if (overlayOpen) closeOverlay(false);
    p.shown = true;
    overlayOpen = true;
    overlayKind = 'prompt';
    raiseUi();
    layout();
    ui.webContents.focus();
    send('prompt-open', { id: p.id, ...p.data });
  });
}
function settlePrompt(p, answer) {
  const i = prompts.indexOf(p);
  if (i < 0) return;
  prompts.splice(i, 1);
  p.resolve(answer);
  if (!p.w.win) return;
  inWin(p.w, () => {
    send('prompt-close');
    if (overlayKind === 'prompt') { overlayOpen = false; overlayKind = null; layout(); }
    const next = prompts.find((x) => x.w === p.w);
    if (next) showPrompt(next); else withActive((wc) => wc.focus());
  });
}
function answerPrompt(arg) {
  const p = prompts.find((x) => x.id === (arg && arg.id));
  if (p) settlePrompt(p, arg.answer === 'ok' ? 'ok' : arg.answer === 'cancel' ? 'cancel' : 'dismiss');
}

// Gizli pencere oturumu: "persist:" olmadigi icin diskte hicbir sey tutulmaz. Tum gizli pencereler paylasir,
// sonuncusu kapaninca icindeki her sey silinir.
let incognitoSes = null;
const incognitoPerms = {};
function getIncognitoSession() {
  if (!incognitoSes) { incognitoSes = session.fromPartition('mondium-gizli'); setupSession(incognitoSes, true); }
  return incognitoSes;
}
function endIncognito() {
  if (!incognitoSes || windows.some((w) => w.incognito)) return;
  incognitoSes.clearStorageData().catch(() => {});
  incognitoSes.clearCache().catch(() => {});
  for (const k of Object.keys(incognitoPerms)) delete incognitoPerms[k];
  for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].incognito && downloads[i].state !== 'progressing') downloads.splice(i, 1);
}

function setupSession(ses = mainSes, incognito = false) {
  ses.setSpellCheckerEnabled(false);
  ses.setUserAgent(app.userAgentFallback);

  // Thorium: DNT + Global Privacy Control varsayilan acik
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['DNT'] = '1';
    if (isGoogleLogin(details.url)) details.requestHeaders['User-Agent'] = LOGIN_UA;
    details.requestHeaders['Sec-GPC'] = '1';
    cb({ requestHeaders: details.requestHeaders });
  });

  // ---- Site izinleri (Chrome gibi: karar hatirlanir)
  const alwaysAllow = new Set([
    'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock',
    // Video oynaticilar icin gerekli: DRM (EME), gomulu oynaticilarin cerez erisimi, ses cikisi secimi
    'mediaKeySystem', 'storage-access', 'top-level-storage-access', 'speaker-selection', 'persistent-storage'
  ]);
  const deviceKinds = new Set(['hid', 'usb', 'serial', 'bluetooth']);
  // Karar Chrome gibi adres cubugunun altindan acilan balonda sorulur (askPermission). Izin ver / Engelle
  // hatirlanir; kapatma (x) ya da disari tiklama sadece bu seferlik reddeder. Gizli pencerede kararlar kalici olmaz.
  const perms = incognito ? incognitoPerms : settings.sitePerms;
  const known = (key) => (key in perms ? perms[key] : key in settings.sitePerms && settings.sitePerms[key] === false ? false : undefined);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (alwaysAllow.has(permission) || deviceKinds.has(permission)) return cb(true);
    if (!PERM_TEXT[permission]) return cb(false);
    const origin = originOf(details.requestingUrl || wc.getURL());
    const key = origin + '|' + permission;
    const k = known(key);
    if (k !== undefined) return cb(k);
    const w = winOfWc(wc);
    if (!w) return cb(false);
    useWin(w);
    const want = permission === 'media' ? mediaText(details) : PERM_TEXT[permission];
    askPrompt({ host: hostOf(origin), title: `${hostOf(origin)} şunu istiyor:`, rows: [].concat(want), ok: 'İzin ver', cancel: 'Engelle', kind: 'perm' }).then((r) => {
      if (r !== 'dismiss') { perms[key] = r === 'ok'; if (!incognito) saveSettings(); }
      cb(r === 'ok');
    });
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (alwaysAllow.has(permission) || deviceKinds.has(permission)) return true;
    const k = known(origin + '|' + permission);
    if (k !== undefined) return k;
    return permission !== 'notifications';
  });

  setupDevices(ses);
  if (incognito) { blockSession(ses); ensureGhostery(); }   // ana oturumu startBlocking() belirler

  // Indirmeler: dogrudan Indirilenler klasorune
  ses.on('will-download', (_e, item, wc) => {
    const ow = winOfWc(wc);
    if (ow) useWin(ow);
    const dir = app.getPath('downloads');
    const ext = path.extname(item.getFilename());
    const base = path.basename(item.getFilename(), ext);
    let file = path.join(dir, item.getFilename()), n = 1;
    while (fs.existsSync(file)) file = path.join(dir, `${base} (${n++})${ext}`);
    item.setSavePath(file);
    const d = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: path.basename(file), file,
      url: item.getURL(), t: Date.now(), received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false, item,
      ...(incognito ? { incognito: true } : {})
    };
    downloads.unshift(d);
    if (downloads.length > DOWNLOADS_MAX) downloads.length = DOWNLOADS_MAX;
    item.on('updated', (_ev, state) => {
      d.state = state; d.paused = item.isPaused(); d.received = item.getReceivedBytes(); d.total = item.getTotalBytes();
      forEachWin(() => schedulePush()); notifyPages('downloads');
    });
    item.once('done', (_ev, state) => {
      d.state = state; d.paused = false; d.received = item.getReceivedBytes(); d.item = null;
      saveDownloads(); forEachWin(() => pushState()); notifyPages('downloads');
      if (state === 'completed') notifyDownload(d);
    });
    saveDownloads(); forEachWin(() => pushState()); notifyPages('downloads');
  });
}

// Bildirim nesnesi tiklanana kadar tutulur (yoksa cop toplayici tiklama olayini kaybettirir)
const liveNotes = new Set();
function notifyDownload(d) {
  if (!settings.downloadNotify || !Notification.isSupported()) return;
  const n = new Notification({ title: T('İndirme tamamlandı'), body: d.name, icon: path.join(__dirname, 'icon.png'), silent: true });
  const drop = () => liveNotes.delete(n);
  n.on('click', () => { drop(); shell.showItemInFolder(d.file); });
  n.on('close', drop);
  liveNotes.add(n);
  setTimeout(drop, 60e3);
  n.show();
}

// ---------------------------------------------------------------- Cihaz destegi (WebHID / WebUSB / Serial / Bluetooth)
// ATK, VIA, Razer/Logitech web surucu, Arduino web yukleyici, ESP web flasher gibi siteler bunlari kullanir.
const sessionDeviceIds = new Set();   // bu oturumda secilen cihazlar
const hex4 = (n) => (typeof n === 'number' ? n.toString(16).padStart(4, '0') : String(n || '').replace(/^0x/i, '')).toUpperCase();
const sameDevice = (g, type, origin, d) => g.type === type && g.origin === origin &&
  hex4(g.vendorId) === hex4(d.vendorId) && hex4(g.productId) === hex4(d.productId) &&
  (!g.serialNumber || g.serialNumber === (d.serialNumber || ''));

function addGrant(type, origin, d) {
  if (!origin || !d) return;
  const g = { type, origin, vendorId: d.vendorId, productId: d.productId, serialNumber: d.serialNumber || '', name: d.name || d.productName || d.displayName || d.portName || '' };
  if (!settings.deviceGrants.some((x) => sameDevice(x, type, origin, d))) { settings.deviceGrants.push(g); saveSettings(); }
}

const KIND_LABEL = { hid: 'HID cihazı', usb: 'USB cihazı', serial: 'seri bağlantı noktası', bluetooth: 'Bluetooth cihazı' };
const hidInfo = (d) => ({ id: d.deviceId, name: d.name || 'Bilinmeyen HID cihazı', detail: `VID ${hex4(d.vendorId)} · PID ${hex4(d.productId)}`, raw: d });
const usbInfo = (d) => ({ id: d.deviceId, name: [d.manufacturerName, d.productName].filter(Boolean).join(' ') || 'Bilinmeyen USB cihazı', detail: `VID ${hex4(d.vendorId)} · PID ${hex4(d.productId)}`, raw: d });
const serialInfo = (p) => ({ id: p.portId, name: p.displayName || p.portName || 'Seri bağlantı noktası', detail: [p.portName, p.vendorId ? `VID ${hex4(p.vendorId)} · PID ${hex4(p.productId)}` : ''].filter(Boolean).join(' · '), raw: p });
const btInfo = (d) => ({ id: d.deviceId, name: d.deviceName || 'Bilinmeyen cihaz (' + d.deviceId + ')', detail: d.deviceId, raw: d });

// Cihaz secici: Chrome'daki gibi adres cubugunun altindan acilan balon.
// Ayri pencere/surec acmaz; mevcut arayuz katmaninda cizilir.
let chooser = null;
function openChooser(kind, origin, list, wc) {
  if (chooser) finishChooser(null);
  const ow = winOfWc(wc);
  if (ow) useWin(ow);
  return new Promise((resolve) => {
    chooser = { kind, origin, devices: new Map(), resolve, w: W };
    for (const d of list) chooser.devices.set(d.id, d);
    if (!win || !ui) { finishChooser(null); return; }
    overlayOpen = true;
    overlayKind = 'chooser';
    raiseUi();
    layout();
    ui.webContents.focus();
    send('chooser-open', chooserData());
  });
}
function finishChooser(id) {
  const c = chooser;
  if (!c) return;
  chooser = null;
  const entry = id ? c.devices.get(id) || null : null;
  c.resolve(entry);
  if (c.w) useWin(c.w);
  if (overlayKind === 'chooser') closeOverlay();
}
function chooserData() {
  return {
    kind: chooser.kind, label: KIND_LABEL[chooser.kind], host: hostOf(chooser.origin),
    devices: [...chooser.devices.values()].map(({ id, name, detail }) => ({ id, name, detail }))
  };
}
function pushChooser() { if (chooser) inWin(chooser.w, () => send('chooser-data', chooserData())); }
const chooserAdd = (kind, d) => { if (chooser && chooser.kind === kind && d.id) { chooser.devices.set(d.id, d); pushChooser(); } };
const chooserRemove = (kind, id) => { if (chooser && chooser.kind === kind) { chooser.devices.delete(id); pushChooser(); } };

function frameOrigin(details, fallbackWc) {
  const u = (details && details.frame && details.frame.url) || (fallbackWc && !fallbackWc.isDestroyed() && fallbackWc.getURL()) ||
    (activeTab() && activeTab().url) || '';
  return originOf(u);
}

const wcOfFrame = (f) => { try { return f ? webContents.fromFrame(f) : null; } catch { return null; } };
function setupDevices(ses) {
  // ---- WebHID (ATK, VIA, oyuncu fare/klavye yazilimlari)
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const origin = frameOrigin(details);
    openChooser('hid', origin, (details.deviceList || []).map(hidInfo), wcOfFrame(details.frame)).then((entry) => {
      if (entry) { sessionDeviceIds.add(entry.id); addGrant('hid', origin, entry.raw); }
      callback(entry ? entry.id : '');
    });
  });
  ses.on('hid-device-added', (_e, details) => details && details.device && chooserAdd('hid', hidInfo(details.device)));
  ses.on('hid-device-removed', (_e, details) => details && details.device && chooserRemove('hid', details.device.deviceId));

  // ---- WebUSB
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const origin = frameOrigin(details);
    openChooser('usb', origin, (details.deviceList || []).map(usbInfo), wcOfFrame(details.frame)).then((entry) => {
      if (entry) { sessionDeviceIds.add(entry.id); addGrant('usb', origin, entry.raw); }
      callback(entry ? entry.id : undefined);
    });
  });
  ses.on('usb-device-added', (_e, device) => device && chooserAdd('usb', usbInfo(device)));
  ses.on('usb-device-removed', (_e, device) => device && chooserRemove('usb', device.deviceId));

  // ---- Web Serial (Arduino / ESP32 web yukleyicileri)
  ses.on('select-serial-port', (event, portList, wc, callback) => {
    event.preventDefault();
    const origin = frameOrigin(null, wc);
    openChooser('serial', origin, (portList || []).map(serialInfo), wc).then((entry) => {
      if (entry) { sessionDeviceIds.add(entry.id); addGrant('serial', origin, entry.raw); }
      callback(entry ? entry.id : '');
    });
  });
  ses.on('serial-port-added', (_e, port) => port && chooserAdd('serial', serialInfo(port)));
  ses.on('serial-port-removed', (_e, port) => port && chooserRemove('serial', port.portId));

  // ---- Daha once izin verilen cihazlar (sayfa yenilense de / tarayici kapansa da hatirlanir)
  ses.setDevicePermissionHandler((details) => {
    const d = details.device || {};
    if (sessionDeviceIds.has(d.deviceId) || sessionDeviceIds.has(d.portId)) return true;
    return settings.deviceGrants.some((g) => sameDevice(g, details.deviceType, details.origin, d));
  });

  // ---- Bluetooth eslestirme (PIN onayi)
  if (typeof ses.setBluetoothPairingHandler === 'function') {
    ses.setBluetoothPairingHandler((details, callback) => {
      if (details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin') {
        dialog.showMessageBox(win, {
          type: 'question', buttons: ['Eşleştir', 'İptal'], defaultId: 0, cancelId: 1,
          message: details.pairingKind === 'confirmPin' ? `Cihazda şu PIN görünüyor mu? ${details.pin}` : 'Bluetooth cihazı eşleştirilsin mi?'
        }).then((r) => callback({ confirmed: r.response === 0 })).catch(() => callback({ confirmed: false }));
      } else {
        dialog.showMessageBox(win, { type: 'warning', message: 'Bu cihaz PIN girişi istiyor. Önce Windows Bluetooth ayarlarından eşleştirin.' });
        callback({ confirmed: false });
      }
    });
  }
}

// Web Bluetooth secimi webContents uzerinden gelir
function attachBluetooth(wc) {
  let pending = null;
  wc.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    const list = (devices || []).map(btInfo);
    if (pending) { list.forEach((d) => chooserAdd('bluetooth', d)); return; }
    pending = callback;
    openChooser('bluetooth', originOf(wc.getURL()), list, wc).then((entry) => {
      const cb = pending; pending = null;
      cb(entry ? entry.id : '');
    });
  });
}

// ---------------------------------------------------------------- Sekmeler
function toUrl(input) {
  const s = (input || '').trim();
  if (!s) return newtabUrl();
  const hashAt = s.indexOf('#');   // mondium://settings#korunan gibi bolum baglantilari
  const alias = PAGE_ALIASES[(hashAt < 0 ? s : s.slice(0, hashAt)).toLowerCase().replace(/\/+$/, '')];
  if (alias) return hashAt < 0 ? alias : alias + '#' + encodeURIComponent(s.slice(hashAt + 1));
  if (/^(https?|file|about|data|view-source|chrome-extension|blob):/i.test(s)) return s;   // uzanti sayfalari da adres
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return searchUrl() + encodeURIComponent(s);
}

function createView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false, backgroundThrottling: true, session: ses, plugins: true,   // plugins: yerlesik PDF goruntuleyici
      preload: path.join(__dirname, 'page-preload.js')
    }
  });
  view.setBackgroundColor((effectiveTheme().page) || (nativeTheme.shouldUseDarkColors ? '#202124' : '#ffffff'));
  const wc = view.webContents;
  if (!tab.w) tab.w = W;
  // Bu sekmenin olaylari her zaman kendi penceresinin baglaminda calisir
  const on = (ev, fn) => wc.on(ev, (...args) => { useWin(tab.w); return fn(...args); });
  wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
  tab.view = view;
  tab.wcId = wc.id;
  byWcId.set(wc.id, tab);
  if (tab.muted) wc.setAudioMuted(true);
  attachBluetooth(wc);
  attachLoginFix(wc);
  if (extensions && !tab.w.incognito) { try { extensions.addTab(wc, win); } catch (e) { console.warn(e.message); } }

  wc.setWindowOpenHandler(({ url, disposition }) => {
    useWin(tab.w);
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { sandbox: true } }
      };
    }
    newTab(url, disposition === 'background-tab', tab.id);
    return { action: 'deny' };
  });
  on('did-create-window', (child, details) => {
    if (child.setMenu) child.setMenu(null);
    const cwc = child.webContents;
    attachLoginFix(cwc);                         // "Google ile giris yap" acilir pencereleri
    const u = (details && details.url) || cwc.getURL();
    if (isGoogleLogin(u)) { cwc.setUserAgent(LOGIN_UA); cwc.loadURL(u, { userAgent: LOGIN_UA }).catch(() => {}); }
  });

  on('page-title-updated', (_e, title) => {
    tab.title = title;
    if (tab.hist && tab.hist.url === wc.getURL() && tab.hist.title !== title) { tab.hist.title = title; saveHistory(); notifyPages('history'); }
    schedulePush();
  });
  on('page-favicon-updated', (_e, icons) => {
    tab.favicon = icons && icons[0];
    if (tab.hist && tab.favicon && tab.hist.url === wc.getURL() && tab.hist.favicon !== tab.favicon) { tab.hist.favicon = tab.favicon; saveHistory(); }
    const bm = settings.bookmarks.find((b) => b.url === tab.url);
    if (bm && tab.favicon && bm.favicon !== tab.favicon) { bm.favicon = tab.favicon; saveSettings(); }
    schedulePush();
  });
  on('did-start-loading', () => { tab.loading = true; schedulePush(); });
  on('did-stop-loading', () => { tab.loading = false; tab.url = wc.getURL() || tab.url; schedulePush(); });
  on('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isSameDocument) { tab.blocked = 0; tab.favicon = null; }
  });
  on('did-navigate', (_e, url, code) => { tab.url = url; if (!code || code < 400) recordVisit(tab, url, wc); pushState(); });
  on('did-navigate-in-page', (_e, url, isMain) => {
    if (!isMain) return;
    tab.url = url;
    if (!tab.hist || tab.hist.url.split('#')[0] !== url.split('#')[0]) recordVisit(tab, url, wc);   // YouTube gibi tek sayfa siteler
    pushState();
  });
  on('did-fail-load', (_e, code, _desc, _url, isMain) => {
    if (isMain && code !== -3) { tab.title = 'Sayfa açılamadı'; pushState(); }
  });
  on('audio-state-changed', (e) => { tab.audible = e.audible; schedulePush(); });
  on('dom-ready', () => { if (settings.hoverZoom) applyHoverZoom(wc); });
  // Ses yukseltme acikken yeni yuklenen sayfa ve gomulu oynaticilara da uygula
  on('did-frame-finish-load', (_e, isMain, pid, rid) => {
    if ((tab.volume || 100) === 100) return;
    applyVolume(wc, isMain ? null : webFrameMain.fromId(pid, rid), tab.volume);
  });
  on('render-process-gone', () => { tab.title = 'Sayfa çöktü - yenileyin'; tab.loading = false; pushState(); });
  on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  on('context-menu', (_e, p) => showContextMenu(wc, p));
  on('found-in-page', (_e, r) => send('found', { active: r.activeMatchOrdinal, total: r.matches }));
  on('enter-html-full-screen', () => { htmlFullscreen = true; win.setFullScreen(true); layout(); });
  on('leave-html-full-screen', () => { htmlFullscreen = false; win.setFullScreen(false); layout(); });
  const wcId = wc.id;
  on('destroyed', () => { if (byWcId.get(wcId) === tab) byWcId.delete(wcId); });
  return view;
}

// Ayni gun ayni adres tek satirda tutulur (en uste tasinir). Yenileme ve uyanan sekme yeni kayit acmaz.
function recordVisit(tab, url, wc) {
  if (!/^https?:/i.test(url || '') || (tab.w && tab.w.incognito)) return;   // gizli pencere gecmise yazmaz
  if (tab.hist && tab.hist.url === url && history.includes(tab.hist)) return;
  const now = Math.max(Date.now(), history.length ? history[0].t + 1 : 0);   // t ayni zamanda kimlik: benzersiz
  const dayStart = new Date().setHours(0, 0, 0, 0);
  let e = null;
  for (let i = 0; i < history.length && history[i].t >= dayStart; i++) {
    if (history[i].url === url) { e = history.splice(i, 1)[0]; break; }
  }
  if (!e) e = { url, title: '', t: now };
  e.t = now;
  const title = wc && !wc.isDestroyed() ? wc.getTitle() : '';
  if (title && title !== url && !/^https?:/i.test(title)) e.title = title;
  history.unshift(e);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  tab.hist = e;
  saveHistory();
  notifyPages('history');
}

// Onceki oturum: sekmeler uyutulmus (bellek kullanmayan) halde geri gelir, sadece etkin olan yuklenir.
function restoreSession() {
  if (!settings.restoreSession) return false;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return false; }
  const wins = data && Array.isArray(data.windows) ? data.windows : data && Array.isArray(data.tabs) ? [data] : [];   // eski bicim: tek pencere
  let any = false;
  for (const entry of wins.slice(0, 20)) {
    if (any) createWindow();
    if (restoreWindow(entry)) any = true;
  }
  return any;
}
function restoreWindow(data) {
  const list = data && Array.isArray(data.tabs) ? data.tabs.filter((x) => x && typeof x.url === 'string' && x.url) : [];
  for (const x of list.slice(0, 100)) {
    tabs.push({
      id: nextId++, w: W, view: null, url: toUrl(x.url), title: String(x.title || hostOf(x.url)).slice(0, 300),
      favicon: typeof x.favicon === 'string' ? x.favicon : null, loading: false, lastActive: Date.now(),
      blocked: 0, audible: false, pinned: !!x.pinned, muted: !!x.muted
    });
  }
  if (!tabs.length) return false;
  orderPinned();
  const a = Math.min(Math.max(Number(data.active) || 0, 0), tabs.length - 1);
  activateTab(tabs[a].id);
  return true;
}

// Gecmis / indirilenler: acik sekmesi varsa ona gec, yeni sekmedeysen orada ac, yoksa yeni sekme
function openPage(url) {
  if (W && W.incognito) {
    const n = lastWin(true);
    if (n) { useWin(n); n.win.focus(); } else createWindow();
  }
  const ex = tabs.find((t) => baseOf(t.url) === baseOf(url));
  if (ex) { activateTab(ex.id); return; }
  const t = activeTab();
  if (t && t.view && isNewtab(t.url)) { t.url = url; go(t.view.webContents, url); return; }
  newTab(url);
}

// Sabitlenmis sekmeler her zaman solda (sort kararlidir, diger sira korunur)
const orderPinned = () => tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

function newTab(url, background = false, openerId = null, at = -1) {
  const tab = {
    id: nextId++, w: W, view: null, url: toUrl(url), title: 'Yeni Sekme', favicon: null,
    loading: true, lastActive: Date.now(), blocked: 0, audible: false, pinned: false, muted: false
  };
  const openerIdx = openerId ? tabs.findIndex((t) => t.id === openerId) : -1;
  if (at >= 0) tabs.splice(Math.min(at, tabs.length), 0, tab);
  else if (openerIdx >= 0) tabs.splice(openerIdx + 1, 0, tab); else tabs.push(tab);
  orderPinned();
  go(createView(tab).webContents, tab.url);
  if (!background || activeId === null) activateTab(tab.id); else pushState();
  if (!background && isNewtab(tab.url)) { const w = W; setTimeout(() => inWin(w, () => focusUrl()), 50); }
  return tab;
}

const getTab = (id) => tabs.find((t) => t.id === id);
const activeTab = () => getTab(activeId);

function activateTab(id) {
  if (!win) return;
  const tab = getTab(id);
  if (!tab || !win) return;
  const prev = activeTab();
  if (prev && prev !== tab) {
    prev.lastActive = Date.now();
    if (prev.view) { try { win.contentView.removeChildView(prev.view); } catch {} }
    if (findOpen) closeFind();
  }
  activeId = id;
  tab.lastActive = Date.now();
  if (!tab.view) { createView(tab); go(tab.view.webContents, tab.url); }
  const keepSide = overlayOpen && overlayKind === 'side';
  if (overlayOpen && !keepSide) closeOverlay();
  win.contentView.addChildView(tab.view);
  if (W) W.uiAbove = false;
  if (keepSide) raiseUi();
  layout();
  tab.view.webContents.focus();
  if (extensions && !W.incognito) { try { extensions.selectTab(tab.view.webContents); } catch {} }
  pushState();
}

function destroyView(tab) {
  if (!tab.view) return;
  if (win) { try { win.contentView.removeChildView(tab.view); } catch {} }
  const wc = tab.view.webContents;
  byWcId.delete(tab.wcId);
  try { if (typeof wc.close === 'function') wc.close(); else wc.destroy(); } catch {}
  tab.view = null;
}

// Kapanan sekmeler (Ctrl+Shift+T ile geri acilir). Sadece adres tutulur, bellek maliyeti yok denecek kadar az.
let closedTabs = [];
function rememberClosed(tab, index) {
  let u = tab.url;
  try { if (tab.view && !tab.view.webContents.isDestroyed()) u = tab.view.webContents.getURL() || u; } catch {}
  const k = pageKind(u);
  if (!u || k === 'newtab' || k === 'welcome') return;
  closedTabs.unshift({ url: k ? displayUrl(u) : u, title: tab.title || u, favicon: tab.favicon || null, index, pinned: !!tab.pinned });
  if (closedTabs.length > 25) closedTabs.length = 25;
}
function reopenClosed(n = 0) {
  const c = closedTabs.splice(n, 1)[0];
  if (!c) return;
  const t = newTab(c.url, false, null, c.index);
  if (c.pinned) { t.pinned = true; orderPinned(); pushState(); }
}
function togglePin(id) {
  const t = getTab(id);
  if (!t) return;
  t.pinned = !t.pinned;
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  const firstFree = tabs.filter((x) => x.pinned).length;
  tabs.splice(firstFree, 0, t);    // sabitlenen: sabitlerin sonuna; cozulen: sabit olmayanlarin basina
  pushState();
}
function toggleMute(id) {
  const t = getTab(id);
  if (!t || !settings.tabAudio) return;
  t.muted = !t.muted;
  if (t.view) t.view.webContents.setAudioMuted(t.muted);
  pushState();
}
// ---------------------------------------------------------------- Ses yukseltme (sekme basina)
// Chrome'daki Volume Booster uzantilarinin yaptigini yapar, tabCapture gerekmez: volume.js sayfadaki
// video/ses ogelerini bir kazanc dugumunden gecirir. Ana karede ayrik dunyada (site karisamaz), gomulu
// karelerde (iframe oynaticilar) kare icinde calisir. Deger sekmede tutulur, uyuyan sekmede de korunur.
const VOLUME_STEPS = [25, 50, 75, 100, 150, 200, 300, 400, 600];   // sekme sag tik menusu
const VOLUME_MAX = 600;
let VOLUME_JS = null;
function applyVolume(wc, frame, pct) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  if (!VOLUME_JS) VOLUME_JS = fs.readFileSync(path.join(__dirname, 'volume.js'), 'utf8');   // ilk kullanimda okunur
  const code = `{ const GAIN = ${pct / 100};\n${VOLUME_JS}\n}`;   // blok: tekrar calisinca "zaten tanimli" hatasi olmasin
  if (frame) { frame.executeJavaScript(code, true).catch(() => {}); return; }
  wc.executeJavaScriptInIsolatedWorld(1013, [{ code }], true).catch(() => {});
  for (const f of wc.mainFrame ? wc.mainFrame.framesInSubtree : []) {
    if (f !== wc.mainFrame && /^https?:/i.test(f.url)) f.executeJavaScript(code, true).catch(() => {});
  }
}
// ---------------------------------------------------------------- Resim buyutme (yerlesik, Imagus benzeri)
// Ayar acikken her sayfaya ayrik dunyada (1014) hoverzoom.js eklenir; site kodu goremez ve bozamaz.
// Kapatilinca acik sayfalardan da kaldirilir. Ek surec, uzanti veya arka plan isi yok.
let ZOOM_JS = null;
function applyHoverZoom(wc, on = settings.hoverZoom) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  if (!on) { wc.executeJavaScriptInIsolatedWorld(1014, [{ code: "{ const z = window[Symbol.for('mondium.zoom')]; if (z) z.off(); }" }]).catch(() => {}); return; }
  if (!ZOOM_JS) ZOOM_JS = localizeSrc(fs.readFileSync(path.join(__dirname, 'hoverzoom.js'), 'utf8'));
  wc.executeJavaScriptInIsolatedWorld(1014, [{ code: ZOOM_JS }]).catch(() => {});
}
function setFeature(key, on) {
  settings[key] = on;
  saveSettings();
  if (key === 'hoverZoom') for (const t of allTabs()) if (t.view) applyHoverZoom(t.view.webContents, on);
  forEachWin(() => pushState());
}
function setVolume(id, pct) {
  const t = getTab(id);
  pct = Math.round(Number(pct));
  if (!t || !Number.isFinite(pct) || pct < 0 || pct > VOLUME_MAX) return;
  t.volume = pct;
  if (t.view) applyVolume(t.view.webContents, null, pct);
  schedulePush();
}

function moveActiveTab(dir) {
  const i = tabs.findIndex((t) => t.id === activeId), j = i + dir;
  if (i < 0 || j < 0 || j >= tabs.length || !!tabs[j].pinned !== !!tabs[i].pinned) return;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  pushState();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  rememberClosed(tabs[i], i);
  const [tab] = tabs.splice(i, 1);
  destroyView(tab);
  if (tabs.length === 0) { if (win) win.close(); return; }
  if (activeId === id) { activeId = null; activateTab(tabs[Math.min(i, tabs.length - 1)].id); }
  else pushState();
}

function sleepIdleTabs(force = false) {
  if (force !== true && (!settings.sleepTabs || !settings.sleepMinutes)) return;
  const limit = force === true ? 0 : settings.sleepMinutes * 60e3;
  forEachWin(() => {
    let changed = false;
    for (const t of tabs) {
      if (t.id === activeId || !t.view || t.audible || Date.now() - t.lastActive < limit) continue;
      const u = t.view.webContents.getURL();
      if (u) t.url = u;
      destroyView(t);
      changed = true;
    }
    if (changed) pushState();
  });
}

// ---------------------------------------------------------------- Yer isaretleri
function isBookmarked(url) { return !!url && settings.bookmarks.some((b) => b.url === url); }
function toggleBookmark() {
  const t = activeTab();
  if (!t || isInternal(t.url)) return;
  const i = settings.bookmarks.findIndex((b) => b.url === t.url);
  if (i >= 0) settings.bookmarks.splice(i, 1);
  else settings.bookmarks.push({ url: t.url, title: t.title || hostOf(t.url), favicon: t.favicon || null });
  saveSettings();
  pushState();
}
function toggleBookmarksBar() { settings.bookmarksBar = !settings.bookmarksBar; saveSettings(); forEachWin(() => { layout(); pushState(); }); }

// ---------------------------------------------------------------- Yerlesim ve UI durumu
const vertical = () => !!settings.verticalTabs && !htmlFullscreen;
function layout() {
  if (!win || !ui) return;
  const { width, height } = win.getContentBounds();
  const t = activeTab();
  if (vertical()) {
    // Dikey: arayuz tum pencereyi kaplar ve sayfanin ARKASINDA durur (ust cubuklar + soldaki kenar cubugu gorunur).
    // Saklanma modunda sayfa tam genislikte; kenar cubugu acilinca arayuz one alinir, sayfanin ustune kayar.
    const top = TOOLBAR + (settings.bookmarksBar ? BOOKMARKS : 0) + (findOpen ? FINDBAR : 0);
    const sw = settings.verticalAutoHide ? 0 : sideWidth(width);
    ui.setBounds({ x: 0, y: 0, width, height });
    if (t && t.view) {
      t.view.setBounds({ x: sw, y: top, width: Math.max(0, width - sw), height: Math.max(0, height - top) });
      if (!overlayOpen && W && W.uiAbove) { win.contentView.addChildView(t.view); W.uiAbove = false; }   // sayfa tekrar one
    }
    return;
  }
  const h = uiHeight();
  ui.setBounds({ x: 0, y: 0, width, height: overlayOpen ? height : h });
  if (t && t.view) t.view.setBounds({ x: 0, y: h, width, height: Math.max(0, height - h) });
}
// Arayuzu en uste al (menuler, balonlar, acilan kenar cubugu)
function raiseUi() { win.contentView.addChildView(ui); if (W) W.uiAbove = true; }

// ---------- Dikey sekmeler
function setVerticalTabs(on) {
  settings.verticalTabs = !!on;
  saveSettings();
  forEachWin(() => { if (overlayOpen) closeOverlay(false); paintFrame(); layout(); pushState(); });
  broadcastPages();
}
function toggleAutoHide() {
  if (!settings.verticalTabs) return;
  settings.verticalAutoHide = !settings.verticalAutoHide;
  saveSettings();
  forEachWin(() => { if (overlayOpen && overlayKind === 'side') closeOverlay(false); layout(); pushState(); });
}
// Saklanma modunda fare sol kenara gelince kenar cubugu acilir (odak sayfada kalir)
function openSide() {
  if (!win || !ui || !vertical() || !settings.verticalAutoHide || overlayOpen) return;
  overlayOpen = true;
  overlayKind = 'side';
  raiseUi();
  layout();
  send('side-reveal', true);
}

function send(ch, data) { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send(ch, data); }

let pushTimer = null;
function schedulePush() {
  if (pushTimer || !W) return;
  const w = W;   // zamanlayici sonra calisir; o pencerenin durumunu gondermeli
  pushTimer = setTimeout(() => inWin(w, () => { pushTimer = null; pushState(); }), 150);
}

function pushState() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (!win) return;
  const t = activeTab();
  const wc = t && t.view ? t.view.webContents : null;
  const nav = wc && wc.navigationHistory;
  const active = downloads.filter((d) => d.state === 'progressing');
  const recv = active.reduce((a, d) => a + d.received, 0), tot = active.reduce((a, d) => a + (d.total || 0), 0);
  win.setTitle((t ? `${t.title} - ` : '') + (W.incognito ? 'Mondium (Gizli)' : 'Mondium'));
  send('state', {
    tabs: tabs.map((x) => ({
      id: x.id, title: x.title, favicon: x.favicon, loading: x.loading && !!x.view,
      sleeping: !x.view, audible: x.audible, pinned: !!x.pinned, muted: !!x.muted, volume: x.volume || 100
    })),
    activeId,
    activeWcId: wc ? wc.id : -1,
    theme: W.incognito ? INCOGNITO_THEME : themeVars(),
    incognito: !!W.incognito,
    tabAudio: !!settings.tabAudio,
    vertical: vertical(), autoHide: !!settings.verticalAutoHide, sideWidth: sideWidth(win.getContentBounds().width), sideMin: SIDE_MIN,
    sideOpen: overlayOpen && (overlayKind === 'side' || overlayKind === 'sidedrag'), sideEdge: settings.sideEdge || 2,
    ubo: !!uboId && !W.incognito,
    windows: windows.length,
    extSupport: !!extensions && !W.incognito,
    hiddenExt: settings.hiddenExtensions,
    volume: t ? (t.volume || 100) : 100,
    canVolume: !!t && /^https?:/i.test(t.url),
    url: t ? displayUrl(t.url) : '',
    loading: t ? t.loading : false,
    canBack: wc ? (nav ? nav.canGoBack() : wc.canGoBack()) : false,
    canForward: wc ? (nav ? nav.canGoForward() : wc.canGoForward()) : false,
    blocked: t ? t.blocked : 0,
    blockerReady: !!blocker,
    findOpen,
    bookmarked: t ? isBookmarked(t.url) : false,
    canBookmark: !!t && !isInternal(t.url),
    bookmarks: settings.bookmarksBar ? barItems() : [],
    bookmarksBar: settings.bookmarksBar,
    fullUrl: settings.fullUrl,
    searchName: (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name,
    downloads: { any: downloads.length > 0, active: active.length, progress: tot ? recv / tot : (active.length ? -1 : 1) }
  });
  saveSession();
}

const withActive = (fn) => { const t = activeTab(); if (t && t.view) fn(t.view.webContents, t); };
const goBack = () => withActive((wc) => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack()));
const goForward = () => withActive((wc) => (wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward()));
const goHome = () => withActive((wc, t) => { t.url = newtabUrl(); go(wc, t.url); });
const zoom = (d) => withActive((wc) => wc.setZoomLevel(d === 0 ? 0 : wc.getZoomLevel() + d));

function focusUrl(search = false) { if (ui) { ui.webContents.focus(); send('focus-url', { search }); } }
function findStep(forward) { if (!findOpen) openFind(); else send('find-step', forward); }
async function openFileDialog() {
  const r = await dialog.showOpenDialog(win, { title: 'Dosya aç', properties: ['openFile'], filters: [
    { name: 'Web sayfaları ve belgeler', extensions: ['html', 'htm', 'pdf', 'svg', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mp3'] },
    { name: 'Tüm dosyalar', extensions: ['*'] }] });
  if (!r.canceled && r.filePaths[0]) newTab(pathToFileURL(r.filePaths[0]).href, false, activeId);
}
function openFind() { findOpen = true; layout(); pushState(); ui.webContents.focus(); send('focus-find'); }
function closeFind() {
  findOpen = false;
  withActive((wc) => wc.stopFindInPage('clearSelection'));
  layout(); pushState();
  withActive((wc) => wc.focus());
}

// Sadece yerel gecmis ve yer isaretlerinden. Yazilanlar arama motoruna tus tus GONDERILMEZ.
const SEARCH_PAGE = /\/search\?|[?&](q|text|query)=/i;
function omniSuggest(text) {
  const q = String(text || '').trim().toLocaleLowerCase('tr');
  if (!q) return { items: [], inline: '' };
  const words = q.split(/\s+/).filter(Boolean);
  const found = new Map();
  const now = Date.now();
  const consider = (url, title, kind, t, favicon) => {
    if (!/^https?:/i.test(url) || (kind === 'hist' && SEARCH_PAGE.test(url))) return;
    const prev = found.get(url);
    if (prev) { prev.score += 6; if (!prev.favicon && favicon) prev.favicon = favicon; return; }   // sik ziyaret edilen yukselir
    const hp = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
    const ti = String(title || '').toLocaleLowerCase('tr');
    if (!words.every((w) => hp.includes(w) || ti.includes(w))) return;
    let score = hp.startsWith(q) ? 100 : hp.includes(q) ? 30 : 0;
    if (ti.startsWith(q)) score += 20;
    if (kind === 'bm') score += 40;
    score += Math.max(0, 20 - (now - t) / 864e5);
    found.set(url, { url, title: title || '', kind, score, favicon: favicon || null });
  };
  for (const b of settings.bookmarks) consider(b.url, b.title, 'bm', now, b.favicon);
  for (const h of history) consider(h.url, h.title, 'hist', h.t, h.favicon);
  const items = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 6)
    .map(({ url, title, kind, favicon }) => ({ url, title, kind, favicon: favicon && /^(https?|data):/.test(favicon) ? favicon : null }));
  // Chrome gibi satir ici tamamlama: yazilan, en iyi sonucun alan adinin basiysa kalani doldurulur
  let inline = '';
  if (!/\s/.test(q)) {
    for (const it of items) {
      try { const host = new URL(it.url).host.replace(/^www\./, ''); if (host.startsWith(q) && host !== q) { inline = host; break; } } catch {}
    }
  }
  return { items, inline };
}
function openOmni() {
  if (!win || !ui || (overlayOpen && overlayKind === 'omni')) return;
  if (overlayOpen) closeOverlay(false);
  overlayOpen = true;
  overlayKind = 'omni';
  raiseUi();
  layout();
}

function openUrl(url, where) {
  if (where === 'tab') newTab(url, true, activeId);
  else {
    const t = activeTab();
    if (!t) { newTab(url); return; }
    t.url = toUrl(url);
    if (!t.view) { activateTab(t.id); return; }   // uyuyan sekme: activateTab sayfayi olusturup t.url'ye gider
    go(t.view.webContents, t.url);
    t.view.webContents.focus();
  }
}

ipcMain.on('ui', (e, cmd, arg) => {
  const w = windows.find((x) => x.ui && x.ui.webContents === e.sender);
  if (!w) return;
  useWin(w);
  switch (cmd) {
    case 'navigate': openUrl(arg); break;
    case 'back': goBack(); break;
    case 'forward': goForward(); break;
    case 'reload': withActive((wc) => wc.reload()); break;
    case 'stop': withActive((wc) => wc.stop()); break;
    case 'home': goHome(); break;
    case 'new-tab': newTab(''); break;
    case 'prompt-answer': answerPrompt(arg); break;
    case 'side-reveal': openSide(); break;
    case 'side-hide': if (overlayKind === 'side') closeOverlay(false); break;
    case 'side-drag-start':   // genislik surukleme: arayuz one alinir ki fare sayfanin ustune gecse de olaylari alsin
      if (vertical() && !settings.verticalAutoHide && !overlayOpen) { overlayOpen = true; overlayKind = 'sidedrag'; raiseUi(); layout(); }
      break;
    case 'side-width': {
      const v = Math.round(Number(arg));
      if (!Number.isFinite(v)) break;
      settings.verticalWidth = Math.max(SIDE_MIN, Math.min(560, v));
      forEachWin(() => layout());
      break;
    }
    case 'side-drag-end': saveSettings(); if (overlayKind === 'sidedrag') closeOverlay(false); forEachWin(() => pushState()); break;
    case 'toggle-autohide': toggleAutoHide(); break;
    case 'close-tab': closeTab(arg); break;
    case 'activate': activateTab(arg); break;
    case 'find': withActive((wc) => { if (arg.text) wc.findInPage(arg.text, { forward: arg.forward !== false, findNext: !!arg.next }); else wc.stopFindInPage('clearSelection'); }); break;
    case 'find-close': closeFind(); break;
    case 'menu': openOverlay(arg); break;
    case 'menu-close': closeOverlay(); break;
    case 'chooser-select': finishChooser(arg); break;
    case 'menu-action': menuAction(arg && arg.id, arg && arg.arg); break;
    case 'shield': showShieldMenu(arg); break;
    case 'site-menu': showSiteMenu(arg); break;
    case 'downloads': showDownloadsMenu(arg); break;
    case 'tab-menu': showTabMenu(arg); break;
    case 'reload-menu': showReloadMenu(arg); break;
    case 'bookmark-toggle': toggleBookmark(); break;
    case 'bookmark-open': if (arg && arg.url) openUrl(arg.url, arg.newTab ? 'tab' : null); break;
    case 'bookmark-menu': showBookmarkMenu(arg); break;
    case 'bookmark-folder': showBookmarkFolder(arg); break;
    case 'bookmark-folder-menu': showBookmarkFolderMenu(arg); break;
    case 'bar-menu': popAt([{ label: 'Yer işaretleri çubuğunu gizle', click: toggleBookmarksBar }], arg); break;
    case 'move-tab': {
      const from = tabs.findIndex((t) => t.id === arg.id);
      if (from >= 0) { const [t] = tabs.splice(from, 1); tabs.splice(Math.max(0, Math.min(arg.to, tabs.length)), 0, t); orderPinned(); pushState(); }
      break;
    }
    case 'mute': toggleMute(arg); break;
    case 'pin': togglePin(arg); break;
    case 'omni-query': {
      const r = omniSuggest(arg);
      send('omni-results', { q: String(arg || ''), ...r });
      if (r.items.length) openOmni(); else if (overlayKind === 'omni') closeOverlay(false);
      break;
    }
    case 'omni-close': if (overlayKind === 'omni') closeOverlay(false); break;
    case 'navigate-tab': if (arg) newTab(arg, false, activeId); break;
  }
});

// ---------------------------------------------------------------- Kisayollar
function handleShortcut(input) {
  if (input.type && input.type !== 'keyDown') return false;
  const ctrl = isMac ? input.meta : input.control;
  const k = (input.key || '').toLowerCase();
  if (k === 'escape' && htmlFullscreen) { withActive((wc) => wc.executeJavaScript('document.exitFullscreen && document.exitFullscreen()').catch(() => {})); return true; }
  if (k === 'escape' && overlayOpen) { closeOverlay(); return true; }
  if (k === 'escape' && findOpen) { closeFind(); return true; }
  if (ctrl && input.shift && k === 't') { reopenClosed(); return true; }
  if (ctrl && input.shift && k === 'n') { newWindow(true); return true; }               // yeni gizli pencere
  if (ctrl && k === 'n') { newWindow(false); return true; }                              // yeni pencere
  if (ctrl && k === 't') { newTab(''); return true; }
  if (ctrl && input.shift && (k === 'w' || k === 'q')) { if (win) win.close(); return true; }
  if ((ctrl && k === 'w') || (ctrl && k === 'f4')) { if (activeId) closeTab(activeId); return true; }
  if (ctrl && (k === 'pagedown' || k === 'pageup')) {
    if (input.shift) { moveActiveTab(k === 'pagedown' ? 1 : -1); return true; }
    const i = tabs.findIndex((t) => t.id === activeId), n = tabs.length;
    if (n > 1) activateTab(tabs[(i + (k === 'pagedown' ? 1 : n - 1)) % n].id);
    return true;
  }
  if (ctrl && (k === 'e' || k === 'k')) { focusUrl(true); return true; }
  if ((input.alt && (k === 'f' || k === 'e')) || k === 'f10') { send('open-menu'); return true; }
  if (ctrl && input.shift && k === 'delete') { clearData(); return true; }
  if (ctrl && !input.shift && k === 'u') { withActive((wc) => newTab('view-source:' + wc.getURL(), false, activeId)); return true; }
  // Ctrl+S: dikey sekmelerde saklanma modu ac/kapa (kullanici istedi); sayfayi kaydetmek Ctrl+Shift+S
  if (ctrl && !input.shift && k === 's') { if (settings.verticalTabs) toggleAutoHide(); else withActive((wc) => saveAs(wc)); return true; }
  if (ctrl && input.shift && k === 's') { withActive((wc) => saveAs(wc)); return true; }
  if (ctrl && !input.shift && k === 'o') { openFileDialog(); return true; }
  if ((ctrl && k === 'g') || k === 'f3') { findStep(!input.shift); return true; }
  if (ctrl && input.shift && (k === 'j' || k === 'c')) { withActive((wc) => (wc.isDevToolsOpened() ? wc.devToolsWebContents && wc.devToolsWebContents.focus() : wc.openDevTools())); return true; }
  if (k === 'f9') { withActive((wc) => toggleReader(wc)); return true; }
  if (k === 'escape' && !input.shift && !ctrl) { const t = activeTab(); if (t && t.loading && t.view) t.view.webContents.stop(); return false; }
  if ((ctrl && k === 'l') || (input.alt && k === 'd') || k === 'f6') { focusUrl(); return true; }
  if (ctrl && k === 'f') { openFind(); return true; }
  if (ctrl && k === 'p') { withActive((wc) => wc.print()); return true; }
  if (input.shift && k === 'escape') { showTaskManager(); return true; }
  if (ctrl && k === 'd') { toggleBookmark(); return true; }
  if (ctrl && input.shift && k === 'b') { toggleBookmarksBar(); return true; }
  if ((ctrl && k === 'r') || k === 'f5') { withActive((wc) => (input.shift || ctrl && k === 'f5' ? wc.reloadIgnoringCache() : wc.reload())); return true; }
  if (input.alt && k === 'home') { goHome(); return true; }
  if (k === 'f11') { win.setFullScreen(!win.isFullScreen()); return true; }
  if (ctrl && k === 'tab') {
    const i = tabs.findIndex((t) => t.id === activeId), n = tabs.length;
    if (n > 1) activateTab(tabs[(i + (input.shift ? n - 1 : 1)) % n].id);
    return true;
  }
  if (input.alt && k === 'arrowleft') { goBack(); return true; }
  if (input.alt && k === 'arrowright') { goForward(); return true; }
  if (ctrl && (k === '+' || k === '=')) { zoom(0.5); return true; }
  if (ctrl && k === '-') { zoom(-0.5); return true; }
  if (ctrl && k === '0') { zoom(0); return true; }
  if (k === 'f12' || (ctrl && input.shift && k === 'i')) { withActive((wc) => wc.toggleDevTools()); return true; }
  if (ctrl && !input.shift && k === 'j') { openPage(DOWNLOADS_URL); return true; }
  if (ctrl && !input.shift && k === 'h') { openPage(HISTORY_URL); return true; }
  if (ctrl && /^[1-9]$/.test(k)) {
    const idx = k === '9' ? tabs.length - 1 : Number(k) - 1;
    if (tabs[idx]) activateTab(tabs[idx].id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- Menuler
// Menu tiklamasi sonradan gelir; o anda baska pencere islenmis olabilir, bu yuzden menunun penceresine donulur
function bindMenu(items) {
  const w = W;
  const wrap = (list) => list.map((it) => ({
    ...it,
    ...(it.label ? { label: T(it.label) } : {}),
    ...(typeof it.click === 'function' ? { click: (...a) => { useWin(w); return it.click(...a); } } : {}),
    ...(Array.isArray(it.submenu) ? { submenu: wrap(it.submenu) } : {})
  }));
  return wrap(items);
}
const popAt = (items, pos) => Menu.buildFromTemplate(bindMenu(items)).popup({ window: win, x: Math.round((pos && pos.x) || 0), y: Math.round((pos && pos.y) || 0) });
const acc = (s) => (isMac ? s.replace('Ctrl', 'Cmd') : s);
const hint = (s) => ({ accelerator: acc(s), registerAccelerator: false });

function setSetting(key, value, needsRestart) {
  settings[key] = value;
  saveSettings(true);
  forEachWin(() => pushState());
  if (!needsRestart) return;
  dialog.showMessageBox(win, {
    type: 'question', buttons: ['Şimdi yeniden başlat', 'Sonra'], defaultId: 0, cancelId: 1,
    message: 'Bu ayar tarayıcı yeniden başlatılınca uygulanır.'
  }).then((r) => { if (r.response === 0) { app.relaunch(); app.quit(); } });
}

// ---------------------------------------------------------------- Chrome tarzi menu (ayri surec acmadan, arayuz katmaninda cizilir)
function openOverlay(arg) {
  if (!win || !ui || overlayKind === 'prompt') return;
  if (chooser) finishChooser(null);
  overlayOpen = true;
  overlayKind = 'menu';
  raiseUi();
  layout();
  ui.webContents.focus();
  send('menu-open', { kind: (arg && arg.kind) || 'main', anchor: arg || {}, data: menuData() });
}
function closeOverlay(refocus = true) {
  if (!overlayOpen) return;
  overlayOpen = false;
  const kind = overlayKind;
  overlayKind = null;
  if (kind === 'chooser' && chooser) finishChooser(null);   // disari tiklandi: iptal
  if (kind === 'side') {
    // Acilan kenar cubugu acildigi gibi sola kayarak kapanir; arayuz animasyon bitene kadar onde kalir
    send('side-reveal', false);
    const w = W;
    setTimeout(() => inWin(w, () => layout()), 190);
    return;
  }
  layout();
  send('menu-closed');
  if (kind === 'sidedrag') send('side-reveal', false);
  if (kind === 'prompt') {   // disari tiklandi / Esc: bu seferlik reddet
    const p = prompts.find((x) => x.w === W && x.shown);
    if (p) { settlePrompt(p, 'dismiss'); return; }
  }
  if (refocus && kind !== 'omni') withActive((wc) => wc.focus());
}

function zoomPercent() {
  let z = 100;
  withActive((wc) => { z = Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100); });
  return z;
}

function menuData() {
  const t = activeTab();
  return {
    zoom: zoomPercent(),
    volume: (activeTab() && activeTab().volume) || 100,
    volumeMax: VOLUME_MAX,
    fullscreen: !!(win && win.isFullScreen()),
    bookmarked: t ? isBookmarked(t.url) : false,
    canBookmark: !!t && !isInternal(t.url),
    bookmarksBar: settings.bookmarksBar,
    bookmarks: settings.bookmarks.map((b, i) => ({ i, title: b.title || b.url, favicon: b.favicon, path: b.path })).filter((b) => !b.path || !b.path.length).slice(0, 40),
    bookmarkFolders: bookmarkGroups().map((g) => g.name),
    engine: settings.searchEngine,
    theme: settings.theme,
    themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name })),
    engines: Object.entries(SEARCH_ENGINES).map(([key, e]) => ({ key, name: e.name })),
    extSupport: !!extensions && !W.incognito,
    webStore: !!CWS,
    extensions: W.incognito ? [] : listExtensions(),
    closed: closedTabs.slice(0, 8).map((c, i) => ({ i, title: c.title, favicon: c.favicon })),
    canRead: (() => { const t = activeTab(); return !!t && /^https?:/i.test(t.url); })(),
    incognito: !!W.incognito,
    version: app.getVersion()
  };
}

function menuAction(id, arg) {
  const refresh = () => send('menu-data', menuData());
  switch (id) {
    case 'new-tab': newTab(''); break;
    case 'new-window': newWindow(false); break;
    case 'new-incognito': newWindow(true); break;
    case 'downloads': openPage(DOWNLOADS_URL); break;
    case 'history': openPage(HISTORY_URL); break;
    case 'settings': openPage(SETTINGS_URL); break;
    case 'reopen': reopenClosed(Number(arg) || 0); break;
    case 'reader': withActive((wc) => toggleReader(wc)); break;
    case 'pip': withActive((wc) => pictureInPicture(wc)); break;
    case 'bookmark-toggle': toggleBookmark(); break;
    case 'bookmarks-bar': toggleBookmarksBar(); break;
    case 'bookmarks-import': openSettingsAt('yer-isaretleri'); break;
    case 'bookmark-open': { const b = settings.bookmarks[arg]; if (b) openUrl(b.url); break; }
    case 'zoom-in': zoom(0.5); refresh(); break;
    case 'zoom-out': zoom(-0.5); refresh(); break;
    case 'zoom-reset': zoom(0); refresh(); break;
    case 'vol-set': { const t = activeTab(); if (t) setVolume(t.id, arg); break; }
    case 'extensions-page': openPage(EXTENSIONS_URL); break;
    case 'ext-hide': if (arg && typeof arg.id === 'string') setExtensionHidden(arg.id, !!arg.hidden); refresh(); break;
    case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
    case 'print': withActive((wc) => wc.print()); break;
    case 'find': openFind(); break;
    case 'task-manager': showTaskManager(); break;
    case 'clear-data': clearData(); break;
    case 'devtools': withActive((wc) => wc.toggleDevTools()); break;
    case 'device-grants': showDeviceGrants(); break;
    case 'update-filters': forceUpdateFilters(); break;
    case 'engine': if (SEARCH_ENGINES[arg]) { setSetting('searchEngine', arg); broadcastPages(); } break;
    case 'theme': if (THEMES[arg]) { settings.theme = arg; saveSettings(); applyTheme(); refresh(); } break;
    case 'web-store': openUrl('https://chromewebstore.google.com/category/extensions', 'tab'); break;
    case 'ext-load': loadUnpackedDialog(); break;
    case 'ext-options': { const e = listExtensions().find((x) => x.id === arg); if (e && e.optionsUrl) newTab(e.optionsUrl); break; }
    case 'ext-remove': removeExtension(arg); break;
    case 'about': dialog.showMessageBox(win, {
      message: 'Mondium ' + app.getVersion(),
      detail: `${uiLang() === 'en' ? 'Engine' : 'Motor'}: Chromium ${process.versions.chrome}\nElectron ${process.versions.electron}\n\n${T('Google hesabı gerekmez, telemetri yok, reklam engelleyici her zaman açık.')}`
    }); break;
    case 'quit': app.quit(); break;
  }
}

// ---------------------------------------------------------------- Gorev yoneticisi (hangi sekme ne kadar RAM kullaniyor)
const MB = (kb) => Math.round(kb / 1024);
function showTaskManager() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const memOf = (m) => (m && m.memory ? (m.memory.privateBytes || m.memory.workingSetSize || 0) : 0);
  const seen = new Set();
  const lines = [];
  let total = 0;
  for (const t of allTabs()) {
    const title = (t.w && t.w.incognito ? '(Gizli) ' : '') + (t.title || 'Sekme').slice(0, 45);
    if (!t.view) { lines.push(`Sekme: ${title}  -  uyutuldu (0 MB)`); continue; }
    const pid = t.view.webContents.getOSProcessId();
    if (seen.has(pid)) { lines.push(`Sekme: ${title}  -  aynı süreci paylaşıyor`); continue; }
    seen.add(pid);
    const kb = memOf(byPid.get(pid));
    total += kb;
    lines.push(`Sekme: ${title}  -  ${MB(kb)} MB`);
  }
  const names = { Browser: 'Tarayıcı (ana süreç)', GPU: 'GPU süreci', Utility: 'Yardımcı süreç', Tab: 'Arayüz / uzantı' };
  for (const m of metrics) {
    if (seen.has(m.pid)) continue;
    const kb = memOf(m);
    total += kb;
    lines.push(`${names[m.type] || m.type}${m.name ? ' (' + m.name + ')' : ''}  -  ${MB(kb)} MB`);
  }
  dialog.showMessageBox(win, {
    type: 'info', title: 'Görev yöneticisi', buttons: ['Arka plan sekmelerini şimdi uyut', 'Kapat'], defaultId: 1, cancelId: 1,
    message: `Toplam bellek: ${MB(total)} MB`,
    detail: lines.join('\n')
  }).then((r) => { if (r.response === 0) sleepIdleTabs(true); });
}

// ---------------------------------------------------------------- Uzantilar
const extApi = () => (mainSes && mainSes.extensions && typeof mainSes.extensions.getAllExtensions === 'function' ? mainSes.extensions : mainSes);

// Uzanti bilgisi (ad, aciklama, simge). Dosyadan okunur; surum basina onbellekte tutulur.
const extInfoCache = new Map();
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function extInfo(id, dir, manifest) {
  const m = manifest || readJson(path.join(dir, 'manifest.json'));
  if (!m) return null;
  const key = dir + '|' + m.version;
  if (extInfoCache.has(key)) return extInfoCache.get(key);
  // __MSG_ad__ bicimindeki yerellestirilmis metinler: Turkce, varsayilan dil, Ingilizce sirasiyla
  let msgs = null;
  const msg = (v) => {
    if (typeof v !== 'string' || !/^__MSG_\w+__$/.test(v)) return v || '';
    if (!msgs) {
      msgs = {};
      for (const l of [m.default_locale, 'en', 'tr'].filter(Boolean)) Object.assign(msgs, readJson(path.join(dir, '_locales', l, 'messages.json')) || {});
      msgs = Object.fromEntries(Object.entries(msgs).map(([k, x]) => [k.toLowerCase(), x && x.message]));
    }
    return msgs[v.slice(6, -2).toLowerCase()] || '';
  };
  let icon = null;
  const icons = m.icons || {};
  // 48 piksele en yakin buyuk simge, yoksa en buyugu
  const size = Object.keys(icons).map(Number).filter((n) => n > 0).sort((x, y) => (y >= 48) - (x >= 48) || (x >= 48 ? x - y : y - x))[0];
  if (size) {
    try {
      const f = path.join(dir, String(icons[size]).replace(/^\//, ''));
      const ext = path.extname(f).slice(1).toLowerCase();
      const buf = fs.readFileSync(f);
      if (buf.length < 300e3) icon = `data:image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext || 'png'};base64,${buf.toString('base64')}`;
    } catch {}
  }
  const opt = (m.options_ui && m.options_ui.page) || m.options_page;
  const info = {
    id, name: msg(m.name) || msg(m.short_name) || id, version: m.version || '', description: msg(m.description),
    icon, optionsUrl: opt ? `chrome-extension://${id}/${opt.replace(/^\//, '')}` : null,
    hasAction: !!(m.action || m.browser_action), theme: !!m.theme
  };
  extInfoCache.set(key, info);
  return info;
}
const storeExtDir = () => path.join(app.getPath('userData'), 'Extensions');
const isStoreDir = (p) => !!p && path.resolve(p).toLowerCase().startsWith(path.resolve(storeExtDir()).toLowerCase() + path.sep);
const isDisabledPath = (p) => settings.disabledExtensions.some((d) => path.resolve(d.path) === path.resolve(p));
// Yuklu ve kapatilmis tum uzantilar (kapali olanlar yuklenmedigi icin bilgileri dosyadan okunur)
function listExtensions() {
  if (!mainSes) return [];
  const out = [];
  try {
    for (const e of extApi().getAllExtensions()) {
      const i = e && extInfo(e.id, e.path, e.manifest);
      if (i && !i.theme) out.push({ ...i, enabled: true, hidden: settings.hiddenExtensions.includes(e.id), unpacked: !isStoreDir(e.path) && e.id !== uboId, builtin: e.id === uboId });
    }
  } catch {}
  for (const d of settings.disabledExtensions) {
    if (out.some((x) => x.id === d.id)) continue;
    const i = extInfo(d.id, d.path);
    if (i && !i.theme) out.push({ ...i, enabled: false, hidden: settings.hiddenExtensions.includes(d.id), unpacked: !isStoreDir(d.path) });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'tr'));
}
async function loadExt(dir) {
  const e = await extApi().loadExtension(dir, { allowFileAccess: true });
  if (e && e.manifest && e.manifest.manifest_version === 3 && e.manifest.background && e.manifest.background.service_worker) {
    mainSes.serviceWorkers.startWorkerForScope(`chrome-extension://${e.id}`).catch(() => {});
  }
  return e;
}
// Web Magazasi'ndan kurulanlar: Extensions/<kimlik>/<surum>/ klasorlerinden en yenisi; kapatilanlar atlanir
async function loadStoreExtensions() {
  let ids = [];
  try { ids = fs.readdirSync(storeExtDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
  for (const id of ids) {
    if (settings.disabledExtensions.some((d) => d.id === id)) continue;
    const base = path.join(storeExtDir(), id);
    let vers = [];
    try { vers = fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, 'manifest.json'))); } catch {}
    vers.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    if (!vers.length) continue;
    try { if (!extApi().getExtension(id)) await loadExt(path.join(base, vers[vers.length - 1])); } catch (e) { console.warn('Uzanti yuklenemedi:', id, e.message); }
  }
}
async function setExtensionEnabled(id, on) {
  if (id && id === uboId) return;   // yerlesik
  if (on) {
    const d = settings.disabledExtensions.find((x) => x.id === id);
    if (!d) return;
    try { await loadExt(d.path); } catch (e) { dialog.showMessageBox(win, { type: 'error', message: 'Uzantı açılamadı', detail: e.message }); return; }
    settings.disabledExtensions = settings.disabledExtensions.filter((x) => x.id !== id);
  } else {
    let e = null; try { e = extApi().getExtension(id); } catch {}
    if (!e) return;
    settings.disabledExtensions = settings.disabledExtensions.filter((x) => x.id !== id).concat({ id, path: e.path });
    try { extApi().removeExtension(id); } catch {}
  }
  saveSettings(true);
  extensionsChanged();
}
function setExtensionHidden(id, hidden) {
  settings.hiddenExtensions = settings.hiddenExtensions.filter((x) => x !== id);
  if (hidden) settings.hiddenExtensions.push(id);
  saveSettings();
  extensionsChanged();
}
function extensionsChanged() { forEachWin(() => pushState()); notifyPages('extensions'); notifyPages('settings'); }

async function setupExtensions() {
  const ses = mainSes;
  if (ECE) {
    // Electron'da olmayan chrome.userScripts (Imagus Reborn gibi uzantilar icin), bkz. user-scripts.js.
    // Uzanti kutuphanesinden ONCE kurulmali: kutuphane chrome nesnesini kendi API'lerini ekledikten sonra donduruyor.
    try { require('./user-scripts').setupUserScripts({ ses, storeFile: path.join(app.getPath('userData'), 'kullanici-betikleri.json') }); }
    catch (e) { console.warn('Kullanici betigi destegi baslatilamadi:', e.message); }
    try {
      extensions = new ECE({
        license: 'GPL-3.0',
        session: ses,
        createTab: async (details) => {
          // Bir uzanti kendi sayfasini (ornegin ayarlarini) zaten acik bir sekmede tekrar acmak isterse yeni sekme
          // acma, mevcut sekmeye gec. Yoksa her acilista ayni sayfa birikiyor (oturum geri yukleme + uzanti).
          const u = details.url || '';
          const same = /^chrome-extension:/i.test(u) && allTabs().find((x) => x.url.split('#')[0] === u.split('#')[0]);
          useWin(same ? same.w : lastWin(true));
          if (same) {
            if (details.active !== false || !same.view) activateTab(same.id);
            if (same.view) {
              // Geri yuklenen sekme uzanti hazir olmadan acilmis ve hata vermis olabilir: yeniden yukle
              same.url = u; go(same.view.webContents, u);
              return [same.view.webContents, win];
            }
          }
          const t = newTab(u, details.active === false, activeId);
          return [t.view.webContents, win];
        },
        selectTab: (wc) => { if (!wc || wc.isDestroyed()) return; const t = byWcId.get(wc.id); if (t) { useWin(t.w); activateTab(t.id); } },
        // Kutuphane, kapanan/uyutulan sekmeler icin de bunu cagirir; sadece uzantinin istedigi canli sekmeleri kapat
        removeTab: (wc) => { if (!wc || wc.isDestroyed()) return; const t = byWcId.get(wc.id); if (t && t.w && t.w.win) { useWin(t.w); closeTab(t.id); } },
        createWindow: async (details) => { useWin(lastWin(true)); [].concat(details.url || '').forEach((u) => newTab(u)); return win; },
        removeWindow: () => {}
      });
      ECE.handleCRXProtocol(ses);
      for (const t of allTabs()) if (t.view && !t.w.incognito) { try { extensions.addTab(t.view.webContents, t.w.win); } catch {} }
      forEachWin((w) => { if (!w.incognito && activeTab() && activeTab().view) { try { extensions.selectTab(activeTab().view.webContents); } catch {} } });
    } catch (e) {
      console.warn('Uzanti destegi baslatilamadi:', e.message);
      extensions = null;
    }
  }
  eceReadyResolve();
  if (CWS) {
    try {
      await CWS.installChromeWebStore({
        session: ses,
        loadExtensions: false,     // kendimiz yukluyoruz: kapatilan uzantilar atlanir
        // Chrome gibi: adres cubugunun altindan acilan balonda, uzantinin neler yapabilecegi listelenir
        beforeInstall: async (details) => {
          const ow = details.frame ? winOfWc(wcOfFrame(details.frame)) : lastWin(true);
          if (!ow) return { action: 'deny' };
          useWin(ow);
          let icon = null;
          try { icon = details.icon && !details.icon.isEmpty() ? details.icon.resize({ width: 32, height: 32 }).toDataURL() : null; } catch {}
          const r = await askPrompt({
            title: `"${details.localizedName}" eklensin mi?`, icon, rows: extPermissionRows(details.manifest),
            note: 'Her uzantı arka planda çalışır ve biraz RAM kullanır.', ok: 'Uzantı ekle', cancel: 'İptal', kind: 'ext'
          });
          return { action: r === 'ok' ? 'allow' : 'deny' };
        },
        afterInstall: () => extensionsChanged(),
        afterUninstall: () => extensionsChanged()
      });
    } catch (e) { console.warn('Web Magazasi destegi baslatilamadi:', e.message); }
  }
  await loadStoreExtensions();
  for (const dir of settings.unpackedExtensions) {
    if (isDisabledPath(dir)) continue;
    try { await loadExt(dir); } catch (e) { console.warn('Uzanti yuklenemedi:', dir, e.message); }
  }
  pushState();
}

async function loadUnpackedDialog() {
  const r = await dialog.showOpenDialog(win, { title: 'Uzantı klasörünü seç (manifest.json olan klasör)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = r.filePaths[0];
  try {
    await loadExt(dir);
    if (!settings.unpackedExtensions.includes(dir)) { settings.unpackedExtensions.push(dir); saveSettings(true); }
    extensionsChanged();
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Uzantı yüklenemedi', detail: e.message });
  }
}

async function removeExtension(id) {
  if (id && id === uboId) return;   // yerlesik
  const e = listExtensions().find((x) => x.id === id);
  if (!e) return;
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Kaldır', 'İptal'], defaultId: 1, cancelId: 1, message: `"${e.name}" kaldırılsın mı?`, detail: 'Uzantının dosyaları ve ayarları silinir.' });
  if (r.response !== 0) return;
  let ext = null;
  try { ext = extApi().getExtension(id); } catch {}
  const dis = settings.disabledExtensions.find((x) => x.id === id);
  const extPath = ext && ext.path ? ext.path : dis ? dis.path : '';
  try {
    if (ext) extApi().removeExtension(id);
    if (isStoreDir(extPath)) {
      if (CWS && CWS.uninstallExtension) await CWS.uninstallExtension(id, { session: mainSes });
      else fs.rmSync(path.join(storeExtDir(), id), { recursive: true, force: true });
    }
  } catch (err) {
    dialog.showMessageBox(win, { type: 'error', message: 'Kaldırılamadı', detail: err.message });
  }
  settings.unpackedExtensions = settings.unpackedExtensions.filter((d) => !extPath || path.resolve(d) !== path.resolve(extPath));
  settings.disabledExtensions = settings.disabledExtensions.filter((x) => x.id !== id);
  settings.hiddenExtensions = settings.hiddenExtensions.filter((x) => x !== id);
  saveSettings(true);
  extensionsChanged();
}

function showDeviceGrants() {
  const g = settings.deviceGrants;
  if (!g.length) { dialog.showMessageBox(win, { message: 'Hiçbir siteye cihaz izni verilmemiş.' }); return; }
  dialog.showMessageBox(win, {
    type: 'info', buttons: ['Tümünü kaldır', 'Kapat'], defaultId: 1, cancelId: 1,
    message: 'Cihaz izinleri',
    detail: g.map((x) => `${hostOf(x.origin)}  →  ${x.name || KIND_LABEL[x.type]} (${KIND_LABEL[x.type]})`).join('\n')
  }).then((r) => {
    if (r.response !== 0) return;
    settings.deviceGrants = [];
    sessionDeviceIds.clear();
    saveSettings(true);
    if (typeof ses.resetPermissions === 'function') { try { ses.resetPermissions(); } catch {} }
  });
}

function clearHistoryAndDownloads() {
  history = [];
  for (const t of tabs) t.hist = null;
  for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
  saveHistory(true); saveDownloads(true);
  pushState(); notifyPages('history'); notifyPages('downloads');
}

// Ctrl+Shift+Delete ve diger girisler: ayarlar sayfasindaki "Gezinti verilerini temizle" penceresi (normal pencerede)
function clearData() { openSettingsAt('temizle'); }
function openSettingsAt(hash) {
  if (W && W.incognito) { const n = lastWin(true); if (n) { useWin(n); n.win.focus(); } else createWindow(); }
  const ex = tabs.find((t) => baseOf(t.url) === SETTINGS_URL);
  if (ex) {
    activateTab(ex.id);
    if (ex.view) ex.view.webContents.executeJavaScript(`location.hash = ''; location.hash = '#${hash}'; void 0`).catch(() => {});
  } else if (activeTab() && activeTab().view && isNewtab(activeTab().url)) {
    const t = activeTab(); t.url = SETTINGS_URL + '#' + hash; go(t.view.webContents, t.url);
  } else newTab(SETTINGS_URL + '#' + hash);
}

// ---------------------------------------------------------------- Korunan Siteler + secici temizlik (site-data.js)
const siteData = createSiteData({
  getSession: () => mainSes,
  getProtected: () => (Array.isArray(settings.protectedSites) ? settings.protectedSites.slice() : []),
  setProtected: (list) => { settings.protectedSites = list; saveSettings(true); notifyPages('settings'); },
  openTabUrls: () => allTabs().filter((t) => !t.w || !t.w.incognito).map((t) => t.url),
  // CDP komutlari icin gizli, pencereye bagli olmayan gecici gorunum (ana oturum)
  makeDebugTarget: async () => {
    const v = new WebContentsView({ webPreferences: { session: mainSes, sandbox: true, contextIsolation: true } });
    await v.webContents.loadURL('about:blank').catch(() => {});
    return { debugger: v.webContents.debugger, close: () => { try { v.webContents.close(); } catch {} } };
  }
});
const RANGE_MS = { hour: 3600e3, day: 864e5, week: 7 * 864e5, month: 28 * 864e5 };
async function runClear(opts) {
  const o = {
    range: RANGE_MS[opts.range] ? opts.range : 'all',
    history: !!opts.history, downloads: !!opts.downloads, cookies: !!opts.cookies, cache: !!opts.cache, protect: opts.protect !== false
  };
  settings.clearPrefs = o; saveSettings();
  const cutoff = o.range === 'all' ? 0 : Date.now() - RANGE_MS[o.range];
  const out = { history: 0, downloads: 0, cache: null, site: null, notes: [] };
  // Gecmis ve indirme listesi: korumadan bagimsiz, zaman araligina gore
  if (o.history) {
    const n = history.length;
    history = history.filter((h) => h.t < cutoff);
    out.history = n - history.length;
    for (const t of allTabs()) if (t.hist && !history.includes(t.hist)) t.hist = null;
    saveHistory(true); notifyPages('history');
  }
  if (o.downloads) {
    for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing' && (downloads[i].t || 0) >= cutoff) { downloads.splice(i, 1); out.downloads++; }
    saveDownloads(true); notifyPages('downloads');
  }
  if (o.cookies) {
    out.site = await siteData.clear({ cookies: true, siteData: true, protect: o.protect, range: o.range });
    notifyPages('settings');
  }
  // HTTP onbellegi site bazinda guvenle ayrilamiyor (anahtari ust site + kaynak adresi): sadece "tumu", acik secimle
  if (o.cache) {
    if (o.range !== 'all') out.notes.push('Önbellek temizlenmedi: motor önbellekte zaman aralığını desteklemiyor. Önbelleği temizlemek için "Tüm zamanlar"ı seçin.');
    else { try { await mainSes.clearCache(); out.cache = 'requested'; } catch (e) { out.notes.push('Önbellek temizlenemedi: ' + e.message); } }
  }
  forEachWin(() => pushState());
  return out;
}

// Adres cubugundaki site simgesi: site bilgisi menusu
function showSiteMenu(pos) {
  const t = activeTab();
  if (!t || W.incognito || !/^https?:/i.test(t.url)) return;
  const site = siteData.siteOfOrigin(t.url);
  if (!site) return;
  const on = (settings.protectedSites || []).includes(site);
  popAt([
    { label: siteData.displaySite(site), enabled: false },
    { type: 'separator' },
    { label: 'Bu siteyi temizlikten koru', type: 'checkbox', checked: on, click: () => {
      const r = siteData.setSite(site, !on);
      if (r.deps && r.deps.length) {
        dialog.showMessageBox(win, { type: 'info', buttons: ['Bunları da koru', 'Gerek yok'], defaultId: 0, cancelId: 1,
          message: `${siteData.displaySite(site)} korunuyor.`,
          detail: `Bu sitede şu hesapla giriş yapıyorsanız oturumun sürmesi için onu da korumanız gerekebilir: ${r.deps.map((d) => d.name + ' (' + d.display + ')').join(', ')}. Mondium bunları kendiliğinden eklemez.` })
          .then((x) => { if (x.response === 0) for (const d of r.deps) siteData.setSite(d.site, true); });
      }
    } },
    { label: 'Çerezler ve site verileri...', click: () => openSettingsAt('siteler') }
  ], pos);
}

// Thorium: yenile dugmesine sag tik menusu
function showReloadMenu(pos) {
  popAt([
    { label: 'Normal yeniden yükleme', ...hint('Ctrl+R'), click: () => withActive((wc) => wc.reload()) },
    { label: 'Sert yeniden yükleme', ...hint('Ctrl+Shift+R'), click: () => withActive((wc) => wc.reloadIgnoringCache()) },
    { label: 'Önbelleği boşalt ve sert yeniden yükle', click: async () => { await ses.clearCache(); withActive((wc) => wc.reloadIgnoringCache()); } }
  ], pos);
}

function showShieldMenu(pos) {
  const t = activeTab();
  popAt([
    { label: blocker ? 'Reklam engelleyici: AÇIK' : 'Reklam engelleyici yükleniyor...', enabled: false },
    { label: `${(t && hostOf(t.url)) || 'Bu sayfa'}: ${t ? t.blocked : 0} reklam/izleyici engellendi`, enabled: false },
    { type: 'separator' },
    { label: 'Filtre listelerini şimdi güncelle', click: forceUpdateFilters }
  ], pos);
}

// ---------------------------------------------------------------- Yer isareti klasorleri (ice aktarilanlar) ve aktarma
// Veri modeli duz liste kaliyor: ice aktarilan yer isaretinde path = ['Google Chrome', 'Is', ...]. Cubukta path[0] tek
// klasor dugmesi olarak gorunur, tiklayinca alt klasorleriyle yerel menu acilir.
function barItems() {
  const out = [], seen = new Set();
  settings.bookmarks.forEach((b, i) => {
    if (b.path && b.path.length) {
      const g = b.path[0];
      if (seen.has(g)) return;
      seen.add(g);
      out.push({ folder: g, count: settings.bookmarks.filter((x) => x.path && x.path[0] === g).length });
    } else out.push({ i, url: b.url, title: b.title, favicon: b.favicon });
  });
  return out;
}
function bookmarkGroups() {
  const m = new Map();
  for (const b of settings.bookmarks) if (b.path && b.path.length) m.set(b.path[0], (m.get(b.path[0]) || 0) + 1);
  return [...m].map(([name, count]) => ({ name, count }));
}
const menuLabel = (s) => String(s || '').slice(0, 70).replace(/&/g, '&&');
function folderMenuItems(group) {
  const root = { dirs: new Map(), items: [] };
  for (const b of settings.bookmarks) {
    if (!b.path || b.path[0] !== group) continue;
    let n = root;
    for (const d of b.path.slice(1)) { if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), items: [] }); n = n.dirs.get(d); }
    n.items.push(b);
  }
  const build = (n) => [
    ...[...n.dirs].map(([name, c]) => ({ label: menuLabel(name), submenu: build(c) })),
    ...(n.dirs.size && n.items.length ? [{ type: 'separator' }] : []),
    ...n.items.slice(0, 500).map((b) => ({ label: menuLabel(b.title || b.url), click: () => openUrl(b.url) }))
  ];
  const items = build(root);
  return items.length ? items : [{ label: '(boş)', enabled: false }];
}
function showBookmarkFolder(arg) {
  if (!arg || typeof arg.folder !== 'string') return;
  popAt(folderMenuItems(arg.folder), arg);
}
function showBookmarkFolderMenu(arg) {
  if (!arg || typeof arg.folder !== 'string') return;
  const g = arg.folder;
  popAt([
    { label: 'Tümünü yeni sekmelerde aç', click: () => { const l = settings.bookmarks.filter((b) => b.path && b.path[0] === g).slice(0, 30); for (const b of l) newTab(b.url, true, activeId); } },
    { label: 'Yer işaretlerini yönet...', click: () => openSettingsAt('yer-isaretleri') },
    { type: 'separator' },
    { label: `"${menuLabel(g)}" klasörünü sil`, click: () => removeBookmarkGroup(g) }
  ], arg);
}
function removeBookmarkGroup(g) {
  const n = settings.bookmarks.length;
  settings.bookmarks = settings.bookmarks.filter((b) => !(b.path && b.path[0] === g));
  saveSettings(); forEachWin(() => pushState()); notifyPages('settings');
  return { removed: n - settings.bookmarks.length };
}
// Ayni adres zaten varsa eklenmez; klasor adi tarayici adi (ayni ad varsa yeni gelenler ona eklenir)
function addImported(items, group) {
  if (!Array.isArray(items)) return { error: 'Yer işaretleri okunamadı.' };
  const have = new Set(settings.bookmarks.map((b) => b.url));
  let added = 0, skipped = 0;
  for (const it of items) {
    if (have.has(it.url)) { skipped++; continue; }
    have.add(it.url);
    settings.bookmarks.push({ url: it.url, title: it.title, favicon: null, path: [group, ...(it.path || [])] });
    added++;
  }
  if (added && !settings.bookmarksBar) settings.bookmarksBar = true;
  saveSettings(true); forEachWin(() => { layout(); pushState(); }); notifyPages('settings');
  return { added, skipped, group };
}
async function importBookmarksHtml() {
  const r = await dialog.showOpenDialog(win, { title: 'Yer işareti dosyasını seçin', properties: ['openFile'], filters: [{ name: 'Yer işaretleri (HTML)', extensions: ['html', 'htm'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const items = bookmarkImport.readHtmlFile(r.filePaths[0]);
  if (!items) return { error: 'Dosya okunamadı.' };
  if (!items.length) return { error: 'Dosyada yer işareti bulunamadı.' };
  return addImported(items, 'HTML dosyası');
}

function showBookmarkMenu(arg) {
  const b = settings.bookmarks[arg.index];
  if (!b) return;
  popAt([
    { label: 'Aç', click: () => openUrl(b.url) },
    { label: 'Yeni sekmede aç', click: () => openUrl(b.url, 'tab') },
    { label: 'Adresi kopyala', click: () => clipboard.writeText(b.url) },
    { type: 'separator' },
    { label: 'Sola taşı', enabled: arg.index > 0, click: () => { settings.bookmarks.splice(arg.index - 1, 0, settings.bookmarks.splice(arg.index, 1)[0]); saveSettings(); pushState(); } },
    { label: 'Sağa taşı', enabled: arg.index < settings.bookmarks.length - 1, click: () => { settings.bookmarks.splice(arg.index + 1, 0, settings.bookmarks.splice(arg.index, 1)[0]); saveSettings(); pushState(); } },
    { label: 'Sil', click: () => { settings.bookmarks.splice(arg.index, 1); saveSettings(); pushState(); } }
  ], arg);
}

function fmtBytes(b) { return b > 1 << 30 ? (b / (1 << 30)).toFixed(1) + ' GB' : b > 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }

function showDownloadsMenu(pos) {
  const items = downloads.slice(0, 10).map((d) => {
    const st = d.state === 'completed' ? fmtBytes(d.total || d.received)
      : d.state === 'progressing' ? (d.total ? Math.round((d.received / d.total) * 100) + '%' : fmtBytes(d.received))
      : d.state === 'cancelled' ? 'iptal edildi' : 'başarısız';
    return {
      label: `${d.name}  -  ${st}`,
      submenu: [
        { label: 'Aç', enabled: d.state === 'completed', click: () => shell.openPath(d.file) },
        { label: 'Klasörde göster', enabled: d.state === 'completed', click: () => shell.showItemInFolder(d.file) },
        { label: 'İptal et', enabled: d.state === 'progressing' && !!d.item, click: () => d.item && d.item.cancel() }
      ]
    };
  });
  if (!items.length) items.push({ label: 'İndirme yok', enabled: false });
  items.push({ type: 'separator' }, { label: 'Tüm indirilenler', ...hint('Ctrl+J'), click: () => openPage(DOWNLOADS_URL) },
    { label: 'İndirilenler klasörünü aç', click: () => shell.openPath(app.getPath('downloads')) });
  popAt(items, pos);
}

function showTabMenu(arg) {
  const t = getTab(arg.id);
  if (!t) return;
  const idx = tabs.indexOf(t);
  popAt([
    { label: 'Yeni sekme', click: () => newTab('', false, t.id) },
    { type: 'separator' },
    { label: 'Yenile', enabled: !!t.view, click: () => t.view && t.view.webContents.reload() },
    { label: 'Kopyala', click: () => newTab(t.url, false, t.id) },
    { label: t.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle', click: () => togglePin(t.id) },
    ...(settings.tabAudio ? [{ label: t.muted ? 'Sitenin sesini aç' : 'Sitenin sesini kapat', click: () => toggleMute(t.id) }] : []),
    { label: settings.verticalTabs ? 'Yatay sekmelere geç' : 'Dikey sekmelere geç', click: () => setVerticalTabs(!settings.verticalTabs) },
    ...(settings.verticalTabs ? [{ label: 'Kenar çubuğunu otomatik gizle', type: 'checkbox', checked: !!settings.verticalAutoHide, ...hint('Ctrl+S'), click: () => toggleAutoHide() }] : []),
    ...([{ label: 'Ses seviyesi (%' + (t.volume || 100) + ')', enabled: /^https?:/i.test(t.url), submenu: VOLUME_STEPS.map((v) => ({
      label: '%' + v + (v === 100 ? ' (normal)' : ''), type: 'radio', checked: (t.volume || 100) === v, click: () => setVolume(t.id, v)
    })) }]),
    { label: 'Yer işareti koy', enabled: !isNewtab(t.url) && !isBookmarked(t.url), click: () => { settings.bookmarks.push({ url: t.url, title: t.title, favicon: t.favicon }); saveSettings(); pushState(); } },
    { type: 'separator' },
    { label: 'Kapat', click: () => closeTab(t.id) },
    { label: 'Diğer sekmeleri kapat', enabled: tabs.length > 1, click: () => tabs.filter((x) => x !== t).map((x) => x.id).forEach(closeTab) },
    { label: 'Sağdaki sekmeleri kapat', enabled: idx < tabs.length - 1, click: () => tabs.slice(idx + 1).map((x) => x.id).forEach(closeTab) },
    { type: 'separator' },
    { label: 'Kapatılan sekmeyi yeniden aç', ...hint('Ctrl+Shift+T'), enabled: closedTabs.length > 0, click: () => reopenClosed() }
  ], arg);
}

function showContextMenu(wc, p) {
  const items = [];
  if (p.linkURL) {
    items.push({ label: 'Bağlantıyı yeni sekmede aç', click: () => newTab(p.linkURL, true, activeId) });
    items.push({ label: 'Bağlantıyı farklı kaydet...', click: () => wc.downloadURL(p.linkURL) });
    items.push({ label: 'Bağlantı adresini kopyala', click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Resmi yeni sekmede aç', click: () => newTab(p.srcURL, true, activeId) });
    items.push({ label: 'Resmi kaydet', click: () => wc.downloadURL(p.srcURL) });
    items.push({ label: 'Resmi kopyala', click: () => wc.copyImageAt(p.x, p.y) });
    items.push({ label: 'Resim adresini kopyala', click: () => clipboard.writeText(p.srcURL) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
      { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' },
      { role: 'selectAll', label: 'Tümünü seç' });
  } else if (p.selectionText) {
    const s = p.selectionText.trim();
    const name = (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name;
    items.push({ role: 'copy', label: 'Kopyala' });
    items.push({ label: `${name} ile "${s.length > 24 ? s.slice(0, 24) + '...' : s}" ara`, click: () => newTab(searchUrl() + encodeURIComponent(s), false, activeId) });
  } else if (p.mediaType === 'video' || p.mediaType === 'audio') {
    const f = p.mediaFlags || {};
    if (p.mediaType === 'video') items.push({ label: 'Resim içinde resim', click: () => pictureInPicture(wc, p.frame, p.x, p.y) });
    items.push({ label: 'Döngü', type: 'checkbox', checked: !!f.isLooping, click: () => mediaToggle(wc, p.frame, p.x, p.y, 'loop') });
    items.push({ label: 'Denetimleri göster', type: 'checkbox', checked: !!f.isControlsVisible, click: () => mediaToggle(wc, p.frame, p.x, p.y, 'controls') });
    if (p.srcURL && /^https?:/i.test(p.srcURL)) items.push({ label: p.mediaType === 'video' ? 'Videoyu farklı kaydet...' : 'Sesi farklı kaydet...', click: () => wc.downloadURL(p.srcURL) });
  } else if (!p.linkURL && p.mediaType !== 'image') {
    const nav = wc.navigationHistory;
    items.push({ label: 'Geri', enabled: nav ? nav.canGoBack() : wc.canGoBack(), click: goBack });
    items.push({ label: 'İleri', enabled: nav ? nav.canGoForward() : wc.canGoForward(), click: goForward });
    items.push({ label: 'Yeniden yükle', click: () => wc.reload() });
    items.push({ type: 'separator' });
    items.push({ label: 'Farklı kaydet...', click: () => saveAs(wc) });
    items.push({ label: 'Yazdır...', click: () => wc.print() });
    items.push({ label: 'Sayfa kaynağını görüntüle', click: () => newTab('view-source:' + wc.getURL(), false, activeId) });
    if (/^https?:/i.test(wc.getURL())) items.push({ label: 'Okuma modu', accelerator: 'F9', registerAccelerator: false, click: () => toggleReader(wc) });
  }
  if (extensions) {
    try {
      const extItems = extensions.getContextMenuItems(wc, p) || [];
      if (extItems.length) items.push({ type: 'separator' }, ...extItems);
    } catch {}
  }
  items.push({ type: 'separator' }, { label: 'İncele', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(bindMenu(items)).popup({ window: win });
}

// ---------------------------------------------------------------- Video: resim icinde resim
// Tiklanan noktadaki videoyu; yoksa once oynayan, sonra en buyuk videoyu bulan sayfa ici ifade.
function findMediaJs(x, y, audio = false) {
  const tags = audio ? "['VIDEO', 'AUDIO']" : "['VIDEO']";
  const hit = Number.isFinite(x) && Number.isFinite(y)
    ? `document.elementsFromPoint(${x}, ${y}).find((e) => ${tags}.includes(e.tagName))` : 'null';
  const all = `[...document.querySelectorAll('${audio ? 'video, audio' : 'video'}')]`;
  return `(${hit} || ${all}.sort((a, b) => (a.paused - b.paused) || (b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight))[0] || null)`;
}
async function pictureInPicture(wc, frame, x, y) {
  if (!wc || wc.isDestroyed()) return;
  const code = `(async () => {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'kapandi'; }
    const v = ${findMediaJs(x, y)};
    if (!v) return '';
    v.disablePictureInPicture = false;
    await v.requestPictureInPicture();
    return 'acik';
  })()`;
  // Once tiklanan kare, sonra sayfadaki tum kareler (gomulu oynaticilar icin)
  const frames = [frame, ...(wc.mainFrame ? wc.mainFrame.framesInSubtree : [])].filter(Boolean);
  for (const f of frames) {
    try { if (await f.executeJavaScript(code, true)) return; } catch {}
  }
}
function mediaToggle(wc, frame, x, y, what) {
  const code = `(() => { const v = ${findMediaJs(x, y, true)}; if (v) v.${what} = !v.${what}; })()`;
  (frame || wc.mainFrame).executeJavaScript(code, true).catch(() => {});
}

// ---------------------------------------------------------------- Okuma modu
// Sayfanin ana yazisini sade bir katmanda gosterir. Ayri surec veya sayfa acmaz; ayrik dunyada calisir,
// boylece sitenin kendi betikleri ve guvenlik kurallari (CSP) karismaz. Tekrar cagrilinca kapanir.
let READER_JS = null;
function toggleReader(wc) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  if (!READER_JS) READER_JS = localizeSrc(fs.readFileSync(path.join(__dirname, 'reader.js'), 'utf8'));   // ilk kullanimda okunur
  wc.executeJavaScriptInIsolatedWorld(1012, [{ code: READER_JS }], true).then((r) => {
    if (r === 'bulunamadi') dialog.showMessageBox(win, { message: 'Bu sayfada okuma modunda gösterilecek bir yazı bulunamadı.' });
  }).catch(() => {});
}

async function saveAs(wc) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), (wc.getTitle() || 'sayfa').replace(/[\\/:*?"<>|]/g, '_') + '.html') });
  if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch(() => {});
}

// ---------------------------------------------------------------- Pencere
// ---------------------------------------------------------------- Temalar
// mode: sistem/acik/koyu tabani. Renkli temalar arac cubugu, sekme seridi ve yeni sekme sayfasini boyar.
const THEMES = {
  sistem:  { name: 'Sistem', mode: 'system' },
  acik:    { name: 'Açık', mode: 'light' },
  koyu:    { name: 'Koyu', mode: 'dark' },
  mavi:    { name: 'Mavi', mode: 'light', frame: '#c4d7f5', toolbar: '#eef3fc', omni: '#ffffff', accent: '#0b57d0', page: '#f4f8fe' },
  yesil:   { name: 'Yeşil', mode: 'light', frame: '#c3e3cc', toolbar: '#eef8f1', omni: '#ffffff', accent: '#146c2e', page: '#f3faf5' },
  mor:     { name: 'Mor', mode: 'light', frame: '#ddd0f4', toolbar: '#f6f1fd', omni: '#ffffff', accent: '#6f43c0', page: '#faf7fe' },
  turuncu: { name: 'Turuncu', mode: 'light', frame: '#f6d6bd', toolbar: '#fdf3ea', omni: '#ffffff', accent: '#b3541e', page: '#fef8f3' },
  pembe:   { name: 'Pembe', mode: 'light', frame: '#f3cfdd', toolbar: '#fdf1f6', omni: '#ffffff', accent: '#b0306a', page: '#fef7fa' },
  gece:    { name: 'Gece mavisi', mode: 'dark', frame: '#121a28', toolbar: '#212d44', omni: '#121a28', accent: '#a8c7fa', page: '#161f30' },
  orman:   { name: 'Orman', mode: 'dark', frame: '#111d17', toolbar: '#1e3027', omni: '#111d17', accent: '#8fd4a8', page: '#14221b' },
  murdum:  { name: 'Mürdüm', mode: 'dark', frame: '#1d1424', toolbar: '#30223b', omni: '#1d1424', accent: '#d7b8f3', page: '#21172a' }
};
const currentTheme = () => THEMES[settings.theme] || THEMES.sistem;
// Tam siyah (pitch black): koyu tema ya da sistem koyu iken, renkli temalar haric
const PITCH = { frame: '#000000', toolbar: '#000000', omni: '#161616', accent: '#a8c7fa', page: '#000000', menu: '#121212', mode: 'dark' };
function effectiveTheme() {
  const t = currentTheme();
  const dark = t.mode === 'dark' || (t.mode === 'system' && nativeTheme.shouldUseDarkColors);
  return settings.pitchBlack && dark && !t.frame ? PITCH : t;
}

function themeColors() {
  const t = effectiveTheme();
  const dark = nativeTheme.shouldUseDarkColors;
  // toolbar: dikey sekmelerde pencere dugmeleri arac cubugunun ustunde durur, rengi ona uymali (ui.html --toolbar ile ayni)
  return { frame: t.frame || (dark ? '#1f1f1f' : '#dfe3e7'), toolbar: t.toolbar || (dark ? '#3c3c3c' : '#ffffff'), symbol: dark ? '#e3e3e3' : '#1f1f1f', dark };
}

function applyTheme() {
  const t = currentTheme();
  nativeTheme.themeSource = t.mode;              // sayfalarin acik/koyu tercihi de buna uyar
  forEachWin(() => { paintFrame(); pushState(); });
  broadcastPages();
}
// Pencere cercevesi ve Windows dugmelerinin rengi
function paintFrame() {
  if (!win) return;
  const c = W && W.incognito ? { frame: INCOGNITO_THEME.frame, toolbar: INCOGNITO_THEME.toolbar, symbol: '#e3e3e3' } : themeColors();
  try { win.setBackgroundColor(c.frame); } catch {}
  if (!isMac && win.setTitleBarOverlay) { try { win.setTitleBarOverlay({ color: settings.verticalTabs ? c.toolbar : c.frame, symbolColor: c.symbol, height: settings.verticalTabs ? TOOLBAR : TAB_STRIP }); } catch {} }
}

// Gizli pencere her zaman koyu (Chrome gibi)
const INCOGNITO_THEME = { frame: '#202124', toolbar: '#35363a', omni: '#202124', accent: '#8ab4f8', page: '#202124', mode: 'dark' };
function themeVars() {
  const t = effectiveTheme();
  return t.frame ? { frame: t.frame, toolbar: t.toolbar, omni: t.omni, accent: t.accent, page: t.page, mode: t.mode, ...(t.menu ? { menu: t.menu } : {}) } : null;
}

// ---------------------------------------------------------------- Yerel sayfalar (yeni sekme + karsilama)
const pageData = () => ({
  incognito: !!(W && W.incognito),
  newtabTitle: settings.newtabTitle,
  shortcuts: settings.shortcuts.map((s) => ({ title: s.title, url: s.url, icon: s.icon || null })),
  searchUrl: searchUrl(),
  searchName: (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name,
  theme: W && W.incognito ? INCOGNITO_THEME : themeVars(),
  themeKey: settings.theme,
  themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, mode: t.mode, frame: t.frame || null, toolbar: t.toolbar || null, accent: t.accent || null }))
});

function broadcastPages() {
  for (const t of allTabs()) {
    if (!t.view || !isInternal(t.url)) continue;
    inWin(t.w, () => { try { t.view.webContents.send('page-update', pageData()); } catch {} });
  }
}

// Gecmis/indirilenler sayfasi acik ise degisikligi haber ver (seyrek)
const notifyTimers = {};
function notifyPages(kind) {
  if (notifyTimers[kind]) return;
  notifyTimers[kind] = setTimeout(() => {
    notifyTimers[kind] = null;
    for (const t of allTabs()) {
      if (!t.view || pageKind(t.url) !== kind) continue;
      inWin(t.w, () => { try { t.view.webContents.send('page-update', { ...pageData(), changed: kind }); } catch {} });
    }
  }, kind === 'downloads' ? 300 : kind === 'extensions' ? 100 : 800);
}

function historyList(arg) {
  const q = String((arg && arg.q) || '').toLocaleLowerCase('tr').split(/\s+/).filter(Boolean);
  const before = (arg && arg.before) || Infinity;
  const limit = Math.min(Math.max((arg && arg.limit) || 150, 1), 1000);
  const items = [];
  let more = false;
  for (const h of history) {
    if (h.t >= before) continue;
    if (q.length) {
      const hay = ((h.title || '') + ' ' + h.url).toLocaleLowerCase('tr');
      if (!q.every((w) => hay.includes(w))) continue;
    }
    if (items.length >= limit) { more = true; break; }
    items.push({ t: h.t, url: h.url, title: h.title || '', favicon: h.favicon || null });
  }
  return { items, more, total: history.length };
}

const fileIcons = new Map();
async function fileIcon(file) {
  const ext = path.extname(file).toLowerCase();
  const key = ['.exe', '.lnk', '.ico'].includes(ext) ? file : ext || '?';
  if (fileIcons.has(key)) return fileIcons.get(key);
  let url = null;
  try { url = (await app.getFileIcon(file, { size: 'normal' })).toDataURL(); } catch {}
  if (fileIcons.size > 200) fileIcons.clear();
  fileIcons.set(key, url);
  return url;
}

async function downloadsList() {
  return Promise.all(downloads.map(async (d) => {
    let exists = true;
    if (d.state === 'completed') exists = await fsp.access(d.file).then(() => true, () => false);
    return {
      id: d.id, name: d.name, url: d.url || '', t: d.t || 0, received: d.received || 0, total: d.total || 0,
      state: d.state, paused: !!d.paused, canResume: !!(d.item && d.item.canResume()), exists,
      icon: d.state === 'completed' && exists ? await fileIcon(d.file) : null
    };
  }));
}

function downloadAction(cmd, id) {
  const d = downloads.find((x) => x.id === id);
  switch (cmd) {
    case 'dl-open': if (d) shell.openPath(d.file); break;
    case 'dl-show': if (d) shell.showItemInFolder(d.file); break;
    case 'dl-cancel': if (d && d.item) d.item.cancel(); break;
    case 'dl-pause': if (d && d.item) d.item.pause(); break;
    case 'dl-resume': if (d && d.item && d.item.canResume()) d.item.resume(); break;
    case 'dl-retry': if (d && d.url && ses) { downloads.splice(downloads.indexOf(d), 1); ses.downloadURL(d.url); } break;
    case 'dl-copy': if (d && d.url) clipboard.writeText(d.url); break;
    case 'dl-remove': if (d && d.state !== 'progressing') downloads.splice(downloads.indexOf(d), 1); break;
    case 'dl-clear': for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1); break;
    case 'dl-folder': shell.openPath(app.getPath('downloads')); break;
  }
  saveDownloads(); pushState(); notifyPages('downloads');
  return { ok: true };
}

const MAX_SHORTCUTS = 12;
function normalizeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  const full = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try { const x = new URL(full); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : null; } catch { return null; }
}

function settingsData() {
  return {
    theme: settings.theme, themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, mode: t.mode, frame: t.frame || null, accent: t.accent || null })),
    engine: settings.searchEngine, engines: Object.entries(SEARCH_ENGINES).map(([key, x]) => ({ key, name: x.name })),
    bookmarksBar: settings.bookmarksBar, fullUrl: settings.fullUrl, forceDarkPages: settings.forceDarkPages, strictIsolation: settings.strictIsolation, language: settings.language || 'auto',
    clearGoogleOnExit: settings.clearGoogleOnExit, restoreSession: settings.restoreSession,
    keepLogins: settings.keepLogins, newtabTitle: settings.newtabTitle,
    sleepMinutes: settings.sleepMinutes, sleepChoices: SLEEP_CHOICES, downloadNotify: settings.downloadNotify,
    downloadsDir: app.getPath('downloads'),
    extSupport: !!extensions, webStore: !!CWS, extCount: listExtensions().length,
    hoverZoom: settings.hoverZoom, tabAudio: settings.tabAudio, sleepTabs: settings.sleepTabs,
    verticalTabs: settings.verticalTabs, verticalAutoHide: settings.verticalAutoHide, sideEdge: settings.sideEdge || 2,
    pitchBlack: settings.pitchBlack, darkActive: effectiveTheme().mode === 'dark' || (effectiveTheme().mode === 'system' && nativeTheme.shouldUseDarkColors),
    ubo: uboId ? (extApi().getExtension(uboId) || {}).version || '' : null,
    adblockEngine: settings.adblockEngine, uboAvailable: fs.existsSync(path.join(UBO_DIR, 'manifest.json')),
    sitePerms: Object.keys(settings.sitePerms).length, deviceGrants: settings.deviceGrants.length,
    version: app.getVersion(), chrome: process.versions.chrome, electron: process.versions.electron,
    widevine: (() => { try { const st = components && components.status(); const w = st && Object.values(st).find((x) => /widevine/i.test(x.title || '')); return w ? w.version : null; } catch { return null; } })()
  };
}
function setNewtabTitle(v) {
  settings.newtabTitle = String(v == null ? 'Mondium' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
  saveSettings();
  broadcastPages();
}
// Dil degisince arayuz ve Mondium sayfalari yeniden yuklenir (ceviri sayfa acilirken uygulanir)
function setLanguage(v) {
  if (settings.language === v) return;
  settings.language = v; uiLangCache = null; saveSettings(true);
  setTimeout(() => {
    forEachWin((w) => { if (ui && !ui.webContents.isDestroyed()) ui.webContents.reload(); });
    for (const t of allTabs()) if (t.view && isInternal(t.url) && !t.view.webContents.isDestroyed()) t.view.webContents.reload();
  }, 150);
}
function settingsSet(key, value) {
  const bool = (k) => { if (typeof value !== 'boolean') return false; setSetting(k, value, k === 'forceDarkPages' || k === 'strictIsolation'); return true; };
  switch (key) {
    case 'theme': if (!THEMES[value]) return false; settings.theme = value; saveSettings(); applyTheme(); return true;
    case 'engine': case 'searchEngine': if (!SEARCH_ENGINES[value]) return false; setSetting('searchEngine', value); broadcastPages(); return true;
    case 'bookmarksBar': if (typeof value !== 'boolean') return false; if (value !== settings.bookmarksBar) toggleBookmarksBar(); return true;
    case 'sleepMinutes': if (!SLEEP_CHOICES.includes(value)) return false; setSetting('sleepMinutes', value); return true;
    case 'newtabTitle': if (typeof value !== 'string') return false; setNewtabTitle(value); return true;
    case 'hoverZoom': if (typeof value !== 'boolean') return false; setFeature(key, value); return true;
    case 'sleepTabs': return bool(key);
    case 'tabAudio':
      if (typeof value !== 'boolean') return false;
      settings.tabAudio = value; saveSettings();
      // Kapatilinca sessize alinmis sekmeler de normale doner (sessize alma tamamen devre disi)
      if (!value) for (const t of allTabs()) { if (t.muted) { t.muted = false; if (t.view) t.view.webContents.setAudioMuted(false); } }
      forEachWin(() => pushState());
      return true;
    case 'verticalTabs': if (typeof value !== 'boolean') return false; setVerticalTabs(value); return true;
    case 'language': if (!['auto', 'tr', 'en'].includes(value)) return false; setLanguage(value); return true;
    case 'pitchBlack': if (typeof value !== 'boolean') return false; settings.pitchBlack = value; saveSettings(); applyTheme(); return true;
    case 'sideEdge': {
      const v = Math.round(Number(value));
      if (!Number.isFinite(v) || v < 1 || v > 60) return false;
      settings.sideEdge = v; saveSettings();
      for (const t of allTabs()) if (t.view) { try { t.view.webContents.send('mondium-edge-px', v); } catch {} }
      forEachWin(() => pushState());
      return true;
    }
    case 'verticalAutoHide': if (typeof value !== 'boolean') return false; if (value !== !!settings.verticalAutoHide) { if (settings.verticalTabs) toggleAutoHide(); else { settings.verticalAutoHide = value; saveSettings(); } } return true;
    case 'adblockEngine': if (!['ubo', 'hafif'].includes(value)) return false; if (value !== settings.adblockEngine) setSetting('adblockEngine', value, true); return true;
    case 'fullUrl': case 'forceDarkPages': case 'strictIsolation': case 'clearGoogleOnExit': case 'restoreSession': case 'downloadNotify': case 'keepLogins': return bool(key);
  }
  return false;
}

ipcMain.handle('page', async (e, cmd, arg) => {
  const ow = winOfWc(e.sender);
  if (ow) useWin(ow);
  const from = (e.senderFrame && e.senderFrame.url) || '';
  const kind = pageKind(from);
  if (!kind) throw new Error('izin yok');
  if (cmd === 'get') return pageData();
  if (kind === 'settings') {
    switch (cmd) {
      case 'settings-get': return settingsData();
      case 'settings-set': { const ok = settingsSet(arg && arg.key, arg && arg.value); notifyPages('settings'); return { ok }; }
      case 'clear-data': clearData(); return { ok: true };
      case 'ps-list': return { sites: siteData.list() };
      case 'ps-add': return siteData.add(String(arg || '').slice(0, 300));
      case 'ps-remove': return siteData.remove(String(arg || ''));
      case 'ps-deps': return { deps: siteData.depsFor(String(arg || '')) };
      case 'sd-inventory': try { return await siteData.inventory(); } catch (err) { return { error: String(err.message || err).slice(0, 200) }; }
      case 'sd-protect': return siteData.setSite(String((arg && arg.site) || ''), !!(arg && arg.on));
      case 'sd-delete-site': { const site = String(arg || ''); if (!siteData.siteOfHost(site)) return { error: 'Geçersiz site' }; const r = await siteData.clear({ cookies: true, siteData: true, protect: false, range: 'all', onlySite: site }); notifyPages('settings'); return r; }
      case 'clear-prefs': return { prefs: settings.clearPrefs, protectedCount: (settings.protectedSites || []).length };
      case 'clear-run': return runClear(arg || {});
      case 'clear-status': return siteData.status();
      case 'bm-sources': return { sources: bookmarkImport.listSources(), groups: bookmarkGroups(), total: settings.bookmarks.length };
      case 'bm-import': {
        const src = bookmarkImport.listSources().find((x) => x.id === String(arg || ''));
        if (!src) return { error: 'Kaynak bulunamadı.' };
        const items = bookmarkImport.readSourceById(src.id);
        if (!items) return { error: `${src.browser} yer işaretleri okunamadı.` };
        if (!items.length) return { error: `${src.browser} profilinde yer işareti yok.` };
        return addImported(items, src.browser);
      }
      case 'bm-import-html': return importBookmarksHtml();
      case 'bm-group-remove': return removeBookmarkGroup(String(arg || ''));
      case 'site-perms': settings.sitePerms = {}; saveSettings(true); notifyPages('settings'); return { ok: true };
      case 'device-grants': showDeviceGrants(); return { ok: true };
      case 'update-filters': forceUpdateFilters(); return { ok: true };
      case 'ubo-dashboard': if (uboId) newTab(uboPage('dashboard.html')); return { ok: true };
      case 'open-downloads-folder': shell.openPath(app.getPath('downloads')); return { ok: true };
      case 'web-store': openUrl('https://chromewebstore.google.com/category/extensions', 'tab'); return { ok: true };
      case 'ext-load': await loadUnpackedDialog(); notifyPages('settings'); return { ok: true };
      case 'ext-remove': await removeExtension(String(arg)); notifyPages('settings'); return { ok: true };
      case 'open-page': openPage(arg === 'downloads' ? DOWNLOADS_URL : arg === 'extensions' ? EXTENSIONS_URL : HISTORY_URL); return { ok: true };
      case 'task-manager': showTaskManager(); return { ok: true };
    }
    return null;
  }
  if (kind === 'extensions') {
    const id = String((arg && arg.id) || arg || '');
    switch (cmd) {
      case 'ext-list': return { extSupport: !!extensions, webStore: !!CWS, devMode: !!settings.extDevMode, list: listExtensions() };
      case 'ext-enable': await setExtensionEnabled(id, !!(arg && arg.on)); return { ok: true };
      case 'ext-hide': setExtensionHidden(id, !!(arg && arg.hidden)); return { ok: true };
      case 'ext-remove': await removeExtension(id); return { ok: true };
      case 'ext-options': { const x = listExtensions().find((e) => e.id === id && e.enabled); if (x && x.optionsUrl) newTab(x.optionsUrl); return { ok: true }; }
      case 'ext-load': await loadUnpackedDialog(); return { ok: true };
      case 'ext-devmode': settings.extDevMode = !!arg; saveSettings(); notifyPages('extensions'); return { ok: true };
      case 'web-store': openUrl('https://chromewebstore.google.com/category/extensions', 'tab'); return { ok: true };
      case 'open-page': openPage(arg === 'settings' ? SETTINGS_URL : HISTORY_URL); return { ok: true };
    }
    return null;
  }
  if (kind === 'history' || kind === 'downloads') {
    if (cmd === 'clear-data') { clearData(); return { ok: true }; }
    if (cmd === 'copy') { clipboard.writeText(String(arg || '').slice(0, 4096)); return { ok: true }; }
    if (cmd === 'open-page') { openPage(arg === 'downloads' ? DOWNLOADS_URL : arg === 'settings' ? SETTINGS_URL : HISTORY_URL); return { ok: true }; }
  }
  if (kind === 'history') {
    switch (cmd) {
      case 'history-list': return historyList(arg);
      case 'history-remove': {
        const del = new Set(Array.isArray(arg) ? arg : []);
        history = history.filter((h) => !del.has(h.t));
        for (const t of tabs) if (t.hist && del.has(t.hist.t)) t.hist = null;
        saveHistory(); notifyPages('history');
        return { ok: true };
      }
      case 'history-clear':
        history = []; for (const t of tabs) t.hist = null;
        saveHistory(true); notifyPages('history');
        return { ok: true };
    }
    return null;
  }
  if (kind === 'downloads') {
    if (cmd === 'downloads-list') return downloadsList();
    if (/^dl-/.test(cmd)) return downloadAction(cmd, arg);
    return null;
  }
  switch (cmd) {
    case 'get': return pageData();
    case 'add': case 'edit': {
      const url = normalizeUrl(arg && arg.url);
      if (!url) return { error: 'Geçerli bir adres girin (ör. youtube.com)' };
      const title = String((arg && arg.title) || '').trim().slice(0, 40) || hostOf(url).replace(/^www\./, '');
      let item;
      if (cmd === 'edit' && settings.shortcuts[arg.i]) {
        item = settings.shortcuts[arg.i];
        const changed = item.url !== url;
        item.title = title; item.url = url;
        if (changed) item.icon = null;
      } else {
        if (settings.shortcuts.length >= MAX_SHORTCUTS) return { error: `En fazla ${MAX_SHORTCUTS} kısayol eklenebilir` };
        item = { title, url, icon: null };
        settings.shortcuts.push(item);
      }
      saveSettings();
      broadcastPages();
      if (!item.icon) fetchSiteIcon(url).then((icon) => {
        if (icon && settings.shortcuts.includes(item) && item.url === url) { item.icon = icon; saveSettings(); broadcastPages(); }
      });
      return { ok: true };
    }
    case 'remove': if (settings.shortcuts[arg]) { settings.shortcuts.splice(arg, 1); saveSettings(); broadcastPages(); } return { ok: true };
    case 'move': {
      const { from: a, to: b } = arg || {};
      if (settings.shortcuts[a] && b >= 0 && b < settings.shortcuts.length) {
        settings.shortcuts.splice(b, 0, settings.shortcuts.splice(a, 1)[0]); saveSettings(); broadcastPages();
      }
      return { ok: true };
    }
    case 'theme': if (THEMES[arg]) { settings.theme = arg; saveSettings(); applyTheme(); } return { ok: true };
    case 'newtab-title': setNewtabTitle(arg); return { ok: true };
    case 'welcome-done': {
      settings.firstRunDone = true;
      saveSettings(true);
      const t = tabs.find((x) => x.view && x.view.webContents === e.sender);
      if (t) { t.url = newtabUrl(); t.title = 'Yeni Sekme'; go(t.view.webContents, t.url); const w = W; setTimeout(() => inWin(w, () => focusUrl()), 300); }
      return { ok: true };
    }
  }
  return null;
});

// Sitenin kendi logosunu ceker (Google/DuckDuckGo gibi ucuncu taraf servis kullanmadan).
// Bulamazsa null doner; yeni sekme sayfasi bas harfi gosterir.
async function fetchSiteIcon(pageUrl) {
  const fetchT = async (u, ms = 7000) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try { return await net.fetch(u, { signal: ac.signal, headers: { 'User-Agent': app.userAgentFallback } }); }
    finally { clearTimeout(timer); }
  };
  let base;
  try { base = new URL(pageUrl); } catch { return null; }
  const cands = [];
  try {
    const r = await fetchT(base.href);
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
      base = new URL(r.url || base.href);
      const html = (await r.text()).slice(0, 400000);
      for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0];
        const rel = ((tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || tag.match(/\brel\s*=\s*([^\s>]+)/i) || [])[1] || '').toLowerCase();
        if (!rel.includes('icon') || rel.includes('mask-icon')) continue;
        const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
        if (!href) continue;
        const size = Number((tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1] || 0);
        // 64-192 px arasi en iyisi; cok buyuk ikonlar gereksiz yer kaplar
        let score = rel.includes('apple-touch') ? 180 : size || (/\.svg(\?|$)/i.test(href) ? 160 : 32);
        if (score > 256) score = 256 - (score - 256) / 10;
        try { cands.push({ href: new URL(href.replace(/&amp;/g, '&'), base).href, score }); } catch {}
      }
    }
  } catch { /* site acilmadi; favicon.ico denenecek */ }
  cands.sort((a, b) => b.score - a.score);
  cands.push({ href: new URL('/favicon.ico', base).href, score: 0 });
  for (const c of cands.slice(0, 4)) {
    try {
      const r = await fetchT(c.href);
      if (!r.ok) continue;
      let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) {
        if (/\.ico(\?|$)/i.test(c.href)) type = 'image/x-icon'; else if (/\.png(\?|$)/i.test(c.href)) type = 'image/png'; else continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 70 || buf.length > 300000) continue;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return null;
}

function createWindow(opts = {}) {
  const incognito = !!opts.incognito;
  const w = {
    id: nextWinId++, incognito, ses: incognito ? getIncognitoSession() : mainSes, win: null, ui: null,
    tabs: [], closedTabs: [], activeId: null, findOpen: false, htmlFullscreen: false, overlayOpen: false, overlayKind: null,
    pushTimer: null, focusedAt: Date.now()
  };
  const from = W;
  windows.push(w);
  useWin(w);
  const c = incognito ? { frame: INCOGNITO_THEME.frame, toolbar: INCOGNITO_THEME.toolbar, symbol: '#e3e3e3' } : themeColors();
  // Yeni pencere oncekinin biraz sag altinda acilir. Test icin MONDIUM_TEST_DISPLAY: o ekranda, odak calmadan.
  let bounds = { width: 1280, height: 820 };
  const testDisplay = process.env.MONDIUM_TEST_DISPLAY;
  if (testDisplay != null) {
    const ds = screen.getAllDisplays();
    const d = ds[Math.min(Number(testDisplay) || 0, ds.length - 1)];
    const wa = d.workArea;
    bounds = { x: wa.x + 30 + (windows.length - 1) * 30, y: wa.y + 30 + (windows.length - 1) * 30, width: Math.min(1280, wa.width - 60), height: Math.min(820, wa.height - 60) };
  } else if (from && from.win) {
    const b = from.win.getBounds();
    bounds = { x: b.x + 30, y: b.y + 30, width: b.width, height: b.height };
  }
  win = w.win = new BaseWindow({
    ...bounds, minWidth: 500, minHeight: 320, show: false,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: c.frame, title: incognito ? 'Mondium (Gizli)' : 'Mondium',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 12, y: 14 } } : { titleBarOverlay: { color: settings.verticalTabs ? c.toolbar : c.frame, symbolColor: c.symbol, height: settings.verticalTabs ? TOOLBAR : TAB_STRIP } })
  });
  if (win.setMenu) win.setMenu(null);

  ui = w.ui = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'ui-preload.js'),
      // sandbox kapali: uzanti simgeleri (<browser-action-list>) icin preload'un modul yuklemesi gerekiyor.
      // Arayuz sadece yerel ui.html'i gosterir, baska adrese gidemez (asagida will-navigate engelli).
      sandbox: false, contextIsolation: true, nodeIntegration: false, spellcheck: false, session: mainSes
    }
  });
  ui.setBackgroundColor('#00000000');   // menu acikken sayfa arkada gorunsun
  ui.webContents.loadFile(path.join(__dirname, 'ui.html'));
  const uw = ui.webContents;
  uw.on('before-input-event', (e, input) => {
    useWin(w);
    const ctrl = isMac ? input.meta : input.control;
    const k = (input.key || '').toLowerCase();
    if (ctrl && !input.shift && ['c', 'v', 'x', 'a', 'z', 'y'].includes(k)) return;
    if (handleShortcut(input)) e.preventDefault();
  });
  uw.on('did-finish-load', () => { useWin(w); pushState(); });
  uw.setWindowOpenHandler(() => ({ action: 'deny' }));
  uw.on('will-navigate', (e) => e.preventDefault());
  win.contentView.addChildView(ui);

  const on = (ev, fn) => win.on(ev, (...a) => { useWin(w); return fn(...a); });
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) on(ev, layout);
  on('leave-full-screen', () => { if (htmlFullscreen) { htmlFullscreen = false; layout(); } });
  on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') goBack();
    if (cmd === 'browser-forward') goForward();
  });
  on('focus', () => { w.focusedAt = Date.now(); });
  on('blur', () => { if (overlayOpen && overlayKind !== 'chooser' && overlayKind !== 'prompt') closeOverlay(); });
  on('swipe', (_e, dir) => { if (dir === 'left') goBack(); if (dir === 'right') goForward(); });
  // Son normal pencere kapanirken oturumu kaydet (sonra pencere listeden cikar)
  on('close', () => { if (!incognito && !quitting && windows.filter((x) => !x.incognito).length === 1) saveSession(true); });
  win.on('closed', () => closedWindow(w));
  if (testDisplay != null) win.showInactive(); else win.show();
  layout();
  return w;
}

// Pencere kapandi: sekmelerin ve arayuzun web iceriklerini kapat (bellek), listeden cikar
function closedWindow(w) {
  if (W === w) saveCtx();
  for (const t of w.tabs) {
    if (!t.view) continue;
    byWcId.delete(t.wcId);
    try { t.view.webContents.close(); } catch {}
    t.view = null;
  }
  try { if (w.ui && !w.ui.webContents.isDestroyed()) w.ui.webContents.close(); } catch {}
  if (chooser && chooser.w === w) { const c = chooser; chooser = null; c.resolve(null); }
  for (const p of prompts.filter((p) => p.w === w)) settlePrompt(p, 'dismiss');
  w.win = null; w.ui = null;
  windows.splice(windows.indexOf(w), 1);
  if (W === w) {
    W = null;
    win = null; ui = null; tabs = []; activeId = null; closedTabs = [];
    const next = lastWin();
    if (next) useWin(next);
  }
  if (w.incognito) endIncognito();
  if (!windows.length) app.quit();
  else saveSession();
}

// Yeni pencere (Ctrl+N) ve yeni gizli pencere (Ctrl+Shift+N): yeni sekme sayfasiyla acilir
function newWindow(incognito) {
  createWindow({ incognito });
  newTab('');
}

// Uzanti arka plan sayfalari: electron-chrome-extensions dinlenen her olay icin bir 'destroyed' dinleyicisi ekliyor
// (uBO ~15 olay). Sayisi sinirli ve sayfa kapaninca kalkiyor; sizinti degil, sadece Node uyarisi susturuluyor.
app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'backgroundPage') wc.setMaxListeners(40); });
app.on('second-instance', (_e, argv) => {
  useWin(lastWin(true) || lastWin());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = urlFromArgs(argv.slice(1));
  if (url) newTab(url);
});
// Windows'tan gelen adres ya da dosya (varsayilan tarayici / "Birlikte ac"): http(s) adresi veya var olan .html/.pdf/.svg/.webp dosyasi
function urlFromArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|pdf|svg|webp)$/i.test(a)) { try { if (fs.statSync(a).isFile()) return pathToFileURL(path.resolve(a)).href; } catch {} }
  }
  return null;
}

app.whenReady().then(async () => {
  // Widevine DRM: ilk acilista indirilir, sonra arka planda guncellenir (baslangici bekletmez)
  if (components && typeof components.whenReady === 'function') {
    const ready = components.whenReady()
      .then(() => console.log('Widevine hazir:', JSON.stringify(components.status())))
      .catch((e) => console.warn('Widevine yuklenemedi:', e && e.message));
    await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);
  } else {
    console.warn('Bu Electron surumunde Widevine yok: DRM\'li videolar (Netflix, Exxen...) oynamaz. "npm install" ile castLabs surumunu kurun.');
  }
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);

  // Thorium: DNS-over-HTTPS (DNS sorgulari sifreli; desteklemeyen agda otomatik normale doner)
  try {
    app.configureHostResolver({
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query']
    });
  } catch (e) { console.warn('DoH ayarlanamadi:', e.message); }

  if (process.platform === 'win32') app.setAppUserModelId('local.mondium.tarayici');   // gorev cubugu ve bildirimlerde "Mondium"
  nativeTheme.themeSource = currentTheme().mode;
  mainSes = ses = session.fromPartition('persist:main');
  setupSession(mainSes);
  if (settings.clearGoogleOnExit) await clearGoogleData();   // onceki oturum cokmus olabilir
  nativeTheme.on('updated', () => { forEachWin(() => { paintFrame(); pushState(); }); broadcastPages(); });
  createWindow();
  startBlocking();
  setupExtensions();
  const startUrl = urlFromArgs(process.argv.slice(1));
  const restored = settings.firstRunDone && restoreSession();
  useWin(windows[0]);
  if (startUrl) newTab(startUrl);
  else if (!restored) newTab(settings.firstRunDone ? '' : WELCOME_URL);
  setInterval(sleepIdleTabs, 60e3);
  setInterval(keepSessionCookies, 15 * 60e3);
});

// Kapanista: ayarlari yaz, Google verilerini sil
let cleanedUp = false;
app.on('before-quit', (e) => {
  if (cleanedUp) return;
  e.preventDefault();
  cleanedUp = true;
  saveSession(true);
  quitting = true;
  saveSettings(true);
  saveHistory(true);
  saveDownloads(true);
  saveSession(true);
  const job = (async () => {
    await keepSessionCookies();
    if (settings.clearGoogleOnExit) await clearGoogleData();
  })();
  Promise.race([job, new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
