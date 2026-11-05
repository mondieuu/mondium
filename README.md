<p align="center">
  <img src="docs/hero.png" alt="Mondium" width="100%">
</p>

<h1 align="center">Mondium</h1>

<p align="center">
  <b>A minimal, debloated, Chromium-based desktop browser.</b><br>
  No accounts, no telemetry, no bloat. Just a fast, quiet browser that respects your RAM and your privacy.
</p>

<p align="center"><a href="#türkçe">Türkçe açıklama aşağıda ↓</a></p>

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
- **Minimalist design.** Chrome-familiar layout, without the logos. 11 themes, pitch-black mode, vertical tabs. English and Turkish UI.
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

> The interface is available in **English** and **Turkish** (Settings → Appearance → Language).

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
- **Import bookmarks** from Chrome, Edge, Brave, Opera, Vivaldi, Yandex or Firefox in one click, or from any exported HTML file. Read locally, nothing is sent anywhere; imports land in a folder on the bookmarks bar.
- **Address bar suggestions** from local history and bookmarks only. Nothing you type is sent to a search engine until you press Enter.
- Chrome keyboard shortcuts, tab pinning and muting, reopen closed tabs, bookmarks bar, downloads and history pages.

### Compatibility
- **Chrome Web Store extensions** can be installed directly, and you can manage, hide and remove them from a Chrome-like extensions page.
- **Widevine DRM** through castLabs Electron.
- **WebHID, WebUSB, Web Serial and Web Bluetooth** for web-based device configurators and firmware flashers.
- Codecs: H.264, HEVC (hardware), VP9, AV1, AAC, Opus, MP3. Built-in PDF viewer.

## Download

**[⬇ Download the latest Mondium for Windows](https://github.com/mondieuu/mondium/releases/latest)** (64-bit, Windows 10/11): grab `Mondium-Setup-<version>.exe` under *Assets*.

The installer works like Chrome's: one click, no admin rights, installs for the current user and opens Mondium when it's done. Mondium also shows up under **Settings → Apps → Default apps**, so you can make it your default browser.

> The installer is not code-signed yet, so Windows SmartScreen may show a warning. Click **More info → Run anyway**.

## Build from source

Requirements: [Node.js](https://nodejs.org/) 20 or newer, Windows 10/11.

```bash
git clone https://github.com/mondieuu/mondium.git
cd mondium
npm install
npm start
```

Build the Windows installer (`dist/Mondium-Setup-<version>.exe`), or just run `build-installer.bat`:

```bash
npm run dist:win
```

Update the bundled uBlock Origin to the latest release:

```bash
npm run update-ublock
```

### Optional: streaming services
Netflix, Disney+ and similar services require a production Widevine VMP signature. Create a free [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) account once (`vmp-create-account.bat`). After that, installers are signed automatically.

## Project structure

| File | Purpose |
|---|---|
| `main.js` | Main process: windows and tabs, permissions, ad blocking, extensions, themes, sessions |
| `ui.html` | Tab strip, toolbar, menus and bubbles, all drawn in one view |
| `site-data.js` | Protected sites: site rules, engine inventory, selective cleanup |
| `settings.html`, `newtab.html`, `history.html`, `downloads.html`, `extensions.html` | Internal pages |
| `volume.js`, `hoverzoom.js`, `reader.js` | Built-in tools injected into isolated worlds |
| `page-preload.js` | Small preload for all pages |
| `i18n.js` | English translations of the UI (Turkish is the source language) |
| `bookmark-import.js` | Bookmark import from other browsers |
| `vendor/ublock` | Bundled uBlock Origin |

## Privacy note

Mondium has no server and collects nothing. All data (settings, history, downloads, cookies) stays in `%APPDATA%\Mondium` on your machine.

## License

[GPL-3.0](LICENSE). Mondium bundles [uBlock Origin](https://github.com/gorhill/uBlock) (GPL-3.0) and is built with [Electron](https://www.electronjs.org/) / [castLabs ECS](https://github.com/castlabs/electron-releases), [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) and [Ghostery adblocker](https://github.com/ghostery/adblocker).

Mondium is not affiliated with Google or the Chromium project.

---

## Türkçe

**Mondium**, Chromium tabanlı, sade ve gereksiz her şeyden arındırılmış (debloated) bir masaüstü tarayıcı. Hesap yok, telemetri yok, şişkinlik yok: RAM'inize ve gizliliğinize saygı duyan hızlı, sessiz bir tarayıcı. Arayüz **Türkçe** ve **İngilizce** (Ayarlar → Görünüm → Dil).

### Neden Mondium
- **Arındırılmış:** Oturum açma, senkronizasyon, çökme raporu, Safe Browsing pingleri, çeviri servisi, Privacy Sandbox, Topics ve FLEDGE yok. `X-Client-Data` başlığı yok.
- **Az RAM:** Akıllı süreç gruplama, arka plan sekmelerini uyutma ve ek süreç açmayan tek görünümlü arayüz.
- **Varsayılan olarak gizli:** Gerçek uBlock Origin içinde gelir; DNS-over-HTTPS, Do Not Track + Global Privacy Control, WebRTC IP sızıntısı koruması.
- **Sade tasarım:** Chrome'a benzeyen düzen, logolar olmadan. 11 tema, tam siyah (pitch black) mod, dikey sekmeler.
- **Saf JavaScript:** Arayüzün tamamı düz HTML, CSS ve JavaScript. Framework, bundler ya da TypeScript yok.

### Öne çıkanlar
- **Korunan siteler:** Gezinti verilerini temizlerken seçtiğiniz sitelerde oturumunuz açık kalır. Temizlik motor üzerinden çerez ve depolama anahtarı bazında yapılır, sonuç yeniden okunarak doğrulanır.
- **Bellek:** Normal siteler süreç paylaşır; giriş, ödeme ve korunan siteler ayrı süreçte kalır. 6 popüler sitede 21 süreç yerine 8 süreç, 4,6 GB yerine 2,8 GB çalışma belleği. Tam site izolasyonu tek tıkla açılır.
- **Yerleşik araçlar:** Ses yükseltme (sekme başına %600'e kadar), resim büyütme (`Z` ile sabitle, tekerlekle yakınlaştır), okuma modu (`F9`), resim içinde resim.
- **Yer işareti aktarma:** Chrome, Edge, Brave, Opera, Vivaldi, Yandex veya Firefox'tan tek tıkla ya da HTML dosyasından. Dosyalar sadece bu bilgisayarda okunur.
- **Uyumluluk:** Chrome Web Mağazası uzantıları, Widevine DRM, WebHID / WebUSB / Web Serial / Web Bluetooth, yerleşik PDF görüntüleyici.

### İndir
**[⬇ En son Mondium'u indir](https://github.com/mondieuu/mondium/releases/latest)** (Windows 10/11, 64 bit): *Assets* altındaki `Mondium-Setup-<sürüm>.exe` dosyası. Kurulum Chrome'unki gibi: tek tık, yönetici izni gerekmez, bitince Mondium açılır. **Ayarlar → Uygulamalar → Varsayılan uygulamalar** bölümünden varsayılan tarayıcı yapabilirsiniz.

> Kurulum dosyası henüz kod imzalı değil, Windows SmartScreen uyarı verebilir. **Ek bilgi → Yine de çalıştır** seçeneğine tıklayın.

### Kaynaktan derleme
```bash
git clone https://github.com/mondieuu/mondium.git
cd mondium
npm install
npm start
```
Kurulum dosyası için `npm run dist:win` ya da `build-installer.bat`.

### Gizlilik notu
Mondium'un sunucusu yok ve hiçbir veri toplamaz. Ayarlar, geçmiş, indirmeler ve çerezler bilgisayarınızda `%APPDATA%\Mondium` klasöründe kalır.

Lisans: [GPL-3.0](LICENSE). Mondium, Google veya Chromium projesiyle bağlantılı değildir.
