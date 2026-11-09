'use strict';
// CI only: runs a real update on this system. The packaged Mondium pretends to be version 0.0.1, so it updates itself to the
// latest published release: real download, real checksum, real install, real restart.
// Usage: node tools/update-test.cjs <path to the installed Mondium executable>
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const exe = process.argv[2];
if (!exe) { console.error('Usage: node tools/update-test.cjs <executable>'); process.exit(2); }
// It replaces the installed browser and closes every copy of it, so it must never run on someone's own computer.
if (!process.env.CI) { console.error('This test replaces the installed Mondium. It only runs in CI.'); process.exit(2); }

const CDP_PORT = 9334;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, mid = 1;
const report = (ok, name, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`); };
async function open(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return ws; }
function cdp(ws, method, params) {
  const id = mid++;
  return new Promise((resolve, reject) => {
    const on = (m) => { const d = JSON.parse(m.data); if (d.id !== id) return; ws.removeEventListener('message', on); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function val(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result ? r.result.value : undefined;
}
async function findTarget(re, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const t = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((x) => re.test(x.url)); if (t) return await open(t.webSocketDebuggerUrl); } catch {}
    await wait(500);
  }
  return null;
}
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await wait(500); }
  return null;
}

const output = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
async function latestAsset(version, match) {
  const headers = { 'User-Agent': 'mondium-update-test', Authorization: `Bearer ${process.env.MONDIUM_UPDATE_TEST_TOKEN}` };
  const release = await (await fetch(`https://api.github.com/repos/mondieuu/mondium/releases/tags/v${version}`, { headers })).json();
  return release.assets.find((a) => match.test(a.name));
}
// What is on disk now, read without starting it
async function installedIs(version) {
  if (process.platform === 'win32') return output('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`]).startsWith(version);
  if (process.platform === 'darwin') return output('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.resolve(exe, '..', '..', 'Info.plist')]) === version;
  if (exe.endsWith('.AppImage')) {
    const asset = await latestAsset(version, /\.AppImage$/);
    return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex') === asset.digest;
  }
  return output('dpkg-query', ['-W', '-f=${Version}', 'mondium']) === version;
}
// Browser processes only: the program itself must be Mondium. Matching on the whole command line would also find this
// test, whose arguments contain the same path.
function browserPids() {
  return output('ps', ['-axo', 'pid=,args=']).split('\n').map((line) => {
    const m = /^\s*(\d+)\s+(\S+)(.*)$/.exec(line);
    return m && /(^|\/)[Mm]ondium$/.test(m[2]) && !m[3].includes('--type=') ? Number(m[1]) : null;
  }).filter(Boolean);
}
function running() {
  if (process.platform === 'win32') return /Mondium\.exe/i.test(output('tasklist', ['/FI', 'IMAGENAME eq Mondium.exe']));
  return browserPids().length > 0;
}
function closeAll() {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/IM', 'Mondium.exe'], { stdio: 'ignore' });
    else for (const pid of browserPids()) process.kill(pid);
  } catch {}
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-update-'));
  fs.writeFileSync(path.join(profile, 'ayarlar.json'), JSON.stringify({ firstRunDone: true, keepLoginsSet: true, restoreSession: false, language: 'en', autoUpdateCheck: false }));
  const logFile = path.join(os.tmpdir(), `mondium-update-${process.pid}.log`);
  const env = { ...process.env, MONDIUM_PROFILE: profile, MONDIUM_UPDATE_TEST_VERSION: '0.0.1', ELECTRON_ENABLE_LOGGING: 'file', ELECTRON_LOG_FILE: logFile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`], { env, stdio: 'ignore' });
  let exited = false, exitInfo = '';
  child.on('exit', (code, signal) => { exited = true; exitInfo = `code ${code}, signal ${signal}`; });
  try {
    const ui = await findTarget(/ui\.html/, 120000);
    report(!!ui, 'window opens');
    if (!ui) return;
    await until(() => val(ui, `typeof browserApi === 'object'`), 30000);
    await val(ui, `browserApi.send('navigate', 'mondium://settings'); 1`);
    const st = await findTarget(/settings\.html/, 20000);
    report(!!st, 'settings opens');
    if (!st) return;
    await until(() => val(st, `!!document.querySelector('#hakkinda') && typeof pageApi === 'object'`), 20000);
    const status = () => val(st, `pageApi.call('update-status')`);
    const first = await status();
    report(first.auto === true && first.canInstall === true, 'this install can update itself', `${first.system}, auto ${first.auto}`);

    await val(st, `pageApi.call('update-check').then(() => 1)`);
    const checked = await until(async () => { const s = await status(); return s.status !== 'checking' && s; }, 30000);
    report(checked && checked.status === 'available' && !!checked.latest, 'finds the latest release', checked && `${checked.status} ${checked.latest || ''} ${checked.error || ''}`);
    if (!checked || checked.status !== 'available') return;
    const latest = checked.latest;

    // Cancelling leaves nothing half done
    await val(st, `pageApi.call('update-download').then(() => 1)`);
    let seen = null;
    for (const end = Date.now() + 60000; Date.now() < end && !seen; await wait(30)) {
      const s = await status();
      if (s.status === 'downloading' && s.received > 0) seen = 'moving';
      else if (s.status === 'verifying' || s.status === 'ready' || s.status === 'error') seen = s.status;
    }
    report(!!seen && seen !== 'error', 'download starts', seen);
    if (seen === 'moving') {
      await val(st, `pageApi.call('update-cancel').then(() => 1)`);
      const after = await until(async () => { const s = await status(); return s.status !== 'downloading' && s; }, 20000);
      if (after && after.status === 'available') {
        report(!after.error, 'download can be cancelled');
        await val(st, `pageApi.call('update-download').then(() => 1)`);
      } else console.log('INFO  download finished before the cancel arrived');
    } else console.log('INFO  download finished before it could be cancelled');

    const ready = await until(async () => { const s = await status(); return (s.status === 'ready' || s.status === 'error') && s; }, 8 * 60000);
    report(ready && ready.status === 'ready' && ready.auto === true, 'downloads and verifies the installer', ready && `${ready.status} ${ready.file || ''} auto ${ready.auto} ${ready.error || ''}`);
    if (!ready || ready.status !== 'ready') return;

    // The click on the button; the socket must not keep the process alive
    await val(st, `[...document.querySelectorAll('#hakkinda + .card button')].find((b) => /Restart and update/.test(b.textContent)).click(); 1`);
    st.close(); ui.close();
    report(await until(() => exited, 10 * 60000), 'Mondium closes for the update', exitInfo);
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'ayarlar.json'), 'utf8'));
    report(saved.restoreOnce === true, 'tabs are set to come back after the restart');
    report(await until(() => installedIs(latest), 5 * 60000), 'the new version is installed', latest);
    report(await until(() => running(), 2 * 60000), 'Mondium opens again by itself');
  } finally {
    if (failures) console.log('--- profile files ---\n' + fs.readdirSync(profile).join('\n'));
    closeAll();
    await wait(1500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
}
main().then(() => {
  console.log(failures ? `${failures} check(s) failed.` : 'All checks passed.');
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); closeAll(); process.exit(1); });
