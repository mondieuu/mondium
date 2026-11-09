'use strict';
// Checks from the web-security review: each one runs the real code, or the real lines of main.js with the browser parts stubbed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const source = read('main.js');
const pkg = JSON.parse(read('package.json'));
const between = (text, from, to) => {
  const a = text.indexOf(from), b = text.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, `marker not found: ${from} ... ${to}`);
  return text.slice(a, b);
};
const flush = () => new Promise((r) => setImmediate(r));
const tests = [];
const check = (name, fn) => tests.push([name, fn]);
function tempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-hardening-'));
  const done = () => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unsafe cleanup'); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); };
  return Promise.resolve().then(() => fn(dir)).finally(done);
}

// ---------------------------------------------------------------- Race conditions: files are replaced whole
const safeWrite = () => require('../safe-write');
check('atomic write: replaces the whole file and leaves no temp file', () => tempDir(async (dir) => {
  const { writeFileAtomic, writeFileAtomicSync } = safeWrite();
  const file = path.join(dir, 'a.json');
  writeFileAtomicSync(file, 'one');
  assert.equal(fs.readFileSync(file, 'utf8'), 'one');
  await writeFileAtomic(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
}));
check('atomic write: a reader never sees a half-written file', () => tempDir(async (dir) => {
  const { writeFileAtomic, writeFileAtomicSync } = safeWrite();
  const file = path.join(dir, 'a.json');
  const big = (n) => JSON.stringify({ n, fill: 'x'.repeat(4 * 1024 * 1024) });
  writeFileAtomicSync(file, big(0));
  let writing = true;
  const reader = (async () => {
    let reads = 0;
    while (writing) { JSON.parse(await fs.promises.readFile(file, 'utf8')); reads++; }
    return reads;
  })();
  for (let i = 1; i <= 12; i++) await writeFileAtomic(file, big(i));
  writing = false;
  assert((await reader) > 0, 'the reader must have run');
}));
check('atomic write: overlapping writes end with the newest text', () => tempDir(async (dir) => {
  const { writeFileAtomic } = safeWrite();
  const file = path.join(dir, 'a.json');
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, 'text ' + i)));
  assert.equal(fs.readFileSync(file, 'utf8'), 'text 19');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
}));
check('atomic write: an older write never replaces a newer one made at quit', () => tempDir(async (dir) => {
  const { writeFileAtomic, writeFileAtomicSync } = safeWrite();
  const file = path.join(dir, 'a.json');
  const slow = writeFileAtomic(file, 'x'.repeat(8 * 1024 * 1024));
  writeFileAtomicSync(file, 'saved at quit');
  await slow;
  assert.equal(fs.readFileSync(file, 'utf8'), 'saved at quit');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
}));
check('atomic write: a failed write keeps nothing behind and reports the error', () => tempDir(async (dir) => {
  const { writeFileAtomic, writeFileAtomicSync } = safeWrite();
  const target = path.join(dir, 'folder');
  fs.mkdirSync(target);
  assert.throws(() => writeFileAtomicSync(target, 'x'));
  await assert.rejects(writeFileAtomic(target, 'x'));
  assert.deepEqual(fs.readdirSync(dir), ['folder']);
}));
check('atomic write: files are private to the user on macOS and Linux', () => tempDir((dir) => {
  if (process.platform === 'win32') return;
  const file = path.join(dir, 'a.json');
  safeWrite().writeFileAtomicSync(file, 'x');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
}));
check('atomic write: the sweep removes only temp files left by a crash', () => tempDir(async (dir) => {
  const { sweepTempFiles, tempName } = safeWrite();
  const left = tempName(path.join(dir, 'ayarlar.json'), 1);
  fs.writeFileSync(left, 'x');
  fs.writeFileSync(path.join(dir, 'ayarlar.json'), 'keep');
  fs.writeFileSync(path.join(dir, 'other.tmp'), 'keep');
  await sweepTempFiles(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['ayarlar.json', 'other.tmp']);
}));
check('settings, history, session and user scripts are saved through atomic writes', () => {
  assert(!/fs\.writeFileSync\(SETTINGS_FILE/.test(source), 'settings must not be written in place');
  assert(!/fsp\.writeFile\(f, json\(\)\)/.test(source) && !/fs\.writeFileSync\(f, json\(\)\)/.test(source), 'lists must not be written in place');
  assert(/writeFileAtomic/.test(read('user-scripts.js')), 'user scripts must be written atomically');
  assert(/sweepTempFiles\(/.test(source), 'temp files left by a crash must be removed');
});

// ---------------------------------------------------------------- Malicious-site layer
function threatLayer(dir, { base = '', cached = null, fetchImpl } = {}) {
  const assets = path.join(dir, 'vendor', 'ublock', 'assets');
  fs.mkdirSync(path.join(assets, 'ublock'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'thirdparties', 'urlhaus-filter'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'ublock', 'badware.min.txt'), base);
  fs.writeFileSync(path.join(assets, 'thirdparties', 'urlhaus-filter', 'urlhaus-filter-online.txt'), '||bundled.example^');
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  if (cached) fs.writeFileSync(path.join(profile, 'malware-hosts.txt'), cached);
  return require('../threat-protection').createThreatProtection({ root: dir, profile, fetchImpl });
}
check('malicious sites: a trailing dot in the host does not get past the list', () => tempDir((dir) => {
  const threat = threatLayer(dir, { base: '||bad.example^' });
  assert(threat.isBlocked('https://bad.example/'));
  assert(threat.isBlocked('https://bad.example./'));
  assert(threat.isBlocked('https://sub.bad.example./x'));
  assert(!threat.isBlocked('https://good.example./'));
}));
check('malicious sites: only the bundled list may make exceptions, never the downloaded one', () => tempDir(async (dir) => {
  const remote = ['@@||bad.example^', ...Array.from({ length: 101 }, (_, i) => `||new${i}.example^`)].join('\n');
  const threat = threatLayer(dir, { base: '||bad.example^\n||kept.example^\n@@||ok.kept.example^', cached: remote, fetchImpl: async () => new Response(remote) });
  assert(threat.isBlocked('https://bad.example/'), 'cached list must not unblock');
  await threat.refresh();
  assert(threat.isBlocked('https://bad.example/'), 'refreshed list must not unblock');
  assert(threat.isBlocked('https://new1.example/'), 'the downloaded list still adds hosts');
  assert(!threat.isBlocked('https://ok.kept.example/'), 'the bundled list keeps its exceptions');
}));

check('malicious sites: the lists are built at the first web address, not during startup', () => tempDir((dir) => {
  const threat = threatLayer(dir);   // the bundled list is empty when this runs
  assert(!threat.isBlocked('file:///c:/page.html'), 'a local page needs no list');
  fs.writeFileSync(path.join(dir, 'vendor', 'ublock', 'assets', 'ublock', 'badware.min.txt'), '||bad.example^');
  assert(threat.isBlocked('https://bad.example/'), 'the list is read when first needed');
}));
check('malicious sites: rules with a path are skipped, hosts around them are kept', () => tempDir((dir) => {
  const threat = threatLayer(dir, { base: '||path.example/x/y^\n||one.example^\r\n! note / with slash\ntwo.example\n||three.example^$doc' });
  for (const h of ['one', 'two', 'three']) assert(threat.isBlocked(`https://${h}.example/`), h);
  assert(!threat.isBlocked('https://path.example/x/y'));
}));

// ---------------------------------------------------------------- SSRF: requests the browser makes for a page
const netRules = () => require('../net-rules');
check('local addresses are recognized, public ones are not', () => {
  const { isLocalHost } = netRules();
  for (const h of ['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '[::1]', '[fe80::1]', '[fc00::1]', '[fd12::1]', '[::ffff:7f00:1]', 'nas.local', 'router', '']) assert(isLocalHost(h), `local: ${h}`);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', '100.128.0.1', '[2606:4700::1]', '1.1.1.1', 'local.example.com']) assert(!isLocalHost(h), `public: ${h}`);
});
check('a public page cannot aim the browser at local files or the local network', () => {
  const { mayFetchForPage } = netRules();
  const page = 'https://public.example/';
  assert(mayFetchForPage(page, 'https://cdn.example/a.png'));
  assert(mayFetchForPage(page, 'http://cdn.example/a.png'));
  for (const t of ['file:///c:/secret.png', 'file://attacker.example/share/a.ico', 'http://192.168.1.1/a.png', 'http://127.0.0.1/a.png', 'http://2130706433/a.png', 'http://[::1]/a.png', 'http://localhost:8080/a.png', 'ftp://cdn.example/a.png', 'chrome-extension://abc/a.png', 'not a url']) assert(!mayFetchForPage(page, t), t);
  assert(mayFetchForPage('http://192.168.1.10/', 'http://192.168.1.10/icon.png'), 'a page on the local network keeps its own icon');
  assert(mayFetchForPage('http://192.168.1.10/', 'https://cdn.example/a.png'));
  assert(!mayFetchForPage('http://192.168.1.10/', 'file:///c:/secret.png'), 'no page reaches files');
});
check('shortcut icons: a page cannot make the browser read files, shares or local addresses', async () => {
  const fetched = [];
  const icon = Buffer.alloc(200, 1);
  const html = ['file://attacker.example/share/a.ico', 'file:///c:/secret.png', 'http://192.168.1.1/a.png', 'https://blocked.example/a.png', 'https://ok.example/a.png']
    .map((href) => `<link rel="icon" href="${href}">`).join('\n');
  const ctx = {
    URL, AbortSignal, console, Buffer,
    app: { userAgentFallback: 'x' },
    threatProtection: { isBlocked: (u) => u.includes('blocked.example') },
    readResponseBytes: require('../bounded-fetch').readResponseBytes,
    mayFetchForPage: netRules().mayFetchForPage,
    mayFetchAfterLookup: netRules().mayFetchAfterLookup,
    session: { defaultSession: { resolveHost: async () => ({ endpoints: [{ address: '93.184.216.34' }] }) } },
    net: { fetch: async (u) => {
      fetched.push(u);
      if (u === 'https://public.example/') return new Response(html, { headers: { 'content-type': 'text/html' } });
      return new Response(icon, { headers: { 'content-type': 'image/png' } });
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(between(source, 'async function fetchSiteIcon', 'function createWindow(opts'), ctx);
  const result = await ctx.fetchSiteIcon('https://public.example/');
  assert(result && result.startsWith('data:image/png'), 'a normal icon still works');
  assert.deepEqual(fetched, ['https://public.example/', 'https://ok.example/a.png']);
  // A public address that redirects to the local network ends the search there.
  fetched.length = 0;
  ctx.net.fetch = async (u) => {
    fetched.push(u);
    const r = new Response('<title>router</title>', { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(r, 'url', { value: 'http://192.168.1.1/' });
    return r;
  };
  assert.equal(await ctx.fetchSiteIcon('https://public.example/'), null);
  assert.deepEqual(fetched, ['https://public.example/']);
  assert.equal(await ctx.fetchSiteIcon('https://blocked.example/'), null, 'a listed site is not contacted at all');
  assert.deepEqual(fetched, ['https://public.example/']);
});
check('title and icon requests the browser makes by itself carry no cookies', () => {
  assert(/tab\.w\.ses\.fetch\(url, \{ credentials: 'omit', signal: controller\.signal \}\)/.test(between(source, 'async function readTabTitle', 'function newTab(')), 'a tab that was never opened must not act signed in');
  assert(/tab\.w\.ses\.fetch\(url, \{ credentials: 'omit', signal: AbortSignal\.timeout\(4000\) \}\)/.test(between(source, 'async function updateIconColor', 'const buckets = new Map()')), 'an icon request must not act signed in');
});
check('pinned tab colors: a public page cannot aim the icon request at a local address', () => {
  const body = between(source, 'async function updateIconColor', 'const buckets = new Map()');
  assert(/mayFetchAfterLookup\(tab\.w\.ses, tab\.url, url\)/.test(body), 'updateIconColor must check the page and the icon address');
});

// ---------------------------------------------------------------- Open redirect: what a page can make the browser open
check('web pages and the documents they create cannot open local or data addresses as the browser', () => {
  const rules = {};
  vm.createContext(rules);
  vm.runInContext(between(source, 'const webMayOpen', 'function toUrl(input)').replace(/const /g, 'var '), rules);
  for (const opener of ['https://a.example/', 'about:blank', 'blob:https://a.example/x', 'data:text/html,x', '', undefined]) {
    for (const url of ['data:text/html,x', 'file:///c:/x', 'mondium://settings', 'view-source:https://a.example/']) assert(!rules.webMayOpen(opener, url), `${opener} -> ${url}`);
    assert(rules.webMayOpen(opener, 'https://b.example/'), `${opener} may open web pages`);
  }
  assert(rules.webMayOpen('chrome-extension://x/p.html', 'chrome-extension://x/q.html'), 'extension pages open their own pages');
  assert(rules.webMayOpen('file:///c:/page.html', 'file:///c:/other.html'), 'a local file links to local files');
});
check('right-click menu: a link or image on a page gets the same limits as the page', () => {
  const menu = between(source, 'function showContextMenu(wc, p)', "label: 'Bağlantı adresini kopyala'");
  assert(/webMayOpen\(wc\.getURL\(\), p\.linkURL\)/.test(menu), 'open and save of a link must pass the page rule');
  const image = between(source, "if (p.mediaType === 'image' && p.srcURL)", "label: 'Resmi kaydet'");
  assert(/webMayOpen\(wc\.getURL\(\), p\.srcURL\)/.test(image), 'opening an image must pass the page rule');
});
check('new tab page: the address in the hash cannot choose where the search box goes', () => {
  const page = read('newtab.html');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(between(page, 'const initialSearch', '\n').replace('const ', 'var '), ctx);
  assert.equal(ctx.initialSearch(encodeURIComponent('https://www.google.com/search?q=')), 'https://www.google.com/search?q=');
  for (const hash of [encodeURIComponent('javascript:alert(1)//'), encodeURIComponent('file:///c:/x?q='), encodeURIComponent('http://a.example/?q='), encodeURIComponent('data:text/html,x'), '%E0%A4%A', '']) assert.equal(ctx.initialSearch(hash), '', hash);
  const engines = between(source, 'const SEARCH_ENGINES', 'const searchUrl');
  for (const [, url] of engines.matchAll(/url: '([^']+)'/g)) assert(url.startsWith('https://'), `search engines must stay https: ${url}`);
});

// ---------------------------------------------------------------- Path traversal: extension folders
check('an extension version can never select a folder outside its own', () => {
  const { assertExtensionVersion } = require('../secure-crx');
  for (const v of ['1', '1.2', '1.2.3', '1.2.3.4', '0.0.1']) assertExtensionVersion(v);
  for (const v of ['../../x', '..', '1/2', '1\\2', '1.2.3.4.5', '1..2', '.1', '1.', '', 'a', '1.a', 5, null, undefined, '1.2.3.12345678901']) assert.throws(() => assertExtensionVersion(v), /version/i, String(v));
  const store = read('vendor/secure-web-store.js');
  assert(/assertExtensionVersion\(manifest\.version\);\s*const versionedPath/.test(store), 'the installer must check the version before using it in a path');
});

// ---------------------------------------------------------------- User data: what an extension sees through events
const guardLib = require('../extension-guard');
const A32 = 'a'.repeat(32), B32 = 'b'.repeat(32);
function guardedRouter(manifests, eventName) {
  const sent = [];
  const router = {
    onExtensionMessage: async () => null, addListener: () => true,
    listeners: new Map([[eventName, Object.keys(manifests).map((extensionId) => ({ type: 'frame', extensionId }))]]),
    sendEvent: (target, name, ...args) => sent.push([target, name, ...args]),
    broadcastEvent(name, ...args) { this.sendEvent(undefined, name, ...args); }
  };
  guardLib.guardExtensionRouter({ ctx: { router } }, { getExtension: (id) => ({ id, url: `chrome-extension://${id}/`, manifest: manifests[id] }) }, { fromId: () => null });
  return { router, sent };
}
check('extension events: cookie changes reach only extensions allowed on that site', () => {
  const { router, sent } = guardedRouter({ [A32]: { permissions: ['cookies'], host_permissions: ['https://ok.example/*'] }, [B32]: { permissions: ['cookies', '<all_urls>'] } }, 'cookies.onChanged');
  router.broadcastEvent('cookies.onChanged', { cookie: { domain: '.other.example', value: 'secret' } });
  assert.deepEqual(sent.map((s) => s[0]), [B32]);
  sent.length = 0;
  router.broadcastEvent('cookies.onChanged', { cookie: { domain: '.ok.example', value: 'mine' } });
  assert.deepEqual(sent.map((s) => s[0]).sort(), [A32, B32]);
});
check('extension events: tab addresses and titles follow the tabs and host permissions', () => {
  const { router, sent } = guardedRouter({ [A32]: {}, [B32]: { permissions: ['tabs'] } }, 'tabs.onUpdated');
  const tab = { id: 1, url: 'https://site.example/private', title: 'Private', favIconUrl: 'https://site.example/i.png', status: 'complete' };
  router.broadcastEvent('tabs.onUpdated', 1, { url: tab.url, title: tab.title, status: 'complete' }, tab);
  const bare = sent.find((s) => s[0] === A32), full = sent.find((s) => s[0] === B32);
  assert.deepEqual(bare[3], { status: 'complete' });
  assert.equal(bare[4].url, undefined);
  assert.equal(bare[4].title, undefined);
  assert.equal(bare[4].status, 'complete');
  assert.equal(full[3].url, tab.url);
  assert.equal(full[4].url, tab.url);
  sent.length = 0;
  router.broadcastEvent('tabs.onUpdated', 1, { title: 'New title' }, tab);
  assert.deepEqual(sent.map((s) => s[0]), [B32], 'nothing is left to tell an extension without access');
});
check('extension events: new tabs and windows hide addresses from extensions without access', () => {
  const tab = { id: 1, url: 'https://site.example/', title: 'T' };
  const created = guardedRouter({ [A32]: {} }, 'tabs.onCreated');
  created.router.broadcastEvent('tabs.onCreated', tab);
  assert.equal(created.sent[0][2].url, undefined);
  const windows = guardedRouter({ [A32]: {} }, 'windows.onCreated');
  windows.router.broadcastEvent('windows.onCreated', { id: 2, tabs: [tab] });
  assert.equal(windows.sent[0][2].tabs[0].url, undefined);
});
check('extension events: other events and events for one extension pass unchanged', () => {
  const { router, sent } = guardedRouter({ [A32]: {}, [B32]: {} }, 'tabs.onRemoved');
  router.broadcastEvent('tabs.onRemoved', 1, { windowId: 1 });
  assert.deepEqual(sent, [[undefined, 'tabs.onRemoved', 1, { windowId: 1 }]]);
  const one = guardedRouter({ [A32]: { permissions: ['tabs'] }, [B32]: { permissions: ['tabs'] } }, 'tabs.onCreated');
  one.router.sendEvent(A32, 'tabs.onCreated', { id: 1, url: 'https://a.example/' });
  assert.deepEqual(one.sent.map((s) => s[0]), [A32]);
});
check('extension events: the guard refuses a library it cannot filter', () => {
  assert.throws(() => guardLib.guardExtensionRouter({ ctx: { router: { onExtensionMessage() {}, addListener() {} } } }, {}, {}), /library changed/);
  const lib = fs.readFileSync(require.resolve('electron-chrome-extensions'), 'utf8');
  assert(/this\.sendEvent\(void 0, eventName, \.\.\.args\)/.test(lib), 'broadcasts must pass through sendEvent');
  assert(/let eventListeners = listeners\.get\(eventName\)/.test(lib), 'listeners must stay a map of event name to listeners');
});

// ---------------------------------------------------------------- SMS pumping: a page asking again and again
function promptLayer() {
  const ctx = {
    Promise, W: { id: 1 }, win: {}, ui: { webContents: { focus() {} } }, overlayOpen: false, overlayKind: null, htmlFullscreen: false,
    inWin: (_w, f) => f(), closeOverlay() {}, raiseUi() {}, layout() {}, send() {}, withActive() {}
  };
  vm.createContext(ctx);
  vm.runInContext(between(source, 'const prompts = [];', 'function answerPrompt(arg)').replace(/\b(const|let) /g, 'var '), ctx);
  return ctx;
}
check('prompts: the same question asked in a loop is one bubble with one answer', async () => {
  const ctx = promptLayer(), owner = {};
  const answers = Array.from({ length: 200 }, () => ctx.askPrompt({ key: 'https://a.example|notifications' }, owner));
  assert.equal(ctx.prompts.length, 1);
  ctx.settlePrompt(ctx.prompts[0], 'ok');
  assert((await Promise.all(answers)).every((a) => a === 'ok'));
  assert.equal(ctx.prompts.length, 0);
});
check('prompts: a page cannot queue endless different questions', async () => {
  const ctx = promptLayer(), owner = {}, other = {};
  const answers = Array.from({ length: 50 }, (_, i) => ctx.askPrompt({ key: 'scheme' + i }, owner));
  assert.equal(ctx.prompts.length, ctx.MAX_PROMPTS_PER_PAGE);
  assert.equal(await answers[49], 'dismiss');
  ctx.askPrompt({ key: 'scheme0' }, other);
  assert.equal(ctx.prompts.length, ctx.MAX_PROMPTS_PER_PAGE + 1, 'another page is not limited by this one');
  ctx.dismissPromptsOf(owner);
  assert.equal(ctx.prompts.length, 1);
});
check('prompts: a question ends when its tab is closed or put to sleep', () => {
  assert(/on\('destroyed', \(\) => \{[^\n]*dismissPromptsOf\(wc\)/.test(source));
});
check('permission and extension prompts say which question they are', () => {
  assert(/askPrompt\(\{ key: `\$\{origin\}\|\$\{open\.join\(\)\}`/.test(source), 'site permission prompts must be merged by origin and kind');
});

// ---------------------------------------------------------------- Clickjacking: the permission bubble
check('permission bubble: Allow never takes keyboard focus by itself', () => {
  const ui = read('ui.html');
  assert(!/\bok\.focus\(\)/.test(between(ui, 'function drawPrompt()', 'browserApi.onPromptOpen')), 'typing on a page must not land on Allow');
});

// ---------------------------------------------------------------- Permissions and devices
check('clearing site permissions empties the object that decisions read', () => {
  assert(!/settings\.sitePerms = \{\}/.test(source), 'replacing the object leaves the old decisions live until restart');
});
function deviceLayer() {
  const handlers = {};
  const ses = { on: (name, fn) => { handlers[name] = fn; }, setDevicePermissionHandler: (fn) => { handlers.permission = fn; } };
  const ctx = {
    Map, Set, Promise, URL, console,
    settings: { deviceGrants: [] }, saveSettings() {}, winOfWc: () => null, useWin() {}, W: {}, win: {}, ui: { webContents: { focus() {} } },
    overlayOpen: false, overlayKind: null, raiseUi() {}, layout() {}, send() {}, closeOverlay() {}, inWin: (_w, f) => f(), hostOf: (u) => new URL(u).hostname,
    originOf: (u) => new URL(u).origin, webContents: { fromFrame: () => null }, activeTab: () => null, dialog: {}
  };
  vm.createContext(ctx);
  vm.runInContext(between(source, 'const sessionDeviceIds', '// Web Bluetooth selection comes through webContents'), ctx);
  const choose = async (site, id) => {
    let picked;
    handlers['select-hid-device']({ preventDefault() {} }, { frame: { url: site + '/' }, deviceList: [{ deviceId: id, vendorId: 1, productId: 2, name: 'Pad' }] }, (r) => { picked = r; });
    ctx.finishChooser(id);
    await flush();
    assert.equal(picked, id);
  };
  const allowed = (site, id) => handlers.permission({ deviceType: 'hid', origin: site, device: { deviceId: id, vendorId: 1, productId: 2 } });
  return { ctx, ses, choose, allowed };
}
check('devices: a device chosen for one site is not open to other sites', async () => {
  const { ctx, ses, choose, allowed } = deviceLayer();
  ctx.setupDevices(ses);
  await choose('https://a.example', 'd1');
  assert(allowed('https://a.example', 'd1'));
  assert(!allowed('https://b.example', 'd1'));
});
check('devices: incognito choices are not saved, and saved grants do not apply there', async () => {
  const { ctx, ses, choose, allowed } = deviceLayer();
  ctx.setupDevices(ses, true);
  await choose('https://a.example', 'd1');
  assert.equal(ctx.settings.deviceGrants.length, 0, 'incognito must leave no record');
  assert(allowed('https://a.example', 'd1'), 'allowed for the rest of this incognito session');
  ctx.settings.deviceGrants.push({ type: 'hid', origin: 'https://c.example', vendorId: 1, productId: 2, serialNumber: '' });
  assert(!allowed('https://c.example', 'd2'), 'a normal window grant does not reach incognito');
  assert(/incognitoDeviceIds\.clear\(\)/.test(source), 'choices end with the incognito session');
});

// ---------------------------------------------------------------- Open database: what is left readable on disk
check('package: cookies are encrypted, and the program cannot be used as a plain Node.js', () => {
  const fuses = pkg.build.electronFuses;
  assert.equal(fuses.enableCookieEncryption, true);
  assert.equal(fuses.runAsNode, false);
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(fuses.grantFileProtocolExtraPrivileges, false);
  assert(/enableCookieEncryption=false/.test(pkg.scripts['dist:mac']), 'an ad-hoc signed Mac app would ask for the Keychain after every update');
  assert(!/enableCookieEncryption/.test(pkg.scripts['dist:win'] + pkg.scripts['dist:linux']));
  const dev = read('tools/dev.js');
  for (const name of ['EnableCookieEncryption', 'RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'GrantFileProtocolExtraPrivileges']) assert(dev.includes(`FuseV1Options.${name}`), `development must match the build: ${name}`);
});

// ---------------------------------------------------------------- Source maps and stray files
check('package: new modules are shipped, source maps are not', () => {
  for (const file of ['safe-write.js', 'net-rules.js']) assert(pkg.build.files.includes(file), `${file} must be packaged`);
  assert(pkg.build.files.includes('!**/*.map'), 'no source maps in the archive');
  const modules = pkg.build.extraResources[0].filter;
  assert(modules.includes('!**/*.map'), 'no source maps in the extra modules');
  assert(modules.includes('!**/*.d.ts') && !modules.some((m) => m.startsWith('@types/')), 'no type definitions: nothing reads them at run time');
  assert(/!\*\*\/\*\.map/.test(read('tools/sync-package-deps.js')) && /@types\//.test(read('tools/sync-package-deps.js')), 'the list generator must keep these rules');
  for (const entry of pkg.build.files) assert(!/^\.git|\.env|\*\*\/\*$/.test(entry) || entry === 'node_modules/**/*' || entry === 'vendor/**/*', `the file list stays an allowlist: ${entry}`);
});

// ---------------------------------------------------------------- Remaining gaps
check('package: the license and attribution ship with the program', () => {
  for (const file of ['LICENSE', 'NOTICE.md']) assert(pkg.build.files.includes(file), file);
});
check('a name that resolves to a local address is refused for a public page', async () => {
  const { mayFetchAfterLookup } = netRules();
  const answers = { 'rebind.example': ['192.168.1.1'], 'mapped.example': ['::ffff:127.0.0.1'], 'six.example': ['fe80::1'], 'ok.example': ['93.184.216.34', '2606:2800::1'] };
  const lookups = [];
  const ses = { resolveHost: async (h) => { lookups.push(h); if (!answers[h]) throw new Error('no name'); return { endpoints: answers[h].map((address) => ({ address })) }; } };
  const page = 'https://public.example/';
  for (const h of ['rebind', 'mapped', 'six', 'missing']) assert.equal(await mayFetchAfterLookup(ses, page, `https://${h}.example/a.png`), false, h);
  assert.equal(await mayFetchAfterLookup(ses, page, 'https://ok.example/a.png'), true);
  lookups.length = 0;
  assert.equal(await mayFetchAfterLookup(ses, 'http://192.168.1.10/', 'http://nas.example/a.png'), true, 'a local page needs no lookup');
  assert.equal(await mayFetchAfterLookup(ses, page, 'https://8.8.8.8/a.png'), true, 'an address needs no lookup');
  assert.equal(await mayFetchAfterLookup(ses, page, 'file:///c:/a.png'), false);
  assert.deepEqual(lookups, []);
});
check('icon requests look up the name before connecting', () => {
  assert(/mayFetchAfterLookup\(session\.defaultSession, start, /.test(between(source, 'async function fetchSiteIcon', 'function createWindow(opts')));
  assert(/mayFetchAfterLookup\(tab\.w\.ses, tab\.url, url\)/.test(between(source, 'async function updateIconColor', 'const buckets = new Map()')));
});
check('history does not replay a public page\'s icon address that points at the local network', () => {
  assert(/mayFetchForPage\([^)]*\.url, [^)]*\.favicon\)/.test(between(source, 'function historyList', 'function ')) || /mayFetchForPage\(h\.url, h\.favicon\)/.test(source));
});
check('fullscreen pages get a notice saying how to leave', () => {
  assert(/on\('enter-html-full-screen', \(\) => \{[^\n]*showFullscreenNotice\(/.test(source));
  const ui = read('ui.html');
  assert(/id="fsnote"/.test(ui) && /fsnote/.test(between(ui, 'function render(s)', '\n}')));
  const i18n = read('i18n.js');
  assert(/tam ekran/.test(i18n), 'the notice needs its English text');
});
check('volume boost leaves no recognizable mark on the page', () => {
  assert(!/mondium/i.test(read('volume.js').replace(/^\/\/.*$/gm, '')), 'no product name in code that runs in the page');
  assert(/KEY_NAME/.test(between(source, 'function applyVolume', "wc.executeJavaScriptInIsolatedWorld(1013")));
});
check('muting a tab with the volume slider stays muted', () => {
  assert(!/volume \|\| 100/.test(source), '0 is a volume, not a missing value');
});
check('a new install keeps the language it was given', () => {
  assert(/case 'welcome-done': \{\s*settings\.firstRunDone = true;\s*settings\.languageSet = true;/.test(source));
});
check('reader mode keeps the content when the best container is main or body', () => {
  const reader = read('reader.js');
  assert(/!KEEP\.has\(el\.tagName\) && el !== root/.test(reader), 'the root must not be emptied');
  assert(/if \(KEEP\.has\(root\.tagName\)\) return root;/.test(reader), 'an unknown root becomes a plain container');
});
check('a failed .deb update does not leave the tabs set to come back', () => {
  assert(/installDeb\(st\.file\)\) \{[^}]*restoreOnce = false/.test(read('updater.js')));
});
check('clearing by time range leaves localStorage alone, as the note says', () => {
  const data = read('site-data.js');
  assert(/storageTypes: range === 'all' \? STORAGE_TYPES : RANGE_STORAGE_TYPES/.test(data));
  assert(/RANGE_STORAGE_TYPES = STORAGE_TYPES\.replace\('local_storage,', ''\)/.test(data));
});
check('light engine: a refresh with most lists unreachable keeps the working engine', async () => {
  const written = [];
  const ctx = {
    fsp: { writeFile: async (...a) => written.push(a), rm: async () => {} }, engineCache: () => 'cache', oldEngineCache: () => 'old', CONFIG: { filterLists: new Array(12).fill('x') }, safeFetch() {},
    listFailures: 0, ElectronBlockerLazy: () => ({ fromLists: async () => { ctx.listFailures = 7; return { serialize: () => 'almost empty' }; } })
  };
  vm.createContext(ctx);
  vm.runInContext(between(source, 'async function buildBlocker', 'async function loadBlocker'), ctx);
  await assert.rejects(ctx.buildBlocker(), /unreachable/);
  assert.equal(written.length, 0);
  ctx.ElectronBlockerLazy = () => ({ fromLists: async () => { ctx.listFailures = 1; return { serialize: () => 'fine' }; } });
  await ctx.buildBlocker();
  assert.equal(written.length, 1, 'one dead list does not stop updates');
});

// ---------------------------------------------------------------- Memory defaults
check('memory: saving is on and tabs sleep after 5 minutes, also once for existing installs', () => {
  const defaults = between(source, 'const DEFAULTS', 'const SLEEP_CHOICES');
  assert(/memorySaver: true/.test(defaults));
  assert(/sleepMinutes: 5\b/.test(defaults));
  assert(/if \(!settings\.memoryDefaultsSet\) \{ settings\.memorySaver = true; if \(settings\.sleepMinutes === 10\) settings\.sleepMinutes = 5; settings\.memoryDefaultsSet = true; saveSettings\(true\); \}/.test(source), 'only the old default moves: a chosen 30 or 60 minutes or sleeping turned off stays');
  assert(source.indexOf('settings.memoryDefaultsSet') < source.indexOf("if (settings.memorySaver) cl.appendSwitch"), 'the switch reads the setting after the move');
  assert(/settings\.sleepTabs = false; settings\.sleepMinutes = 5;/.test(source), 'an unknown choice falls back to the default');
});

// ---------------------------------------------------------------- Page privacy
check('hover zoom follows the page referrer policy', () => {
  assert(!/referrerPolicy/.test(read('hoverzoom.js')), 'a preview must not send the full page address when the page chose not to');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok    ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e.message || e).split('\n')[0]}`); }
  }
  console.log(failed ? `${failed} of ${tests.length} hardening checks failed.` : `PASS: all ${tests.length} hardening checks.`);
  process.exit(failed ? 1 : 0);
})();
