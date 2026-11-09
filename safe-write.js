'use strict';
// Saves a file whole or not at all. A plain write empties the file first, so a crash, or a second write running at the
// same time, leaves broken JSON, and bookmarks, permissions or the open tabs are gone at the next start.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MODE = 0o600;   // macOS and Linux: other users of the computer cannot read history or settings
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);   // Windows: an antivirus or backup program holds the file for a moment
const ATTEMPTS = 40, PAUSE_MS = 25;
const TEMP = /\.\d+\.\d+\.tmp$/;

let counter = 0;
const newest = new Map();     // file -> number of its newest write; an older write that finishes late is dropped
const inFlight = new Set();   // temp files being written now

const tempName = (file, n) => `${file}.${process.pid}.${n}.tmp`;
function discard(temp) {
  inFlight.delete(temp);
  try { fs.rmSync(temp, { force: true }); } catch {}
}
// Last resort when the target stays held: an in-place write is still better than losing the data.
function replaceInPlace(temp, file, text) {
  try { fs.writeFileSync(file, text, { mode: MODE }); } finally { discard(temp); }
}

function writeFileAtomicSync(file, text) {
  const n = ++counter;
  newest.set(file, n);
  const temp = tempName(file, n);
  inFlight.add(temp);
  try {
    fs.writeFileSync(temp, text, { mode: MODE });
    fs.renameSync(temp, file);
    inFlight.delete(temp);
  } catch (e) {
    if (BUSY.has(e.code) && fs.existsSync(temp) && !isDirectory(file)) return replaceInPlace(temp, file, text);
    discard(temp);
    throw e;
  }
}
function isDirectory(file) { try { return fs.statSync(file).isDirectory(); } catch { return false; } }

async function writeFileAtomic(file, text) {
  const n = ++counter;
  newest.set(file, n);
  const temp = tempName(file, n);
  inFlight.add(temp);
  try {
    await fsp.writeFile(temp, text, { mode: MODE });
    for (let attempt = 1; ; attempt++) {
      if (newest.get(file) !== n) return discard(temp);
      try {
        fs.renameSync(temp, file);   // synchronous on purpose: nothing can slip between the check above and this line
        inFlight.delete(temp);
        return undefined;
      } catch (e) {
        if (!BUSY.has(e.code) || isDirectory(file)) throw e;
        if (attempt >= ATTEMPTS) return replaceInPlace(temp, file, text);
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }
  } catch (e) {
    discard(temp);
    throw e;
  }
}

// Temp files left by a crash. Called once at startup; never touches a write in progress.
async function sweepTempFiles(dir) {
  let names;
  try { names = await fsp.readdir(dir); } catch { return; }
  await Promise.all(names.filter((name) => TEMP.test(name) && !inFlight.has(path.join(dir, name))).map((name) => fsp.rm(path.join(dir, name), { force: true }).catch(() => {})));
}

module.exports = { writeFileAtomic, writeFileAtomicSync, sweepTempFiles, tempName };
