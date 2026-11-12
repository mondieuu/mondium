'use strict';
// Where the window opens: saved state, screens that changed, damaged settings.
const assert = require('assert');
const { sanitize, place, snapshot } = require('../window-state');

const main = { x: 0, y: 0, width: 1920, height: 1040 };         // work area of a 1080p screen with a task bar
const second = { x: 1920, y: 0, width: 1280, height: 1024 };
const left = { x: -1600, y: 100, width: 1600, height: 860 };    // a screen to the left of the main one

// Left as it was
assert.deepStrictEqual(place({ x: 100, y: 80, width: 1000, height: 700, maximized: false }, [main]),
  { bounds: { x: 100, y: 80, width: 1000, height: 700 }, maximized: false });
assert.strictEqual(place({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, [main]).maximized, true, 'maximized comes back maximized');
assert.strictEqual(place({ x: 100, y: 80, width: 1000, height: 700, maximized: 'yes' }, [main]).maximized, false, 'only a real true counts');

// Second screen kept, and left screens with negative coordinates too
assert.deepStrictEqual(place({ x: 2000, y: 50, width: 900, height: 600 }, [main, second]).bounds, { x: 2000, y: 50, width: 900, height: 600 });
assert.deepStrictEqual(place({ x: -1500, y: 150, width: 900, height: 600 }, [left, main]).bounds, { x: -1500, y: 150, width: 900, height: 600 });

// Second screen unplugged: the window was entirely on it, so the normal placement is used
assert.strictEqual(place({ x: 2000, y: 50, width: 900, height: 600 }, [main]), null);
// Only a sliver left on screen: also lost
assert.strictEqual(place({ x: 1880, y: 50, width: 900, height: 600 }, [main]), null);
// A lot of it still on the main screen: it is pulled fully inside
assert.deepStrictEqual(place({ x: 1400, y: 50, width: 900, height: 600 }, [main]).bounds, { x: 1020, y: 50, width: 900, height: 600 });
// Bigger than the screen now: cut down to the screen
assert.deepStrictEqual(place({ x: 0, y: 0, width: 2500, height: 1400 }, [main]).bounds, { x: 0, y: 0, width: 1920, height: 1040 });
// Under the task bar or above the screen: moved back in
assert.deepStrictEqual(place({ x: 100, y: 1000, width: 1000, height: 700 }, [main]).bounds, { x: 100, y: 340, width: 1000, height: 700 });
assert.deepStrictEqual(place({ x: 100, y: -300, width: 1000, height: 700 }, [main]).bounds, { x: 100, y: 0, width: 1000, height: 700 });
// Across two screens: the one it overlaps most wins (780 px on the second, 220 px on the main), whatever the list order
assert.deepStrictEqual(place({ x: 1700, y: 0, width: 1000, height: 600 }, [main, second]).bounds, { x: 1920, y: 0, width: 1000, height: 600 });
assert.strictEqual(place({ x: 1700, y: 0, width: 1000, height: 600 }, [second, main]).bounds.x, 1920);
assert.strictEqual(place({ x: 1000, y: 0, width: 1000, height: 600 }, [second, main]).bounds.x, 920, 'mostly on the main screen: pulled onto it');

// Nothing saved, nothing usable
assert.strictEqual(place(null, [main]), null);
assert.strictEqual(place(undefined, [main]), null);
assert.strictEqual(place({ x: 100, y: 80, width: 1000, height: 700 }, []), null, 'no screens');
assert.strictEqual(place({ x: 100, y: 80, width: 1000, height: 700 }, null), null);

// Damaged or edited settings
for (const bad of ['text', 5, [], { x: 'a', y: 0, width: 1000, height: 700 }, { x: 0, y: 0, width: NaN, height: 700 },
  { x: 0, y: 0, width: 100, height: 700 }, { x: 0, y: 0, width: 1000, height: 100 }, { x: 0, y: 0, width: 1e9, height: 700 },
  { x: 1e9, y: 0, width: 1000, height: 700 }, { x: Infinity, y: 0, width: 1000, height: 700 }, { x: 0, y: 0, width: '1000', height: 700 }]) {
  assert.strictEqual(sanitize(bad), null, JSON.stringify(bad));
  assert.strictEqual(place(bad, [main]), null, JSON.stringify(bad));
}
assert.deepStrictEqual(sanitize({ x: 10.4, y: 20.6, width: 1000.2, height: 700.7, extra: 'x' }), { x: 10, y: 21, width: 1000, height: 701, maximized: false }, 'rounded, extra keys dropped');

// What gets stored from a live window
const fake = (o) => ({ isDestroyed: () => false, isFullScreen: () => false, isMinimized: () => false, isMaximized: () => false, getNormalBounds: () => ({ x: 10, y: 20, width: 900, height: 600 }), ...o });
assert.deepStrictEqual(snapshot(fake({ isMaximized: () => true })), { x: 10, y: 20, width: 900, height: 600, maximized: true }, 'normal bounds are kept while maximized');
assert.strictEqual(snapshot(fake({ isFullScreen: () => true })), null, 'fullscreen does not change what is stored');
assert.strictEqual(snapshot(fake({ isMinimized: () => true })), null, 'minimized does not change what is stored');
assert.strictEqual(snapshot(fake({ isDestroyed: () => true })), null);
assert.strictEqual(snapshot(fake({ getNormalBounds: () => { throw new Error('gone'); } })), null, 'a window that fails to answer is skipped');
assert.strictEqual(snapshot(null), null);

console.log('Window state tests passed.');
