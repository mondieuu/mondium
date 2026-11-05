'use strict';
// Widevine VMP signing (castLabs EVS). Services like Netflix, Disney+, Exxen, BluTV, Spotify
// may refuse DRM video in an unsigned browser. Signing needs a free castLabs EVS account:
// running "vmp-create-account.bat" once is enough.
// On Windows, sign AFTER the exe resources (icon etc.) are written -> afterSign.
// On macOS, sign BEFORE code signing -> afterPack.
const { execFileSync } = require('child_process');

function trySign(dir) {
  for (const py of ['python', 'py', 'python3']) {
    try {
      execFileSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], { stdio: 'inherit' });
      console.log('  • Widevine VMP signing done');
      return;
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;   // this python command doesn't exist, try the next
      break;
    }
  }
  console.warn('  • WARNING: Widevine VMP signing failed. DRM sites (Netflix etc.) may not play video.');
  console.warn('    To fix, run "vmp-create-account.bat" once, then rebuild the installer.');
}

// The same file serves two hooks: Windows -> afterSign, macOS -> afterPack
function make(platformWanted) {
  return async function (context) {
    if (context.electronPlatformName === platformWanted) trySign(context.appOutDir);
  };
}
module.exports = { trySign, afterSignWin: make('win32'), afterPackMac: make('darwin') };
