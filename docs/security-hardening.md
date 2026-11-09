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

- **Stored data:** on Windows and Linux cookies are encrypted on disk with the system's key (DPAPI, or the Linux keyring when there is one). Cookies saved by an older version keep working and stay unencrypted until the site sets them again. This cannot be turned off again for an existing profile. The program cannot be started as plain Node.js, and `NODE_OPTIONS` is ignored. Settings, history, the session and user scripts are saved whole, through a temp file, so a crash or two writes at once cannot leave a broken file.
- **Permission bubble:** a click or key in the first half second is not an answer, and the Allow button never takes the keyboard by itself, so a page cannot time a bubble under the user's next click or key press. The device chooser follows the same rule. The same question asked in a loop is one bubble, and one page can queue at most four. A question ends when its tab closes or sleeps. Clearing site permissions takes effect at once.
- **Devices:** a device chosen for one site stays closed to other sites. Incognito choices are not saved and end with the session, and saved grants do not apply in incognito.
- **Requests the browser makes for a page:** shortcut and pinned tab icons reach only http(s), and a public page cannot aim them at local addresses, written in the URL or behind a name. These requests and the titles of unopened background tabs carry no cookies.
- **What a page can open:** a `blob:`, `about:blank` or `data:` document has the limits of the web page that made it, and so do "open in new tab" and "save" in the right-click menu.
- **Extensions:** cookie changes and tab addresses in events now follow the manifest too, not only call results. An extension version must be plain numbers before it becomes a folder name.
- **Malicious sites:** a trailing dot in the host no longer gets past the list. The downloaded list can add hosts but cannot lift a block.
- **Hover zoom:** previews follow the page's referrer policy.
- **Fullscreen:** a page going fullscreen is named in a short notice that says how to leave, so it cannot silently pose as the browser's interface.

## Not covered

Updates rest on GitHub release access, with no separate signature. The installer is not Windows Authenticode signed, and Widevine VMP signing needs a castLabs EVS account. The Mac build is ad-hoc signed, so `codesign --verify` only proves the files are intact. Cookies stay unencrypted on macOS until the app has a real signature, because an ad-hoc signed app could ask for Keychain access after every update. The volume booster runs in the page's own world inside frames, because Electron has no isolated world for a frame; its mark has a random name and a page can only affect its own sound. The icon rule looks up the name first, but the connection makes its own lookup, so DNS rebinding is narrowed and not ended. Opening the history list still reloads public icons from their sites.

## Checks before each release

```bash
npm run test:security
npm audit --audit-level=moderate
npm run check:engine
```

`test:security` covers CRX signatures and tampering, archive limits and paths, bounded streams, user-script permissions, the domain list, download state and the checks in `tools/test-hardening.cjs`. `tools/smoke-test.cjs` checks the bubble, cookie encryption and the fuses in a real package. A clean `npm audit` does not certify the Chromium engine or custom code.
