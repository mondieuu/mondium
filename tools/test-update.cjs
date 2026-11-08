'use strict';
// Update logic that needs no network or Electron: version order, which file is accepted, how each kind of install updates.
const assert = require('assert');
const path = require('path');
const { isNewer, parseVersion, assetName, detectInstall, pickAsset, isGithubHost } = require('../updater');

assert(isNewer('1.6.0', '1.5.1') && isNewer('v1.10.0', '1.9.9') && isNewer('2.0.0', '1.99.99'));
assert(!isNewer('1.5.1', '1.5.1') && !isNewer('1.5.0', '1.5.1'), 'same or older is never an update');
for (const bad of ['', null, '1.6', '1.6.0-beta', '1.6.0.1', 'latest', '../../1.6.0']) { assert(!isNewer(bad, '1.0.0'), String(bad)); assert(!parseVersion(bad)); }

assert.strictEqual(assetName('exe', '1.6.0'), 'Mondium-Setup-1.6.0.exe');
assert.strictEqual(assetName('dmg', '1.6.0', 'arm64'), 'Mondium-1.6.0-mac-arm64.dmg');
assert.strictEqual(assetName('dmg', '1.6.0', 'x64'), 'Mondium-1.6.0-mac-x64.dmg');
assert.strictEqual(assetName('deb', '1.6.0'), 'Mondium-1.6.0-linux-amd64.deb');
assert.strictEqual(assetName('appimage', '1.6.0'), 'Mondium-1.6.0-linux-x86_64.AppImage');

const base = { arch: 'x64', env: {}, isPackaged: true, exists: () => false, writable: () => true };
assert.strictEqual(detectInstall({ ...base, isPackaged: false, platform: 'win32', execPath: path.join('x', 'electron.exe') }).type, null);
const win = (exists) => detectInstall({ ...base, platform: 'win32', execPath: path.join('x', 'Programs', 'Mondium', 'Mondium.exe'), exists });
assert.strictEqual(win(() => true).auto, true);
assert.strictEqual(win(() => false).auto, false);

// The paths below are POSIX ones, so these only run where path works that way (Linux and macOS in CI).
if (path.sep === '/') {
  const mac = (execPath, writable = () => true) => detectInstall({ ...base, platform: 'darwin', arch: 'arm64', execPath, writable });
  const macOk = mac('/Applications/Mondium.app/Contents/MacOS/Mondium');
  assert(macOk.auto && macOk.bundle === '/Applications/Mondium.app');
  assert(!mac('/Volumes/Mondium/Mondium.app/Contents/MacOS/Mondium').auto, 'running from the disk image');
  assert(!mac('/private/var/folders/x/AppTranslocation/y/d/Mondium.app/Contents/MacOS/Mondium').auto, 'translocated');
  assert(!mac('/Applications/Mondium.app/Contents/MacOS/Mondium', () => false).auto, 'read-only folder');
}
const lin = (o) => detectInstall({ ...base, platform: 'linux', execPath: '/opt/Mondium/mondium', ...o });
assert.strictEqual(lin({ env: { APPIMAGE: '/home/a/M.AppImage' } }).type, 'appimage');
assert.strictEqual(lin({ env: { APPIMAGE: '/home/a/M.AppImage' }, writable: () => false }).auto, false);
assert.strictEqual(lin({ exists: (p) => p === '/usr/bin/dpkg' }).type, 'deb');
assert.strictEqual(lin({ execPath: '/home/a/x/mondium' }).type, null, 'unknown install only points to the page');

const sha = 'a'.repeat(64);
const name = 'Mondium-Setup-1.6.0.exe';
const good = { name, size: 1000, digest: 'sha256:' + sha, browser_download_url: `https://github.com/mondieuu/mondium/releases/download/v1.6.0/${name}` };
const release = (a) => ({ tag_name: 'v1.6.0', assets: [a] });
assert.deepStrictEqual(pickAsset(release(good), 'exe', 'x64'), { name, url: good.browser_download_url, sha256: sha, size: 1000 });
assert.strictEqual(pickAsset(release({ ...good, browser_download_url: `https://evil.example/${name}` }), 'exe', 'x64'), null, 'other host');
assert.strictEqual(pickAsset(release({ ...good, browser_download_url: `https://github.com/someone/else/releases/download/v1.6.0/${name}` }), 'exe', 'x64'), null, 'other repository');
assert.strictEqual(pickAsset(release({ ...good, digest: undefined }), 'exe', 'x64'), null, 'no checksum');
assert.strictEqual(pickAsset(release({ ...good, digest: 'md5:abc' }), 'exe', 'x64'), null, 'weak checksum');
assert.strictEqual(pickAsset(release({ ...good, size: 0 }), 'exe', 'x64'), null);
assert.strictEqual(pickAsset(release({ ...good, size: 2e9 }), 'exe', 'x64'), null, 'too large');
assert.strictEqual(pickAsset(release({ ...good, name: 'evil.exe' }), 'exe', 'x64'), null, 'other file');
assert.strictEqual(pickAsset({ tag_name: 'v1.6.0/../x', assets: [good] }, 'exe', 'x64'), null, 'odd tag');

assert(isGithubHost('https://github.com/a') && isGithubHost('https://release-assets.githubusercontent.com/a'));
for (const bad of ['http://github.com/a', 'https://github.com.evil.example/a', 'https://evilgithubusercontent.com/a', 'nonsense']) assert(!isGithubHost(bad), bad);
console.log('Update tests passed.');
