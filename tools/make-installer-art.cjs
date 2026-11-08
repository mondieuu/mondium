'use strict';
// Draws the ring and name shown at the top of the Windows installer, one bitmap per screen scale.
// Run again only when the art changes: node_modules/electron/dist/electron.exe tools/make-installer-art.cjs
// The bitmaps are committed. Their top left pixel is the color the installer fills the rest of the band with.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'build', 'installer');
const BACKGROUND = '#1f1f22';
const SCALES = { 96: 1, 120: 1.25, 144: 1.5, 168: 1.75, 192: 2, 240: 2.5, 288: 3 };
const WIDTH = 220, HEIGHT = 128;

function page(s) {
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${WIDTH * s}px;height:${HEIGHT * s}px;overflow:hidden;background:${BACKGROUND}}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${10 * s}px}
    svg{width:${58 * s}px;height:${58 * s}px;display:block}
    div{font:600 ${25 * s}px "Segoe UI",sans-serif;color:#fff;letter-spacing:.2px;line-height:1}
  </style><svg viewBox="130 130 252 252"><path d="M245 155A101 101 0 1 0 355 268" fill="none" stroke="#fff" stroke-width="50" stroke-linecap="round"/></svg><div>Mondium</div>`;
}

// 24-bit bottom-up BMP from Chromium's BGRA pixels
function toBmp(bgra, width, height) {
  const stride = (width * 3 + 3) & ~3;
  const size = 54 + stride * height;
  const out = Buffer.alloc(size);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4, to = row + x * 3;
      out[to] = bgra[from];
      out[to + 1] = bgra[from + 1];
      out[to + 2] = bgra[from + 2];
    }
  }
  return out;
}

async function draw(dpi, s) {
  const width = Math.round(WIDTH * s), height = Math.round(HEIGHT * s);
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
  const html = path.join(app.getPath('userData'), `art-${dpi}.html`);
  fs.writeFileSync(html, page(s));
  await win.loadFile(html);
  const image = await new Promise((resolve) => {
    let n = 0;
    win.webContents.on('paint', (_e, _r, img) => { if (++n >= 3) resolve(img); });
    win.webContents.setFrameRate(30);
    win.webContents.invalidate();
    setTimeout(() => resolve(null), 3000);
  });
  const shot = image || await win.webContents.capturePage();
  const size = shot.getSize();
  fs.writeFileSync(path.join(OUT, `art-${dpi}.bmp`), toBmp(shot.toBitmap(), size.width, size.height));
  console.log(`art-${dpi}.bmp ${size.width}x${size.height}`);
  win.destroy();
}

app.on('window-all-closed', () => {});   // one window per scale; don't quit between them
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mondium-art-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [dpi, s] of Object.entries(SCALES)) await draw(dpi, s);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
