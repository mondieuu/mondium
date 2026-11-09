'use strict';
// Checks electron-chrome-extensions leaves out. Its router trusts the extension id the caller sends and runs
// cookies, tabs and popup calls without looking at the manifest. Every call passes through here first.

const idFromUrl = (u) => { const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(u || ''); return m ? m[1] : null; };

// The extension a call really comes from, from the channel and never from the message.
function callerId(event) {
  if (event.type === 'service-worker') {
    try { return idFromUrl(event.session.serviceWorkers.getWorkerFromVersionID(event.versionId).scope); } catch { return null; }
  }
  const frameUrl = event.senderFrame && event.senderFrame.url;
  return idFromUrl(frameUrl || (event.sender && event.sender.getURL()));
}

function matchHost(pattern, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^(https?|wss?):$/.test(u.protocol)) return false;
  if (pattern === '<all_urls>') return true;
  const m = /^(\*|https?|wss?):\/\/([^/]*)\//.exec(pattern);
  if (!m) return false;
  if (m[1] === '*' ? !/^(https?|wss?):$/.test(u.protocol) : m[1] + ':' !== u.protocol) return false;
  const host = m[2];
  if (host === '*') return true;
  if (host.startsWith('*.')) return u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1));
  return u.hostname === host;
}
const hostPatterns = (m) => [...(m.permissions || []), ...(m.host_permissions || [])].filter((p) => typeof p === 'string' && (p === '<all_urls>' || p.includes('://')));
const hostAllowed = (m, url) => hostPatterns(m).some((p) => matchHost(p, url));
const hasPermission = (m, name) => (m.permissions || []).includes(name);

const NEEDS_PERMISSION = { cookies: 'cookies', webNavigation: 'webNavigation', notifications: 'notifications' };
const needsPermission = (name) => NEEDS_PERMISSION[String(name).split('.')[0]];

function checkOpenUrl(extension, url) {
  for (const one of [].concat(url || [])) {
    let parsed;
    try { parsed = new URL(one, extension.url); } catch { throw new Error('Invalid URL'); }
    if (/^(file|view-source|mondium|chrome|devtools|javascript):$/i.test(parsed.protocol)) throw new Error('Extensions cannot open this address');
  }
}

// Throws when the extension may not make this call.
function checkCall(extension, name, args, tabUrl) {
  const m = extension.manifest || {};
  const need = needsPermission(name);
  if (need && !hasPermission(m, need)) throw new Error(`${name} requires the ${need} permission`);
  if (name === 'cookies.get' || name === 'cookies.set' || name === 'cookies.remove') {
    if (!hostAllowed(m, args[0] && args[0].url)) throw new Error(`${name} requires host permission for this address`);
  }
  if (name === 'cookies.getAll' && args[0] && args[0].url && !hostAllowed(m, args[0].url)) throw new Error(`${name} requires host permission for this address`);
  if (name === 'tabs.create' || name === 'windows.create') checkOpenUrl(extension, args[0] && args[0].url);
  if (name === 'tabs.update') checkOpenUrl(extension, (args[1] || args[0] || {}).url);
  if (name === 'tabs.insertCSS' && !hostAllowed(m, tabUrl)) throw new Error(`${name} requires host permission for this tab`);
  if (name === 'browserAction.setPopup') {
    const popup = args[0] && args[0].popup;
    if (popup && !new URL(popup, extension.url).href.startsWith(extension.url)) throw new Error('A popup must be a page of the extension');
  }
}

function stripTab(m, tab) {
  if (!tab || typeof tab !== 'object' || hasPermission(m, 'tabs') || hostAllowed(m, tab.url)) return tab;
  const { url, pendingUrl, title, favIconUrl, ...rest } = tab;
  return rest;
}
const stripWindow = (m, w) => (w && Array.isArray(w.tabs) ? { ...w, tabs: w.tabs.map((t) => stripTab(m, t)) } : w);
const cookieAllowed = (m, c) => {
  const host = String((c && c.domain) || '').replace(/^\./, '');
  return hostAllowed(m, `https://${host}/`) || hostAllowed(m, `http://${host}/`);
};
// Removes what the extension may not see from a result.
function filterResult(extension, name, result) {
  const m = extension.manifest || {};
  if (name === 'cookies.getAll' && Array.isArray(result)) return result.filter((c) => cookieAllowed(m, c));
  if (/^tabs\.(get|query|getAllInWindow|getCurrent|create|update)$/.test(name)) {
    return Array.isArray(result) ? result.map((t) => stripTab(m, t)) : stripTab(m, result);
  }
  if (/^windows\./.test(name)) return Array.isArray(result) ? result.map((w) => stripWindow(m, w)) : stripWindow(m, result);
  return result;
}

// The library sends each event to every extension that listens, so cookies and tab addresses would also reach
// extensions with no access to those sites. Each one gets only what its manifest allows; null means nothing at all.
const EVENT_FILTERS = {
  'cookies.onChanged': (m, [info]) => (cookieAllowed(m, info && info.cookie) ? [info] : null),
  'tabs.onCreated': (m, [tab]) => [stripTab(m, tab)],
  'tabs.onUpdated': (m, [id, change, tab]) => {
    const seen = stripTab(m, tab);
    if (seen === tab) return [id, change, tab];
    const { url, pendingUrl, title, favIconUrl, ...rest } = change || {};
    return Object.keys(rest).length ? [id, rest, seen] : null;
  },
  'windows.onCreated': (m, [w]) => [stripWindow(m, w)],
  'windows.onBoundsChanged': (m, [w]) => [stripWindow(m, w)]
};

function guardExtensionRouter(extensions, session, webContents) {
  const router = extensions && extensions.ctx && extensions.ctx.router;
  if (!router || typeof router.onExtensionMessage !== 'function' || typeof router.addListener !== 'function' || typeof router.sendEvent !== 'function' || !(router.listeners instanceof Map)) {
    throw new Error('Extension library changed: review extension-guard.js');   // no extensions rather than unchecked ones
  }
  const api = session.extensions || session;
  const call = router.onExtensionMessage.bind(router);
  router.onExtensionMessage = async (event, claimed, name, ...args) => {
    if (!claimed) return call(event, claimed, name, ...args);
    if (callerId(event) !== claimed) throw new Error(`${name} was sent with another extension's identity`);
    const extension = api.getExtension(claimed);
    if (!extension) return call(event, claimed, name, ...args);
    let tabUrl;
    if (name === 'tabs.insertCSS') { const wc = webContents.fromId(args[0]); tabUrl = wc && !wc.isDestroyed() ? wc.getURL() : ''; }
    checkCall(extension, name, args, tabUrl);
    return filterResult(extension, name, await call(event, claimed, name, ...args));
  };
  const listen = router.addListener.bind(router);
  router.addListener = (listener, claimed, eventName) => {
    if (listener.host && idFromUrl(listener.host.getURL()) !== claimed) return undefined;
    const extension = api.getExtension(claimed);
    const need = needsPermission(eventName);
    if (need && (!extension || !hasPermission(extension.manifest || {}, need))) return undefined;
    return listen(listener, claimed, eventName);
  };
  const send = router.sendEvent.bind(router);
  router.sendEvent = (target, eventName, ...args) => {
    const filter = EVENT_FILTERS[eventName];
    if (!filter) return send(target, eventName, ...args);
    for (const id of new Set((router.listeners.get(eventName) || []).map((l) => l.extensionId))) {
      if (target && target !== id) continue;
      const extension = api.getExtension(id);
      const allowed = extension && filter(extension.manifest || {}, args);
      if (allowed) send(id, eventName, ...allowed);
    }
    return undefined;
  };
}

module.exports = { guardExtensionRouter, matchHost, hostAllowed, checkCall, filterResult, callerId };
