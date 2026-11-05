'use strict';
// Installs/updates uBlock Origin into vendor/ublock from the official GitHub release (gorhill/uBlock, chromium package).
// Adds the Mondium bridge (vendor/mondium-ece.js) to the head of every HTML page; no other uBO file is touched.
// Usage: node tools/update-ublock.js [version]   (latest when no version is given)
// Note: uBO updates its filter lists itself; this script only updates the uBO program.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'vendor', 'ublock');
const bridge = path.join(root, 'vendor', 'mondium-ece.js');
const TAG = '<script src="js/mondium-ece.js"></script>';

async function main() {
  const want = process.argv[2];
  const rel = await (await fetch(`https://api.github.com/repos/gorhill/uBlock/releases/${want ? 'tags/' + want : 'latest'}`, { headers: { 'User-Agent': 'Mondium' } })).json();
  const asset = (rel.assets || []).find((a) => /\.chromium\.zip$/.test(a.name));
  if (!asset) throw new Error('chromium package not found: ' + (rel.message || rel.tag_name));
  console.log('uBlock Origin', rel.tag_name, '-', asset.name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-ubo-'));
  const zip = path.join(tmp, 'ubo.zip');
  fs.writeFileSync(zip, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));
  const out = path.join(tmp, 'ac');
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${out}'`]);
  else execFileSync('unzip', ['-q', zip, '-d', out]);
  const src = path.join(out, fs.readdirSync(out).find((d) => fs.existsSync(path.join(out, d, 'manifest.json'))) || '');
  const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  if (m.manifest_version !== 2 || !/uBlock/i.test(m.name || '') && !/__MSG_/.test(m.name || '')) throw new Error('unexpected package');
  // Bridge: first script on every page
  fs.copyFileSync(bridge, path.join(src, 'js', 'mondium-ece.js'));
  let n = 0;
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.html'))) {
    const p = path.join(src, f);
    let html = fs.readFileSync(p, 'utf8');
    if (html.includes(TAG)) continue;
    html = html.replace(/<head>/i, (h) => { n++; return h + '\n' + TAG; });
    fs.writeFileSync(p, html);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Installed: ${dest} (version ${m.version}, bridge added to ${n} pages)`);
}
main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
