'use strict';
// electron-builder's collector can drop production modules from app.asar (seen with npm overrides and electron as a
// peer dependency), which silently breaks extensions, the Web Store and the light engine in installed builds.
// So the production tree is listed explicitly in build.extraResources. Run after changing dependencies.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let out;
try { out = execFileSync(npm, ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { out = e.stdout; }   // npm ls exits non-zero on "overridden" notes; the JSON is still complete
const names = new Set();
(function walk(deps) {
  for (const [name, info] of Object.entries(deps || {})) {
    if (name === 'electron' || names.has(name)) continue;
    names.add(name);
    walk(info.dependencies);
  }
})(JSON.parse(out).dependencies);
const file = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const others = (pkg.build.extraResources || []).filter((x) => x.from !== 'node_modules');
pkg.build.extraResources = [{ from: 'node_modules', to: 'node_modules', filter: [...[...names].filter((n) => !n.startsWith('@types/')).sort().map((n) => `${n}/**/*`), '!**/*.map', '!**/*.d.ts'] }, ...others];   // nothing reads these at run time
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`${names.size} modules listed for packaging`);
