'use strict';
// Updates from the project's GitHub releases. The user decides: a check only shows that a new version exists,
// nothing is downloaded or installed until they ask for it.
//
// Requests use a private in-memory session, so GitHub sees no cookies, sign-ins or extensions from the user's profile.
// Only the exact installer name for this system is accepted, only from the project's release URL, and only if its
// size and SHA-256 match what the GitHub API lists for that release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { spawn, execFile } = require('child_process');
const { readResponseBytes } = require('./bounded-fetch');

const REPO = 'mondieuu/mondium';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/`;
const MAX_INSTALLER = 700 * 1024 * 1024;
const CHECK_EVERY = 24 * 60 * 60 * 1000;
const STALL_LIMIT = 60000;

const parseVersion = (v) => { const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function assetName(type, version, arch) {
  switch (type) {
    case 'exe': return `Mondium-Setup-${version}.exe`;
    case 'dmg': return `Mondium-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`;
    case 'deb': return `Mondium-${version}-linux-amd64.deb`;
    case 'appimage': return `Mondium-${version}-linux-x86_64.AppImage`;
    default: return null;
  }
}

// How this copy was installed decides how it can be updated.
// auto = Mondium replaces itself; otherwise the installer is saved to Downloads and opened for the user.
function detectInstall({ platform, arch, env, execPath, isPackaged, exists, writable }) {
  if (!isPackaged) return { type: null, auto: false, system: 'Geliştirme sürümü', how: 'Bu kopya kaynak koddan çalışıyor. Yeni sürüm GitHub sayfasından kurulur.' };
  if (platform === 'win32') {
    const installed = exists(path.join(path.dirname(execPath), 'Uninstall Mondium.exe'));
    return installed
      ? { type: 'exe', auto: true, system: 'Windows 64-bit', how: 'Kurulum dosyası indirilir. Yeniden başlatınca Mondium kapanır, güncellenir ve kendiliğinden açılır.' }
      : { type: 'exe', auto: false, system: 'Windows 64-bit', how: 'Bu kopya kurulu değil. Kurulum dosyası İndirilenler klasörüne iner, açıp kurabilirsiniz.' };
  }
  if (platform === 'darwin') {
    const system = arch === 'arm64' ? 'macOS Apple Silicon' : 'macOS Intel';
    const bundle = path.resolve(execPath, '..', '..', '..');
    const parent = path.dirname(bundle);
    const movable = bundle.endsWith('.app') && !bundle.startsWith('/Volumes/') && !bundle.includes('/AppTranslocation/') && writable(parent);
    return movable
      ? { type: 'dmg', auto: true, system, bundle, how: 'Disk görüntüsü indirilir. Yeniden başlatınca uygulama yenisiyle değiştirilir ve kendiliğinden açılır.' }
      : { type: 'dmg', auto: false, system, how: 'Uygulama değiştirilemiyor (disk görüntüsünden ya da yazılamayan bir klasörden çalışıyor). Disk görüntüsü İndirilenler klasörüne iner, Mondium\'u Uygulamalar klasörüne sürükleyin.' };
  }
  if (platform === 'linux') {
    if (env.APPIMAGE) {
      return writable(path.dirname(env.APPIMAGE))
        ? { type: 'appimage', auto: true, system: 'Linux AppImage', file: env.APPIMAGE, how: 'Yeni AppImage indirilir. Yeniden başlatınca eski dosyanın yerini alır ve kendiliğinden açılır.' }
        : { type: 'appimage', auto: false, system: 'Linux AppImage', how: 'AppImage dosyasının klasörüne yazılamıyor. Yeni dosya İndirilenler klasörüne iner.' };
    }
    if (execPath.startsWith('/opt/Mondium/') && exists('/usr/bin/dpkg')) {
      return { type: 'deb', auto: true, system: 'Linux .deb', how: 'Paket indirilir. Kurarken sistem parolanız sorulur, sonra Mondium yeniden açılır.' };
    }
    return { type: null, auto: false, system: 'Linux', how: 'Bu kurulum türü kendini güncelleyemiyor. Yeni sürüm GitHub sayfasından kurulur.' };
  }
  return { type: null, auto: false, system: platform, how: 'Yeni sürüm GitHub sayfasından kurulur.' };
}

// Accepts only the expected file from the expected release. Returns null when the release has no such file.
function pickAsset(release, type, arch) {
  const version = String(release && release.tag_name || '').replace(/^v/, '');
  const name = assetName(type, version, arch);
  if (!name || !parseVersion(version) || !Array.isArray(release.assets)) return null;
  const asset = release.assets.find((a) => a && a.name === name);
  if (!asset || asset.browser_download_url !== `${RELEASES_URL}download/v${version}/${name}`) return null;
  const digest = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest || ''));
  if (!digest || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_INSTALLER) return null;
  return { name, url: asset.browser_download_url, sha256: digest[1], size: asset.size };
}

const isGithubHost = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'github.com' || x.hostname.endsWith('.githubusercontent.com')); } catch { return false; } };

class UpdateError extends Error {}
const failure = (message) => new UpdateError(message);
const run = (cmd, args, ms = 180000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

// Waits for the running browser to exit, so the single instance lock is free and its files are no longer in use.
const WAIT_FOR_EXIT = 'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.5; i=$((i+1)); done';
const SWAP_MAC_APP = `${WAIT_FOR_EXIT}
bak="$2.old-$1"
if mv "$2" "$bak"; then
  if mv "$3" "$2"; then rm -rf "$bak"; else mv "$bak" "$2"; rm -rf "$3"; fi
fi
exec /usr/bin/open "$2"`;
const SWAP_APPIMAGE = `${WAIT_FOR_EXIT}
mv -f "$3" "$2"
exec "$2"`;

function createUpdater({ app, session, shell, getSettings, save, onChange, confirmRestart }) {
  const current = process.env.MONDIUM_UPDATE_TEST_VERSION || app.getVersion();
  const updateDir = path.join(app.getPath('userData'), 'guncelleme');
  // app.isPackaged is also true for the renamed Mondium.exe that tools/dev.js starts; only a real build runs from app.asar.
  const isBuild = app.isPackaged && __dirname.includes('app.asar');
  const install = detectInstall({
    platform: process.platform, arch: process.arch, env: process.env, execPath: process.execPath, isPackaged: isBuild,
    exists: (p) => fs.existsSync(p),
    writable: (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } }
  });
  const st = { status: 'idle', latest: null, notesUrl: null, received: 0, total: 0, error: null, file: null, auto: install.auto, how: install.how };
  let controller = null, pending = null, netSession = null, restartAsked = false;

  const changed = () => { try { onChange(); } catch {} };
  const set = (patch) => { Object.assign(st, patch); changed(); };
  const newerKnown = () => !!st.latest && isNewer(st.latest, current);

  function network() {
    if (!netSession) netSession = session.fromPartition('mondium-guncelleme');
    return netSession;
  }
  function request(url, signal, accept) {
    const headers = { 'User-Agent': `Mondium/${app.getVersion()}`, Accept: accept };
    // Only the update test in CI sets this, because shared runner addresses hit GitHub's anonymous rate limit.
    if (process.env.MONDIUM_UPDATE_TEST_TOKEN && url === API_URL) headers.Authorization = `Bearer ${process.env.MONDIUM_UPDATE_TEST_TOKEN}`;
    return network().fetch(url, { credentials: 'omit', cache: 'no-store', signal, headers });
  }

  async function fetchRelease() {
    let res;
    try { res = await request(API_URL, AbortSignal.timeout(20000), 'application/vnd.github+json'); }
    catch { throw failure('GitHub\'a bağlanılamadı. İnternet bağlantınızı denetleyin.'); }
    if (res.status === 403 || res.status === 429) throw failure('GitHub şu an çok fazla istek aldığını bildiriyor. Biraz sonra yeniden deneyin.');
    if (!res.ok) throw failure('GitHub\'dan sürüm bilgisi alınamadı.');
    let release;
    try { release = JSON.parse((await readResponseBytes(res, 5 * 1024 * 1024)).toString('utf8')); }
    catch { throw failure('GitHub\'dan sürüm bilgisi alınamadı.'); }
    const version = String(release && release.tag_name || '').replace(/^v/, '');
    if (!parseVersion(version) || release.draft || release.prerelease) throw failure('GitHub\'dan sürüm bilgisi alınamadı.');
    return { release, version };
  }
  function remember(version) {
    const s = getSettings();
    s.updateCheckedAt = Date.now();
    s.updateKnown = isNewer(version, current) ? version : '';
    save();
  }

  async function check({ silent = false } = {}) {
    if (['checking', 'downloading', 'verifying', 'installing', 'ready'].includes(st.status)) return;
    if (!silent) set({ status: 'checking', error: null });
    try {
      const { version } = await fetchRelease();
      remember(version);
      const newer = isNewer(version, current);
      set({ status: newer ? 'available' : 'current', latest: version, notesUrl: `${RELEASES_URL}tag/v${version}`, error: null });
    } catch (err) {
      if (silent) return;   // An automatic check stays quiet: nothing to report and it runs again later
      set({ status: newerKnown() ? 'available' : 'error', error: err instanceof UpdateError ? err.message : 'Güncelleme denetlenemedi.' });
    }
  }

  async function saveTo(asset, target, signal) {
    const part = target + '.part';
    const res = await request(asset.url, signal, 'application/octet-stream');
    if (!res.ok || !res.body || !isGithubHost(res.url || asset.url)) throw failure('Güncelleme indirilemedi.');
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part, { mode: 0o600 });
    let outError = null;
    out.on('error', (e) => { outError = e; });
    const reader = res.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (outError) throw outError;
        received += value.byteLength;
        if (received > asset.size) throw failure('İndirilen dosya doğrulanamadı, kurulmadı.');
        hash.update(value);
        if (!out.write(value)) await once(out, 'drain');
        st.received = received;
        st.lastChunk = Date.now();
      }
      if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw failure('İndirilen dosya doğrulanamadı, kurulmadı.');
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      fs.rmSync(target, { force: true });
      fs.renameSync(part, target);
    } catch (err) {
      out.destroy();
      fs.promises.rm(part, { force: true }).catch(() => {});
      throw err;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  // macOS: the new app is copied next to the current one now, so the swap at restart is only two renames.
  async function prepareMac(file, version) {
    const mount = path.join(updateDir, 'mnt');
    const stage = path.join(path.dirname(install.bundle), `.Mondium-new-${process.pid}.app`);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(mount, { recursive: true });
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]);
    try { await run('/usr/bin/ditto', [path.join(mount, 'Mondium.app'), stage]); }
    finally { await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {}); }
    try {
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage]);
      const plist = (p, key) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(p, 'Contents', 'Info.plist')]).then((s) => s.trim());
      if (await plist(stage, 'CFBundleShortVersionString') !== version) throw new Error('version');
      if (await plist(stage, 'CFBundleIdentifier') !== await plist(install.bundle, 'CFBundleIdentifier')) throw new Error('identifier');
    } catch (err) { fs.rmSync(stage, { recursive: true, force: true }); throw err; }
    return stage;
  }
  async function prepareAppImage(file) {
    const stage = `${install.file}.new-${process.pid}`;
    fs.copyFileSync(file, stage);
    fs.chmodSync(stage, 0o755);
    return stage;
  }

  async function download() {
    if (['checking', 'downloading', 'verifying', 'installing', 'ready'].includes(st.status)) return;
    if (!install.type) return;
    set({ status: 'checking', error: null, received: 0, total: 0 });
    controller = new AbortController();
    const { signal } = controller;
    let stall = null;
    try {
      const { release, version } = await fetchRelease();
      remember(version);
      if (!isNewer(version, current)) { set({ status: 'current', latest: version }); return; }
      const asset = pickAsset(release, install.type, process.arch);
      if (!asset) throw failure('Bu sürümde sisteminize uygun kurulum dosyası bulunamadı.');
      const dir = install.auto ? updateDir : app.getPath('downloads');
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, asset.name);
      set({ status: 'downloading', latest: version, notesUrl: `${RELEASES_URL}tag/v${version}`, total: asset.size, received: 0, lastChunk: Date.now() });
      stall = setInterval(() => { if (Date.now() - st.lastChunk > STALL_LIMIT) controller.abort(); }, 5000);
      await saveTo(asset, target, signal);
      clearInterval(stall); stall = null;
      set({ status: 'verifying' });
      let stage = null, auto = install.auto, file = target;
      try {
        if (auto && install.type === 'dmg') stage = await prepareMac(target, version);
        if (auto && install.type === 'appimage') stage = await prepareAppImage(target);
      } catch {
        // The installer is fine but the copy cannot be swapped automatically: hand it to the user.
        auto = false;
        file = path.join(app.getPath('downloads'), asset.name);
        fs.copyFileSync(target, file);
      }
      st.stage = stage;
      set({ status: 'ready', file, auto, how: auto ? install.how : 'Otomatik kurulum yapılamadı. Kurulum dosyasını açıp kendiniz kurabilirsiniz.' });
    } catch (err) {
      const cancelled = signal.aborted && !(err instanceof UpdateError) && st.status !== 'error' && st.cancelled;
      if (cancelled) { set({ status: 'available', received: 0, cancelled: false, error: null }); return; }
      set({ status: newerKnown() ? 'available' : 'error', received: 0, error: err instanceof UpdateError ? err.message : 'Güncelleme indirilemedi. Yeniden deneyin.' });
    } finally {
      if (stall) clearInterval(stall);
      controller = null;
    }
  }
  function cancel() {
    if (st.status === 'downloading' && controller) { st.cancelled = true; controller.abort(); }
  }

  async function installDeb(file) {
    set({ status: 'installing', error: null });
    try {
      // pkexec shows the system's own password dialog
      await run('/usr/bin/pkexec', ['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', file], 10 * 60 * 1000);
      return true;
    } catch (err) {
      const dismissed = err && err.code === 126;
      if (!dismissed) shell.openPath(file);
      set({ status: 'ready', error: dismissed ? 'Parola girilmediği için kurulmadı.' : 'Paket otomatik kurulamadı. Dosyayı sistemin yazılım kurucusunda açtım.' });
      return false;
    }
  }

  async function apply() {
    if (st.status !== 'ready' || !st.file || restartAsked) return;
    if (!st.auto) { const err = await shell.openPath(st.file); if (err) shell.showItemInFolder(st.file); return; }
    restartAsked = true;
    try {
      if (!await confirmRestart()) return;
      if (install.type === 'exe') {
        pending = { cmd: st.file, args: ['/S', '--force-run', '--updated'] };
      } else if (install.type === 'dmg') {
        pending = { cmd: '/bin/sh', args: ['-c', SWAP_MAC_APP, 'mondium-update', String(process.pid), install.bundle, st.stage] };
      } else if (install.type === 'appimage') {
        const env = { ...process.env };
        const appDir = env.APPDIR;
        for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[k];
        if (appDir && env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH.split(':').filter((p) => p && !p.startsWith(appDir)).join(':');
        pending = { cmd: '/bin/sh', args: ['-c', SWAP_APPIMAGE, 'mondium-update', String(process.pid), install.file, st.stage], env, cwd: path.dirname(install.file) };
      } else if (install.type === 'deb') {
        if (process.env.MONDIUM_UPDATE_TRACE) require('fs').appendFileSync(process.env.MONDIUM_UPDATE_TRACE, `${new Date().toISOString()} [${process.pid}] apt-get start
`);
        const __ok = await installDeb(st.file);
        if (process.env.MONDIUM_UPDATE_TRACE) require('fs').appendFileSync(process.env.MONDIUM_UPDATE_TRACE, `${new Date().toISOString()} [${process.pid}] apt-get done ok=${__ok}
`);
        if (!__ok) return;
        const __r = app.relaunch();
        if (process.env.MONDIUM_UPDATE_TRACE) require('fs').appendFileSync(process.env.MONDIUM_UPDATE_TRACE, `${new Date().toISOString()} [${process.pid}] relaunch returned ${__r}
`);
      }
      app.quit();
    } finally { restartAsked = false; }
  }

  // Runs as the very last step of quitting, after the session and settings are saved.
  function runPending() {
    if (!pending) return;
    const { cmd, args, env, cwd } = pending;
    pending = null;
    try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, env: env || process.env, cwd }).unref(); } catch {}
  }

  function start() {
    const s = getSettings();
    if (isNewer(s.updateKnown, current)) Object.assign(st, { status: 'available', latest: s.updateKnown, notesUrl: `${RELEASES_URL}tag/v${s.updateKnown}` });
    else if (s.updateKnown) { s.updateKnown = ''; save(); }
    // Leftovers of an update that has finished (or was abandoned)
    fs.promises.rm(updateDir, { recursive: true, force: true }).catch(() => {});
    if (install.bundle) {
      const parent = path.dirname(install.bundle);
      fs.promises.readdir(parent).then((names) => {
        for (const n of names) if (/^\.Mondium-new-\d+\.app$/.test(n)) fs.promises.rm(path.join(parent, n), { recursive: true, force: true }).catch(() => {});
      }).catch(() => {});
    }
    if (!isBuild && !process.env.MONDIUM_UPDATE_TEST_VERSION) return;
    const tick = () => {
      const now = getSettings();
      if (now.autoUpdateCheck !== false && Date.now() - (now.updateCheckedAt || 0) >= CHECK_EVERY) check({ silent: true });
    };
    setTimeout(tick, 60000).unref?.();
    setInterval(tick, 6 * 60 * 60 * 1000).unref?.();
  }

  return {
    start, check, download, cancel, apply, runPending,
    indicator: () => newerKnown(),
    latest: () => st.latest,
    notesUrl: () => st.notesUrl || RELEASES_URL,
    status: () => ({
      status: st.status, current, latest: st.latest, received: st.received, total: st.total, error: st.error,
      file: st.file ? path.basename(st.file) : null, auto: st.auto, how: st.how, system: install.system, canInstall: !!install.type
    })
  };
}

module.exports = { createUpdater, parseVersion, isNewer, assetName, detectInstall, pickAsset, isGithubHost };
