'use strict';
const fs = require('fs'), path = require('path');
const { readResponseBytes } = require('./bounded-fetch');
// A local, conservative domain layer using the malicious-site lists already bundled with uBO.
// Browsing URLs are never submitted to a reputation service: only the public list is downloaded.
// Memory: the lists hold over 100k hosts. A JS Set of strings costs ~40 MB in the main process, so the deny list is
// kept as a sorted Float64Array of 53-bit hashes (~1 MB). A false match needs a 53-bit collision (~1e-11 per lookup)
// and only ever shows the warning page, which the user can pass.

function hash53(text) {   // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const FILTER = /^(@@)?\|\|([a-z0-9.-]+)\^(?:\$(?:doc|document|all))?$/;
function eachHost(text, fn) {
  let slash = -1;
  for (let at = 0; at < text.length;) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    // Most of URLhaus is rules with a path, which this layer does not use: skip them without copying the line.
    if (slash < at) { slash = text.indexOf('/', at); if (slash < 0) slash = Infinity; }
    if (slash < end) { at = end + 1; continue; }
    const line = text.slice(at, end).trim();
    at = end + 1;
    if (!line || line[0] === '!') continue;
    const filter = FILTER.exec(line);
    const host = filter ? filter[2] : /^[a-z0-9.-]+$/.test(line) ? line : null;
    if (!host || host.length > 253 || !host.includes('.') || host.includes('..')) continue;
    fn(host.toLowerCase(), !!(filter && filter[1]));
  }
}
// Kept for tests and tools: the readable form of a list.
function parseHosts(text) {
  const deny = new Set(), allow = new Set();
  eachHost(text, (host, isAllow) => (isAllow ? allow : deny).add(host));
  return { deny, allow };
}
// Exceptions come only from the bundled list. The downloaded list can add hosts but never lift a block: whoever
// controlled that address could otherwise switch the warning off for their own sites.
function compile(bundled, downloaded) {
  const hashes = [], allow = new Set();
  eachHost(bundled, (host, isAllow) => { if (isAllow) allow.add(host); else hashes.push(hash53(host)); });
  eachHost(downloaded, (host, isAllow) => { if (!isAllow) hashes.push(hash53(host)); });
  return { deny: Float64Array.from(hashes).sort(), allow };
}
function has(sorted, value) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >>> 1, v = sorted[mid]; if (v === value) return true; if (v < value) lo = mid + 1; else hi = mid - 1; }
  return false;
}
function createThreatProtection({ root, profile, fetchImpl = fetch }) {
  const file = path.join(profile, 'malware-hosts.txt');
  const read = (f) => { try { return fs.statSync(f).size <= 16 * 1024 * 1024 ? fs.readFileSync(f, 'utf8') : ''; } catch { return ''; } };
  const bundled = () => read(path.join(root, 'vendor', 'ublock', 'assets', 'ublock', 'badware.min.txt'));
  const usable = (text) => /^(?:\|\|)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\^\S*)?\s*$/m.test(text);   // stops at the first host, unlike a full parse
  // Built at the first web address and not during startup: the new tab page and local files never need it. Texts are not kept.
  let sets = null;
  const lists = () => {
    if (sets) return sets;
    let dynamic = read(file);
    if (!usable(dynamic)) dynamic = read(path.join(root, 'vendor', 'ublock', 'assets', 'thirdparties', 'urlhaus-filter', 'urlhaus-filter-online.txt'));
    return (sets = compile(bundled(), dynamic));
  };
  const walk = (host, test) => { for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (test(h)) return true; return false; };
  return {
    isBlocked(url) {
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return false;
        const host = u.hostname.replace(/\.$/, '');   // "bad.example." is the same site as "bad.example"
        const { allow, deny } = lists();
        return !walk(host, (h) => allow.has(h)) && walk(host, (h) => has(deny, hash53(h)));
      } catch { return false; }
    },
    async refresh() {
      try {
        const r = await fetchImpl('https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt', { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return false;
        const text = (await readResponseBytes(r, 16 * 1024 * 1024)).toString('utf8');
        if (parseHosts(text).deny.size < 100) return false;
        fs.mkdirSync(profile, { recursive: true });
        await fs.promises.writeFile(file + '.tmp', text);
        await fs.promises.rename(file + '.tmp', file);
        sets = compile(bundled(), text);
        return true;
      } catch { return false; }
    }
  };
}
module.exports = { parseHosts, createThreatProtection };
