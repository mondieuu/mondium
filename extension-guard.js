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
// Removes what the extension may not see from a result.
function filterResult(extension, name, result) {
  const m = extension.manifest || {};
  if (name === 'cookies.getAll' && Array.isArray(result)) {
    return result.filter((c) => hostAllowed(m, `https://${String(c.domain || '').replace(/^\./, '')}/`));
  }
  if (/^tabs\.(get|query|getAllInWindow|getCurrent|create|update)$/.test(name)) {
    return Array.isArray(result) ? result.map((t) => stripTab(m, t)) : stripTab(m, result);
  }
  if (/^windows\./.test(name) && result && Array.isArray(result.tabs)) return { ...result, tabs: result.tabs.map((t) => stripTab(m, t)) };
  if (/^windows\./.test(name) && Array.isArray(result)) return result.map((w) => (w && Array.isArray(w.tabs) ? { ...w, tabs: w.tabs.map((t) => stripTab(m, t)) } : w));
  return result;
}

function guardExtensionRouter(extensions, session, webContents) {
  const router = extensions && extensions.ctx && extensions.ctx.router;
  if (!router || typeof router.onExtensionMessage !== 'function' || typeof router.addListener !== 'function') {
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
}

module.exports = { guardExtensionRouter, matchHost, hostAllowed, checkCall, filterResult, callerId };
