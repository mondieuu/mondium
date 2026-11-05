'use strict';
// Widevine VMP imzasi (castLabs EVS). Netflix, Disney+, Exxen, BluTV, Spotify gibi servisler
// imzasiz tarayicida DRM'li videoyu oynatmayi reddedebilir. Imza ucretsiz bir castLabs EVS hesabi ister:
// bir kez "vmp-hesap-olustur.bat" calistirmak yeterli.
// Windows'ta imza, exe'nin kaynaklari (ikon vb.) yazildiktan SONRA atilmali -> afterSign.
// macOS'ta kod imzasindan ONCE atilmali -> afterPack.
const { execFileSync } = require('child_process');

function trySign(dir) {
  for (const py of ['python', 'py', 'python3']) {
    try {
      execFileSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], { stdio: 'inherit' });
      console.log('  • Widevine VMP imzasi tamam');
      return;
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;   // bu python komutu yok, digerini dene
      break;
    }
  }
  console.warn('  • UYARI: Widevine VMP imzasi atilamadi. DRM\'li siteler (Netflix vb.) video oynatmayabilir.');
  console.warn('    Duzeltmek icin bir kez "vmp-hesap-olustur.bat" calistirin, sonra kurulum dosyasini yeniden olusturun.');
}

// Ayni dosya iki kancada kullanilir: Windows -> afterSign, macOS -> afterPack
function make(platformWanted) {
  return async function (context) {
    if (context.electronPlatformName === platformWanted) trySign(context.appOutDir);
  };
}
module.exports = { trySign, afterSignWin: make('win32'), afterPackMac: make('darwin') };
