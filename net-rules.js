'use strict';
// Requests the browser makes by itself for a page (shortcut and pinned tab icons) run outside the page's sandbox.
// So the page must not choose local files, Windows shares or the user's own network as their target.
// mayFetchForPage checks what is written in the URL and costs nothing. mayFetchAfterLookup also asks where a name points;
// it runs only for these rare icon requests. The connection makes its own lookup afterwards, so a name that changes in
// that moment is still possible: this narrows DNS rebinding and does not end it.

function isLocalIpv4(host) {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function isLocalIpv6(inner) {
  if (inner === '::' || inner === '::1' || /^f[cd]/.test(inner) || /^fe[89ab]/.test(inner)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);   // the URL parser writes ::ffff:127.0.0.1 this way
  if (!mapped) return false;
  const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
  return isLocalIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
}
function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host.startsWith('[')) return isLocalIpv6(host.slice(1, -1));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isLocalIpv4(host);
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.');
}
// A page on the user's own network keeps its own icons. A public page reaches only public web addresses.
function mayFetchForPage(pageUrl, target) {
  let to;
  try { to = new URL(target); } catch { return false; }
  if (!/^https?:$/.test(to.protocol)) return false;
  let from;
  try { from = new URL(pageUrl); } catch { return !isLocalHost(to.hostname); }
  return isLocalHost(from.hostname) || !isLocalHost(to.hostname);
}

async function mayFetchAfterLookup(ses, pageUrl, target) {
  if (!mayFetchForPage(pageUrl, target)) return false;
  let from = '';
  try { from = new URL(pageUrl).hostname; } catch {}
  const host = new URL(target).hostname;
  if ((from && isLocalHost(from)) || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  try {
    const { endpoints } = await ses.resolveHost(host);
    return !endpoints.some(({ address }) => isLocalHost(address.includes(':') ? new URL(`http://[${address}]/`).hostname : address));
  } catch { return false; }
}

module.exports = { isLocalHost, mayFetchForPage, mayFetchAfterLookup };
