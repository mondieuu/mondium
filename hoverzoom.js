// Mondium image zoom (built-in, Imagus-like). When enabled the main process injects it into every page in isolated world 1014.
// Hovering briefly over an image or image link opens the large version on the wider side of the cursor.
// Closes on Esc, click, scroll or when the mouse leaves.
// Z: pins the image to the screen (like Imagus): fit to screen in the center, wheel zooms toward the cursor point,
// drag pans, double-click toggles 100% / fit. Z, Esc or clicking empty space closes. When disabled (setting) all listeners are removed; no leaks.
(() => {
  const KEY = Symbol.for('mondium.zoom');
  if (window[KEY]) { window[KEY].on(); return; }

  const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
  const VID_EXT = /\.(mp4|webm|gifv)(?:[?#]|$)/i;
  const DELAY = 220, PAD = 12;

  // Large image URL from a thumbnail (common sites); null if unknown
  function upgrade(src) {
    let u;
    try { u = new URL(src, location.href); } catch { return null; }
    const h = u.hostname;
    if (/(^|\.)wikimedia\.org$/.test(h) && u.pathname.includes('/thumb/')) {
      // Thumbnails come from thumb.wikimedia.org or upload.wikimedia.org; the original is always on upload
      return 'https://upload.wikimedia.org' + u.pathname.replace('/thumb/', '/').replace(/\/[^/]+$/, '');
    }
    if (h === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) { u.searchParams.set('name', 'orig'); return u.href; }
    if (h === 'preview.redd.it' || h === 'external-preview.redd.it') {
      if (h === 'preview.redd.it') return 'https://i.redd.it' + u.pathname.replace(/^\/[^/]*-(?=[^/-]+\.\w+$)/, '/');
      return null;
    }
    if (h === 'i.ytimg.com' && /\/(default|mqdefault|hqdefault|sddefault|hq720)\.(jpg|webp)$/.test(u.pathname)) {
      return u.origin + u.pathname.replace(/\/[^/]+$/, '/hqdefault.jpg');
    }
    if (/(^|\.)media-amazon\.com$|images-amazon\.com$/.test(h) && /\._[^/]*_\./.test(u.pathname)) {
      return u.origin + u.pathname.replace(/\._[^/]*_\./, '.');
    }
    if (h === 'i.imgur.com' && /[sbtmlh]\.(jpe?g|png|webp)$/.test(u.pathname) && /\/\w{7}[sbtmlh]\./.test(u.pathname)) {
      return u.origin + u.pathname.replace(/(\/\w{7})[sbtmlh]\./, '$1.');
    }
    return null;
  }
  // Largest candidate in srcset
  function bestSrcset(img) {
    const set = img.getAttribute('srcset') || (img.parentElement && img.parentElement.tagName === 'PICTURE'
      ? [...img.parentElement.querySelectorAll('source[srcset]')].map((x) => x.getAttribute('srcset')).join(',') : '');
    let best = null, bw = 0;
    for (const part of set.split(/,\s+/)) {
      const [url, d] = part.trim().split(/\s+/);
      const w = d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1;
      if (url && w > bw) { bw = w; best = url; }
    }
    return best ? new URL(best, location.href).href : null;
  }
  // Does a link really point to an image/video file? (not pages like Wikipedia's "File:Cat.jpg")
  function mediaLink(href) {
    let u;
    try { u = new URL(href); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || /\/[^/]*:[^/]*$/.test(u.pathname)) return null;   // "Dosya:..." / "File:..." pages
    if (VID_EXT.test(u.pathname)) return { url: u.href.replace(/\.gifv(?=[?#]|$)/i, '.mp4'), video: true, sure: true };
    if (IMG_EXT.test(u.pathname)) return { url: upgrade(u.href) || u.href, sure: true };
    return null;
  }
  // Media candidates to show for an element, best first: { url, video, sure, next }
  // "sure": known to be large. If a candidate fails to load, the next one is tried.
  function pick(el) {
    if (!el || el.nodeType !== 1) return null;
    const img = el.tagName === 'IMG' ? el : null;
    const list = [];
    let small = null;
    if (img && img.currentSrc && !/^data:/.test(img.currentSrc)) {
      small = img.getBoundingClientRect();
      if (small.width < 24 || small.height < 24) return null;   // icon, emoji etc.
      const up = upgrade(img.currentSrc);
      if (up && up !== img.currentSrc) list.push({ url: up, sure: true });
    }
    const a = el.closest('a[href]');
    const ml = a && mediaLink(a.href);
    if (ml && (!img || ml.url !== img.currentSrc)) list.push(ml);
    if (small) {
      const ss = bestSrcset(img);
      if (ss && ss !== img.currentSrc) list.push({ url: ss, sure: false, small });
      list.push({ url: img.currentSrc, sure: false, small });
    }
    for (let i = 0; i < list.length - 1; i++) list[i].next = list[i + 1];
    return list[0] || null;
  }

  // ---- Display layer (closed shadow root: site styles don't leak in)
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .box { position:fixed; background:#fff; border-radius:4px; box-shadow:0 4px 18px rgba(0,0,0,.45); overflow:hidden; display:none; }
    .box img, .box video { display:block; width:100%; height:100%; object-fit:contain; }
    .spin { position:fixed; width:18px; height:18px; border-radius:50%; border:3px solid rgba(255,255,255,.35); border-top-color:#fff;
      box-shadow:0 0 0 1px rgba(0,0,0,.35); animation:r .8s linear infinite; display:none; }
    @keyframes r { to { transform:rotate(360deg); } }
    @media (prefers-color-scheme: dark) { .box { background:#202124; } }
    .bd { position:fixed; inset:0; background:rgba(0,0,0,.72); display:none; cursor:zoom-out; }
    :host(.pin) .box { border-radius:0; box-shadow:0 6px 32px rgba(0,0,0,.6); cursor:grab; background:transparent; }
    :host(.pin) .box.drag { cursor:grabbing; }
    :host(.pin) .box img, :host(.pin) .box video { object-fit:fill; user-select:none; -webkit-user-drag:none; }
    .pct { position:fixed; right:16px; bottom:16px; padding:4px 10px; border-radius:12px; background:rgba(0,0,0,.75); color:#fff;
      font:600 13px "Segoe UI", system-ui, sans-serif; display:none; pointer-events:none; }
  </style><div class="bd"></div><div class="box"></div><div class="spin"></div><div class="pct"></div>`;
  const box = root.querySelector('.box'), spin = root.querySelector('.spin'), bd = root.querySelector('.bd'), pct = root.querySelector('.pct');

  let target = null, timer = 0, media = null, mx = 0, my = 0, active = false;
  // Pinned (Z) view: scale and on-screen position of the image's top-left corner
  let pinned = false, wantPin = false, sc = 1, fit = 1, bx = 0, by = 0, drag = null, pctTimer = 0;

  function place() {
    if (!media || pinned) return;
    const nw = media.naturalWidth || media.videoWidth, nh = media.naturalHeight || media.videoHeight;
    if (!nw || !nh) return;
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    // Fit the image on whichever side of the cursor has more room
    const left = mx - PAD * 2, right = vw - mx - PAD * 2;
    const side = right >= left ? 'r' : 'l';
    const room = Math.max(left, right);
    const s = Math.min(1, room / nw, (vh - PAD * 2) / nh);
    const w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
    const x = side === 'r' ? mx + PAD * 2 : mx - PAD * 2 - w;
    const y = Math.min(Math.max(PAD, my - h / 2), vh - h - PAD);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: 'block' });
    spin.style.display = 'none';
  }
  function hide() {
    if (pinned) unpinUi();
    wantPin = false;
    clearTimeout(timer); timer = 0; target = null;
    if (media) { media.onload = media.onerror = media.onloadedmetadata = null; if (media.pause) media.pause(); media.removeAttribute('src'); media = null; }
    box.replaceChildren(); box.style.display = 'none'; spin.style.display = 'none'; host.style.display = 'none';
  }
  function show(p) {
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = 'block';
    Object.assign(spin.style, { left: (mx + 14) + 'px', top: (my + 14) + 'px', display: 'block' });
    const m = document.createElement(p.video ? 'video' : 'img');
    media = m;
    const ready = () => {
      if (media !== m) return;
      const nw = m.naturalWidth || m.videoWidth;
      // Don't bother zooming an image that's already that size
      if (!p.sure && p.small && nw <= p.small.width * 1.25 && (m.naturalHeight || m.videoHeight) <= p.small.height * 1.25) { hide(); return; }
      box.replaceChildren(m); place();
      if (wantPin) pin();
    };
    m.onerror = () => {
      if (media !== m) return;
      if (p.next) { m.onerror = null; media = null; show(p.next); } else hide();
    };
    if (p.video) { m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true; m.onloadedmetadata = ready; }
    else { m.decoding = 'async'; m.onload = ready; }
    m.referrerPolicy = 'no-referrer-when-downgrade';
    m.src = p.url;
  }

  // ---- Z: pin and zoom
  const dims = () => [media.naturalWidth || media.videoWidth, media.naturalHeight || media.videoHeight];
  function draw() {
    const [nw, nh] = dims();
    Object.assign(box.style, { left: bx + 'px', top: by + 'px', width: Math.round(nw * sc) + 'px', height: Math.round(nh * sc) + 'px', display: 'block' });
  }
  function showPct() {
    pct.textContent = '%' + Math.round(sc * 100);
    pct.style.display = 'block';
    clearTimeout(pctTimer); pctTimer = setTimeout(() => { pct.style.display = 'none'; }, 900);
  }
  function fitCenter() {
    const [nw, nh] = dims();
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    fit = Math.min(1, (vw - 40) / nw, (vh - 40) / nh);
    sc = fit;
    bx = (vw - nw * sc) / 2; by = (vh - nh * sc) / 2;
    draw();
  }
  function pin() {
    if (!media || box.style.display !== 'block') { wantPin = true; return; }   // image still loading: pin when it arrives
    wantPin = false; pinned = true;
    host.classList.add('pin');
    host.style.pointerEvents = 'auto';
    bd.style.display = 'block';
    if (media.play) { media.controls = true; media.muted = false; }
    fitCenter(); showPct();
  }
  function unpinUi() {
    pinned = false; drag = null;
    host.classList.remove('pin');
    host.style.pointerEvents = 'none';
    bd.style.display = 'none'; pct.style.display = 'none';
  }
  // Wheel: rescale keeping the point under the cursor fixed
  host.addEventListener('wheel', (e) => {
    if (!pinned) return;
    e.preventDefault(); e.stopPropagation();
    const [nw, nh] = dims();
    const f = Math.pow(1.0015, -e.deltaY);
    const min = Math.min(fit, 1) * 0.2, max = Math.max(8, fit * 8);
    const ns = Math.min(max, Math.max(min, sc * f));
    const ix = (e.clientX - bx) / sc, iy = (e.clientY - by) / sc;
    sc = ns; bx = e.clientX - ix * sc; by = e.clientY - iy * sc;
    draw(); showPct();
  }, { passive: false });
  box.addEventListener('mousedown', (e) => {
    if (!pinned || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    drag = { x: e.clientX, y: e.clientY, bx, by, moved: false };
    box.classList.add('drag');
  });
  host.addEventListener('mousemove', (e) => {
    if (!pinned || !drag) return;
    bx = drag.bx + e.clientX - drag.x; by = drag.by + e.clientY - drag.y;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
    draw();
  });
  host.addEventListener('mouseup', () => { if (drag) { box.classList.remove('drag'); setTimeout(() => { drag = null; }, 0); } });
  box.addEventListener('dblclick', (e) => {
    if (!pinned) return;
    e.preventDefault();
    const [nw, nh] = dims();
    const ix = (e.clientX - bx) / sc, iy = (e.clientY - by) / sc;
    if (Math.abs(sc - 1) < 0.01) { fitCenter(); } else { sc = 1; bx = e.clientX - ix; by = e.clientY - iy; draw(); }
    showPct();
  });
  bd.addEventListener('mousedown', (e) => { if (pinned && e.button === 0) { e.stopPropagation(); hide(); } });

  const onOver = (e) => {
    if (pinned) return;
    const el = e.target;
    if (el === target || el === host) return;
    const p = pick(el);
    if (!p) { if (target && !(target.contains && target.contains(el))) hide(); return; }
    hide();
    target = el; mx = e.clientX; my = e.clientY;
    timer = setTimeout(() => { timer = 0; if (target === el) show(p); }, DELAY);
  };
  const onMove = (e) => { mx = e.clientX; my = e.clientY; if (!pinned && media && box.style.display === 'block') place(); };
  const onOut = (e) => { if (!pinned && target && (!e.relatedTarget || !target.contains(e.relatedTarget))) hide(); };
  const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const onKey = (e) => {
    if (e.key === 'Escape') { if (media || pinned) { hide(); if (pinned) e.stopPropagation(); } return; }
    if (e.key === 'Control' && !pinned) { hide(); return; }
    if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target)) {
      if (pinned) { hide(); e.preventDefault(); e.stopPropagation(); return; }
      if (media || timer) { pin(); e.preventDefault(); e.stopPropagation(); }
    }
  };
  const onDown = (e) => { if (!pinned) hide(); };
  const onWheel = () => { if (!pinned) hide(); };
  const onBlur = () => { if (!pinned) hide(); };
  const opts = { capture: true, passive: true };
  const events = [['mouseover', onOver], ['mousemove', onMove], ['mouseout', onOut], ['mousedown', onDown], ['wheel', onWheel]];
  const keyOpts = { capture: true, passive: false };

  const api = {
    on() { if (active) return; active = true; for (const [n, f] of events) document.addEventListener(n, f, opts); window.addEventListener('keydown', onKey, keyOpts); window.addEventListener('blur', onBlur); },
    off() { if (!active) return; active = false; for (const [n, f] of events) document.removeEventListener(n, f, opts); window.removeEventListener('keydown', onKey, keyOpts); window.removeEventListener('blur', onBlur); pinned && unpinUi(); hide(); host.remove(); }
  };
  Object.defineProperty(window, KEY, { value: api });
  api.on();
})();
