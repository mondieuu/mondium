'use strict';
// Starts a packaged Mondium with a throwaway profile and checks that the essentials work on this operating system.
// Usage: node tools/smoke-test.cjs <path to the Mondium executable> [more arguments for it]
// SMOKE_OUT=<folder> keeps screenshots there. Exit code 0 means every check passed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const [exe, ...extraArgs] = process.argv.slice(2);
if (!exe) { console.error('Usage: node tools/smoke-test.cjs <executable>'); process.exit(2); }
const OUT = process.env.SMOKE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-smoke-out-'));
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-smoke-'));
fs.writeFileSync(path.join(profile, 'ayarlar.json'), JSON.stringify({ firstRunDone: true, keepLoginsSet: true, restoreSession: false, language: 'en', languageSet: true, theme: 'koyu' }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP_PORT = 9333, INSPECT_PORT = 9230;
let failures = 0, mid = 1;
const report = (ok, name, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`); };
const info = (name, detail) => console.log(`INFO  ${name}: ${detail}`);

async function open(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return ws; }
function cdp(ws, method, params) {
  const id = mid++;
  return Promise.race([
    wait(20000).then(() => ({ timeout: method })),
    new Promise((r) => {
      const h = (m) => { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', h); r(d.result || d.error); } };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id, method, params }));
    })
  ]);
}
async function val(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result ? r.result.value : undefined;
}
const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); } catch { return []; } };
async function findTarget(re, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = (await targets()).find((x) => re.test(x.url)); if (t) return open(t.webSocketDebuggerUrl); await wait(200); }
  return null;
}
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await wait(250); }
  return false;
}
async function shot(ws, name) {
  const r = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  if (r && r.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
function desktopShot(name) {
  const file = path.join(OUT, name);
  try {
    if (process.platform === 'darwin') execFileSync('screencapture', ['-x', file]);
    else if (process.platform === 'linux') execFileSync('import', ['-window', 'root', file]);
  } catch (e) { info('desktop screenshot', e.message.split('\n')[0]); }
}

// Local page: lets a check see the request headers the browser really sends.
let lastHeaders = null;
const seen = [];
let cookieProbe = null;
const server = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url === '/cookie-probe') cookieProbe = req.headers.cookie || '';
  if (req.url === '/headers') lastHeaders = req.headers;
  if (req.url === '/reader') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Reader</title><main>${'<p>readersentence plain words for a long enough article, with commas, and more words to read here.</p>'.repeat(30)}</main>`); return; }
  res.setHeader('Content-Type', req.url === '/headers' ? 'application/json' : 'text/html');
  res.end(req.url === '/headers' ? JSON.stringify(req.headers) : '<!doctype html><title>Smoke</title><h1>Smoke page</h1>');
});

// macOS: nothing clickable may sit under the red, yellow and green buttons, whatever the tab layout, and the buttons must work.
async function macWindowButtons({ uiWs, mainWs, st }) {
  const M = (code) => val(mainWs, `(async () => { const E = process.mainModule.require('electron'); const w = E.BaseWindow.getAllWindows().find((x) => !/Gizli/.test(x.getTitle())); ${code} })()`);
  const put = (key, value) => val(st, `pageApi.call('settings-set', ${JSON.stringify({ key, value })}).then(() => 1)`);
  const hits = (x2, y2) => `JSON.stringify([...document.querySelectorAll('button, input, a, .tab, #incog, [role=button]')].filter((el) => {
    const r = el.getBoundingClientRect(), c = getComputedStyle(el);
    return r.width && r.height && c.visibility !== 'hidden' && r.left < ${x2} && r.right > 0 && r.top < ${y2} && r.bottom > 0;
  }).map((el) => el.id || el.className || el.tagName))`;
  info('windows', await M(`return JSON.stringify(E.BaseWindow.getAllWindows().map((x) => [x.getTitle(), x.isVisible(), x.isFullScreenable(), x.isFullScreen()]))`));
  const uis = async () => Promise.all((await targets()).filter((x) => /ui\.html/.test(x.url)).map((x) => open(x.webSocketDebuggerUrl)));
  const check = async (name) => {
    await wait(1200);
    const pos = await M('return w.getWindowButtonPosition()');
    // Three buttons: 54 to 60 px wide depending on the macOS version, about 16 px tall
    const x2 = pos.x + 60, y2 = pos.y + 16;
    const found = [];
    for (const ws of await uis()) { found.push(...JSON.parse(await val(ws, hits(x2, y2)))); ws.close(); }
    report(!found.length, `window buttons clear: ${name}`, found.length ? 'covers ' + found.join(', ') : `buttons at ${pos.x},${pos.y}`);
    desktopShot(`mac-${name}.png`);
  };
  await check('horizontal-tabs');
  await val(uiWs, `browserApi.send('menu-action', { id: 'new-incognito' }); 1`);
  await until(async () => (await targets()).filter((x) => /ui\.html/.test(x.url)).length === 2, 8000);
  await check('horizontal-tabs-incognito');
  await put('verticalTabs', true);
  await check('vertical-tabs-incognito');
  await M(`E.BaseWindow.getAllWindows().filter((x) => /Gizli/.test(x.getTitle())).forEach((x) => x.close()); return 1`);
  await check('vertical-tabs');
  await put('verticalAutoHide', true);
  await check('vertical-tabs-autohide');
  await put('verticalAutoHide', false);
  await put('verticalTabs', false);
  await wait(800);

  // Green button: fullscreen keeps the tabs and drops the gap left for the buttons
  await M('w.setFullScreen(true); return 1');
  if (await until(() => M('return w.isFullScreen()'), 10000)) {
    await wait(1500);
    const gap = await val(uiWs, `getComputedStyle(document.getElementById('strip')).paddingLeft`);
    const seen = await val(uiWs, `document.visibilityState === 'visible' && document.getElementById('strip').getBoundingClientRect().height > 0`);
    const why = await val(uiWs, `JSON.stringify({ fs: state && state.fullscreen, body: document.body.className })`);
    report(seen && gap === '8px', 'green button: fullscreen keeps tabs and toolbar', `tab strip gap ${gap}, ui ${why}`);
    desktopShot('mac-fullscreen.png');
    await M('w.setFullScreen(false); return 1');
    await until(async () => !(await M('return w.isFullScreen()')), 10000);
    await wait(1500);
    report(await val(uiWs, `getComputedStyle(document.getElementById('strip')).paddingLeft`) === '80px', 'green button: leaving fullscreen restores the gap');
  } else info('fullscreen', 'this machine did not enter fullscreen');

  // Yellow button, and zoom
  await M('w.minimize(); return 1');
  const small = await until(() => M('return w.isMinimized()'), 8000);
  await M('w.restore(); return 1');
  const back = await until(async () => !(await M('return w.isMinimized()')), 8000);
  report(!!small && !!back, 'yellow button: minimize and restore');
  await M('w.maximize(); return 1');
  await wait(1200);
  await check('zoomed');
  await M('w.unmaximize(); return 1');
  await wait(800);
}

// Web-security review: the permission bubble and what a page may open, in the real interface.
async function pagePermissions({ uiWs, page, base }) {
  const only = process.env.SMOKE_ONLY;
  if (only !== 'perms' && only !== 'popup') return;
  const allow = `[...document.querySelectorAll('.bubble .bf button')].pop()`;
  if (only === 'perms') {
  await val(page, `window.__asked = Promise.all(Array.from({ length: 50 }, () => Notification.requestPermission())); document.cookie = 'smokecookie=plaintextvalue; max-age=3600'; 1`);
  const asked = await until(() => val(uiWs, '!!prompt'), 8000);
  report(!!asked, 'a site asking for a permission gets a bubble');
  if (!asked) return;
  report(await val(uiWs, `document.activeElement === document.querySelector('.bubble')`), 'the bubble takes the keyboard, not its Allow button');
  report(await val(uiWs, `armBubble(); ${allow}.click(); !!prompt`), 'a click that lands on a fresh bubble is not an answer');
  await wait(650);
  await val(uiWs, `${allow}.click(); 1`);
  await val(page, 'window.__asked');
  await wait(400);
  report(await val(uiWs, '!prompt'), 'a question asked 50 times is one bubble with one answer');
  report(await val(page, 'Notification.permission') === 'granted', 'the answer reaches the page');

  }
  if (only !== 'popup') return;
  // A document the page made (about:blank) is still that page: it cannot open data: as the browser would.
  const before = (await targets()).length;
  const opened = await cdp(page, 'Runtime.evaluate', { userGesture: true, returnByValue: true, expression: `(() => { const w = window.open('about:blank', '_blank', 'width=420,height=420'); if (!w) return 'no popup'; w.open('data:text/html,<title>smokedata</title>smoke'); setTimeout(() => w.close(), 1500); return 'ok'; })()` });
  await wait(1200);
  const dataTab = (await targets()).find((x) => /^data:text\/html/.test(x.url));
  report(!dataTab, 'a popup cannot open a data: address in a tab', `${opened.result && opened.result.value}, ${before} targets before`);
  await wait(800);
  void base;
}

// A second start, as when another program opens a link while Mondium runs, must hand over the link and leave the data alone.
async function secondStart({ env, base }) {
  const session = path.join(profile, 'oturum.json');
  fs.writeFileSync(session, JSON.stringify({ windows: [{ active: 0, tabs: [{ url: base + '/kept' }] }] }));
  const started = Date.now();
  const second = spawn(exe, [base + '/second-start'], { env, stdio: 'ignore' });
  // Watched all the time: the running browser saves its own session a moment later and would hide a bad write.
  let emptied = false;
  const watch = setInterval(() => { try { if (/^\s*null/.test(fs.readFileSync(session, 'utf8'))) emptied = true; } catch {} }, 5);
  const code = await new Promise((r) => { second.on('exit', r); setTimeout(() => { second.kill(); r('still running'); }, 30000); });
  await wait(100);
  clearInterval(watch);
  report(code === 0, 'a second start exits by itself', `code ${code} after ${Date.now() - started} ms`);
  report(!emptied, 'a second start leaves the saved session alone');
  report(!!(await until(() => seen.includes('/second-start'), 10000)), 'its link opens in the running browser');
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, MONDIUM_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--inspect=${INSPECT_PORT}`, ...extraArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = null;
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  const stop = () => { try { child.kill(); } catch {} };
  try {
    const uiWs = await findTarget(/ui\.html/, 90000);
    report(!!uiWs, 'window opens');
    if (!uiWs) return;
    // The target can appear before the page's scripts have run.
    await until(() => val(uiWs, `typeof browserApi === 'object' && typeof state === 'object'`), 30000);
    report(await val(uiWs, 'browserApi.platform') === process.platform, 'UI runs on this platform', process.platform);
    const mainList = await until(async () => (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json())[0], 20000);
    const mainWs = mainList ? await open(mainList.webSocketDebuggerUrl) : null;
    report(!!mainWs, 'main process reachable');

    // uBlock Origin: loads, finishes compiling its lists, and adds the privacy headers.
    const uboUp = await until(() => val(uiWs, '!!(state && state.ubo)'), 120000);
    report(!!uboUp, 'uBlock Origin loads');
    const bg = uboUp && await findTarget(/chrome-extension:\/\/[^/]+\/background\.html/, 20000);
    const ready = bg && await until(() => val(bg, '!!(self.µBlock && self.µBlock.readyToFilter)'), 180000);
    report(!!ready, 'uBlock Origin ready to filter');
    if (bg) await until(() => val(bg, '!!self.__mondiumHeaders'), 20000);
    const readyAt = Date.now();

    // A real page: blocking must reach the network layer, and an allowed request must still pass.
    await val(uiWs, `browserApi.send('navigate', ${JSON.stringify(base + '/page')}); 1`);
    const page = await findTarget(/127\.0\.0\.1:\d+\/page/, 30000);
    report(!!page, 'page loads');
    if (page) {
      const reach = (u) => `fetch(${JSON.stringify(u)}, { mode: 'no-cors', cache: 'no-store' }).then(() => 'reached', () => 'blocked')`;
      // Filters depend on the request type: lists allow fetch() to some ad hosts and block their images and scripts,
      // and uBO answers some ad scripts with a harmless stand-in. So use one tracker per type and read the engine's own error.
      if (bg) await val(bg, `self.__smokeBlocked = []; chrome.webRequest.onErrorOccurred.addListener((d) => { if (d.error === 'net::ERR_BLOCKED_BY_CLIENT') self.__smokeBlocked.push(d.url); }, { urls: ['<all_urls>'] }); 1`);
      const tracker = await until(async () => (await val(page, reach('https://www.google-analytics.com/collect'))) === 'blocked', 30000);
      await val(page, `new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = 'https://ad.doubleclick.net/ddm/smoke'; }).then(() => 1)`);
      const adImage = bg && await until(() => val(bg, `self.__smokeBlocked.some((u) => u.includes('ad.doubleclick.net'))`), 10000);
      const allowed = await val(page, reach('https://example.com/'));
      report(tracker && adImage && allowed === 'reached', 'trackers and ads blocked, normal request allowed', `tracker ${tracker ? 'blocked' : 'reached'}, ad image ${adImage ? 'blocked' : 'reached'}, example.com ${allowed}`);
      await val(page, "fetch('/headers').then((r) => r.text())");
      report(!!lastHeaders && lastHeaders.dnt === '1' && lastHeaders['sec-gpc'] === '1', 'DNT and GPC headers sent', lastHeaders ? `dnt=${lastHeaders.dnt} sec-gpc=${lastHeaders['sec-gpc']}` : 'no request');
      report(!/Electron|Mondium/.test(lastHeaders ? lastHeaders['user-agent'] : 'x'), 'user agent has no app name');
      report(await val(page, `MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') && MediaSource.isTypeSupported('video/webm; codecs="vp9"')`), 'H.264 and VP9 supported');
      report(await val(page, 'typeof PublicKeyCredential') === 'undefined', 'passkeys disabled');
      const drm = await until(() => val(page, `navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: 'SW_SECURE_CRYPTO' }] }]).then(() => true, () => false)`), 40000);
      info('Widevine', drm ? 'available' : 'not available within 40 s (may still be downloading)');
      await pagePermissions({ uiWs, page, base }).catch((e) => report(false, 'permission checks ran', e.message));
    }

    // Modules listed in build.extraResources must all load: the installed package has no other copy of them.
    if (mainWs) {
      for (const name of ['tldts-experimental', 'electron-chrome-extensions', '@ghostery/adblocker-electron', 'adm-zip']) {
        const loaded = await val(mainWs, `(() => { try { return !!process.mainModule.require(${JSON.stringify(name)}); } catch (e) { return e.message.split('\\n')[0]; } })()`);
        report(loaded === true, `module loads: ${name}`, loaded === true ? '' : loaded);
      }
    }
    // The option the title and icon requests use really keeps the session's cookies at home.
    if (mainWs) {
      await val(mainWs, `process.mainModule.require('electron').session.fromPartition('persist:main').fetch(${JSON.stringify(base + '/cookie-probe')}, { credentials: 'omit' }).then((r) => r.text()).then(() => 1)`);
      report(cookieProbe === '', 'browser requests with credentials omitted send no cookies', JSON.stringify(cookieProbe));
    }
    if (process.env.SMOKE_ONLY === 'second') await secondStart({ env, base }).catch((e) => report(false, 'second start checks ran', e.message));

    // Renderer sandbox on Linux: a sandboxed renderer runs under seccomp mode 2.
    if (process.platform === 'linux' && mainWs) {
      const pids = await val(mainWs, `process.mainModule.require('electron').app.getAppMetrics().filter((m) => m.type === 'Tab').map((m) => m.pid)`);
      const modes = (pids || []).map((pid) => { try { return /Seccomp:\s*(\d)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]; } catch { return '?'; } });
      report(modes.length > 0 && modes.every((m) => m === '2'), 'renderers are sandboxed', modes.join(','));
    }

    // New tab page and settings, in English
    await val(uiWs, `browserApi.send('new-tab'); 1`);
    const nt = await findTarget(/newtab\.html/, 15000);
    report(!!nt && await until(() => val(nt, `!!document.getElementById('logo')`), 5000), 'new tab page opens');
    await wait(1500);
    // The hash of the new tab page cannot choose where its search box goes.
    if (nt) report(await val(nt, `typeof initialSearch === 'function' && initialSearch(encodeURIComponent('javascript:alert(1)//')) === '' && data.searchUrl.startsWith('https://')`), 'new tab search address is a web address');
    if (nt) await shot(nt, 'new-tab-page.png');
    await shot(uiWs, 'ui-strip.png');
    desktopShot('desktop-new-tab.png');
    await val(uiWs, `browserApi.send('navigate', 'mondium://settings'); 1`);
    const st = await findTarget(/settings\.html/, 15000);
    report(!!st && await until(() => val(st, `document.body.innerText.includes('Appearance')`), 8000), 'settings page opens in English');
    await wait(800);
    if (st) await shot(st, 'settings.png');
    desktopShot('desktop-settings.png');
    // Clearing site permissions takes effect at once, not after a restart.
    if (st && page) {
      await val(st, `pageApi.call('site-perms').then(() => 1)`);
      const after = await val(page, 'Notification.permission');
      report(after !== 'granted', 'clearing site permissions takes effect at once', after);
    }
    if (st) {
      // The last sections cannot scroll to the top of the page; the left menu must still mark the one that was clicked.
      await val(st, `document.querySelector('nav a[href="#hakkinda"]').click(); 1`);
      await wait(1200);
      report(await val(st, `document.querySelector('nav a.on').getAttribute('href')`) === '#hakkinda', 'left menu marks the picked section');
      report(await val(st, `/Check for updates/.test(document.querySelector('#hakkinda + .card').innerText)`), 'update button is shown');
      await shot(st, 'settings-about.png');
      await val(st, `scrollTo(0, 0); 1`);
      await wait(600);
    }

    if (process.platform === 'darwin' && st && mainWs) await macWindowButtons({ uiWs, mainWs, st });

    // uBlock Origin must stay loaded and keep blocking long after start, not only in the first seconds.
    const later = 45000 - (Date.now() - readyAt);
    if (later > 0) await wait(later);
    const stillLoaded = mainWs && await val(mainWs, `process.mainModule.require('electron').session.fromPartition('persist:main').extensions.getAllExtensions().some((x) => x.name === 'uBlock Origin')`);
    await val(uiWs, `browserApi.send('navigate', ${JSON.stringify(base + '/later')}); 1`);
    const pageLater = await findTarget(/127\.0\.0\.1:\d+\/later/, 20000);
    const blockedLater = pageLater && await until(async () => (await val(pageLater, `fetch('https://www.google-analytics.com/collect', { mode: 'no-cors', cache: 'no-store' }).then(() => 'reached', () => 'blocked')`)) === 'blocked', 10000);
    report(!!stillLoaded && !!blockedLater, 'uBlock Origin still loaded and blocking 45 s after start', `loaded ${!!stillLoaded}, tracker ${blockedLater ? 'blocked' : 'reached'}`);

    // Reader mode keeps the text when the best container is <main>. The page has the sentence 30 times, the reader adds its own copies.
    if (process.env.SMOKE_ONLY === 'reader') await val(uiWs, `browserApi.send('navigate', ${JSON.stringify(base + '/reader')}); 1`);
    const readerPage = process.env.SMOKE_ONLY === 'reader' ? await findTarget(/127\.0\.0\.1:\d+\/reader/, 20000) : null;
    if (readerPage) {
      await until(() => val(readerPage, `document.readyState === 'complete'`), 5000);
      await cdp(readerPage, 'DOM.enable');
      await val(uiWs, `browserApi.send('menu-action', { id: 'reader' }); 1`);
      const copies = await until(async () => { const n = JSON.stringify(await cdp(readerPage, 'DOM.getDocument', { depth: -1, pierce: true })).split('readersentence').length - 1; return n > 30 ? n : false; }, 6000);
      report(!!copies, 'reader mode shows a page whose text sits directly in main', `copies ${copies}`);
      await val(uiWs, `browserApi.send('menu-action', { id: 'reader' }); 1`).catch(() => {});

      // A page going fullscreen is named and says how to leave; the notice goes away by itself.
      const asked = await cdp(readerPage, 'Runtime.evaluate', { userGesture: true, awaitPromise: true, returnByValue: true, expression: `document.documentElement.requestFullscreen().then(() => 'ok', (e) => e.message)` });
      const shown = await until(() => val(uiWs, `document.body.classList.contains('fsnote') && document.getElementById('fsnote').textContent`), 4000);
      report(/127\.0\.0\.1/.test(shown || '') && /Esc/.test(shown || ''), 'a fullscreen page gets a notice', `${asked.result && asked.result.value}: ${shown}`);
      report(!!(await until(() => val(uiWs, `!document.body.classList.contains('fsnote')`), 7000)), 'the fullscreen notice goes away by itself');
      await val(readerPage, 'document.exitFullscreen().then(() => 1, () => 1)');
      await wait(1000);
    }

    // The patched store preload must load from the package and open the store API on the real origin.
    await val(uiWs, `browserApi.send('navigate', 'https://chromewebstore.google.com/'); 1`);
    const storePage = await findTarget(/^https:\/\/chromewebstore\.google\.com\//, 30000);
    const storeApi = storePage && await until(async () => (await val(storePage, `typeof window.electronManagement === 'object' && typeof window.electronWebstore === 'object'`)) || null, 15000);
    report(!!storeApi, 'Web Store API is available on the store origin', `api ${!!storeApi}`);

    // Clean exit. On macOS through the red window button's path: closing the last window quits the app.
    if (mainWs) {
      info('windows at quit', await val(mainWs, `JSON.stringify(process.mainModule.require('electron').BaseWindow.getAllWindows().map((x) => [x.getTitle(), x.isVisible(), x.isFullScreen()]))`));
      const leave = process.platform === 'darwin' ? 'E.BaseWindow.getAllWindows().forEach((w) => w.close())' : 'E.app.quit()';
      await val(mainWs, `setTimeout(() => { const E = process.mainModule.require('electron'); ${leave}; }, 300); 1`).catch(() => {});
      mainWs.close();   // the process waits at exit while an inspector stays attached
    }
    const clean = await until(() => exited, 20000);
    report(!!clean && !clean.signal && clean.code === 0, 'quits cleanly', clean ? `code ${clean.code}` : 'still running after 20 s');

    // Saved cookies: encrypted on disk, so a copied profile or backup does not hand out sign-ins.
    // Not on macOS for now: an ad-hoc signed app would ask for the Keychain after every update.
    const encrypts = process.platform !== 'darwin';
    const cookieFile = ['Network/Cookies', 'Cookies'].map((f) => path.join(profile, 'Partitions', 'main', f)).find((f) => fs.existsSync(f));
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(cookieFile, { readOnly: true });
      const row = db.prepare(`SELECT value, length(encrypted_value) AS sealed FROM cookies WHERE name = 'smokecookie'`).get();
      db.close();
      if (encrypts) report(!!row && row.value === '' && row.sealed > 0, 'cookies are encrypted on disk', row ? `plain ${row.value.length} bytes, sealed ${row.sealed} bytes` : 'cookie not found');
      else info('cookies on disk', row ? `plain ${row.value.length} bytes, sealed ${row.sealed} bytes` : 'cookie not found');
    } catch (e) { report(false, 'cookie store can be read', `${cookieFile}: ${e.message}`); }

    // Fuses of this very program. An AppImage is a wrapper around it, so its fuses cannot be read from outside.
    if (!/\.AppImage$/i.test(exe)) try {
      const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
      const wire = await getCurrentFuseWire(exe.replace(/(\.app)\/Contents\/MacOS\/.*$/, '$1'));
      const off = (name) => wire[FuseV1Options[name]] === 48, on = (name) => wire[FuseV1Options[name]] === 49;   // ASCII 0 and 1
      report(off('RunAsNode') && off('EnableNodeOptionsEnvironmentVariable') && off('GrantFileProtocolExtraPrivileges') && (on('EnableCookieEncryption') === encrypts), 'program fuses are set', `runAsNode ${off('RunAsNode') ? 'off' : 'ON'}, NODE_OPTIONS ${off('EnableNodeOptionsEnvironmentVariable') ? 'off' : 'ON'}, cookie encryption ${on('EnableCookieEncryption') ? 'on' : 'OFF'}`);
    } catch (e) { report(false, 'program fuses are set', e.message); }
  } finally {
    if (failures) console.log('--- application log ---\n' + log.slice(-6000));
    if (!exited) stop();
    server.close();
    await wait(800);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
}
main().then(() => {
  console.log(failures ? `${failures} check(s) failed.` : 'All checks passed.');
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
