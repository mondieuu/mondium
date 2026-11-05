<p align="center">
  <img src="docs/hero.png" alt="Mondium" width="100%">
</p>

<h1 align="center">Mondium</h1>

<p align="center">
  <b>A minimal, debloated, Chromium-based desktop browser.</b><br>
  No accounts, no telemetry, no bloat. Just a fast, quiet browser that respects your RAM and your privacy.
</p>

<p align="center">
  <img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-2f2f35">
  <img alt="Engine: Chromium" src="https://img.shields.io/badge/engine-Chromium-2f2f35">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-2f2f35">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/UI-vanilla%20JS-2f2f35">
</p>

---

## Why Mondium

Modern browsers ship with sync, telemetry, shopping assistants, AI sidebars, sponsored tiles and a dozen background services. Mondium keeps the Chromium engine and drops the rest.

- **Debloated.** No sign-in, sync, crash reporting, Safe Browsing pings, translation service, Privacy Sandbox, Topics or FLEDGE. No `X-Client-Data` header.
- **Light on memory.** Smart process grouping, sleeping background tabs, and a UI drawn in a single view with no extra processes.
- **Private by default.** Real uBlock Origin built in, DNS-over-HTTPS, Do Not Track + Global Privacy Control, WebRTC IP leak protection.
- **Minimalist design.** Chrome-familiar layout, without the logos. 11 themes, pitch-black mode, vertical tabs.
- **Vanilla JS.** The whole UI is plain HTML, CSS and JavaScript. No framework, no bundler, no TypeScript build step.

## Screenshots

| Vertical tabs | Classic tabs |
|---|---|
| ![Vertical tabs](docs/vertical-tabs-dark.png) | ![Classic tabs, light theme](docs/horizontal-light.png) |

| New tab | Built-in volume booster |
|---|---|
| ![New tab page](docs/new-tab-dark.png) | ![Volume booster](docs/volume-booster.png) |

| Protected sites | Clear browsing data |
|---|---|
| ![Protected sites](docs/settings-protected-sites.png) | ![Clear browsing data](docs/clear-browsing-data.png) |

> The interface is currently in Turkish.

## Features

### Privacy
- **uBlock Origin, built in.** The real, official uBlock Origin (MV2) ships with the browser and cannot be removed by accident. A lighter built-in engine (Ghostery adblocker with uBO lists) is available as an alternative.
- **Google without the tracking.** Non-personalized results (`pws=0`), no AI Overviews (`udm=14`), Google logging and ping requests blocked.
- **Passkeys disabled** on request: no Windows Hello or "use a passkey" pop-ups.
- **DNS-over-HTTPS** (Cloudflare, Quad9), **DNT** and **GPC** on by default.
- **Permission bubbles** like Chrome's for camera, microphone, location, notifications and device access. Your decisions are remembered.
- **Incognito windows** with a separate in-memory session, wiped when the last one closes.

### Protected sites
Clear everything, except the sites you choose to keep signed in to.
- Protect a site from the settings page, the site data list, or the address bar's site menu.
- Cleanup works per cookie and per storage key through the engine itself. Third-party data embedded *inside* a protected site (CHIPS / partitioned storage) is kept, and the same third party embedded elsewhere is removed.
- A real inventory of cookies and site storage (IndexedDB, Cache Storage, service workers, OPFS, localStorage), read from the engine, not from history.
- Every cleanup is verified by re-reading the inventory: requested vs. deleted vs. remaining.
- Handles public suffixes, private suffixes (`github.io`), IDN domains, IP addresses and `localhost`.

### Memory
- **Process grouping.** Regular sites share renderer processes, while sign-in, payment and protected sites stay isolated (similar to Chrome on Android). In our test with six popular sites this cut renderer processes from 21 to 8 and working set from 4.6 GB to 2.8 GB. Full site isolation is one toggle away.
- **Tab sleeping.** Background tabs are unloaded after 5–60 minutes (configurable). Tabs playing audio are never put to sleep.
- **Lazy session restore.** Only the active tab loads at startup.
- **Task manager** (`Shift+Esc`) shows the memory of every tab, extension and process.

### Interface
- **Vertical tabs** with a resizable sidebar (down to an icon-only strip) and an auto-hide mode (`Ctrl+S`). The sidebar slides in from the screen edge.
- **Themes:** System, Light, Dark, eight color themes, and an optional **pitch-black** mode for OLED screens.
- **Built-in tools, no extensions needed:** a volume booster (up to 600% per tab), hover zoom for images (press `Z` to pin and zoom with the wheel), reader mode (`F9`), picture-in-picture.
- **Address bar suggestions** from local history and bookmarks only. Nothing you type is sent to a search engine until you press Enter.
- Chrome keyboard shortcuts, tab pinning and muting, reopen closed tabs, bookmarks bar, downloads and history pages.

### Compatibility
- **Chrome Web Store extensions** can be installed directly, and you can manage, hide and remove them from a Chrome-like extensions page.
- **Widevine DRM** through castLabs Electron.
- **WebHID, WebUSB, Web Serial and Web Bluetooth** for web-based device configurators and firmware flashers.
- Codecs: H.264, HEVC (hardware), VP9, AV1, AAC, Opus, MP3. Built-in PDF viewer.

## Getting started

Requirements: [Node.js](https://nodejs.org/) 20 or newer, Windows 10/11.

```bash
git clone https://github.com/mondieuu/mondium.git
cd mondium
npm install
npm start
```

Build a Windows installer (`dist/Mondium-Kurulum-<version>.exe`):

```bash
npm run dist:win
```

Update the bundled uBlock Origin to the latest release:

```bash
npm run ublock-guncelle
```

### Optional: streaming services
Netflix, Disney+ and similar services require a production Widevine VMP signature. Create a free [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) account once (`vmp-hesap-olustur.bat`). After that, installers are signed automatically.

## Project structure

| File | Purpose |
|---|---|
| `main.js` | Main process: windows and tabs, permissions, ad blocking, extensions, themes, sessions |
| `ui.html` | Tab strip, toolbar, menus and bubbles, all drawn in one view |
| `site-data.js` | Protected sites: site rules, engine inventory, selective cleanup |
| `settings.html`, `newtab.html`, `history.html`, `downloads.html`, `extensions.html` | Internal pages |
| `volume.js`, `hoverzoom.js`, `reader.js` | Built-in tools injected into isolated worlds |
| `page-preload.js` | Small preload for all pages |
| `vendor/ublock` | Bundled uBlock Origin |

## Privacy note

Mondium has no server and collects nothing. All data (settings, history, downloads, cookies) stays in `%APPDATA%\Mondium` on your machine.

## License

[GPL-3.0](LICENSE). Mondium bundles [uBlock Origin](https://github.com/gorhill/uBlock) (GPL-3.0) and is built with [Electron](https://www.electronjs.org/) / [castLabs ECS](https://github.com/castlabs/electron-releases), [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) and [Ghostery adblocker](https://github.com/ghostery/adblocker).

Mondium is not affiliated with Google or the Chromium project.
