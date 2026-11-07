'use strict';
// Checks the per-platform paths used by bookmark import, and that a real profile on this machine's OS is found and read.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-platform-test-'));
const realHome = process.env.HOME, realLocal = process.env.LOCALAPPDATA, realRoaming = process.env.APPDATA, realConfig = process.env.XDG_CONFIG_HOME;
try {
  // Run with a fake home so the machine's real browsers are never read.
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.LOCALAPPDATA = path.join(tmp, 'local');
  process.env.APPDATA = path.join(tmp, 'roaming');
  delete process.env.XDG_CONFIG_HOME;
  const { browserLocations, listSources } = require('../bookmark-import');

  const dirOf = (loc, key) => loc.chromium.find((b) => b.key === key).dir;
  const mac = browserLocations('darwin', '/Users/a', {});
  assert.equal(dirOf(mac, 'chrome'), '/Users/a/Library/Application Support/Google/Chrome');
  assert.equal(mac.opera[0].dir, '/Users/a/Library/Application Support/com.operasoftware.Opera');
  assert.deepEqual(mac.firefox, ['/Users/a/Library/Application Support/Firefox/Profiles']);

  const linux = browserLocations('linux', '/home/a', {});
  assert.equal(dirOf(linux, 'chrome'), '/home/a/.config/google-chrome');
  assert(linux.firefox.includes('/home/a/.mozilla/firefox'));
  assert(linux.firefox.includes('/home/a/snap/firefox/common/.mozilla/firefox'));
  const chromiumDirs = linux.chromium.filter((b) => b.name === 'Chromium');
  assert.equal(chromiumDirs.length, 3);
  assert.equal(new Set(linux.chromium.map((b) => b.key)).size, linux.chromium.length);
  assert.equal(linux.opera.length, 1);
  assert.equal(dirOf(browserLocations('linux', '/home/a', { XDG_CONFIG_HOME: '/cfg' }), 'chrome'), '/cfg/google-chrome');

  const win = browserLocations('win32', 'C:\\Users\\a', { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' });
  assert.equal(dirOf(win, 'chrome'), 'C:\\L\\Google\\Chrome\\User Data');
  assert.equal(win.opera[1].dir, 'C:\\R\\Opera Software\\Opera GX Stable');
  assert.deepEqual(win.firefox, ['C:\\R\\Mozilla\\Firefox\\Profiles']);

  // End to end on this OS: a fake Chrome profile in this platform's real location is listed and read.
  const here = browserLocations();
  const profile = path.join(dirOf(here, 'chrome'), 'Default');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Example', url: 'https://example.com/' }] } } }));
  const found = listSources().filter((s) => s.browser === 'Google Chrome');
  assert.equal(found.length, 1);
  assert.equal(found[0].count, 1);
  console.log(`PASS: bookmark import locations for macOS, Linux and Windows; real read on ${process.platform}.`);
} finally {
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('HOME', realHome); restore('LOCALAPPDATA', realLocal); restore('APPDATA', realRoaming); restore('XDG_CONFIG_HOME', realConfig);
  if (path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(tmp, { recursive: true, force: true });
}
