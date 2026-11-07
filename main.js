'use strict';
/*
 * Mondium - lightweight, privacy-focused browser (Electron / Chromium engine)
 *  - NO required Google account / sync / sign-in
 *  - Telemetry, crash reports, Safe Browsing, translation, spellcheck downloads are OFF
 *  - Always-on ad/tracker blocker (uBlock Origin filter lists)
 *  - Google is the default search; Google cookies/data are cleared on exit
 *  - WebHID / WebUSB / Web Serial / Web Bluetooth: for browser-based device firmware sites
 *  - From Thorium: DoH, DNT+GPC, parallel downloads, HEVC, bookmarks bar, home button,
 *    reload menu (normal / hard / clear cache), full URL display, force dark pages
 */
const {
  app, nativeImage, BrowserWindow, BaseWindow, WebContentsView, session, ipcMain, Menu, clipboard,
  dialog, shell, nativeTheme, net, Notification, webFrameMain, webContents, screen
} = require('electron');
// castLabs Electron (Widevine DRM). Not in stock Electron; in that case we run without DRM.
const { components } = require('electron');
const I18N = require('./i18n');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
// The light engine (Ghostery adblocker) is loaded only when it is actually used (light engine selected, uBO failed,
// or an incognito window): with uBO as the default this saves ~6.6 MB RAM and ~60 ms at startup.
let ElectronBlockerLib = null;
const ElectronBlockerLazy = () => ElectronBlockerLib || (ElectronBlockerLib = require('@ghostery/adblocker-electron').ElectronBlocker);
const { createThreatProtection } = require('./threat-protection');
const { readResponseBytes, assertImageLimits } = require('./bounded-fetch');
const { createSiteData } = require('./site-data');
const bookmarkImport = require('./bookmark-import');

// Separate profile folder for tests: does not touch the user's running Mondium or data (single-instance lock is per folder too)
if (process.env.MONDIUM_PROFILE) app.setPath('userData', process.env.MONDIUM_PROFILE);

// Extension support (Chrome Web Store + chrome.* APIs). If it fails to load, the browser keeps working without extensions.
let ECE = null, CWS = null, extensions = null;
try { ({ ElectronChromeExtensions: ECE } = require('electron-chrome-extensions')); } catch (e) { console.warn('Extension library missing:', e.message); }
try { CWS = require('./vendor/secure-web-store'); } catch (e) { console.warn('Web Store library missing:', e.message); }

const isMac = process.platform === 'darwin';

(function migrateOldProfile() {
  const dst = app.getPath('userData');
  const src = path.join(path.dirname(dst), 'Chromium');
  if (fs.existsSync(path.join(dst, 'ayarlar.json')) || !fs.existsSync(path.join(src, 'ayarlar.json'))) return;
  const SKIP = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|GPUPersistentCache|GrShaderCache|ShaderCache|blob_storage|Crashpad|DevToolsActivePort|Singleton.*|lockfile|filtre-motoru\.bin)$/i;
  try {
    fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false, filter: (p) => !SKIP.test(path.basename(p)) });
    console.log('Old Chromium profile migrated to the Mondium folder.');
  } catch (e) { console.warn('Could not migrate old profile:', e.message); }
})();

// The ad blocker library leaves an unhandled rejection when it cannot run a script in a closed frame.
// Harmless; silenced so it doesn't flood the terminal, other errors still show.
process.on('unhandledRejection', (e) => {
  if (e && /Script failed to execute/.test(e.message || '')) return;
  console.error('Unhandled rejection:', e);
});

// ---------------------------------------------------------------- Persistent settings
const SETTINGS_FILE = path.join(app.getPath('userData'), 'ayarlar.json');
const DEFAULTS = {
  searchEngine: 'google',
  bookmarksBar: true,        // Thorium: on by default
  fullUrl: true,             // Thorium: show full URL
  forceDarkPages: false,
  strictIsolation: true,     // true = every site in its own process like Chrome (more RAM, safer); false = only login/payment/protected sites isolated
  askDownloadLocation: false, // ask where to save every download (native, non-blocking dialog)
  newTabPrompt: false,       // Ctrl+T opens a search/address box first instead of the new tab page
  overlayScrollbar: true,    // thin overlay scrollbar that takes no page width
  clearGoogleOnExit: false,  // when on, Google cookies/site data are cleared on exit (signs out of Google)
  keepLogins: true,          // keep site logins across restarts (session cookies are made persistent)
  newtabClock: 'top',        // new tab clock: 'top' (above the logo), 'tl', 'tr', 'bl', 'br' (corners) or 'off'
  newtabClockSize: 56,       // new tab clock size in px
  newtabClockFont: 'system', // new tab clock font (key of CLOCK_FONTS in newtab.html)
  newtabClockWeight: 300,    // new tab clock font weight
  theme: 'sistem',
  firstRunDone: false,
  shortcuts: [],             // favorites on the new tab page {title, url, icon}
  bookmarks: [],
  sitePerms: {},             // "origin|permission" -> true/false
  deviceGrants: [],          // {type, origin, vendorId, productId, serialNumber}
  unpackedExtensions: [],    // extensions loaded from a folder
  disabledExtensions: [],    // disabled extensions {id, path}: files kept, not loaded (no RAM)
  hiddenExtensions: [],      // extension IDs whose toolbar icon is hidden
  hoverZoom: true,           // built-in image hover zoom (Imagus-like), on by default
  tabAudio: true,            // speaker icon on tabs + click to mute (both gone when off)
  sleepTabs: true,           // put unused background tabs to sleep (after sleepMinutes)
  verticalTabs: false,       // vertical tabs (sidebar on the left)
  verticalWidth: 240,        // vertical sidebar width (px); at its narrowest only icons
  verticalAutoHide: false,
  language: 'auto',         // UI language: 'auto' (system language) | 'tr' | 'en'
  sideEdge: 2,               // TEMPORARY test setting: width (px) of the left edge that opens the sidebar in auto-hide mode
  pitchBlack: false,         // pure black in dark theme
  protectedSites: [],        // Protected Sites: cookies and site data not cleared on cleanup (registrable domain)
  clearPrefs: { range: 'all', history: true, downloads: false, cookies: true, cache: false, protect: true },   // last choice in the clear-data dialog   // auto-hide mode: sidebar hidden, opens at the same width when the mouse hits the left edge (Ctrl+S)
  adblockEngine: 'ubo',      // 'ubo' = built-in uBlock Origin (strongest, ~250 MB more RAM), 'hafif' = Mondium engine
  restoreSession: true,      // previous tabs come back (asleep) on startup
  sleepMinutes: 10,          // background tabs are put to sleep after this many minutes
  downloadNotify: true       // system notification when a download finishes
};
const SLEEP_CHOICES = [5, 10, 30, 60];
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
// Installs from before language support were Turkish-only: keep them Turkish instead of following the system
// language (which may be English even for Turkish users). New installs pick a language on the welcome page.
if (settings.firstRunDone && !settings.languageSet) { if (settings.language === 'auto') settings.language = 'tr'; settings.languageSet = true; }
// Security: existing profiles move once to full site isolation; turning it off afterwards is a deliberate choice in Settings.
if (!settings.isolationSecurityMigration) { settings.strictIsolation = true; settings.isolationSecurityMigration = true; }
let saveTimer = null;
function saveSettings(now = false) {
  clearTimeout(saveTimer);
  const write = () => { try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.warn('Could not save settings:', e.message); } };
  if (now) write(); else saveTimer = setTimeout(write, 300);
}
// Once on old installs: the user wanted site logins to persist; Google clearing is turned off
if (!settings.keepLoginsSet) { settings.clearGoogleOnExit = false; settings.keepLogins = true; settings.keepLoginsSet = true; saveSettings(true); }
// Nov 2026: image zoom is now on by default (turned on once, since old installs have "off" saved in the file)
if (!settings.hoverZoomOnSet) { settings.hoverZoom = true; settings.hoverZoomOnSet = true; saveSettings(true); }
// The old "Never" (0 min) choice is now a separate key
if (!SLEEP_CHOICES.includes(settings.sleepMinutes)) { if (settings.sleepMinutes === 0) settings.sleepTabs = false; settings.sleepMinutes = 10; }
const SIDE_MIN = 56;    // narrowest: tab icons only
const sideWidth = (winWidth) => Math.round(Math.max(SIDE_MIN, Math.min(settings.verticalWidth || 240, Math.max(SIDE_MIN, Math.min(560, (winWidth || 1280) * 0.6)))));

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?pws=0&udm=14&q=' }, // pws=0: non-personalized, udm=14: no AI overview
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  yandex: { name: 'Yandex', url: 'https://yandex.com.tr/search/?text=' }
};
const searchUrl = () => (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).url;

// ---------------------------------------------------------------- Filter lists
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
    'https://filters.adtidy.org/extension/ublock/filters/13.txt', // AdGuard Turkish
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
const SECURITY_URL = pathToFileURL(path.join(__dirname, 'securitywarning.html')).href;
const TASKS_URL = pathToFileURL(path.join(__dirname, 'taskmanager.html')).href;
const EXTENSIONS_URL = pathToFileURL(path.join(__dirname, 'extensions.html')).href;
const baseOf = (u) => (typeof u === 'string' ? u.split('#')[0].split('?')[0] : '');
// Short names shown in and typeable into the address bar
const PAGE_ALIASES = {
  'mondium://tasks': TASKS_URL, 'mondium://task-manager': TASKS_URL,
  'mondium://history': HISTORY_URL, 'mondium://gecmis': HISTORY_URL,
  'mondium://downloads': DOWNLOADS_URL, 'mondium://indirilenler': DOWNLOADS_URL,
  'mondium://settings': SETTINGS_URL, 'mondium://ayarlar': SETTINGS_URL,
  'mondium://extensions': EXTENSIONS_URL, 'mondium://uzantilar': EXTENSIONS_URL
};
function pageKind(u) {
  const b = baseOf(u);
  if (b === SECURITY_URL) return 'security';
  if (b === TASKS_URL) return 'tasks';
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
  if (k === 'security') return 'mondium://security';
  if (k === 'tasks') return 'mondium://tasks';
  if (k === 'history') return 'mondium://history';
  if (k === 'downloads') return 'mondium://downloads';
  if (k === 'settings') return 'mondium://settings';
  if (k === 'extensions') return 'mondium://extensions';
  return k ? '' : (u || '');
}

// ---------------------------------------------------------------- History and download list (this computer only)
const HISTORY_FILE = path.join(app.getPath('userData'), 'gecmis.json');
const DOWNLOADS_FILE = path.join(app.getPath('userData'), 'indirilenler.json');
const HISTORY_MAX = 5000, HISTORY_DAYS = 90, DOWNLOADS_MAX = 100;
function readJsonArray(f) { try { const a = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } }
let history = readJsonArray(HISTORY_FILE).filter((h) => h && typeof h.url === 'string' && h.t > Date.now() - HISTORY_DAYS * 864e5);
const listTimers = {};
function writeList(f, data, now) {
  clearTimeout(listTimers[f]);
  const json = () => JSON.stringify(data());
  if (now) { try { fs.writeFileSync(f, json()); } catch (e) { console.warn('Could not write:', f, e.message); } return; }
  listTimers[f] = setTimeout(() => { fsp.writeFile(f, json()).catch((e) => console.warn('Could not write:', f, e.message)); }, 2000);
}
const saveHistory = (now = false) => writeList(HISTORY_FILE, () => history, now);
const saveDownloads = (now = false) => writeList(DOWNLOADS_FILE, () => downloads.filter((d) => !d.incognito).map(({ item, ...d }) => d), now);
// Session: URLs of open tabs. Local pages are stored by short name (mondium://...) so they open even if the folder moves.
const SESSION_FILE = path.join(app.getPath('userData'), 'oturum.json');
// Incognito windows are not saved. When the last normal window closes (or on quit) the last snapshot is kept.
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
      if (k === 'newtab' || k === 'welcome' || k === 'security' || !t.url) continue;
      if (t.id === w.activeId) active = list.length;
      list.push({ url: k ? displayUrl(t.url) : t.url, title: t.title || '', favicon: t.favicon || null, iconColor: t.iconColor || null, pinned: !!t.pinned, muted: !!t.muted });
    }
    return { active, tabs: list };
  }).filter((x) => x.tabs.length) };
  return lastSessionData;
}
const saveSession = (now = false) => writeList(SESSION_FILE, sessionData, now);

// ------------------------------------------- UI language (i18n.js). Turkish source; English comes from the dictionary.
// 'auto': Turkish if the system language is Turkish, otherwise English. Chromium's own language (Accept-Language sent
// to sites, built-in PDF viewer) is set at startup from the chosen language; UI changes apply immediately.
let uiLangCache = null;
function uiLang() {
  if (uiLangCache) return uiLangCache;
  if (settings.language === 'tr' || settings.language === 'en') return (uiLangCache = settings.language);
  let sys = '';
  try { sys = (app.getPreferredSystemLanguages && app.getPreferredSystemLanguages()[0]) || app.getSystemLocale() || app.getLocale() || ''; } catch {}
  return (uiLangCache = /^tr/i.test(sys) ? 'tr' : 'en');
}
const T = (text) => I18N.translate(text, uiLang());
// UI text in scripts injected into pages (reader mode, image zoom): single-quoted strings are translated
const localizeSrc = (src) => (uiLang() === 'tr' ? src : src.replace(/'([^'\\\n]*)'/g, (m, x) => { const t = T(x); return t === x ? m : JSON.stringify(t); }));
ipcMain.on('mondium-lang', (e) => { e.returnValue = uiLang(); });
if (settings.language === 'en') app.commandLine.appendSwitch('lang', 'en-US');
else if (settings.language === 'tr') app.commandLine.appendSwitch('lang', 'tr');
// Native menus, dialogs and notifications in the chosen language
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

// ------------------------------------------- Privacy + performance command-line switches
const cl = app.commandLine;
[
  // Note: 'disable-background-networking' and 'disable-component-update' are NOT used:
  // both block downloading/updating the Widevine DRM module (Netflix, Exxen, BluTV, Spotify...).
  // Electron has no background services like Safe Browsing, translation or sync anyway.
  'disable-domain-reliability',
  'disable-breakpad', 'disable-default-apps',
  'disable-sync', 'no-pings', 'no-default-browser-check', 'no-first-run',
  'process-per-site'
].forEach((s) => cl.appendSwitch(s));
cl.appendSwitch('enable-features', [
  'ParallelDownloading',            // Thorium: parallel downloads
  'PlatformHEVCDecoderSupport',     // Thorium: HEVC/H.265 (if hardware supports it)
  ...(settings.forceDarkPages ? ['WebContentsForceDark'] : [])
].join(','));
cl.appendSwitch('disable-features', [
  'BackForwardCache', 'SpareRendererForSitePerProcess', 'Translate', 'TranslateUI', 'MediaRouter',
  'OptimizationHints', 'AutofillServerCommunication',
  'BrowsingTopics', 'Fledge', 'InterestGroupStorage', 'PrivacySandboxAdsAPIs',
  'AttributionReportingCrossAppWeb', 'DialMediaRouteProvider',
  'WebAuthenticationConditionalUI', 'WebAuthenticationPasskeysUI'   // passkey popups
].join(','));
// RAM: full site isolation puts every third-party iframe in its own process (measured: 6 sites, 21 processes, 4.6 GB
// working set; off: 8 processes, 2.8 GB). Partial isolation like Android Chrome: general sites share processes, login,
// payment and protected sites (where you sign in) still get their own. Settings > Privacy > full isolation.
// Disable Chromium's automatic page-translation prompts in every session.
cl.appendSwitch('disable-translate');
const ISOLATED_ORIGINS = ['https://accounts.google.com', 'https://login.microsoftonline.com', 'https://login.live.com', 'https://appleid.apple.com',
  'https://github.com', 'https://paypal.com', 'https://facebook.com', 'https://x.com', 'https://discord.com', 'https://web.whatsapp.com'];
if (settings.strictIsolation) cl.appendSwitch('site-per-process');
if (!settings.strictIsolation) {
  cl.appendSwitch('disable-site-isolation-trials');
  const prot = (Array.isArray(settings.protectedSites) ? settings.protectedSites : []).filter((x) => /^[a-z0-9.-]+$/i.test(x) && x.includes('.')).map((x) => 'https://' + x);
  cl.appendSwitch('isolate-origins', [...new Set([...ISOLATED_ORIGINS, ...prot])].join(','));
}
cl.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');

// The browser's unmodified, original identity (with the Electron and app name suffixes).
// Google sign-in ONLY works with this (see below).
const ORIGINAL_UA = app.userAgentFallback;

// For all other sites, make the User-Agent look like regular Chrome
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/i, '')
  .replace(new RegExp('\\s?' + app.getName().replace(/[^\w]/g, '\\$&') + '\\/\\S+', 'i'), '');

if (!app.requestSingleInstanceLock()) { app.quit(); }

// ---------------------------------------------------------------- Google sign-in fix
// Google rejects browsers that look exactly like "plain Chrome" but aren't real Chrome after the email step,
// saying "This browser or app may not be secure". Spoofing Firefox is caught too.
// Measured working approach: on sign-in pages use the browser's own, unmodified identity
// (Chrome version + app name + Electron suffixes). Client hints (Sec-CH-UA) are left alone.
// Source: github.com/stablyai/orca/issues/11518 (Sep 2026, 12/12 measurements)
const LOGIN_UA = ORIGINAL_UA;
const GOOGLE_LOGIN_HOST = /^accounts\.(google|youtube)\.[a-z.]+$/i;
const isGoogleLogin = (u) => { try { return GOOGLE_LOGIN_HOST.test(new URL(u).hostname); } catch { return false; } };
// Google search: disable AI Overviews. udm=14 = web results only.
const GOOGLE_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i;
function noAiUrl(u) {
  try {
    const x = new URL(u);
    if (!GOOGLE_HOST.test(x.hostname) || x.pathname !== '/search') return null;
    if (x.searchParams.has('udm') || x.searchParams.has('tbm')) return null;   // leave images, news etc. tabs alone
    x.searchParams.set('udm', '14');
    return x.href;
  } catch { return null; }
}

// Load a URL with the right identity (User-Agent) before navigating. Chromium does not change the UA
// of a navigation already started, so we set it BEFORE going to the sign-in page and reload from scratch.
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
  // After sign-in, switch back to the normal Chrome identity for later pages
  wc.on('did-start-navigation', (e) => {
    if (!e.isMainFrame || !e.url || e.isSameDocument) return;
    if (!isGoogleLogin(e.url) && wc.getUserAgent() === LOGIN_UA) wc.setUserAgent(app.userAgentFallback);
  });
}

// ---------------------------------------------------------------- State
let win = null, ui = null, ses = null, mainSes = null, blocker = null;
let findOpen = false, htmlFullscreen = false, overlayOpen = false, overlayKind = null;
const TAB_STRIP = 42, TOOLBAR = 46, BOOKMARKS = 32, FINDBAR = 40;
let tabs = [];
const byWcId = new Map();
const downloads = readJsonArray(DOWNLOADS_FILE)
  .filter((d) => d && d.file && d.id)
  .map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted', paused: false } : d));
let activeId = null, nextId = 1;

// ---------------------------------------------------------------- Windows
// Each window has its own tabs, UI, session (a separate in-memory session for incognito) and state.
// The rest of the code works with "current window" variables (win, ui, ses, tabs, activeId...); at the start
// of each event useWin() switches to that event's window. Safe in single-threaded JS as long as there is no await.
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
const downloadPanels = new Map(), taskPanels = new Map();
const winOfWc = (wc) => { const t = wc && !wc.isDestroyed() ? byWcId.get(wc.id) : null; return t ? t.w : [...downloadPanels, ...taskPanels].find(([, p]) => p.webContents === wc)?.[0] || null; };
const allTabs = () => windows.flatMap((w) => w.tabs);
// Run a job in another window, then switch back to the previous one
function inWin(w, fn) {
  const prev = W;
  useWin(w);
  try { return fn(); } finally { if (prev && windows.includes(prev)) useWin(prev); }
}
const forEachWin = (fn) => { for (const w of [...windows]) inWin(w, () => fn(w)); };
const lastWin = (normalOnly) => windows.filter((w) => !normalOnly || !w.incognito).sort((a, b) => b.focusedAt - a.focusedAt)[0] || null;

const uiHeight = () => (htmlFullscreen ? 0
  : TAB_STRIP + TOOLBAR + (settings.bookmarksBar ? BOOKMARKS : 0) + (findOpen ? FINDBAR : 0));

// ---------------------------------------------------------------- Ad blocker
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
    console.warn('List skipped:', url, e.message);
    return new Response('');
  }
};

let blockerReadyResolve;
const blockerReady = new Promise((r) => { blockerReadyResolve = r; });
// v3: all of uBO's default lists (resource-abuse + malicious URLs). When the list set changes, the name changes and the engine is rebuilt.
const engineCache = () => path.join(app.getPath('userData'), 'filtre-motoru-v3.bin');
const oldEngineCache = () => path.join(app.getPath('userData'), 'filtre-motoru-v2.bin');   // used until the new one is built

async function buildBlocker() {
  const b = await ElectronBlockerLazy().fromLists(safeFetch, CONFIG.filterLists, {
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
      cached = ElectronBlockerLazy().deserialize(new Uint8Array(await fsp.readFile(f)));
      stale = f !== engineCache() || Date.now() - st.mtimeMs > CONFIG.filterUpdateDays * 864e5;   // old version: rebuild right away
      break;
    } catch { /* missing: try the other one / first run */ }
  }
  try {
    if (cached) {
      attachBlocker(cached);
      if (stale) buildBlocker().then(attachBlocker).catch((e) => console.warn('Could not update filters:', e.message));
    } else {
      try { attachBlocker(await buildBlocker()); }
      catch (e) { console.warn(e.message); attachBlocker(await ElectronBlockerLazy().fromPrebuiltAdsAndTracking(safeFetch)); }
    }
  } catch (e) {
    console.error('Could not load ad blocker:', e);
  }
  blockerReadyResolve();
  forEachWin(() => pushState());
}

// ---------------------------------------------------------------- Built-in uBlock Origin
// In normal windows the real uBlock Origin does the blocking (vendor/ublock, official chromium package; to update run
// "node tools/ublock-guncelle.js"). Electron supports MV2 extensions and blocking chrome.webRequest; missing APIs are
// wired to electron-chrome-extensions via mv2-bridge.js + vendor/mondium-ece.js. Mondium's own engine (Ghostery)
// is then NEVER loaded in the main session (no double blocker, no RAM); it only loads for the incognito session
// when an incognito window opens. If uBO fails to load, the main session falls back to Mondium's engine as before.
const UBO_DIR = path.join(__dirname, 'vendor', 'ublock').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');   // extensions cannot load from inside asar
let uboId = null;
let eceReadyResolve;
const eceReady = new Promise((r) => { eceReadyResolve = r; });
let mainBlockResolve;
const mainBlockReady = new Promise((r) => { mainBlockResolve = r; });
let ghosteryP = null;
const ensureGhostery = () => ghosteryP || (ghosteryP = loadBlocker());
// Incognito: Electron cannot load extensions into an in-memory session. With uBO as the engine, private requests are
// filtered by the already loaded uBO (no second engine, no extra RAM; network rules only, no cosmetic filters).
// With the light engine, or if uBO is unavailable, the light engine covers the session as before.
let privateBlock = null;
function ensureIncognitoBlock(s) {
  if (privateBlock) return privateBlock;
  privateBlock = (async () => {
    if (settings.adblockEngine !== 'hafif' && !process.env.MONDIUM_NO_UBO) {
      await Promise.race([mainBlockReady, timeout(12000)]);
      if (uboId) {
        const background = () => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.session === mainSes && w.getURL().startsWith(uboPage('background.html')));
        try { await require('./private-ubo').attachPrivateUBlock(s, background, webContents); return true; }
        catch (e) { console.warn('Private uBO filter failed, using the light engine:', e.message); }
      }
    }
    blockSession(s);
    await ensureGhostery();
    return true;
  })();
  return privateBlock;
}
const uboPage = (p) => (uboId ? `chrome-extension://${uboId}/${p}` : null);

// Runs inside uBO's background page: same headers as installSessionHeaders, without a session.webRequest listener.
const uboHeaderScript = () => `(() => {
  if (self.__mondiumHeaders) return true;
  self.__mondiumHeaders = true;
  const loginHost = new RegExp(${JSON.stringify(GOOGLE_LOGIN_HOST.source)}, ${JSON.stringify(GOOGLE_LOGIN_HOST.flags)});
  const loginUa = ${JSON.stringify(LOGIN_UA)};
  chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
    const headers = d.requestHeaders.filter((h) => !/^(dnt|sec-gpc)$/i.test(h.name));
    headers.push({ name: 'DNT', value: '1' }, { name: 'Sec-GPC', value: '1' });
    let login = false;
    try { login = loginHost.test(new URL(d.url).hostname); } catch {}
    if (login) { const ua = headers.find((h) => /^user-agent$/i.test(h.name)); if (ua) ua.value = loginUa; else headers.push({ name: 'User-Agent', value: loginUa }); }
    return { requestHeaders: headers };
  }, { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, ['blocking', 'requestHeaders']);
  return true;
})()`;
async function startUBlock() {
  if (process.env.MONDIUM_NO_UBO || settings.adblockEngine === 'hafif' || !fs.existsSync(path.join(UBO_DIR, 'manifest.json'))) return false;
  await eceReady;   // the extension library must be set up first for the toolbar icon
  try { mainSes.registerPreloadScript({ id: 'mondium-mv2-bridge', type: 'frame', filePath: path.join(__dirname, 'mv2-bridge.js') }); } catch {}
  const e = await Promise.race([extApi().loadExtension(UBO_DIR, { allowFileAccess: false }), timeout(20000).then(() => { throw new Error('uBO failed to load (20 s)'); })]);
  uboId = e.id;
  // Pages wait until uBO has loaded its filters from cache and is ready (so first requests don't slip through). At most 10 s.
  const t0 = Date.now();
  const background = () => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(`chrome-extension://${uboId}/background.html`));
  while (Date.now() - t0 < 10000) {
    const bg = background();
    if (bg) { try { if (await Promise.race([bg.executeJavaScript('!!(self.µBlock && self.µBlock.readyToFilter)'), timeout(1000)])) break; } catch {} }
    await new Promise((r) => setTimeout(r, 100));
  }
  // After the page has settled: an earlier call can run in a document that is then replaced, losing the listener.
  const bg = background();
  if (bg) await Promise.race([bg.executeJavaScript(uboHeaderScript()), timeout(2000)]).catch((err) => console.warn('Could not set privacy headers:', err.message));
  console.log(`uBlock Origin ${e.version} ready (${Date.now() - t0} ms)`);
  return true;
}
async function startBlocking() {
  let ok = false;
  try { ok = await startUBlock(); } catch (e) { console.warn('Could not start uBlock Origin, falling back to Mondium engine:', e.message); }
  if (!ok) { installSessionHeaders(mainSes); blockSession(mainSes); await ensureGhostery(); }
  mainBlockResolve();
  forEachWin(() => pushState());
}

async function forceUpdateFilters() {
  if (uboId && W && !W.incognito) { newTab(uboPage('dashboard.html#3p-filters.html')); return; }   // uBO updates its own lists
  try {
    attachBlocker(await buildBlocker());
    dialog.showMessageBox(win, { message: 'Filtre listeleri güncellendi.' });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Güncellenemedi: ' + e.message });
  }
}

// The library registers two global IPC channels for in-page (cosmetic) blocking and aborts halfway on the second
// session with "already registered" (network blocking was never set up in incognito). The channels are session-independent
// (they reply to the requesting page); the main session registers them, the others share.
function withSharedIpc(fn) {
  const h = ipcMain.handle, r = ipcMain.removeHandler;
  ipcMain.handle = (ch, f) => { try { h.call(ipcMain, ch, f); } catch { /* the main session's handler is used */ } };
  ipcMain.removeHandler = () => {};
  try { return fn(); } finally { ipcMain.handle = h; ipcMain.removeHandler = r; }
}
function blockerToggle(b, s, on) {
  const run = () => (on ? b.enableBlockingInSession(s) : b.disableBlockingInSession(s));
  try { if (s === mainSes) run(); else withSharedIpc(run); } catch (e) { console.warn('Blocker:', e.message); }
}
const blockerSessions = new Set();
function blockSession(s) {
  if (blockerSessions.has(s)) return;
  blockerSessions.add(s);
  if (blocker) blockerToggle(blocker, s, true);
}
// Library bug: in-page scripts (uBO scriptlets) requested by an iframe run in the MAIN page, not that iframe
// (event.sender = whole tab). On iframe-heavy pages like YouTube the same scripts entered the main page many times
// and wrapped each other ("JSONPath already defined", infinite recursion), which could break the player.
// Fix: scripts and CSS run in the requesting frame (senderFrame).
// Timing: uBlock Origin runs in-page scripts BEFORE the page's own code. The library instead injects them after
// the page starts loading, via a round-trip message to the main process; YouTube's first inline script slipped
// past and the player waited for a ~8 s timeout. So page-preload requests the main frame's scripts synchronously
// and runs them before the page's code; the library's late injection is skipped for that frame.
let tldParse = null;
try { ({ parse: tldParse } = require('tldts-experimental')); } catch {}
// The page preload asks for the left-edge detection width at startup (TEMPORARY test setting)
ipcMain.on('mondium-edge-px', (e) => { e.returnValue = settings.sideEdge || 2; });
// Visible label of a link opened in the background: no renderer has to load just for a tab title.
ipcMain.on('mondium-link-title', (e, data) => {
  e.returnValue = false;
  const tab = byWcId.get(e.sender.id);
  if (!tab || e.sender.session !== tab.w.ses || !/^https?:/i.test(e.senderFrame?.url || '') || !data || typeof data.url !== 'string' || typeof data.title !== 'string') return;
  try { if (!/^https?:$/.test(new URL(data.url).protocol)) return; } catch { return; }
  const title = data.title.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (title) { tab.linkTitleHint = { url: data.url, title, at: Date.now() }; e.returnValue = true; }
});
// Hover zoom: S downloads the image being shown (http(s) pages and URLs only).
ipcMain.on('mondium-zoom-download', (e, url) => {
  const tab = byWcId.get(e.sender.id);
  if (!settings.hoverZoom || !tab || !tab.view || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  if (!/^https?:/i.test(e.sender.getURL())) return;
  e.sender.downloadURL(url);
});
// Auto-hide mode: the sidebar opens when the mouse reaches the page's left edge (reported by page-preload)
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
  } catch (err) { console.warn('Could not get in-page scripts:', err.message); }
});
function fixCosmeticTarget(b) {
  if (b.mondiumFrameFix) return;
  b.mondiumFrameFix = true;
  const orig = b.onInjectCosmeticFilters;
  b.onInjectCosmeticFilters = (event, url, msg) => {
    const frame = event.senderFrame;
    if (!frame) return orig(event, url, msg);
    const isMain = !frame.parent;
    // Our tabs' main frame already got its scripts from page-preload (this request may even arrive before that)
    const early = isMain && byWcId.has(event.sender.id);
    const sender = {
      insertCSS: (css, o) => (isMain ? event.sender.insertCSS(css, o).catch(() => {})
        : frame.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s); })()`).catch(() => {})),
      // Each script in its own scope: the engine produces 35 scripts for YouTube; in one shared global scope
      // "class JSONPath" can't be defined twice (6 scripts never ran) and once the shared safeSelf() was overwritten
      // the wrappers called themselves into infinite recursion. uBlock Origin also runs scripts in separate scopes.
      executeJavaScript: (code, gesture) => { if (early) return; frame.executeJavaScript(`(function () {\n${code}\n})();`, gesture).catch(() => {}); }
    };
    return orig({ frameId: event.frameId, processId: event.processId, sender, senderFrame: frame }, url, msg);
  };
}
function attachBlocker(b) {
  fixCosmeticTarget(b);
  const list = [...blockerSessions].sort((x, y) => (y === mainSes) - (x === mainSes));   // main session first
  if (blocker) for (const s of list) blockerToggle(blocker, s, false);
  for (const s of list) blockerToggle(b, s, true);
  blocker = b;
  blocker.on('request-blocked', (req) => {
    const t = byWcId.get(req.tabId);
    if (t) { t.blocked++; if (t.w) inWin(t.w, () => { if (t.id === activeId) schedulePush(); }); }
  });
  forEachWin(() => pushState());
}

// At startup we briefly wait for the blocker so first requests don't slip through. The wait must NEVER lock the user:
// at most 3 s, and once it has elapsed (or the blocker is ready) we never wait again. (It used to wait up to 15 s per
// navigation: if the blocker hung, Enter in the address bar seemed to "do nothing".)
let mainBlockSettled = false;
mainBlockReady.then(() => { mainBlockSettled = true; });
setTimeout(() => { mainBlockSettled = true; }, 12000);
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
// Local malicious-domain layer (see threat-protection.js). navigationEpoch stops a slow go() from overriding a newer navigation.
const threatProtection = createThreatProtection({ root: __dirname, profile: app.getPath('userData') });
const blockedNavigations = new Map(), trustedThreatHosts = new WeakMap(), navigationEpoch = new WeakMap();
function showThreatWarning(wc, url) {
  const tab = byWcId.get(wc.id);
  if (!tab) return false;
  if (trustedThreatHosts.get(tab.w)?.has(hostOf(url)) || !threatProtection.isBlocked(url)) return false;
  navigationEpoch.set(wc, (navigationEpoch.get(wc) || 0) + 1);
  blockedNavigations.set(wc.id, url);
  wc.loadURL(SECURITY_URL).catch(() => {});
  return true;
}
async function go(wc, url) {
  const epoch = (navigationEpoch.get(wc) || 0) + 1;
  navigationEpoch.set(wc, epoch);
  if (showThreatWarning(wc, url)) return;
  if (!url.startsWith('file:')) {
    if (wc.session === mainSes) { if (!mainBlockSettled) await Promise.race([mainBlockReady, timeout(3000)]); }
    else await Promise.race([ensureIncognitoBlock(wc.session), timeout(3000)]);
  }
  if (wc.isDestroyed() || navigationEpoch.get(wc) !== epoch) return;
  const p = prepareUrl(wc, url);
  wc.loadURL(p.url, { userAgent: p.ua }).catch(() => {});
}

// ---------------------------------------------------------------- Google data cleanup
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
  } catch (e) { console.warn('Could not clear Google data:', e.message); }
}

// ---------------------------------------------------------------- Keep logins
// Many sites keep logins in "session cookies" (no expiry date). They are deleted when the browser closes
// and you must sign in again on every start. Chrome keeps them when "continue where you left off" is on; here
// they are turned into 30-day persistent cookies on exit (and every 15 minutes, against crashes). All stays on this computer.
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
  } catch (e) { console.warn('Could not keep sessions:', e.message); }
  return n;
}

// ---------------------------------------------------------------- Session
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return u || ''; } };

// ---------------------------------------------------------------- Permission bubble (like Chrome)
// Bubble below the left of the address bar: "<site> wants to: [icon] Know your location  [Block] [Allow]".
// Multiple requests in the same window are asked in turn. No extra window/process; drawn in the UI layer.
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
// The "It can:" list from Chrome's add-extension dialog
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

// Incognito session: no "persist:" prefix, so nothing is kept on disk. Shared by all incognito windows;
// everything in it is cleared when the last one closes.
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

// Thorium: DNT + Global Privacy Control on by default.
// PITFALL: with Electron 45, ANY session.webRequest listener stops all chrome.webRequest events for extensions in that
// session, so uBlock Origin sees no requests and blocks nothing (filters load fine, counters stay 0). Never call this
// on the main session while uBO is the engine. There, uboHeaderScript() sets the same headers through uBO's permission.
function installSessionHeaders(ses) {
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    if (details.resourceType === 'mainFrame' && threatProtection.isBlocked(details.url)) {
      const tab = byWcId.get(details.webContentsId);
      if (!trustedThreatHosts.get(tab?.w)?.has(hostOf(details.url))) { cb({ cancel: true }); return; }
    }
    details.requestHeaders['DNT'] = '1';
    if (isGoogleLogin(details.url)) details.requestHeaders['User-Agent'] = LOGIN_UA;
    details.requestHeaders['Sec-GPC'] = '1';
    cb({ requestHeaders: details.requestHeaders });
  });
}
function setupSession(ses = mainSes, incognito = false) {
  if (settings.overlayScrollbar !== false) ses.registerPreloadScript({ id: 'mondium-scrollbar', type: 'frame', filePath: path.join(__dirname, 'overlay-scrollbar.js') });
  ses.setSpellCheckerEnabled(false);
  ses.setUserAgent(app.userAgentFallback);

  // The main session gets its headers from uBO's background page, or from startBlocking() if uBO is unavailable.
  if (incognito) installSessionHeaders(ses);

  // ---- Site permissions (like Chrome: the decision is remembered)
  const alwaysAllow = new Set([
    'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock',
    // Needed by video players: DRM (EME), cookie access for embedded players, audio output selection
    'mediaKeySystem', 'storage-access', 'top-level-storage-access', 'speaker-selection', 'persistent-storage'
  ]);
  const deviceKinds = new Set(['hid', 'usb', 'serial', 'bluetooth']);
  // Like Chrome, the decision is asked in a bubble below the address bar (askPermission). Allow / Block are
  // remembered; closing (x) or clicking outside only denies this once. In incognito, decisions are not persisted.
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
  if (incognito) ensureIncognitoBlock(ses);   // the main session is decided by startBlocking()

  // Downloads: straight to the Downloads folder
  ses.on('will-download', (_e, item, wc) => {
    const ow = winOfWc(wc);
    if (threatProtection.isBlocked(item.getURL()) && !trustedThreatHosts.get(ow)?.has(hostOf(item.getURL()))) { item.cancel(); if (wc) showThreatWarning(wc, item.getURL()); return; }
    if (ow) useWin(ow);
    const dir = app.getPath('downloads');
    const ext = path.extname(item.getFilename());
    const base = path.basename(item.getFilename(), ext);
    let file = path.join(dir, path.basename(item.getFilename())), n = 1;
    while (fs.existsSync(file)) file = path.join(dir, `${base} (${n++})${ext}`);
    // Electron owns the asynchronous save dialog; do not block the main process.
    if (settings.askDownloadLocation === true) item.setSaveDialogOptions({ defaultPath: file, properties: ['showOverwriteConfirmation', 'createDirectory'] });
    else item.setSavePath(file);
    const d = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: path.basename(file), file,
      url: item.getURL(), t: Date.now(), received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false, item,
      ...(incognito ? { incognito: true } : {})
    };
    downloads.unshift(d);
    if (downloads.length > DOWNLOADS_MAX) downloads.length = DOWNLOADS_MAX;
    item.on('updated', (_ev, state) => {
      const selected = item.getSavePath();
      if (selected) { d.file = selected; d.name = path.basename(selected); }
      d.state = state; d.paused = item.isPaused(); d.received = item.getReceivedBytes(); d.total = item.getTotalBytes();
      forEachWin(() => schedulePush()); notifyPages('downloads');
    });
    item.once('done', (_ev, state) => {
      const selected = item.getSavePath();
      if (selected) { d.file = selected; d.name = path.basename(selected); }
      if (state === 'cancelled' && !selected) { const index = downloads.indexOf(d); if (index >= 0) downloads.splice(index, 1); }   // dialog cancelled: no bogus entry
      d.state = state; d.paused = false; d.received = item.getReceivedBytes(); d.item = null;
      saveDownloads(); forEachWin(() => pushState()); notifyPages('downloads');
      if (state === 'completed') notifyDownload(d);
    });
    saveDownloads(); forEachWin(() => pushState()); notifyPages('downloads');
  });
}

// The notification object is kept until clicked (otherwise garbage collection loses the click event)
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

// ---------------------------------------------------------------- Device support (WebHID / WebUSB / Serial / Bluetooth)
// Used by sites like ATK, VIA, Razer/Logitech web drivers, Arduino web uploader, ESP web flasher.
const sessionDeviceIds = new Set();   // devices chosen in this session
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

// Device chooser: a bubble below the address bar, like in Chrome.
// No extra window/process; drawn in the existing UI layer.
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
  // ---- WebHID (ATK, VIA, gaming mouse/keyboard software)
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

  // ---- Web Serial (Arduino / ESP32 web uploaders)
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

  // ---- Previously allowed devices (remembered across page reloads / browser restarts)
  ses.setDevicePermissionHandler((details) => {
    const d = details.device || {};
    if (sessionDeviceIds.has(d.deviceId) || sessionDeviceIds.has(d.portId)) return true;
    return settings.deviceGrants.some((g) => sameDevice(g, details.deviceType, details.origin, d));
  });

  // ---- Bluetooth pairing (PIN confirmation)
  if (typeof ses.setBluetoothPairingHandler === 'function') {
    ses.setBluetoothPairingHandler((details, callback) => {
      if (details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin') {
        dialog.showMessageBox(win, {
          type: 'question', buttons: ['Eşleştir', 'İptal'], defaultId: 0, cancelId: 1,
          message: details.pairingKind === 'confirmPin' ? `Cihazda şu PIN görünüyor mu? ${details.pin}` : 'Bluetooth cihazı eşleştirilsin mi?'
        }).then((r) => callback({ confirmed: r.response === 0 })).catch(() => callback({ confirmed: false }));
      } else {
        dialog.showMessageBox(win, { type: 'warning', message: 'Bu cihaz PIN girişi istiyor. Önce sistemin Bluetooth ayarlarından eşleştirin.' });
        callback({ confirmed: false });
      }
    });
  }
}

// Web Bluetooth selection comes through webContents
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

// ---------------------------------------------------------------- Tabs
// ECE observes each added tab by activating it, even when Mondium requested a background tab.
// Registration must not drive browser selection; restore ECE's active tab afterwards.
let extensionTabRegistrationDepth = 0;
function registerExtensionTab(wc, w) {
  if (!extensions || w.incognito) return;
  const selectedId = w === W ? activeId : w.activeId;
  const selected = w.tabs.find((t) => t.id === selectedId);
  extensionTabRegistrationDepth++;
  try {
    extensions.addTab(wc, w.win);
    if (selected && selected.view) extensions.selectTab(selected.view.webContents);
  } finally { extensionTabRegistrationDepth--; }
}
function toUrl(input) {
  const s = (input || '').trim();
  if (!s) return newtabUrl();
  const hashAt = s.indexOf('#');   // section links like mondium://settings#korunan
  const alias = PAGE_ALIASES[(hashAt < 0 ? s : s.slice(0, hashAt)).toLowerCase().replace(/\/+$/, '')];
  if (alias) return hashAt < 0 ? alias : alias + '#' + encodeURIComponent(s.slice(hashAt + 1));
  if (/^(https?|file|about|data|view-source|chrome-extension|blob):/i.test(s)) return s;   // extension pages are URLs too
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return searchUrl() + encodeURIComponent(s);
}

function createView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false, backgroundThrottling: true, session: ses, plugins: true,   // plugins: built-in PDF viewer
      preload: path.join(__dirname, 'page-preload.js')
    }
  });
  view.setBackgroundColor((effectiveTheme().page) || (nativeTheme.shouldUseDarkColors ? '#202124' : '#ffffff'));
  const wc = view.webContents;
  if (!tab.w) tab.w = W;
  // This tab's events always run in the context of its own window
  const on = (ev, fn) => wc.on(ev, (...args) => { useWin(tab.w); return fn(...args); });
  wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
  tab.view = view;
  tab.wcId = wc.id;
  byWcId.set(wc.id, tab);
  if (tab.pinned && tab.favicon) updateIconColor(tab);
  if (tab.muted) wc.setAudioMuted(true);
  attachBluetooth(wc);
  attachLoginFix(wc);
  if (extensions && !tab.w.incognito) { try { registerExtensionTab(wc, tab.w); } catch (e) { console.warn(e.message); } }

  wc.setWindowOpenHandler(({ url, disposition }) => {
    useWin(tab.w);
    if (showThreatWarning(wc, url)) return { action: 'deny' };
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { sandbox: true } }
      };
    }
    newTab(url, disposition === 'background-tab', tab.id);
    return { action: 'deny' };
  });
  on('will-navigate', (event, url) => { if (showThreatWarning(wc, event.url || url)) event.preventDefault(); });
  on('will-redirect', (event, url) => { if (showThreatWarning(wc, event.url || url)) event.preventDefault(); });
  on('did-create-window', (child, details) => {
    if (child.setMenu) child.setMenu(null);
    const cwc = child.webContents;
    attachLoginFix(cwc);                         // "Sign in with Google" popups
    const u = (details && details.url) || cwc.getURL();
    if (isGoogleLogin(u)) { cwc.setUserAgent(LOGIN_UA); cwc.loadURL(u, { userAgent: LOGIN_UA }).catch(() => {}); }
  });

  on('page-title-updated', (_e, title) => {
    tab.title = title;
    if (tab.hist && tab.hist.url === wc.getURL() && tab.hist.title !== title) { tab.hist.title = title; saveHistory(); notifyPages('history'); }
    schedulePush();
  });
  on('page-favicon-updated', (_e, icons) => {
    if (tab.favicon !== icons?.[0]) tab.iconColor = null;
    tab.favicon = icons && icons[0];
    if (tab.pinned) updateIconColor(tab);
    if (tab.hist && tab.favicon && tab.hist.url === wc.getURL() && tab.hist.favicon !== tab.favicon) { tab.hist.favicon = tab.favicon; saveHistory(); }
    const bm = settings.bookmarks.find((b) => b.url === tab.url);
    if (bm && tab.favicon && bm.favicon !== tab.favicon) { bm.favicon = tab.favicon; saveSettings(); }
    schedulePush();
  });
  on('did-start-loading', () => { tab.loading = true; schedulePush(); });
  on('did-stop-loading', () => { tab.loading = false; if (!tab.pendingNavigation) tab.url = wc.getURL() || tab.url; schedulePush(); });
  on('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isSameDocument) {
      navigationEpoch.set(wc, (navigationEpoch.get(wc) || 0) + 1); tab.blocked = 0; tab.favicon = null; tab.iconColor = null;
      if (e.url) showThreatWarning(wc, e.url);   // also catches history navigation; the main session has no header-level check with uBO
    }
  });
  on('did-navigate', (_e, url, code) => { tab.url = url; if (!code || code < 400) recordVisit(tab, url, wc); pushState(); });
  on('did-navigate-in-page', (_e, url, isMain) => {
    if (!isMain) return;
    tab.url = url;
    if (!tab.hist || tab.hist.url.split('#')[0] !== url.split('#')[0]) recordVisit(tab, url, wc);   // single-page sites like YouTube
    pushState();
  });
  on('did-fail-load', (_e, code, _desc, _url, isMain) => {
    if (isMain && code !== -3) { tab.title = 'Sayfa açılamadı'; pushState(); }
  });
  on('audio-state-changed', (e) => { tab.audible = e.audible; schedulePush(); });
  on('dom-ready', () => { if (settings.hoverZoom) applyHoverZoom(wc); });
  // While volume boost is on, apply it to newly loaded pages and embedded players too
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
  on('destroyed', () => { if (byWcId.get(wcId) === tab) byWcId.delete(wcId); blockedNavigations.delete(wcId); });
  return view;
}

// The same URL on the same day is kept as one row (moved to the top). Reloads and waking tabs add no new entry.
function recordVisit(tab, url, wc) {
  if (!/^https?:/i.test(url || '') || (tab.w && tab.w.incognito)) return;   // incognito does not write history
  if (tab.hist && tab.hist.url === url && history.includes(tab.hist)) return;
  const now = Math.max(Date.now(), history.length ? history[0].t + 1 : 0);   // t is also the ID: must be unique
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

// Previous session: tabs come back asleep (using no memory), only the active one is loaded.
function restoreSession() {
  if (!settings.restoreSession) return false;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return false; }
  const wins = data && Array.isArray(data.windows) ? data.windows : data && Array.isArray(data.tabs) ? [data] : [];   // old format: single window
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
      favicon: typeof x.favicon === 'string' ? x.favicon : null, iconColor: /^#[0-9a-f]{6}$/i.test(x.iconColor || '') ? x.iconColor : null, loading: false, lastActive: Date.now(),
      blocked: 0, audible: false, pinned: !!x.pinned, muted: !!x.muted
    });
  }
  if (!tabs.length) return false;
  orderPinned();
  for (const t of tabs) if (t.pinned && t.favicon) updateIconColor(t);
  const a = Math.min(Math.max(Number(data.active) || 0, 0), tabs.length - 1);
  activateTab(tabs[a].id);
  return true;
}

// History / downloads: switch to its tab if open, open in place if on a new tab page, else a new tab
function openPage(url) {
  if (baseOf(url) === DOWNLOADS_URL) { showDownloadsPanel(); return; }
  if (baseOf(url) === TASKS_URL) { showTaskManager(); return; }
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

// Pinned tabs always on the left (sort is stable, the rest keep their order)
const orderPinned = () => tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

// Deferred background tabs: fetch only the HTML title; no renderer, scripts, images or media until the tab is selected.
const titleQueue = [];
let titleJobs = 0;
function queueTabTitle(tab) {
  if (!/^https?:/i.test(tab.url) || threatProtection.isBlocked(tab.url)) return;
  const known = settings.bookmarks.find((b) => b.url === tab.url) || history.find((h) => h.url === tab.url);
  if (known && known.title) { tab.title = known.title; return; }
  titleQueue.push(tab);
  drainTabTitles();
}
function drainTabTitles() {
  while (titleJobs < 3 && titleQueue.length) {
    const tab = titleQueue.shift();
    if (!tab.w.tabs.includes(tab) || (tab.view && !tab.pendingNavigation)) continue;
    titleJobs++;
    readTabTitle(tab).finally(() => { titleJobs--; drainTabTitles(); });
  }
}
async function readTabTitle(tab) {
  const controller = new AbortController();
  tab.titleRequest = controller;
  const timer = setTimeout(() => controller.abort(), 6000);
  const url = tab.url;
  let reader;
  try {
    const response = await tab.w.ses.fetch(url, { signal: controller.signal });
    if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) return;
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '', bytes = 0, match;
    while (bytes < 256 * 1024) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      html += decoder.decode(chunk.value, { stream: true });
      match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
      if (match || /<\/head\s*>/i.test(html)) break;
    }
    if (match && tab.url === url && tab.w.tabs.includes(tab) && (!tab.view || tab.pendingNavigation)) {
      const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
      tab.title = match[1].replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|quot|apos|lt|gt|nbsp);/gi, (all, n, named) => {
        if (named) return entities[named.toLowerCase()];
        const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }).replace(/\s+/g, ' ').trim().slice(0, 300) || tab.title;
      if (windows.includes(tab.w)) inWin(tab.w, () => pushState());
    }
  } catch {} finally {
    if (reader) reader.cancel().catch(() => {});
    controller.abort(); clearTimeout(timer);
    if (tab.titleRequest === controller) tab.titleRequest = null;
  }
}

function newTab(url, background = false, openerId = null, at = -1, requireView = false) {
  const tab = {
    id: nextId++, w: W, view: null, url: toUrl(url), title: 'Yeni Sekme', favicon: null,
    loading: false, lastActive: Date.now(), blocked: 0, audible: false, pinned: false, muted: false
  };
  const openerIdx = openerId ? tabs.findIndex((t) => t.id === openerId) : -1;
  if (at >= 0) tabs.splice(Math.min(at, tabs.length), 0, tab);
  else if (openerIdx >= 0) tabs.splice(openerIdx + 1, 0, tab); else tabs.push(tab);
  orderPinned();
  // Background links are URL records only; title metadata is fetched without a renderer or media.
  // chrome.tabs.create requires a WebContents ID, so keep its background view blank until selected.
  if (background && activeId !== null) {
    tab.title = isInternal(tab.url) ? 'Yeni Sekme' : hostOf(tab.url);
    if (requireView) { tab.pendingNavigation = true; createView(tab); }
    const opener = getTab(openerId), hint = opener?.linkTitleHint;
    if (hint && hint.url === tab.url && Date.now() - hint.at < 2000) { tab.title = hint.title; opener.linkTitleHint = null; } else queueTabTitle(tab);
  }
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
  if (tab.titleRequest) tab.titleRequest.abort();
  tab.lastActive = Date.now();
  if (!tab.view) { createView(tab); go(tab.view.webContents, tab.url); }
  else if (tab.pendingNavigation) { tab.pendingNavigation = false; go(tab.view.webContents, tab.url); }
  const keepSide = overlayOpen && overlayKind === 'side';
  if (overlayOpen && !keepSide) closeOverlay();
  win.contentView.addChildView(tab.view);
  if (W) W.uiAbove = false;
  if (keepSide || W.sideClosing) raiseUi();
  if (keepSide) W.sideHoldUntil = Date.now() + 500;
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

// Closed tabs (reopened with Ctrl+Shift+T). Only the URL is kept, so memory cost is negligible.
let closedTabs = [];
function rememberClosed(tab, index) {
  let u = tab.url;
  try { if (tab.view && !tab.pendingNavigation && !tab.view.webContents.isDestroyed()) u = tab.view.webContents.getURL() || u; } catch {}
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
// Accent color of a pinned tab's tile, taken from its favicon. Bounded download and image size, three jobs at most.
const iconColors = new Map(), iconJobs = [];
let activeIconJobs = 0;
function runIconJob(fn) { return new Promise((resolve) => { iconJobs.push({ fn, resolve }); drainIconJobs(); }); }
function drainIconJobs() {
  while (activeIconJobs < 3 && iconJobs.length) {
    const { fn, resolve } = iconJobs.shift();
    activeIconJobs++;
    Promise.resolve().then(fn).then(resolve, () => resolve(null)).finally(() => { activeIconJobs--; drainIconJobs(); });
  }
}
async function updateIconColor(tab) {
  if (!vertical() || !tab.pinned || !tab.favicon || !/^(https?:|data:image\/)/i.test(tab.favicon)) return;
  const url = tab.favicon;
  const cacheKey = (tab.w.incognito ? 'private:' : 'main:') + url;
  let pendingColor = iconColors.get(cacheKey);
  if (!pendingColor) {
    const job = runIconJob(async () => {
      if (!windows.includes(tab.w) || !tab.w.tabs.includes(tab) || !tab.pinned || tab.favicon !== url) return null;
      try {
        let image, imageData;
        if (url.startsWith('data:image/')) {
          if (url.length > 180 * 1024) return null;
          imageData = url;
          const encoded = url.split(',')[1];
          if (/;base64,/i.test(url)) assertImageLimits(Buffer.from(encoded, 'base64'));
          image = nativeImage.createFromDataURL(url);
        } else {
          const r = await tab.w.ses.fetch(url, { signal: AbortSignal.timeout(4000) });
          if (!r.ok || Number(r.headers.get('content-length')) > 128 * 1024) return null;
          const bytes = await readResponseBytes(r, 128 * 1024);
          imageData = 'data:' + (r.headers.get('content-type') || 'image/x-icon').split(';')[0] + ';base64,' + Buffer.from(bytes).toString('base64');
          assertImageLimits(Buffer.from(bytes));
          image = nativeImage.createFromBuffer(Buffer.from(bytes));
        }
        let pixels;
        if (!image.isEmpty()) pixels = image.resize({ width: 20, height: 20 }).toBitmap();
        else if (tab.w.ui && !tab.w.ui.webContents.isDestroyed()) {
          // Chromium can decode favicon formats (ICO/SVG) that nativeImage cannot.
          const rgba = await tab.w.ui.webContents.executeJavaScript('(' + (async (src) => {
            const image = new Image(); image.src = src; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
            const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, 20, 20);
            return Array.from(context.getImageData(0, 0, 20, 20).data);
          }).toString() + ')(' + JSON.stringify(imageData) + ')');
          pixels = Buffer.from(rgba);
          for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
        } else return null;
        const buckets = new Map(), neutral = new Map();
        for (let i = 0; i < pixels.length; i += 4) {
          const b = pixels[i], g = pixels[i + 1], r = pixels[i + 2], alpha = pixels[i + 3] / 255;
          const hi = Math.max(r, g, b), lo = Math.min(r, g, b), saturation = hi ? (hi - lo) / hi : 0;
          if (alpha >= 0.5 && hi >= 45) { const v = Math.round((r + g + b) / 3 / 16) * 16; neutral.set(v, (neutral.get(v) || 0) + alpha); }
          if (alpha < 0.5 || hi < 45 || saturation < 0.2) continue;
          const key = [r >> 5, g >> 5, b >> 5].join(','); const v = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
          const weight = saturation * alpha; v.weight += weight; v.r += r * weight; v.g += g * weight; v.b += b * weight; buckets.set(key, v);
        }
        const c = [...buckets.values()].sort((x, y) => y.weight - x.weight)[0];
        if (c) return '#' + [c.r, c.g, c.b].map((v) => Math.round(v / c.weight).toString(16).padStart(2, '0')).join('');
        const gray = [...neutral].sort((x, y) => y[1] - x[1])[0];
        return gray ? '#' + Math.max(96, Math.min(224, gray[0])).toString(16).padStart(2, '0').repeat(3) : '#808080';
      } catch { return null; }
    });
    pendingColor = job;
    iconColors.set(cacheKey, job);
    if (iconColors.size > 128) iconColors.delete(iconColors.keys().next().value);
  }
  const color = await pendingColor;
  if (!color && iconColors.get(cacheKey) === pendingColor) iconColors.delete(cacheKey);   // a failed request must not lock the tab to the fallback color
  if (tab.favicon === url && tab.w.tabs.includes(tab)) { if (color) tab.iconColor = color; if (windows.includes(tab.w)) inWin(tab.w, () => pushState()); }
}
function revealPinChange() {
  if (!vertical() || !settings.verticalAutoHide) return;
  clearTimeout(W.sideCloseTimer); W.sideClosing = false;
  openSide(); W.sideHoldUntil = Date.now() + 1400;
}
function togglePin(id) {
  const t = getTab(id);
  if (!t) return;
  t.pinned = !t.pinned;
  if (t.pinned) updateIconColor(t);
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  const firstFree = tabs.filter((x) => x.pinned).length;
  tabs.splice(firstFree, 0, t);    // pinned: to the end of pinned tabs; unpinned: to the start of unpinned ones
  pushState();
}
function toggleMute(id) {
  const t = getTab(id);
  if (!t || !settings.tabAudio) return;
  t.muted = !t.muted;
  if (t.view) t.view.webContents.setAudioMuted(t.muted);
  pushState();
}
// ---------------------------------------------------------------- Volume boost (per tab)
// Does what Volume Booster extensions do in Chrome, without tabCapture: volume.js routes the page's
// video/audio elements through a gain node. Runs in an isolated world in the main frame (site can't interfere),
// and inside the frame for embedded frames (iframe players). The value is kept per tab, also while asleep.
const VOLUME_STEPS = [25, 50, 75, 100, 150, 200, 300, 400, 600];   // tab context menu
const VOLUME_MAX = 600;
let VOLUME_JS = null;
function applyVolume(wc, frame, pct) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  if (!VOLUME_JS) VOLUME_JS = fs.readFileSync(path.join(__dirname, 'volume.js'), 'utf8');   // read on first use
  const code = `{ const GAIN = ${pct / 100};\n${VOLUME_JS}\n}`;   // block scope: avoids "already defined" errors when run again
  if (frame) { frame.executeJavaScript(code, true).catch(() => {}); return; }
  wc.executeJavaScriptInIsolatedWorld(1013, [{ code }], true).catch(() => {});
  for (const f of wc.mainFrame ? wc.mainFrame.framesInSubtree : []) {
    if (f !== wc.mainFrame && /^https?:/i.test(f.url)) f.executeJavaScript(code, true).catch(() => {});
  }
}
// ---------------------------------------------------------------- Image zoom (built-in, Imagus-like)
// When enabled, hoverzoom.js is injected into every page in an isolated world (1014); site code can't see or break it.
// When disabled it is removed from open pages too. No extra process, extension or background work.
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
  if (tab.titleRequest) tab.titleRequest.abort();
  destroyView(tab);
  if (tabs.length === 0) { if (win) win.close(); return; }
  if (activeId === id) { activeId = null; activateTab(tabs[Math.min(i, tabs.length - 1)].id); }
  else pushState();
}

function sleepTab(id) {
  const tab = allTabs().find((t) => t.id === Number(id));
  if (!tab || !tab.view) return false;
  useWin(tab.w);
  if (activeId === tab.id) {
    const next = tabs.find((t) => t !== tab);
    if (!next) return false;
    activateTab(next.id);
  }
  if (tab.titleRequest) tab.titleRequest.abort();
  if (!tab.pendingNavigation) tab.url = tab.view.webContents.getURL() || tab.url;
  destroyView(tab); tab.pendingNavigation = false; tab.loading = false; tab.audible = false;
  pushState();
  return true;
}
function sleepIdleTabs(force = false) {
  if (force !== true && (!settings.sleepTabs || !settings.sleepMinutes)) return;
  const limit = force === true ? 0 : settings.sleepMinutes * 60e3;
  forEachWin(() => {
    let changed = false;
    for (const t of tabs) {
      if (t.id === activeId || !t.view || t.pendingNavigation || t.audible || Date.now() - t.lastActive < limit) continue;
      const u = t.view.webContents.getURL();
      if (u) t.url = u;
      destroyView(t);
      changed = true;
    }
    if (changed) pushState();
  });
}

// ---------------------------------------------------------------- Bookmarks
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

// ---------------------------------------------------------------- Layout and UI state
const vertical = () => !!settings.verticalTabs && !htmlFullscreen;
function layout() {
  if (!win || !ui) return;
  // Full-page F11 and HTML fullscreen: the page takes the whole window, the browser UI is hidden
  const fullscreen = htmlFullscreen || win.isFullScreen();
  ui.setVisible(!fullscreen);
  if (fullscreen) {
    const { width, height } = win.getContentBounds();
    ui.setBounds({ x: 0, y: 0, width, height: 0 });
    const t = activeTab();
    if (t?.view) { t.view.setBounds({ x: 0, y: 0, width, height }); win.contentView.addChildView(t.view); if (W) W.uiAbove = false; }
    return;
  }
  const { width, height } = win.getContentBounds();
  const t = activeTab();
  if (vertical()) {
    // Vertical: the UI covers the whole window and sits BEHIND the page (top bars + left sidebar stay visible).
    // In auto-hide mode the page is full width; when the sidebar opens the UI is raised and slides over the page.
    const top = TOOLBAR + (settings.bookmarksBar ? BOOKMARKS : 0) + (findOpen ? FINDBAR : 0);
    const sw = settings.verticalAutoHide ? 0 : sideWidth(width);
    ui.setBounds({ x: 0, y: 0, width, height });
    if (t && t.view) {
      t.view.setBounds({ x: sw, y: top, width: Math.max(0, width - sw), height: Math.max(0, height - top) });
      if (!overlayOpen && W && !W.sideClosing && W.uiAbove) { win.contentView.addChildView(t.view); W.uiAbove = false; }   // page back on top
    }
    return;
  }
  const h = uiHeight();
  ui.setBounds({ x: 0, y: 0, width, height: overlayOpen ? height : h });
  if (t && t.view) t.view.setBounds({ x: 0, y: h, width, height: Math.max(0, height - h) });
}
// Bring the UI to the top (menus, bubbles, revealed sidebar)
function raiseUi() { win.contentView.addChildView(ui); if (W) W.uiAbove = true; }

// ---------- Vertical tabs
function setVerticalTabs(on) {
  settings.verticalTabs = !!on;
  saveSettings();
  if (settings.verticalTabs) for (const t of allTabs()) if (t.pinned && !t.iconColor) updateIconColor(t);
  forEachWin(() => { if (overlayOpen) closeOverlay(false); paintFrame(); layout(); pushState(); });
  broadcastPages();
}
function animateSideLayout() {
  const w = W;
  clearTimeout(w.sideCloseTimer);
  w.sideClosing = true;
  raiseUi();
  layout(); pushState();
  w.sideCloseTimer = setTimeout(() => {
    if (!windows.includes(w) || w.win.isDestroyed()) return;
    inWin(w, () => { w.sideClosing = false; layout(); });
  }, 220);
}
function toggleAutoHide() {
  if (!settings.verticalTabs) return;
  settings.verticalAutoHide = !settings.verticalAutoHide;
  saveSettings();
  forEachWin(() => {
    if (overlayKind === 'side') { overlayOpen = false; overlayKind = null; send('side-reveal', false); }
    animateSideLayout();
  });
  notifyPages('settings');
}
// In auto-hide mode the sidebar opens when the mouse hits the left edge (focus stays on the page)
function openSide() {
  if (!win || !ui || !vertical() || !settings.verticalAutoHide || overlayOpen) return;   // may reopen while the close animation runs
  clearTimeout(W.sideCloseTimer);
  W.sideClosing = false;
  overlayOpen = true;
  overlayKind = 'side';
  raiseUi();
  layout();
  send('side-reveal', true);
  W.sideHoldUntil = Date.now() + 500;
  // Native cursor tracking owns dismissal: page repaints and DOM replacement cannot close the sidebar by accident.
  const w = W;
  clearInterval(w.sideWatch);
  w.sideWatch = setInterval(() => {
    if (!windows.includes(w) || w.win.isDestroyed()) { clearInterval(w.sideWatch); return; }
    inWin(w, () => {
      if (!overlayOpen || overlayKind !== 'side') { clearInterval(w.sideWatch); return; }
      if (w.tabDragging) return;
      const p = screen.getCursorScreenPoint(), b = win.getContentBounds();
      const x = p.x - b.x, y = p.y - b.y;
      const top = TOOLBAR + (settings.bookmarksBar ? BOOKMARKS : 0) + (findOpen ? FINDBAR : 0);
      const inside = x >= 0 && x <= sideWidth(b.width) + 8 && y >= top && y < b.height;
      if (inside) w.sideHoldUntil = Date.now() + 250;
      else if (Date.now() >= w.sideHoldUntil) closeOverlay(false);
    });
  }, 50);
}

function send(ch, data) { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send(ch, data); }

let pushTimer = null;
function schedulePush() {
  if (pushTimer || !W) return;
  const w = W;   // the timer runs later; it must send that window's state
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
      iconColor: x.iconColor || null, sleeping: !x.view || !!x.pendingNavigation, audible: x.audible, pinned: !!x.pinned, muted: !!x.muted, volume: x.volume || 100
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

// From local history and bookmarks only. Keystrokes are NOT sent to the search engine.
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
    if (prev) { prev.score += 6; if (!prev.favicon && favicon) prev.favicon = favicon; return; }   // frequently visited ranks higher
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
  // Inline completion like Chrome: if the input is a prefix of the top result's domain, the rest is filled in
  let inline = '';
  if (!/\s/.test(q)) {
    for (const it of items) {
      try { const host = new URL(it.url).host.replace(/^www\./, ''); if (host.startsWith(q) && host !== q) { inline = host; break; } } catch {}
    }
  }
  return { items, inline };
}
function openNewTabPrompt(fallback) {
  if (settings.newTabPrompt !== true) { if (fallback) fallback(); else newTab(''); return; }
  if (!win || !ui || overlayKind === 'prompt') return;
  if (overlayOpen) closeOverlay(false);
  overlayOpen = true; overlayKind = 'newtab';
  raiseUi(); layout(); ui.webContents.focus();
  send('newtab-prompt', { searchName: (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name });
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
    if (!t.view) { activateTab(t.id); return; }   // sleeping tab: activateTab creates the view and loads t.url
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
    case 'new-tab': openNewTabPrompt(); break;
    case 'prompt-answer': answerPrompt(arg); break;
    case 'side-reveal': openSide(); break;
    case 'side-hide': break;   // native cursor tracking owns sidebar dismissal
    case 'tab-drag-start': W.tabDragging = true; if (!overlayOpen) { overlayOpen = true; overlayKind = 'tabdrag'; raiseUi(); layout(); } break;
    case 'tab-drag-end': W.tabDragging = false; W.sideHoldUntil = Date.now() + 500; if (overlayKind === 'tabdrag') closeOverlay(false); break;
    case 'side-drag-start':   // width drag: UI is raised so it keeps getting events even when the mouse moves over the page
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
    case 'newtab-query': if (overlayKind === 'newtab' && typeof arg === 'string') send('newtab-results', { q: arg, ...omniSuggest(arg) }); break;
    case 'newtab-submit': if (overlayKind === 'newtab' && typeof arg === 'string' && arg.trim()) { closeOverlay(false); newTab(arg.trim()); } break;
    case 'newtab-cancel': if (overlayKind === 'newtab') closeOverlay(); break;
    case 'navigate-tab': if (arg) newTab(arg, false, activeId); break;
  }
});

// ---------------------------------------------------------------- Shortcuts
// Chrome's Mac-only shortcuts, on top of the shared list where Cmd takes the place of Ctrl.
function macShortcut(input, k) {
  if (!input.meta) return false;
  const stepTab = (d) => {
    const i = tabs.findIndex((t) => t.id === activeId), n = tabs.length;
    if (n > 1) activateTab(tabs[(i + d + n) % n].id);
    return true;
  };
  if (input.control && k === 'f') { win.setFullScreen(!win.isFullScreen()); return true; }
  if (input.alt && k === 'arrowright') return stepTab(1);
  if (input.alt && k === 'arrowleft') return stepTab(-1);
  if (input.shift && (k === ']' || k === '}')) return stepTab(1);
  if (input.shift && (k === '[' || k === '{')) return stepTab(-1);
  if (input.alt && k === 'i') { withActive((wc) => wc.toggleDevTools()); return true; }
  if (input.shift || input.alt || input.control) return false;
  if (k === '[') { goBack(); return true; }
  if (k === ']') { goForward(); return true; }
  if (k === 'y') { openPage(HISTORY_URL); return true; }
  if (k === ',') { openPage(SETTINGS_URL); return true; }
  return false;
}

function handleShortcut(input) {
  if (input.type && input.type !== 'keyDown') return false;
  const ctrl = isMac ? input.meta : input.control;
  const k = (input.key || '').toLowerCase();
  if (isMac && macShortcut(input, k)) return true;
  // macOS keeps Cmd+H (hide) and Cmd+M (minimize) for the system.
  if (isMac && input.meta && !input.shift && !input.alt && !input.control && (k === 'h' || k === 'm')) return false;
  if (k === 'escape' && htmlFullscreen) { withActive((wc) => wc.executeJavaScript('document.exitFullscreen && document.exitFullscreen()').catch(() => {})); return true; }
  if (k === 'escape' && overlayOpen) { closeOverlay(); return true; }
  if (k === 'escape' && findOpen) { closeFind(); return true; }
  if (ctrl && input.shift && k === 't') { reopenClosed(); return true; }
  if (ctrl && input.shift && k === 'n') { newWindow(true); return true; }               // new incognito window
  if (ctrl && k === 'n') { newWindow(false); return true; }                              // new window
  if (ctrl && k === 't') { openNewTabPrompt(); return true; }
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
  // Ctrl+S: toggle auto-hide mode with vertical tabs (user request); save page is Ctrl+Shift+S
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
  if ((ctrl || (isMac && input.control)) && k === 'tab') {   // Cmd+Tab belongs to macOS, Ctrl+Tab switches tabs there
    const i = tabs.findIndex((t) => t.id === activeId), n = tabs.length;
    if (n > 1) activateTab(tabs[(i + (input.shift ? n - 1 : 1)) % n].id);
    if (vertical() && settings.verticalAutoHide) { openSide(); W.sideHoldUntil = Date.now() + 1200; }
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

// ---------------------------------------------------------------- Menus
// Menu clicks arrive later; another window may be current by then, so we switch back to the menu's window
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

// ---------------------------------------------------------------- Chrome-style menu (drawn in the UI layer, no extra process)
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
  if (kind === 'chooser' && chooser) finishChooser(null);   // clicked outside: cancel
  if (kind === 'side') {
    // The revealed sidebar slides back left as it came; the UI stays on top until the animation ends
    send('side-reveal', false);
    const w = W;
    clearInterval(w.sideWatch);
    w.sideClosing = true;
    clearTimeout(w.sideCloseTimer);
    w.sideCloseTimer = setTimeout(() => { if (windows.includes(w) && !w.win.isDestroyed()) inWin(w, () => { w.sideClosing = false; layout(); }); }, 220);
    return;
  }
  layout();
  send('menu-closed');
  if (kind === 'sidedrag') send('side-reveal', false);
  if (kind === 'prompt') {   // clicked outside / Esc: deny this once
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

// ---------------------------------------------------------------- Task manager (how much RAM each tab uses)
const MB = (kb) => Math.round(kb / 1024);
function showTaskManager() { return showInternalPanel(TASKS_URL, 'Görev yöneticisi', taskPanels, 1000, 640); }
function taskManagerData() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const groups = new Map(), assigned = new Set();
  const memory = (m) => (m && m.memory ? m.memory.privateBytes || m.memory.workingSetSize || 0 : 0);
  const add = (key, label, row) => {
    if (!groups.has(key)) groups.set(key, { key, label, rows: [], memory: 0, cpu: 0 });
    const g = groups.get(key);
    g.rows.push(row);
    if (!row.shared) { g.memory += row.memory; g.cpu += row.cpu; }
  };
  for (const t of allTabs()) {
    const sleeping = !t.view || !!t.pendingNavigation;
    const pid = sleeping ? null : t.view.webContents.getOSProcessId();
    const m = byPid.get(pid), shared = pid != null && assigned.has(pid);
    if (pid != null) assigned.add(pid);
    add('tabs', 'Sekmeler', { id: t.id, title: (t.w.incognito ? '(Gizli) ' : '') + (t.title || t.url), icon: t.favicon || null, pid, sleeping, shared, memory: sleeping || shared ? 0 : memory(m), cpu: sleeping || shared ? 0 : (m?.cpu?.percentCPUUsage || 0), canSleep: !sleeping && !(t.w === W && t.id === activeId), tab: true });
  }
  const uiPids = new Set(windows.filter((w) => w.ui && !w.ui.webContents.isDestroyed()).map((w) => w.ui.webContents.getOSProcessId()));
  const processes = webContents.getAllWebContents();
  for (const m of metrics) {
    if (assigned.has(m.pid)) continue;
    const hosts = processes.filter((wc) => !wc.isDestroyed() && wc.getOSProcessId() === m.pid);
    const extension = hosts.find((wc) => wc.getURL().startsWith('chrome-extension:'));
    const key = uiPids.has(m.pid) ? 'ui' : extension ? 'extensions' : m.type === 'Browser' ? 'browser' : m.type === 'GPU' ? 'gpu' : m.type === 'Utility' ? 'utility' : 'ui';
    const names = { ui: 'Arayüz', extensions: 'Uzantılar', browser: 'Tarayıcı', gpu: 'GPU', utility: 'Yardımcı süreçler' };
    const title = extension ? (extension.getTitle() || hostOf(extension.getURL())) : m.name || m.serviceName || names[key];
    add(key, names[key], { id: 'process-' + m.pid, title, pid: m.pid, memory: memory(m), cpu: m.cpu?.percentCPUUsage || 0, shared: false, tab: false });
  }
  return { total: metrics.reduce((n, m) => n + memory(m), 0), groups: [...groups.values()], at: Date.now() };
}

// ---------------------------------------------------------------- Extensions
const extApi = () => (mainSes && mainSes.extensions && typeof mainSes.extensions.getAllExtensions === 'function' ? mainSes.extensions : mainSes);

// Extension info (name, description, icon). Read from files; cached per version.
const extInfoCache = new Map();
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function extInfo(id, dir, manifest) {
  const m = manifest || readJson(path.join(dir, 'manifest.json'));
  if (!m) return null;
  const key = dir + '|' + m.version;
  if (extInfoCache.has(key)) return extInfoCache.get(key);
  // Localized __MSG_name__ strings: Turkish, then default locale, then English (in priority order)
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
  // Smallest icon of at least 48 px, otherwise the largest
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
// All loaded and disabled extensions (disabled ones are not loaded, so their info is read from files)
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
  const e = await extApi().loadExtension(dir, { allowFileAccess: false });
  if (e && e.manifest && e.manifest.manifest_version === 3 && e.manifest.background && e.manifest.background.service_worker) {
    mainSes.serviceWorkers.startWorkerForScope(`chrome-extension://${e.id}`).catch(() => {});
  }
  return e;
}
// Installed from the Web Store: newest of the Extensions/<id>/<version>/ folders; disabled ones are skipped
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
    try { if (!extApi().getExtension(id)) await loadExt(path.join(base, vers[vers.length - 1])); } catch (e) { console.warn('Could not load extension:', id, e.message); }
  }
}
async function setExtensionEnabled(id, on) {
  if (id && id === uboId) return;   // built-in
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
    // chrome.userScripts, missing in Electron (for extensions like Imagus Reborn), see user-scripts.js.
    // Must be set up BEFORE the extension library: the library freezes the chrome object after adding its own APIs.
    try { require('./user-scripts').setupUserScripts({ ses, storeFile: path.join(app.getPath('userData'), 'kullanici-betikleri.json') }); }
    catch (e) { console.warn('Could not start user script support:', e.message); }
    try {
      extensions = new ECE({
        license: 'GPL-3.0',
        session: ses,
        createTab: async (details) => {
          // If an extension wants to reopen its own page (e.g. its options) that is already open in a tab, don't open
          // a new tab, switch to the existing one. Otherwise the same page piles up on every start (session restore + extension).
          const u = details.url || '';
          const same = /^chrome-extension:/i.test(u) && allTabs().find((x) => x.url.split('#')[0] === u.split('#')[0]);
          useWin(same ? same.w : lastWin(true));
          if (same) {
            if (details.active !== false || !same.view) activateTab(same.id);
            if (same.view) {
              // The restored tab may have opened before the extension was ready and errored: reload it
              same.url = u; go(same.view.webContents, u);
              return [same.view.webContents, win];
            }
          }
          const t = newTab(u, details.active === false, activeId, -1, true);
          return [t.view.webContents, win];
        },
        selectTab: (wc) => { if (extensionTabRegistrationDepth || !wc || wc.isDestroyed()) return; const t = byWcId.get(wc.id); if (t) { useWin(t.w); activateTab(t.id); } },
        // The library also calls this for closed/slept tabs; only close live tabs the extension asked for
        removeTab: (wc) => { if (!wc || wc.isDestroyed()) return; const t = byWcId.get(wc.id); if (t && t.w && t.w.win) { useWin(t.w); closeTab(t.id); } },
        createWindow: async (details) => { useWin(lastWin(true)); [].concat(details.url || '').forEach((u) => newTab(u)); return win; },
        removeWindow: () => {}
      });
      ECE.handleCRXProtocol(ses);
      for (const t of allTabs()) if (t.view && !t.w.incognito) { try { registerExtensionTab(t.view.webContents, t.w); } catch {} }
      forEachWin((w) => { if (!w.incognito && activeTab() && activeTab().view) { try { extensions.selectTab(activeTab().view.webContents); } catch {} } });
    } catch (e) {
      console.warn('Could not start extension support:', e.message);
      extensions = null;
    }
  }
  eceReadyResolve();
  if (CWS) {
    try {
      await CWS.installChromeWebStore({
        session: ses,
        loadExtensionOptions: { allowFileAccess: false },
        loadExtensions: false,     // we load them ourselves: disabled extensions are skipped
        // Like Chrome: a bubble below the address bar lists what the extension can do
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
    } catch (e) { console.warn('Could not start Web Store support:', e.message); }
  }
  await loadStoreExtensions();
  for (const dir of settings.unpackedExtensions) {
    if (isDisabledPath(dir)) continue;
    try { await loadExt(dir); } catch (e) { console.warn('Could not load extension:', dir, e.message); }
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
  if (id && id === uboId) return;   // built-in
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

// Ctrl+Shift+Delete and other entry points: the "Clear browsing data" dialog on the settings page (in a normal window)
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

// ---------------------------------------------------------------- Protected Sites + selective cleanup (site-data.js)
const siteData = createSiteData({
  getSession: () => mainSes,
  getProtected: () => (Array.isArray(settings.protectedSites) ? settings.protectedSites.slice() : []),
  setProtected: (list) => { settings.protectedSites = list; saveSettings(true); notifyPages('settings'); },
  openTabUrls: () => allTabs().filter((t) => !t.w || !t.w.incognito).map((t) => t.url),
  // Hidden temporary view, not attached to a window, for CDP commands (main session)
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
  // History and download list: independent of protection, by time range
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
  // The HTTP cache can't be safely split per site (key is top-level site + resource URL): only "all", by explicit choice
  if (o.cache) {
    if (o.range !== 'all') out.notes.push('Önbellek temizlenmedi: motor önbellekte zaman aralığını desteklemiyor. Önbelleği temizlemek için "Tüm zamanlar"ı seçin.');
    else { try { await mainSes.clearCache(); out.cache = 'requested'; } catch (e) { out.notes.push('Önbellek temizlenemedi: ' + e.message); } }
  }
  forEachWin(() => pushState());
  return out;
}

// Site icon in the address bar: site info menu
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

// Thorium: right-click menu on the reload button
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

// ---------------------------------------------------------------- Bookmark folders (imported) and import
// The data model stays a flat list: an imported bookmark has path = ['Google Chrome', 'Is', ...]. On the bar path[0]
// shows as a single folder button; clicking it opens a native menu with its subfolders.
// Scanning other browsers' files (and copying Firefox's database) is cached for a minute: the settings page
// reloads its data on every settings change and must not rescan each time.
let bmSrcCache = null;
function bmSources() {
  if (!bmSrcCache || Date.now() - bmSrcCache.t > 60e3) bmSrcCache = { t: Date.now(), list: bookmarkImport.listSources() };
  return bmSrcCache.list;
}
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
// Skipped if the URL already exists; folder name is the browser name (if it exists, new items are added to it)
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

function showDownloadsMenu() { return showDownloadsPanel(); }
function showDownloadsPanel() { return showInternalPanel(DOWNLOADS_URL, 'İndirilenler', downloadPanels, 740, 580); }
// Centered modal windows for downloads and the task manager. Their renderer exists only while open (no idle RAM).
function showInternalPanel(url, title, panels, preferredWidth, preferredHeight) {
  const owner = W;
  if (!owner || owner.win.isDestroyed()) return;
  const existing = panels.get(owner);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return existing; }
  const bounds = owner.win.getBounds(), work = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(preferredWidth, work.width - 32), height = Math.min(preferredHeight, work.height - 48);
  const x = Math.max(work.x, Math.min(work.x + work.width - width, Math.round(bounds.x + (bounds.width - width) / 2)));
  const y = Math.max(work.y, Math.min(work.y + work.height - height, Math.round(bounds.y + (bounds.height - height) / 2)));
  const panel = new BrowserWindow({
    parent: owner.win, modal: !process.env.MONDIUM_TEST_DISPLAY, skipTaskbar: true, show: false, frame: false, width, height, x, y, minWidth: 360, minHeight: 300,
    title: T(title), icon: path.join(__dirname, 'icon.png'), backgroundColor: effectiveTheme().page || (nativeTheme.shouldUseDarkColors ? '#202124' : '#ffffff'), autoHideMenuBar: true,
    webPreferences: { session: owner.ses, preload: path.join(__dirname, 'page-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  panels.set(owner, panel);
  const navigate = (to) => { if (/^https?:/i.test(to)) inWin(owner, () => newTab(to)); panel.close(); };
  panel.webContents.setWindowOpenHandler(({ url: to }) => { navigate(to); return { action: 'deny' }; });
  const pageUrl = baseOf(url);
  panel.webContents.on('will-navigate', (e, to) => { if (baseOf(to) !== pageUrl) { e.preventDefault(); navigate(to); } });
  // Enable and focus the owner before Windows destroys the modal HWND. Otherwise
  // Windows can briefly activate the previously focused external application.
  const restoreOwner = () => { if (!quitting && owner.win && !owner.win.isDestroyed() && owner.win.isVisible()) { owner.win.setEnabled(true); owner.win.moveTop(); owner.win.focus(); } };
  panel.on('close', restoreOwner);
  panel.once('ready-to-show', () => { if (process.env.MONDIUM_TEST_DISPLAY) panel.showInactive(); else panel.show(); });
  panel.on('closed', () => { panels.delete(owner); restoreOwner(); });
  panel.loadURL(url + '?popup=1');
  return panel;
}

function showTabMenu(arg) {
  const t = getTab(arg.id);
  if (!t) return;
  const idx = tabs.indexOf(t);
  popAt([
    { label: 'Yeni sekme', click: () => openNewTabPrompt(() => newTab('', false, t.id)) },
    { type: 'separator' },
    { label: 'Yenile', enabled: !!t.view, click: () => t.view && t.view.webContents.reload() },
    { label: 'Sekmeyi uyut', enabled: !!t.view && (t.id !== activeId || tabs.length > 1), click: () => sleepTab(t.id) },
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

// ---------------------------------------------------------------- Video: picture-in-picture
// In-page expression that finds the video at the clicked point; otherwise a playing one, then the largest.
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
  // First the clicked frame, then all frames on the page (for embedded players)
  const frames = [frame, ...(wc.mainFrame ? wc.mainFrame.framesInSubtree : [])].filter(Boolean);
  for (const f of frames) {
    try { if (await f.executeJavaScript(code, true)) return; } catch {}
  }
}
function mediaToggle(wc, frame, x, y, what) {
  const code = `(() => { const v = ${findMediaJs(x, y, true)}; if (v) v.${what} = !v.${what}; })()`;
  (frame || wc.mainFrame).executeJavaScript(code, true).catch(() => {});
}

// ---------------------------------------------------------------- Reader mode
// Shows the page's main text in a clean overlay. No extra process or page; runs in an isolated world,
// so the site's own scripts and security rules (CSP) don't interfere. Calling it again closes it.
let READER_JS = null;
function toggleReader(wc) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  if (!READER_JS) READER_JS = localizeSrc(fs.readFileSync(path.join(__dirname, 'reader.js'), 'utf8'));   // read on first use
  wc.executeJavaScriptInIsolatedWorld(1012, [{ code: READER_JS }], true).then((r) => {
    if (r === 'bulunamadi') dialog.showMessageBox(win, { message: 'Bu sayfada okuma modunda gösterilecek bir yazı bulunamadı.' });
  }).catch(() => {});
}

async function saveAs(wc) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), (wc.getTitle() || 'sayfa').replace(/[\\/:*?"<>|]/g, '_') + '.html') });
  if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch(() => {});
}

// ---------------------------------------------------------------- Window
// ---------------------------------------------------------------- Themes
// mode: system/light/dark base. Colored themes paint the toolbar, tab strip and new tab page.
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
  murdum:  { name: 'Mürdüm', mode: 'dark', frame: '#1d1424', toolbar: '#30223b', omni: '#1d1424', accent: '#d7b8f3', page: '#21172a' },
  kum:     { name: 'Kum', mode: 'light', frame: '#e8dcc4', toolbar: '#f7f1e3', omni: '#ffffff', accent: '#8a6a1f', page: '#fbf7ee' },
  nane:    { name: 'Nane', mode: 'light', frame: '#bfe6dd', toolbar: '#ecf8f5', omni: '#ffffff', accent: '#0b7a6b', page: '#f2fbf8' },
  gok:     { name: 'Gökyüzü', mode: 'light', frame: '#bde3f5', toolbar: '#ebf7fd', omni: '#ffffff', accent: '#0a6fa8', page: '#f2faff' },
  limon:   { name: 'Limon', mode: 'light', frame: '#efe59a', toolbar: '#fbf8dc', omni: '#ffffff', accent: '#7a6c00', page: '#fdfbe9' },
  gul:     { name: 'Gül', mode: 'light', frame: '#f5c6c6', toolbar: '#fdeeee', omni: '#ffffff', accent: '#b3262e', page: '#fff6f6' },
  okyanus: { name: 'Okyanus', mode: 'dark', frame: '#0b1f26', toolbar: '#153440', omni: '#0b1f26', accent: '#7fd6e8', page: '#0e262e' },
  civit:   { name: 'Çivit', mode: 'dark', frame: '#15143a', toolbar: '#262560', omni: '#15143a', accent: '#b4b4ff', page: '#1a1944' },
  bordo:   { name: 'Bordo', mode: 'dark', frame: '#230f16', toolbar: '#3a1c26', omni: '#230f16', accent: '#f2a7bd', page: '#2a131b' },
  gunbat:  { name: 'Gün batımı', mode: 'dark', frame: '#26130d', toolbar: '#3f2116', omni: '#26130d', accent: '#ffb087', page: '#2d1810' },
  kahve:   { name: 'Kahve', mode: 'dark', frame: '#1f1712', toolbar: '#33271f', omni: '#1f1712', accent: '#e3bd8f', page: '#251c16' },
  grafit:  { name: 'Grafit', mode: 'dark', frame: '#17191c', toolbar: '#2a2d31', omni: '#17191c', accent: '#b9c4d0', page: '#1c1e21' }
};
const currentTheme = () => THEMES[settings.theme] || THEMES.sistem;
// Pitch black: with the dark theme or a dark system theme, except colored themes
const PITCH = { frame: '#000000', toolbar: '#000000', card: '#0a0a0a', activeTab: '#0a0a0a', omniHover: '#141414', omni: '#0d0d0d', accent: '#a8c7fa', page: '#000000', menu: '#121212', mode: 'dark' };
function effectiveTheme() {
  const t = currentTheme();
  const dark = t.mode === 'dark' || (t.mode === 'system' && nativeTheme.shouldUseDarkColors);
  return settings.pitchBlack && dark && !t.frame ? PITCH : t;
}

function themeColors() {
  const t = effectiveTheme();
  const dark = nativeTheme.shouldUseDarkColors;
  // toolbar: with vertical tabs the window buttons sit on the toolbar, so the color must match it (same as ui.html --toolbar)
  return { frame: t.frame || (dark ? '#1f1f1f' : '#dfe3e7'), toolbar: t.toolbar || (dark ? '#3c3c3c' : '#ffffff'), symbol: dark ? '#e3e3e3' : '#1f1f1f', dark };
}

function applyTheme() {
  const t = currentTheme();
  nativeTheme.themeSource = t.mode;              // pages' light/dark preference follows this too
  forEachWin(() => { paintFrame(); pushState(); });
  broadcastPages();
}
// Color of the window frame and Windows caption buttons
function paintFrame() {
  if (!win) return;
  const c = W && W.incognito ? { frame: INCOGNITO_THEME.frame, toolbar: INCOGNITO_THEME.toolbar, symbol: '#e3e3e3' } : themeColors();
  try { win.setBackgroundColor(c.frame); } catch {}
  if (!isMac && win.setTitleBarOverlay) { try { win.setTitleBarOverlay({ color: settings.verticalTabs ? c.toolbar : c.frame, symbolColor: c.symbol, height: settings.verticalTabs ? TOOLBAR : TAB_STRIP }); } catch {} }
}

// Incognito windows are always dark (like Chrome)
const INCOGNITO_THEME = { frame: '#202124', toolbar: '#35363a', omni: '#202124', accent: '#8ab4f8', page: '#202124', mode: 'dark' };
function themeVars() {
  const t = effectiveTheme();
  return t.frame ? { frame: t.frame, toolbar: t.toolbar, omni: t.omni, accent: t.accent, page: t.page, mode: t.mode, ...(t.menu ? { menu: t.menu } : {}), ...(t.card ? { card: t.card, activeTab: t.activeTab, omniHover: t.omniHover } : {}) } : null;
}

// ---------------------------------------------------------------- Local pages (new tab + welcome)
const pageData = () => ({
  incognito: !!(W && W.incognito),
  clockPosition: settings.newtabClock,
  clockSize: settings.newtabClockSize,
  clockFont: settings.newtabClockFont,
  clockWeight: settings.newtabClockWeight,
  shortcuts: settings.shortcuts.map((s) => ({ title: s.title, url: s.url, icon: s.icon || null })),
  searchUrl: searchUrl(),
  searchName: (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name,
  theme: W && W.incognito ? INCOGNITO_THEME : themeVars(),
  themeKey: settings.theme,
  themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, mode: t.mode, frame: t.frame || null, toolbar: t.toolbar || null, accent: t.accent || null }))
});

function broadcastPages() {
  for (const [owner, panel] of [...downloadPanels, ...taskPanels]) if (!panel.isDestroyed()) inWin(owner, () => panel.webContents.send('page-update', pageData()));
  for (const t of allTabs()) {
    if (!t.view || !isInternal(t.url)) continue;
    inWin(t.w, () => { try { t.view.webContents.send('page-update', pageData()); } catch {} });
  }
}

// Notify the history/downloads page of changes if it is open (throttled)
const notifyTimers = {};
function notifyPages(kind) {
  if (notifyTimers[kind]) return;
  notifyTimers[kind] = setTimeout(() => {
    notifyTimers[kind] = null;
    for (const t of allTabs()) {
      if (!t.view || pageKind(t.url) !== kind) continue;
      inWin(t.w, () => { try { t.view.webContents.send('page-update', { ...pageData(), changed: kind }); } catch {} });
    }
    if (kind === 'downloads') for (const [owner, panel] of downloadPanels) if (!panel.isDestroyed()) inWin(owner, () => panel.webContents.send('page-update', { ...pageData(), changed: kind }));
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
  // Incognito downloads are shown only in incognito windows
  return Promise.all(downloads.filter((d) => !d.incognito || W?.incognito).map(async (d) => {
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
    askDownloadLocation: settings.askDownloadLocation === true,
    newTabPrompt: settings.newTabPrompt === true,
    overlayScrollbar: settings.overlayScrollbar !== false,
    uboError: settings.adblockEngine !== 'hafif' && mainBlockSettled && !uboId,
    theme: settings.theme, themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, mode: t.mode, frame: t.frame || null, accent: t.accent || null })),
    engine: settings.searchEngine, engines: Object.entries(SEARCH_ENGINES).map(([key, x]) => ({ key, name: x.name })),
    bookmarksBar: settings.bookmarksBar, fullUrl: settings.fullUrl, forceDarkPages: settings.forceDarkPages, strictIsolation: settings.strictIsolation, language: settings.language || 'auto',
    clearGoogleOnExit: settings.clearGoogleOnExit, restoreSession: settings.restoreSession,
    keepLogins: settings.keepLogins, newtabClock: settings.newtabClock, newtabClockSize: settings.newtabClockSize, newtabClockFont: settings.newtabClockFont, newtabClockWeight: settings.newtabClockWeight,
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
const CLOCK_POSITIONS = ['top', 'tl', 'tr', 'bl', 'br', 'off'];
const CLOCK_FONT_KEYS = ['system', 'bahnschrift', 'georgia', 'times', 'trebuchet', 'verdana', 'consolas', 'courier', 'script', 'impact'];
const CLOCK_WEIGHTS = [300, 400, 600, 700, 900];
function setNewtabClock({ position, size, font, weight }) {
  if (position !== undefined && !CLOCK_POSITIONS.includes(position)) return false;
  if (font !== undefined && !CLOCK_FONT_KEYS.includes(font)) return false;
  if (weight !== undefined && !CLOCK_WEIGHTS.includes(Number(weight))) return false;
  const px = size === undefined ? undefined : Math.round(Number(size));
  if (px !== undefined && (!Number.isFinite(px) || px < 20 || px > 140)) return false;
  if (position !== undefined) settings.newtabClock = position;
  if (px !== undefined) settings.newtabClockSize = px;
  if (font !== undefined) settings.newtabClockFont = font;
  if (weight !== undefined) settings.newtabClockWeight = Number(weight);
  saveSettings();
  broadcastPages();
  return true;
}
// On language change the UI and Mondium pages are reloaded (translation is applied when a page opens)
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
    case 'newtabClock': return setNewtabClock({ position: value });
    case 'newtabClockSize': return setNewtabClock({ size: value });
    case 'newtabClockFont': return setNewtabClock({ font: value });
    case 'newtabClockWeight': return setNewtabClock({ weight: value });
    case 'hoverZoom': if (typeof value !== 'boolean') return false; setFeature(key, value); return true;
    case 'newTabPrompt': case 'askDownloadLocation': return bool(key);
    case 'overlayScrollbar': if (typeof value !== 'boolean') return false; setSetting(key, value, true); return true;
    case 'sleepTabs': return bool(key);
    case 'tabAudio':
      if (typeof value !== 'boolean') return false;
      settings.tabAudio = value; saveSettings();
      // When turned off, muted tabs are unmuted too (muting is fully disabled)
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
  if (kind === 'security') {
    const target = blockedNavigations.get(e.sender.id);
    if (cmd === 'get') return { ...pageData(), blockedHost: target ? hostOf(target) : null };
    if (cmd === 'security-back') { blockedNavigations.delete(e.sender.id); go(e.sender, newtabUrl()); return { ok: true }; }
    if (cmd === 'security-continue' && target && ow) {
      if (!trustedThreatHosts.has(ow)) trustedThreatHosts.set(ow, new Set());
      trustedThreatHosts.get(ow).add(hostOf(target));
      blockedNavigations.delete(e.sender.id);
      go(e.sender, target);
      return { ok: true };
    }
    return null;
  }
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
      case 'bm-sources': return { sources: bmSources(), groups: bookmarkGroups(), total: settings.bookmarks.length };
      case 'bm-import': {
        const src = bmSources().find((x) => x.id === String(arg || ''));
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
  if (kind === 'tasks') {
    if (cmd === 'task-panel-close') { const panel = ow && taskPanels.get(ow); if (panel?.webContents === e.sender) panel.close(); return { ok: true }; }
    if (cmd === 'tasks-list') return taskManagerData();
    if (cmd === 'tasks-sleep') return { ok: sleepTab(arg) };
    if (cmd === 'tasks-sleep-background') { sleepIdleTabs(true); return { ok: true }; }
    if (cmd === 'tasks-activate') {
      const t = allTabs().find((x) => x.id === Number(arg));
      if (t) { const panel = ow && taskPanels.get(ow); if (panel?.webContents === e.sender) panel.close(); useWin(t.w); activateTab(t.id); win.focus(); }
      return { ok: !!t };
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
    if (cmd === 'download-panel-close') { const panel = ow && downloadPanels.get(ow); if (panel?.webContents === e.sender) panel.close(); return { ok: true }; }
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
    case 'language': if (kind === 'welcome' && ['auto', 'tr', 'en'].includes(arg)) { settings.languageSet = true; setLanguage(arg); } return { ok: true };
    case 'newtab-clock': if (kind === 'newtab' && arg) { setNewtabClock(arg); notifyPages('settings'); } return { ok: true };
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

// Fetches the site's own logo (without third-party services like Google/DuckDuckGo).
// Returns null if none is found; the new tab page shows the first letter instead.
async function fetchSiteIcon(pageUrl) {
  const fetchT = async (u, ms = 7000) => {
    return net.fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': app.userAgentFallback } });
  };
  let base;
  try { base = new URL(pageUrl); } catch { return null; }
  const cands = [];
  try {
    const r = await fetchT(base.href);
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
      base = new URL(r.url || base.href);
      const html = (await readResponseBytes(r, 400000)).toString('utf8');
      for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0];
        const rel = ((tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || tag.match(/\brel\s*=\s*([^\s>]+)/i) || [])[1] || '').toLowerCase();
        if (!rel.includes('icon') || rel.includes('mask-icon')) continue;
        const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1];
        if (!href) continue;
        const size = Number((tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1] || 0);
        // 64-192 px is best; very large icons waste space
        let score = rel.includes('apple-touch') ? 180 : size || (/\.svg(\?|$)/i.test(href) ? 160 : 32);
        if (score > 256) score = 256 - (score - 256) / 10;
        try { cands.push({ href: new URL(href.replace(/&amp;/g, '&'), base).href, score }); } catch {}
      }
    }
  } catch { /* site didn't load; favicon.ico will be tried */ }
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
      const buf = await readResponseBytes(r, 300000);
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
  // A new window opens slightly below-right of the previous one. For tests MONDIUM_TEST_DISPLAY: on that display, without stealing focus.
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
  if (process.platform === 'win32') win.setAppDetails({ appId: 'local.mondium.tarayici', appIconPath: app.isPackaged ? path.join(process.resourcesPath, 'mondium.ico') : path.join(__dirname, 'build', 'icon.ico'), appIconIndex: 0, relaunchDisplayName: 'Mondium', relaunchCommand: app.isPackaged ? '"' + process.execPath + '"' : '"' + process.execPath + '" "' + __dirname + '"' });
  if (win.setMenu) win.setMenu(null);

  ui = w.ui = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'vendor', 'ui-sandbox-preload.js'),
      // The extension icon API is bundled into a sandbox-compatible preload (tools/prepare-security.js).
      sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, session: w.ses
    }
  });
  ui.setBackgroundColor('#00000000');   // so the page shows behind while a menu is open
  ui.webContents.loadFile(path.join(__dirname, 'ui.html'));
  const uw = ui.webContents;
  uw.on('before-input-event', (e, input) => {
    useWin(w);
    const ctrl = isMac ? input.meta : input.control;
    const k = (input.key || '').toLowerCase();
    if (ctrl && !input.shift && (['c', 'v', 'x', 'a', 'z'].includes(k) || (!isMac && k === 'y'))) return;
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
  // Save the session while the last normal window closes (it is then removed from the list)
  on('close', () => { if (!incognito && !quitting && windows.filter((x) => !x.incognito).length === 1) saveSession(true); });
  win.on('closed', () => closedWindow(w));
  if (testDisplay != null) win.showInactive(); else win.show();
  layout();
  return w;
}

// Window closed: close the web contents of its tabs and UI (memory), remove it from the list
function closedWindow(w) {
  if (W === w) saveCtx();
  for (const t of w.tabs) {
    if (t.titleRequest) t.titleRequest.abort();
    if (!t.view) continue;
    byWcId.delete(t.wcId);
    blockedNavigations.delete(t.wcId);
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

// New window (Ctrl+N) and new incognito window (Ctrl+Shift+N): open with the new tab page
function newWindow(incognito) {
  createWindow({ incognito });
  newTab('');
}

// Extension background pages: electron-chrome-extensions adds a 'destroyed' listener per listened event
// (uBO ~15 events). The count is bounded and removed when the page closes; not a leak, just silencing the Node warning.
app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'backgroundPage') wc.setMaxListeners(40); });
app.on('second-instance', (_e, argv) => {
  useWin(lastWin(true) || lastWin());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = urlFromArgs(argv.slice(1));
  if (url) newTab(url);
});
// macOS delivers links and files as events, not as command-line arguments. They can arrive before the first window exists.
let startupOpens = [];
function openFromSystem(url) {
  if (!url) return;
  if (startupOpens) { startupOpens.push(url); return; }
  useWin(lastWin(true) || lastWin());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  newTab(url);
}
app.on('open-url', (e, url) => { e.preventDefault(); if (/^https?:\/\//i.test(url)) openFromSystem(url); });
app.on('open-file', (e, file) => { e.preventDefault(); openFromSystem(urlFromArgs([file])); });
// URL or file passed by the operating system (default browser / "Open with"): an http(s) URL or an existing .html/.pdf/.svg/.webp file
function urlFromArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|pdf|svg|webp)$/i.test(a)) { try { if (fs.statSync(a).isFile()) return pathToFileURL(path.resolve(a)).href; } catch {} }
  }
  return null;
}

app.whenReady().then(async () => {
  // Widevine DRM: downloaded on first run, then updated in the background (does not delay startup)
  if (components && typeof components.whenReady === 'function') {
    const ready = components.whenReady()
      .then(() => console.log('Widevine ready:', JSON.stringify(components.status())))
      .catch((e) => console.warn('Could not load Widevine:', e && e.message));
    await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);
  } else {
    console.warn('This Electron build has no Widevine: DRM videos (Netflix, Exxen...) will not play. Install the castLabs build with "npm install".');
  }
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

  // Thorium: DNS-over-HTTPS (encrypted DNS queries; falls back to normal automatically on networks that don't support it)
  try {
    app.configureHostResolver({
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query']
    });
  } catch (e) { console.warn('Could not configure DoH:', e.message); }

  if (process.platform === 'win32') app.setAppUserModelId('local.mondium.tarayici');   // "Mondium" in the taskbar and notifications
  nativeTheme.themeSource = currentTheme().mode;
  mainSes = ses = session.fromPartition('persist:main');
  setupSession(mainSes);
  if (settings.clearGoogleOnExit) await clearGoogleData();   // the previous session may have crashed
  nativeTheme.on('updated', () => { forEachWin(() => { paintFrame(); pushState(); }); broadcastPages(); });
  // Malicious-domain list: data update only, no browsing data leaves the computer.
  if (app.isPackaged) { setTimeout(() => threatProtection.refresh(), 30000); setInterval(() => threatProtection.refresh(), 12 * 60 * 60 * 1000); }
  createWindow();
  startBlocking();
  setupExtensions();
  const opens = [urlFromArgs(process.argv.slice(1)), ...startupOpens].filter(Boolean);
  startupOpens = null;
  const restored = settings.firstRunDone && restoreSession();
  useWin(windows[0]);
  for (const url of opens) newTab(url);
  if (!opens.length && !restored) newTab(settings.firstRunDone ? '' : WELCOME_URL);
  setInterval(sleepIdleTabs, 60e3);
  setInterval(keepSessionCookies, 15 * 60e3);
});

// On quit: write settings, clear Google data
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
