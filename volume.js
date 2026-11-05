// Mondium volume boost: routes the tab's video/audio elements through a Web Audio gain node.
// The main process prepends "const GAIN = <number>;" and runs it in every frame (isolated world in the main frame).
// Re-running only updates the gain; nodes are built once per element (no leak, WeakMap).
// Cross-origin media without CORS goes SILENT when connected to Web Audio, so it is left alone.
(() => {
  const KEY = Symbol.for('mondium.volume');
  let s = window[KEY];
  if (!s) {
    if (GAIN === 1) return 0;                       // don't set up on a page that was never boosted
    s = { ctx: null, gain: null, limit: null, boosted: false, linked: new WeakMap(), count: 0 };
    Object.defineProperty(window, KEY, { value: s });
    const safe = (el) => {
      const src = el.currentSrc || '';
      if (!src) return false;                         // not loaded yet; retried on play
      if (/^(blob|data|mediastream):/i.test(src)) return true;   // YouTube, Twitch etc. (MSE)
      try { if (new URL(src, location.href).origin === location.origin) return true; } catch { return false; }
      return el.crossOrigin != null;                  // cross-origin media loaded with CORS
    };
    s.hook = (el) => {
      if (s.linked.has(el) || !safe(el)) return;
      try {
        if (!s.ctx) {
          s.ctx = new AudioContext();
          s.gain = s.ctx.createGain();
          // Limiter: reduces clipping at high gain; active only above 100%
          s.limit = s.ctx.createDynamicsCompressor();
          s.limit.threshold.value = -3; s.limit.knee.value = 3; s.limit.ratio.value = 20;
          s.limit.attack.value = 0.002; s.limit.release.value = 0.2;
          s.limit.connect(s.ctx.destination);
          s.route();
        }
        const n = s.ctx.createMediaElementSource(el);
        n.connect(s.gain);
        s.linked.set(el, n);
        s.count++;
        if (s.ctx.state === 'suspended') s.ctx.resume().catch(() => {});
      } catch {}
    };
    s.route = () => {
      if (!s.gain) return;
      s.gain.gain.value = s.value;
      const want = s.value > 1;
      if (s.boosted === want && s.routed) return;
      try { s.gain.disconnect(); } catch {}
      s.gain.connect(want ? s.limit : s.ctx.destination);
      s.boosted = want; s.routed = true;
    };
    document.addEventListener('play', (e) => {
      const el = e.target;
      if (s.value !== 1 && (el instanceof HTMLMediaElement)) s.hook(el);
      if (s.ctx && s.ctx.state === 'suspended') s.ctx.resume().catch(() => {});
    }, true);
  }
  s.value = GAIN;
  if (s.value !== 1) document.querySelectorAll('video, audio').forEach(s.hook);
  s.route();
  return s.count;
})();
