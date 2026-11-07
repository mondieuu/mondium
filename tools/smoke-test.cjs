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
const server = http.createServer((req, res) => {
  if (req.url === '/headers') lastHeaders = req.headers;
  res.setHeader('Content-Type', req.url === '/headers' ? 'application/json' : 'text/html');
  res.end(req.url === '/headers' ? JSON.stringify(req.headers) : '<!doctype html><title>Smoke</title><h1>Smoke page</h1>');
});

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
    }

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
    if (nt) await shot(nt, 'new-tab-page.png');
    await shot(uiWs, 'ui-strip.png');
    desktopShot('desktop-new-tab.png');
    await val(uiWs, `browserApi.send('navigate', 'mondium://settings'); 1`);
    const st = await findTarget(/settings\.html/, 15000);
    report(!!st && await until(() => val(st, `document.body.innerText.includes('Appearance')`), 8000), 'settings page opens in English');
    await wait(800);
    if (st) await shot(st, 'settings.png');
    desktopShot('desktop-settings.png');

    // Clean exit
    if (mainWs) {
      await val(mainWs, `setTimeout(() => process.mainModule.require('electron').app.quit(), 300); 1`).catch(() => {});
      mainWs.close();   // the process waits at exit while an inspector stays attached
    }
    const clean = await until(() => exited, 20000);
    report(!!clean && !clean.signal && clean.code === 0, 'quits cleanly', clean ? `code ${clean.code}` : 'still running after 20 s');
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
