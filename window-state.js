'use strict';
// Remembers where the window was and whether it was maximized, so Mondium opens the way it was left.
// Stored: the normal (not maximized) bounds and a maximized flag. Fullscreen is not restored (like Chrome).

const MIN_W = 500, MIN_H = 320;   // the window's own minimum size
const VISIBLE_W = 150, VISIBLE_H = 40;   // at least this much (the tab strip is about 40 px) must be on a screen, or it counts as lost

const int = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);

// Anything that is not a plausible window rectangle is dropped (the settings file can be edited or damaged).
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = int(raw.x), y = int(raw.y), width = int(raw.width), height = int(raw.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < MIN_W || height < MIN_H || width > 20000 || height > 20000) return null;
  if (Math.abs(x) > 100000 || Math.abs(y) > 100000) return null;
  return { x, y, width, height, maximized: raw.maximized === true };
}

// Puts the saved window on a screen that exists now: the one it overlaps most, moved inside it and cut down to fit.
// null = it would not be reachable (screen unplugged, resolution changed): the caller uses its normal placement.
function place(raw, workAreas) {
  const s = sanitize(raw);
  if (!s || !Array.isArray(workAreas)) return null;
  let best = null, bestArea = 0;
  for (const wa of workAreas) {
    const w = Math.min(s.x + s.width, wa.x + wa.width) - Math.max(s.x, wa.x);
    const h = Math.min(s.y + s.height, wa.y + wa.height) - Math.max(s.y, wa.y);
    if (w >= VISIBLE_W && h >= VISIBLE_H && w * h > bestArea) { best = wa; bestArea = w * h; }
  }
  if (!best) return null;
  const width = Math.min(s.width, best.width), height = Math.min(s.height, best.height);
  return {
    bounds: {
      x: Math.max(best.x, Math.min(s.x, best.x + best.width - width)),
      y: Math.max(best.y, Math.min(s.y, best.y + best.height - height)),
      width, height
    },
    maximized: s.maximized
  };
}

// What to store for a window right now, or null when it should not change what is stored (fullscreen, minimized, gone).
function snapshot(win) {
  try {
    if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return null;
    const b = win.getNormalBounds();
    return sanitize({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
  } catch { return null; }
}

module.exports = { sanitize, place, snapshot, MIN_W, MIN_H };
