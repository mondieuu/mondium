# Security hardening

This review fixes specific identified paths. It is not a claim that the browser is free of vulnerabilities. Most of this work was ported from [Calcium](https://github.com/cnrgks/Calcium) (see [NOTICE](../NOTICE.md)).

## Changes

- **Engine:** Electron upgraded from castLabs 44.10.1 to 45.2.1. Runtime and build dependencies are pinned; vulnerable adm-zip and minimatch versions are overridden.
- **Site isolation:** full site isolation (`site-per-process`) is on by default and existing profiles migrate once. Turning it off in Settings is a deliberate choice that saves RAM.
- **Sandbox:** remote pages and the browser UI all run with sandbox and context isolation on and Node integration off. The extension icon API is bundled into a sandbox-compatible preload. The incognito UI uses its own in-memory session.
- **Extensions:**
  - Web Store packages must be CRX3 with a verified signature; CRX2 is rejected.
  - Archives have limits on size, entry count, per-file and total output. Unsafe paths, duplicate names and symlinks are rejected.
  - Extension file access is off by default.
  - `extension-guard.js` adds checks the extension library leaves out: identity comes from the calling channel, cookies and tab details follow the manifest, and extensions cannot open local files or internal pages.
- **Local files:** Electron's extra `file:` privileges are switched off with a fuse, so a local HTML file has browser-like limits. Internal pages stay outside `app.asar` for this reason, and only the exact internal pages get the page bridge.
- **Site permissions:** decisions are kept per origin and per kind (microphone, camera, each external app scheme). Screen capture asks every time. Frames with no origin of their own act for their page, and a prompt ends when the page that asked goes away.
- **Popups:** `window.open` cannot set always-on-top, non-closable and similar window options, and web pages can only open web addresses.
- **User scripts:** registration requires the manifest permission. Injection and messaging also require host permission, a matching sender document, the right session and an issued script world. Batches, script sizes and pending requests are bounded.
- **Network reads:** icon and metadata bodies are limited while reading, not after allocating them. Image dimensions are checked, and at most three icon jobs run at once.
- **Malicious sites:** a local domain layer uses the URLhaus and badware lists bundled with uBlock Origin. Installed builds refresh URLhaus every twelve hours. No browsing URL is sent to the list provider. Matches show a warning page, and an exception lasts only for that window. This is not a file scanner or Google Safe Browsing.
- **Downloads:** file names are reduced to their base name, the optional save dialog uses Electron's non-blocking flow, downloads from blocked sites are cancelled, and incognito downloads are not listed in normal windows.
- **TLS:** the Certificate Transparency component is no longer disabled.
- **Private windows:** with uBlock Origin as the engine, private requests go through the loaded uBO engines in bounded batches, without registering tabs or logs in the persistent session. This covers network rules only, not cosmetic filters or scriptlets.

## Not covered

Updates rest on GitHub release access, with no separate signature. The installer is not Windows Authenticode signed, and Widevine VMP signing needs a castLabs EVS account.

## Checks before each release

```bash
npm run test:security
npm audit --audit-level=moderate
npm run check:engine
```

`test:security` covers CRX signatures and tampering, archive limits and paths, bounded streams, user-script permissions, the domain list and download state. A clean `npm audit` does not certify the Chromium engine or custom code.
