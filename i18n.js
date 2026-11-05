'use strict';
// Mondium UI translations. The source language is Turkish; this file maps Turkish UI strings to English.
// Used in two places:
//  - Main process: require('./i18n').translate(text, lang) for native menus, dialogs and notifications.
//  - Internal pages and the browser UI: <script src="i18n.js"> translates text nodes and a few attributes as they appear
//    (MutationObserver). When the language is Turkish nothing is installed, so it costs nothing.
// Strings built from several parts are translated where they are built (see L() in the pages).
(function (root) {
  const EN = {
    // ---- Permissions and bubbles
    'Konumunuzu bilmek': 'Know your location',
    'Bildirim göstermek': 'Show notifications',
    'Ekranınızı görmek': 'See your screen',
    'Bilgisayarınızdaki bir uygulamayı açmak': 'Open an app on your computer',
    'Kameranızı kullanmak': 'Use your camera',
    'Mikrofonunuzu kullanmak': 'Use your microphone',
    'Tüm web sitelerindeki verilerinizi okuyup değiştirebilir': 'Read and change all your data on all websites',
    'Şu sitelerdeki verilerinizi okuyup değiştirebilir:': 'Read and change your data on these sites:',
    'Tarama geçmişinizi okuyup değiştirebilir': 'Read and change your browsing history',
    'Tarama geçmişinizi okuyabilir': 'Read your browsing history',
    'Yer işaretlerinizi okuyup değiştirebilir': 'Read and change your bookmarks',
    'İndirmelerinizi yönetebilir': 'Manage your downloads',
    'Kopyaladığınız verileri okuyabilir': 'Read data you copy',
    'Kopya-yapıştır verilerini değiştirebilir': 'Change data you copy and paste',
    'Kopyala-yapıştır verilerini değiştirebilir': 'Change data you copy and paste',
    'Konumunuzu bilebilir': 'Know your location',
    'Bildirim gösterebilir': 'Show notifications',
    'Uygulamalarınızı, uzantılarınızı ve temalarınızı yönetebilir': 'Manage your apps, extensions and themes',
    'Ekranınızın içeriğini yakalayabilir': 'Capture the content of your screen',
    'Gizlilik ayarlarınızı değiştirebilir': 'Change your privacy settings',
    'Ağ trafiğinizi başka sunucuya yönlendirebilir': 'Route your network traffic through another server',
    'Bilgisayarınızdaki uygulamalarla iletişim kurabilir': 'Communicate with apps on your computer',
    'Sayfalarda kendi betiklerini çalıştırabilir': 'Run its own scripts on pages',
    'Özel izin gerektirmiyor': 'Requires no special permissions',
    'Şunları yapabilir:': 'It can:',
    'İzin ver': 'Allow',
    'Engelle': 'Block',
    'İndirme tamamlandı': 'Download complete',
    'HID cihazı': 'HID device',
    'USB cihazı': 'USB device',
    'seri bağlantı noktası': 'serial port',
    'Bluetooth cihazı': 'Bluetooth device',
    'Bilinmeyen HID cihazı': 'Unknown HID device',
    'Bilinmeyen USB cihazı': 'Unknown USB device',
    'Seri bağlantı noktası': 'Serial port',
    'Eşleştir': 'Pair',
    'İptal': 'Cancel',
    'Bluetooth cihazı eşleştirilsin mi?': 'Pair the Bluetooth device?',
    'Bu cihaz PIN girişi istiyor. Önce Windows Bluetooth ayarlarından eşleştirin.': 'This device asks for a PIN. Pair it in Windows Bluetooth settings first.',
    'bir seri bağlantı noktasına bağlanmak istiyor': 'wants to connect to a serial port',
    'bir HID cihazına bağlanmak istiyor': 'wants to connect to a HID device',
    'bir USB cihazına bağlanmak istiyor': 'wants to connect to a USB device',
    'bir Bluetooth cihazıyla eşleşmek istiyor': 'wants to pair with a Bluetooth device',
    'bir cihaza bağlanmak istiyor': 'wants to connect to a device',
    'Bu site': 'This site',
    'Uyumlu cihaz aranıyor...': 'Looking for compatible devices...',
    'Cihazın takılı ve açık olduğundan emin olun.': 'Make sure the device is plugged in and turned on.',
    'Bağlan': 'Connect',

    // ---- Pages and tabs
    'Sayfa açılamadı': 'This page could not be opened',
    'Sayfa çöktü - yenileyin': 'The page crashed - reload',
    'Yeni Sekme': 'New Tab',
    'Yeni sekme': 'New tab',
    'Dosya aç': 'Open file',
    'Web sayfaları ve belgeler': 'Web pages and documents',
    'Tüm dosyalar': 'All files',
    'Tarayıcı sayfası': 'Browser page',
    'Bağlantı güvenli': 'Connection is secure',
    'Bağlantı güvenli değil': 'Connection is not secure',
    '(Uyutuldu - bellek boşaltıldı)': '(Asleep - memory freed)',
    '(Sesi kapalı)': '(Muted)',
    'Sekmenin sesini aç': 'Unmute tab',
    'Sekmenin sesini kapat': 'Mute tab',
    'Sekmeyi kapat': 'Close tab',
    'Gizli': 'Incognito',
    'Gizli pencere': 'Incognito window',
    'Gizli pencere: geçmiş, çerezler ve site verileri pencere kapanınca silinir': 'Incognito window: history, cookies and site data are deleted when the window closes',

    // ---- Settings dialogs
    'Şimdi yeniden başlat': 'Restart now',
    'Sonra': 'Later',
    'Bu ayar tarayıcı yeniden başlatılınca uygulanır.': 'This setting takes effect after the browser restarts.',
    'Google hesabı gerekmez, telemetri yok, reklam engelleyici her zaman açık.': 'No Google account needed, no telemetry, ad blocker always on.',

    // ---- Task manager
    'Sekme': 'Tab',
    'Tarayıcı (ana süreç)': 'Browser (main process)',
    'GPU süreci': 'GPU process',
    'Yardımcı süreç': 'Utility process',
    'Arayüz / uzantı': 'Interface / extension',
    'Görev yöneticisi': 'Task manager',
    'Arka plan sekmelerini şimdi uyut': 'Put background tabs to sleep now',
    'Kapat': 'Close',

    // ---- Extensions
    'Uzantı açılamadı': 'Could not open the extension',
    'Her uzantı arka planda çalışır ve biraz RAM kullanır.': 'Every extension runs in the background and uses some RAM.',
    'Uzantı ekle': 'Add extension',
    'Uzantı klasörünü seç (manifest.json olan klasör)': 'Select the extension folder (the one with manifest.json)',
    'Uzantı yüklenemedi': 'Could not load the extension',
    'Kaldır': 'Remove',
    'Uzantının dosyaları ve ayarları silinir.': "The extension's files and settings will be deleted.",
    'Kaldırılamadı': 'Could not remove',
    'Uzantı desteği yüklenemedi. Klasörde "npm install" komutunu tekrar çalıştırın.': 'Extension support could not be loaded. Run "npm install" again in the folder.',
    'Uzantıları yönet': 'Manage extensions',
    "Chrome Web Mağazası'nı ziyaret et": 'Visit the Chrome Web Store',
    'Açık uzantı yok. Her uzantı biraz RAM kullanır; sadece gerekenleri ekleyin.': 'No extensions are on. Each extension uses some RAM; add only the ones you need.',
    '- seçenekleri aç': '- open options',
    'Araç çubuğunda göster': 'Show in toolbar',
    'Araç çubuğundan gizle': 'Hide from toolbar',
    'Paketlenmemiş': 'Unpacked',
    'Mondium ile gelir': 'Built into Mondium',
    'Seçenekler': 'Options',
    'Araç çubuğunda gizli. Göstermek için tıklayın.': 'Hidden from the toolbar. Click to show.',
    'Araç çubuğunda görünüyor. Gizlemek için tıklayın.': 'Shown in the toolbar. Click to hide.',
    'Açık. Kapatınca uzantı hiç yüklenmez, RAM harcamaz.': 'On. When turned off, the extension is not loaded at all and uses no RAM.',
    'Kapalı': 'Off',
    'Yerleşik reklam engelleyici, her zaman açık': 'Built-in ad blocker, always on',
    'Aramanızla eşleşen uzantı yok.': 'No extensions match your search.',
    "Henüz uzantı yok. Chrome Web Mağazası'ndan ekleyebilirsiniz.": 'No extensions yet. You can add some from the Chrome Web Store.',
    "Web Mağazası'nı aç": 'Open Web Store',
    'Geliştirici modu': 'Developer mode',
    'Uzantılarım': 'My extensions',
    'Yerleşik araçlar (Ayarlar)': 'Built-in tools (Settings)',
    'Her açık uzantı arka planda çalışır ve RAM kullanır. Kullanmadıklarınızı kapatın; kapalı uzantı hiç yüklenmez.': "Every extension that is on runs in the background and uses RAM. Turn off the ones you don't use; an extension that is off is not loaded at all.",
    'Paketlenmemiş öğe yükle': 'Load unpacked',
    'Uzantılarda ara': 'Search extensions',
    'Kimlik:': 'ID:',
    'Hiçbir siteye cihaz izni verilmemiş.': 'No site has been given device access.',
    'Tümünü kaldır': 'Remove all',
    'Cihaz izinleri': 'Device permissions',

    // ---- Site menu / protected sites (native)
    'Bu siteyi temizlikten koru': 'Protect this site from clearing',
    'Bunları da koru': 'Protect these too',
    'Gerek yok': 'No need',
    'Çerezler ve site verileri...': 'Cookies and site data...',
    'Önbellek temizlenmedi: motor önbellekte zaman aralığını desteklemiyor. Önbelleği temizlemek için "Tüm zamanlar"ı seçin.': 'Cache was not cleared: the engine does not support a time range for the cache. Choose "All time" to clear the cache.',

    // ---- Reload / shield / bookmarks (native menus)
    'Normal yeniden yükleme': 'Normal reload',
    'Sert yeniden yükleme': 'Hard reload',
    'Önbelleği boşalt ve sert yeniden yükle': 'Empty cache and hard reload',
    'Reklam engelleyici: AÇIK': 'Ad blocker: ON',
    'Reklam engelleyici yükleniyor...': 'Ad blocker is loading...',
    'Filtre listelerini şimdi güncelle': 'Update filter lists now',
    'Filtre listeleri güncellendi.': 'Filter lists updated.',
    '(boş)': '(empty)',
    'Tümünü yeni sekmelerde aç': 'Open all in new tabs',
    'Yer işaretlerini yönet...': 'Manage bookmarks...',
    'Yer işaretleri okunamadı.': 'Could not read the bookmarks.',
    'Yer işareti dosyasını seçin': 'Choose a bookmarks file',
    'Yer işaretleri (HTML)': 'Bookmarks (HTML)',
    'Dosya okunamadı.': 'Could not read the file.',
    'Dosyada yer işareti bulunamadı.': 'No bookmarks found in the file.',
    'HTML dosyası': 'HTML file',
    'Yer işaretleri çubuğunu gizle': 'Hide bookmarks bar',
    'Aç': 'Open',
    'Yeni sekmede aç': 'Open in new tab',
    'Adresi kopyala': 'Copy address',
    'Sola taşı': 'Move left',
    'Sağa taşı': 'Move right',
    'Sil': 'Delete',

    // ---- Downloads bubble
    'başarısız': 'failed',
    'Klasörde göster': 'Show in folder',
    'İptal et': 'Cancel',
    'İndirme yok': 'No downloads',
    'Tüm indirilenler': 'All downloads',
    'İndirilenler klasörünü aç': 'Open Downloads folder',

    // ---- Tab / page context menus
    'Yenile': 'Reload',
    'Kopyala': 'Copy',
    'Sabitlemeyi kaldır': 'Unpin',
    'Sabitle': 'Pin',
    'Sitenin sesini aç': 'Unmute site',
    'Sitenin sesini kapat': 'Mute site',
    'Yatay sekmelere geç': 'Switch to horizontal tabs',
    'Dikey sekmelere geç': 'Switch to vertical tabs',
    'Kenar çubuğunu otomatik gizle': 'Auto-hide sidebar',
    'Yer işareti koy': 'Bookmark',
    'Diğer sekmeleri kapat': 'Close other tabs',
    'Sağdaki sekmeleri kapat': 'Close tabs to the right',
    'Kapatılan sekmeyi yeniden aç': 'Reopen closed tab',
    'Bağlantıyı yeni sekmede aç': 'Open link in new tab',
    'Bağlantıyı farklı kaydet...': 'Save link as...',
    'Bağlantı adresini kopyala': 'Copy link address',
    'Resmi yeni sekmede aç': 'Open image in new tab',
    'Resmi kaydet': 'Save image',
    'Resmi kopyala': 'Copy image',
    'Resim adresini kopyala': 'Copy image address',
    'Geri al': 'Undo',
    'Yinele': 'Redo',
    'Kes': 'Cut',
    'Yapıştır': 'Paste',
    'Tümünü seç': 'Select all',
    'Resim içinde resim': 'Picture in picture',
    'Döngü': 'Loop',
    'Denetimleri göster': 'Show controls',
    'Videoyu farklı kaydet...': 'Save video as...',
    'Sesi farklı kaydet...': 'Save audio as...',
    'Geri': 'Back',
    'İleri': 'Forward',
    'Yeniden yükle': 'Reload',
    'Farklı kaydet...': 'Save as...',
    'Yazdır...': 'Print...',
    'Sayfa kaynağını görüntüle': 'View page source',
    'Okuma modu': 'Reading mode',
    'İncele': 'Inspect',
    'Bu sayfada okuma modunda gösterilecek bir yazı bulunamadı.': 'No article was found on this page to show in reading mode.',
    'Ses düzeyi': 'Volume',
    'Ses seviyesi': 'Volume',

    // ---- Themes and search engines
    'Sistem': 'System',
    'Açık': 'Light',
    'Koyu': 'Dark',
    'Mavi': 'Blue',
    'Yeşil': 'Green',
    'Mor': 'Purple',
    'Turuncu': 'Orange',
    'Pembe': 'Pink',
    'Gece mavisi': 'Midnight',
    'Orman': 'Forest',
    'Mürdüm': 'Plum',
    'Brave Search': 'Brave Search',

    // ---- Misc main
    'izin yok': 'not allowed',
    'Geçersiz site': 'Invalid site',
    'Kaynak bulunamadı.': 'Source not found.',
    'Geçerli bir adres girin (ör. youtube.com)': 'Enter a valid address (e.g. youtube.com)',

    // ---- Browser UI (toolbar, omnibox, menus)
    'Siteye git': 'Go to site',
    'ile ara': 'search',
    'Bu sayfanın yüklenmesini durdur': 'Stop loading this page',
    'Yeniden yükle (Ctrl+R)': 'Reload (Ctrl+R)',
    'Yeniden yükle (Ctrl+R) - sağ tık: diğer seçenekler': 'Reload (Ctrl+R) - right-click: more options',
    'Yer işaretini kaldır (Ctrl+D)': 'Remove bookmark (Ctrl+D)',
    'Bu sayfaya yer işareti koy (Ctrl+D)': 'Bookmark this page (Ctrl+D)',
    '(bu sekme)': '(this tab)',
    'Bu sayfada ses ayarı yok': 'No volume control on this page',
    'Kenar çubuğunu sabitle (Ctrl+S)': 'Pin sidebar (Ctrl+S)',
    'Kenar çubuğunu gizle (Ctrl+S)': 'Hide sidebar (Ctrl+S)',
    'Hızlı erişim için yer işaretlerinizi buraya, yer işaretleri çubuğuna ekleyin (Ctrl+D).': 'For quick access, place your bookmarks here on the bookmarks bar (Ctrl+D).',
    'Yeni pencere': 'New window',
    'Yeni gizli pencere': 'New incognito window',
    'Yer işaretleri': 'Bookmarks',
    'Yer işaretini kaldır': 'Remove bookmark',
    'Bu sayfaya yer işareti koy': 'Bookmark this page',
    'Yer işaretleri çubuğunu göster': 'Show bookmarks bar',
    'Yer işaretlerini içe aktar...': 'Import bookmarks...',
    'Geçmiş': 'History',
    'Son kapatılanlar': 'Recently closed',
    'İndirilenler': 'Downloads',
    'Uzantılar': 'Extensions',
    'Diğer araçlar': 'More tools',
    'Görev yöneticisi (RAM kullanımı)': 'Task manager (RAM usage)',
    'Geliştirici araçları': 'Developer tools',
    'Tema': 'Theme',
    'Arama motoru': 'Search engine',
    'Ayarlar': 'Settings',
    'Mondium hakkında': 'About Mondium',
    'Çıkış': 'Exit',
    'Yakınlaştır': 'Zoom',
    'Sıfırla (Ctrl+0)': 'Reset (Ctrl+0)',
    'Küçült (Ctrl+-)': 'Zoom out (Ctrl+-)',
    'Büyüt (Ctrl++)': 'Zoom in (Ctrl++)',
    'Normale döndür': 'Reset to normal',
    'Sadece bu sekme için': 'For this tab only',
    'Yeni sekme (Ctrl+T)': 'New tab (Ctrl+T)',
    'Geri (Alt+Sol ok)': 'Back (Alt+Left arrow)',
    'İleri (Alt+Sağ ok)': 'Forward (Alt+Right arrow)',
    'Ana sayfa': 'Home',
    'Arama yapın veya URL yazın': 'Search or type a URL',
    'Ses yükseltme': 'Volume booster',
    'İndirilenler (Ctrl+J)': 'Downloads (Ctrl+J)',
    "Mondium'u özelleştir ve yönet": 'Customize and control Mondium',
    'Sayfada bul': 'Find in page',
    'Önceki (Shift+Enter)': 'Previous (Shift+Enter)',
    'Sonraki (Enter)': 'Next (Enter)',
    'Kapat (Esc)': 'Close (Esc)',
    'Pencereyi taşımak için sürükleyin': 'Drag to move the window',
    'Genişliği ayarlamak için sürükleyin': 'Drag to adjust the width',
    'Uzantılar (Ctrl+Shift+E)': 'Extensions',
    'Simge durumuna küçült': 'Minimize',
    'Ekranı kapla': 'Maximize',

    // ---- Settings page
    'Görünüm': 'Appearance',
    'Boş bırakılırsa gizlenir': 'Hidden if left empty',
    'Yeni sekme başlığı': 'New tab title',
    'Yeni sekme sayfasındaki büyük yazı. Sayfada başlığa çift tıklayarak da değiştirebilirsiniz.': 'The large text on the new tab page. You can also change it by double-clicking the title on the page.',
    'Yer işaretleri çubuğunu göster ': 'Show bookmarks bar',
    'Adres çubuğunda tam URL göster': 'Show full URLs in the address bar',
    'Kapalıyken "https://www." kısmı gizlenir.': 'When off, the "https://www." part is hidden.',
    'Tüm sayfaları koyu göster': 'Show all pages dark',
    'Siteleri zorla koyu renge çevirir. Yeniden başlatma gerekir.': 'Forces websites into dark colors. Requires a restart.',
    'Koyu temada tam siyah (pitch black)': 'Pitch black in dark mode',
    'Koyu temada ve sistem koyuyken çerçeve, araç çubuğu ve Mondium sayfaları tam siyah olur (OLED ekranlar için).': 'In the dark theme, or when the system is dark, the frame, toolbar and Mondium pages become pure black (for OLED screens).',
    'Dikey sekmeler': 'Vertical tabs',
    'Sekmeler solda kenar çubuğunda listelenir. Genişliği kenar çubuğunun sağ kenarını sürükleyerek ayarlarsınız; en dar halinde sadece simgeler görünür.': 'Tabs are listed in a sidebar on the left. Drag the right edge of the sidebar to change its width; at its narrowest only icons are shown.',
    'Kenar çubuğunu otomatik gizle (Ctrl+S)': 'Auto-hide sidebar (Ctrl+S)',
    'Kenar çubuğu gizlenir, sayfa tam genişlikte görünür. Fareyi ekranın sol kenarına götürünce ayarladığınız genişlikte açılır.': 'The sidebar is hidden and the page uses the full width. Move the mouse to the left edge of the screen and it slides in at the width you set.',
    'Kenar algılama genişliği (piksel)': 'Edge detection width (pixels)',
    'Kenar algılama genişliği (px) - geçici test ayarı': 'Edge detection width (px) - temporary test setting',
    'Fare ekranın sol kenarından bu kadar piksel içerideyken kenar çubuğu açılır (1-60).': 'The sidebar opens when the mouse is within this many pixels of the left edge of the screen (1-60).',
    'Sekmelerde ses simgesini göster': 'Show the sound icon on tabs',
    'Kapalıyken sekmelerde hoparlör simgesi görünmez ve sekmeyi sessize alma tamamen devre dışı kalır.': 'When off, tabs show no speaker icon and muting tabs is turned off completely.',
    'Dil': 'Language',
    'Dil / Language': 'Language / Dil',
    'Arayüz dili. "Otomatik" Windows dilini kullanır.': 'Interface language. "Automatic" follows the Windows language.',
    'Otomatik (sistem dili)': 'Automatic (system language)',
    '5 dakika': '5 minutes',
    '10 dakika': '10 minutes',
    '30 dakika': '30 minutes',
    '1 saat': '1 hour',
    'Adres çubuğunda kullanılan arama motoru': 'Search engine used in the address bar',
    "Yazdıklarınız siz Enter'a basana kadar hiçbir yere gönderilmez.": 'Nothing you type is sent anywhere until you press Enter.',
    'Başlangıç': 'On startup',
    'Önceki sekmeleri geri aç': 'Restore previous tabs',
    'Açılışta sekmeler uyutulmuş gelir; sadece tıkladığınız yüklenir, RAM harcanmaz.': "Tabs come back asleep at startup; only the one you click loads, so they don't use RAM.",
    'Performans': 'Performance',
    'Kullanılmayan sekmeleri uyut': 'Put unused tabs to sleep',
    'Arka planda bir süre açılmayan sekme bellekten boşaltılır, tıklayınca yeniden yüklenir. Ses çalan sekmeler uyutulmaz. Uyuyan sekmeler soluk görünür.': "A background tab you haven't opened for a while is unloaded from memory and reloads when you click it. Tabs playing audio are never put to sleep. Sleeping tabs look faded.",
    'Uyutma süresi': 'Sleep after',
    'Sekme bu süre boyunca açılmazsa uyutulur.': "A tab is put to sleep if you don't open it for this long.",
    'Hangi sekmenin ne kadar RAM kullandığını gösterir (Shift+Esc).': 'Shows how much RAM each tab uses (Shift+Esc).',
    'Gizlilik ve güvenlik': 'Privacy and security',
    'Gezinti verilerini temizle': 'Clear browsing data',
    'Geçmiş, çerezler, site verileri ve önbellek; korunan siteler hariç tutulabilir (Ctrl+Shift+Delete).': 'History, cookies, site data and cache; protected sites can be kept (Ctrl+Shift+Delete).',
    'Temizle': 'Clear',
    'Sitelerde oturumum açık kalsın': 'Keep me signed in to sites',
    'Giriş yaptığınız siteler tarayıcı kapanıp açılınca da sizi hatırlar. Bilgiler sadece bu bilgisayarda saklanır, 30 gün kullanılmazsa silinir.': 'Sites you sign in to remember you after the browser restarts. The data stays on this computer and is deleted after 30 days of no use.',
    'Kapanışta Google verilerini sil': 'Delete Google data on exit',
    'Açıkken Google, YouTube ve Gmail oturumunuz her kapanışta kapanır.': 'When on, you are signed out of Google, YouTube and Gmail every time you exit.',
    'Her siteyi ayrı süreçte çalıştır (tam site izolasyonu)': 'Run every site in its own process (full site isolation)',
    'Chrome gibi her site ve gömülü üçüncü taraf ayrı süreçte çalışır: biraz daha güvenli, ama çok daha fazla RAM (6 sitede ~1,8 GB fazla). Kapalıyken giriş, ödeme ve korunan siteler yine ayrı süreçte. Yeniden başlatma gerekir.': 'Like Chrome, every site and embedded third party runs in its own process: slightly more secure, but much more RAM (~1.8 GB more with 6 sites). When off, sign-in, payment and protected sites still get their own process. Requires a restart.',
    'Site izinlerini sıfırla': 'Reset site permissions',
    'Kaydedilmiş izin kararı yok.': 'No saved permission decisions.',
    'Sıfırla': 'Reset',
    'Site izinleri sıfırlandı': 'Site permissions reset',
    'Göster': 'Show',
    'uBlock Origin (önerilen)': 'uBlock Origin (recommended)',
    'Mondium hafif motor': 'Mondium light engine',
    'Reklam engelleyici': 'Ad blocker',
    'uBlock Origin en güçlü engelleme (YouTube dahil), ama yaklaşık 250 MB daha fazla RAM kullanır. Hafif motor aynı filtre listelerini çok daha az RAM ile kullanır, YouTube reklamlarını her zaman engelleyemez. Değişiklik yeniden başlatınca uygulanır.': "uBlock Origin blocks the most (including YouTube) but uses about 250 MB more RAM. The light engine uses the same filter lists with much less RAM but can't always block YouTube ads. Takes effect after a restart.",
    'Her zaman açık. Filtre listeleri, kendi kurallarınız ve site istisnaları uBlock Origin ayarlarında.': 'Always on. Filter lists, your own rules and site exceptions are in the uBlock Origin settings.',
    'uBlock Origin ayarları': 'uBlock Origin settings',
    'Her zaman açık. uBlock Origin listeleri, EasyList ve AdGuard Türkçe.': 'Always on. uBlock Origin lists, EasyList and AdGuard Turkish.',
    'Listeleri güncelle': 'Update lists',
    'İndirmeler': 'Downloads',
    'Konum': 'Location',
    'Klasörü aç': 'Open folder',
    'İndirme bitince bildirim göster': 'Notify me when a download finishes',
    'Bildirime tıklayınca dosya klasörde gösterilir.': 'Clicking the notification shows the file in its folder.',
    'Yerleşik araçlar': 'Built-in tools',
    'Resim büyütme': 'Hover zoom',
    'Farenizi bir resmin ya da resim bağlantısının üzerinde tutunca büyük hali açılır (Imagus gibi). Z: resmi ekrana sabitler, tekerlekle büyütüp küçültür, sürükleyerek kaydırırsınız (çift tık: %100 / sığdır). Esc veya Z ile kapanır. Uzantı gerekmez.': 'Hold the mouse over an image or an image link to see it full size (like Imagus). Z pins it to the screen; zoom with the wheel and drag to pan (double-click: 100% / fit). Esc or Z closes it. No extension needed.',
    'uzantı yüklü. Açın, kapatın, araç çubuğunda gizleyin veya kaldırın.': 'extensions installed. Turn them on or off, hide them from the toolbar or remove them.',
    'Henüz uzantı yok.': 'No extensions yet.',
    'Uzantı desteği yüklenemedi': 'Extension support could not be loaded',
    'Klasörde "npm install" komutunu tekrar çalıştırın.': 'Run "npm install" again in the folder.',
    'Chrome Web Mağazası': 'Chrome Web Store',
    'Uzantı bul ve ekle.': 'Find and add extensions.',
    '· Widevine yok': '· no Widevine',
    'ölçülemedi': 'not measurable',
    'az önce': 'just now',
    'Aç ': 'Open',
    'Bulunan tarayıcılar': 'Browsers found',
    'HTML dosyasından aktar': 'Import from HTML file',
    'Safari ya da başka bir tarayıcıdan dışa aktardığınız yer işareti dosyası (.html).': 'A bookmarks file (.html) you exported from Safari or another browser.',
    'Dosya seç': 'Choose file',
    'Aktarılan klasörler': 'Imported folders',
    'Aktarılıyor...': 'Importing...',
    'yer işareti yok': 'no bookmarks',
    'okunamadı': 'unreadable',
    'Aktar': 'Import',
    'Bu bilgisayarda yer işareti aktarılabilecek başka tarayıcı bulunamadı (Chrome, Edge, Brave, Opera, Vivaldi, Yandex, Firefox). HTML dosyasından aktarabilirsiniz.': 'No other browser to import bookmarks from was found on this computer (Chrome, Edge, Brave, Opera, Vivaldi, Yandex, Firefox). You can import from an HTML file.',
    'Başka bir tarayıcıdaki yer işaretlerinizi Mondium’a aktarın. Dosyalar sadece bu bilgisayarda okunur, hiçbir yere gönderilmez ve o tarayıcıda hiçbir şey değişmez. Aktarılanlar yer işaretleri çubuğunda tarayıcının adıyla bir klasörde durur; zaten olan adresler tekrar eklenmez.': "Bring your bookmarks over from another browser. Files are read only on this computer, nothing is sent anywhere and nothing changes in the other browser. Imported bookmarks go into a folder named after the browser on the bookmarks bar; addresses you already have aren't added again.",
    'Varsayılan profil': 'Default profile',
    'Diğer yer işaretleri': 'Other bookmarks',
    'Mobil yer işaretleri': 'Mobile bookmarks',
    'Yer işaretleri menüsü': 'Bookmarks menu',
    'Klasör': 'Folder',
    'Korunan siteler': 'Protected sites',
    'Temizlik yaparken bu sitelerin çerezleri ve site verileri (localStorage, IndexedDB, Cache Storage, service worker, site dosyaları ve bu sitelerin içinde gömülü üçüncü taraf verileri) silinmez. Alt alan adları da korunur. Site kendi sunucusunda oturumu kapatırsa (süre dolması, güvenlik) Mondium bunu engelleyemez.': "When clearing data, these sites' cookies and site data (localStorage, IndexedDB, Cache Storage, service workers, site files and third-party data embedded in these sites) are kept. Subdomains are protected too. If a site ends your session on its own server (expiry, security), Mondium can't prevent that.",
    'örn. github.com ya da https://mail.google.com': 'e.g. github.com or https://mail.google.com',
    'Korunacak site': 'Site to protect',
    'Ekle': 'Add',
    'Korunan sitelerde ara': 'Search protected sites',
    'Google, Microsoft, Apple gibi bir hesapla giriş yaptığınız sitelerde o hesabın sitesini de (ör. google.com, live.com) korumanız gerekebilir. Mondium bunları kendiliğinden eklemez.': "On sites where you sign in with a Google, Microsoft or Apple account, you may need to protect that account's site too (e.g. google.com, live.com). Mondium doesn't add these by itself.",
    'Bu sitede şu hesapla giriş yapıyorsanız onu da korumanız gerekebilir:': 'If you sign in to this site with one of these accounts, you may need to protect it too:',
    'Henüz korunan site yok. Temizlik yapıldığında bütün sitelerin verileri silinir.': 'No protected sites yet. Clearing data deletes the data of all sites.',
    'Aramayla eşleşen site yok.': 'No sites match your search.',
    'IP adresi (tüm portlar)': 'IP address (all ports)',
    'localhost (tüm portlar)': 'localhost (all ports)',
    'Alt alan adları dahil': 'Including subdomains',
    'korumasını kaldır': 'remove protection',
    'Çerezler ve site verileri': 'Cookies and site data',
    'Liste tarayıcının gerçek çerez ve depolama kayıtlarından gelir (geçmişten değil). Boyut, motorun ölçtüğü site depolamasıdır; çerezler dahil değildir. Gömülü siteler, o sitenin içinde çalışırken veri bırakan üçüncü taraflardır (bölümlenmiş veri).': "This list comes from the browser's real cookie and storage records (not from history). Size is the site storage measured by the engine; cookies are not included. Embedded sites are third parties that left data while running inside that site (partitioned data).",
    'Sitelerde ara': 'Search sites',
    'Site verilerinde ara': 'Search site data',
    'Sıralama': 'Sort',
    'Boyuta göre': 'By size',
    'Ada göre': 'By name',
    'Son kullanıma göre': 'By last used',
    'Çerez sayısına göre': 'By cookie count',
    'Yükleniyor...': 'Loading...',
    'Envanter okunamadı:': 'Could not read the inventory:',
    'Uyarı: depolama kayıt veritabanı okunamadı; IndexedDB/Cache Storage verileri listede eksik olabilir.': 'Warning: the storage database could not be read; IndexedDB/Cache Storage data may be missing from the list.',
    'Uyarı: localStorage kayıtları okunamadı.': 'Warning: localStorage records could not be read.',
    'Hiçbir sitenin çerezi ya da depolaması yok.': 'No site has cookies or storage.',
    'Korunuyor': 'Protected',
    'Açık sekme': 'Open tab',
    'Korumayı kaldır': 'Unprotect',
    'Koru': 'Protect',
    'korunuyor - kimlik sağlayıcı önerisi Korunan siteler bölümünde': 'protected - sign-in provider suggestion in the Protected sites section',
    'Yenile ': 'Refresh',
    'Zaman aralığı': 'Time range',
    'Son 1 saat': 'Last hour',
    'Son 24 saat': 'Last 24 hours',
    'Son 7 gün': 'Last 7 days',
    'Son 4 hafta': 'Last 4 weeks',
    'Tüm zamanlar': 'All time',
    'Tarama geçmişi': 'Browsing history',
    'Ziyaret edilen sayfaların listesi.': 'The list of pages you visited.',
    'İndirme geçmişi': 'Download history',
    'İndirilenler listesi (dosyalar silinmez).': 'The downloads list (files are not deleted).',
    'Çerezler ve diğer site verileri': 'Cookies and other site data',
    'Çerezler, localStorage, IndexedDB, Cache Storage, service worker ve site dosyaları. Korunmayan sitelerde oturumunuz kapanır.': "Cookies, localStorage, IndexedDB, Cache Storage, service workers and site files. You'll be signed out of sites that aren't protected.",
    'Korunan siteler hariç temizle': 'Keep protected sites',
    'Korunan sitelerin ve içlerinde gömülü verilerin oturumu korunur.': 'Sessions on protected sites and data embedded in them are kept.',
    'Önbelleğe alınan resimler ve dosyalar': 'Cached images and files',
    'Sayfaların daha hızlı açılması için saklanan dosyalar. Oturum bilgisi içermez.': 'Files kept so pages open faster. They contain no session data.',
    'Verileri temizle': 'Clear data',
    'Korunan siteleri yönet': 'Manage protected sites',
    'Koruma listesi boş: bütün sitelerin çerezleri ve verileri silinir.': 'The protection list is empty: cookies and data of all sites will be deleted.',
    'Motor çerezlerin oluşturulma zamanını vermiyor: bu zaman aralığıyla çerezler SİLİNMEZ. Site depolamasından yalnızca motorun son değişiklik zamanını tuttuğu veriler (IndexedDB, Cache Storage, service worker, site dosyaları) seçilir; localStorage seçilmez. Çerezleri silmek için "Tüm zamanlar"ı seçin.': 'The engine does not record when cookies were created: with this time range cookies are NOT deleted. From site storage, only data with a last-modified time (IndexedDB, Cache Storage, service workers, site files) is selected; localStorage is not. Choose "All time" to delete cookies.',
    'Önbellek site bazında güvenle ayrılamıyor: bu seçenek korunan siteler dahil TÜM sitelerin önbelleğini siler (oturumları kapatmaz).': 'The cache cannot be safely separated per site: this option clears the cache of ALL sites, including protected ones (it does not sign you out).',
    'Motor önbellekte zaman aralığını desteklemiyor: bu seçimle önbellek silinmez. Önbellek için "Tüm zamanlar"ı seçin.': 'The engine does not support a time range for the cache: the cache will not be cleared with this choice. Choose "All time" for the cache.',
    'Başlıyor...': 'Starting...',
    'doğrulanıyor': 'verifying',
    'Sonuç doğrulanıyor (envanter yeniden okunuyor)...': 'Verifying the result (re-reading the inventory)...',
    'Gerçek envanter okunuyor...': 'Reading the real inventory...',
    'Temizlik başlatılamadı:': 'Could not start clearing:',
    'Sonuç': 'Result',
    'Korunduğu için bırakılan siteler': 'Sites kept because they are protected',
    'Silinemeyen ya da yeniden oluşan veriler': 'Data that could not be deleted or came back',
    'Temizlik sırasında yeni veri oluşturan siteler': 'Sites that created new data during clearing',
    'Hatalar': 'Errors',
    'Önbellek: tüm sitelerin önbelleği için temizleme isteği gönderildi (motor sonucun doğrulanmasına izin vermiyor).': 'Cache: a clear request was sent for the cache of all sites (the engine does not allow verifying the result).',
    'Hiçbir veri seçilmedi.': 'No data selected.',
    'Site verileri': 'Site data',
    'Gezinti verilerini temizle ': 'Clear browsing data',
    'Kapat ': 'Close',
    'Geçmiş ': 'History',

    // ---- New tab page
    'Düzenle': 'Edit',
    'Kısayol ekle': 'Add shortcut',
    'Kısayolu düzenle': 'Edit shortcut',
    'Bu pencerede gezdiğiniz sayfalar geçmişe yazılmaz; çerezler ve site verileri son gizli pencere kapanınca silinir. İndirdiğiniz dosyalar ve yer işaretleri kalır.': 'Pages you visit in this window are not saved to history; cookies and site data are deleted when the last incognito window closes. Downloaded files and bookmarks are kept.',
    'Ad': 'Name',
    'Bitti': 'Done',
    'Değiştirmek için çift tıklayın': 'Double-click to change',
    'Başlığı değiştir': 'Change title',
    "Web'de arayın veya URL yazın": 'Search the web or type a URL',
    'Kaldır ': 'Remove',

    // ---- Welcome page
    'Hoş geldiniz': 'Welcome',
    "Mondium'a hoş geldiniz": 'Welcome to Mondium',
    'Başlamak için bir tema seçin.': 'Choose a theme to get started.',
    'Başla': 'Start',
    'Temayı daha sonra ⋮ → Tema menüsünden değiştirebilirsiniz.': 'You can change the theme later from ⋮ → Theme.',

    // ---- History page
    'Seç': 'Select',
    'Diğer işlemler': 'More actions',
    'Arama sonucu bulunamadı': 'No search results',
    'Tarama geçmişiniz burada görünür': 'Your browsing history appears here',
    'Ziyaret ettiğiniz sayfalar tarihe göre burada listelenir.': 'Pages you visit are listed here by date.',
    'Bağlantı kopyalandı': 'Link copied',
    'Geçmişten kaldırıldı': 'Removed from history',
    'Seçilen öğeler kaldırılsın mı?': 'Remove the selected items?',
    'Tüm geçmiş silinsin mi?': 'Delete all history?',
    'Ziyaret ettiğiniz bütün sayfaların kaydı silinir. Çerezler ve oturumlarınız etkilenmez; onlar için "Tarama verilerini temizle"yi kullanın.': 'The record of every page you visited will be deleted. Cookies and sessions are not affected; use "Clear browsing data" for those.',
    'Tümünü sil': 'Delete all',
    'Geçmiş silindi': 'History deleted',
    'Tarama verilerini temizle': 'Clear browsing data',
    'Tüm geçmişi sil': 'Delete all history',
    'Geçmiş yalnızca bu bilgisayarda saklanır, hiçbir yere gönderilmez. 90 günden eski kayıtlar kendiliğinden silinir.': 'History is stored only on this computer and is never sent anywhere. Entries older than 90 days are deleted automatically.',
    'Bu siteden daha fazlası': 'More from this site',
    'Bağlantıyı kopyala': 'Copy link',
    'Geçmişten kaldır': 'Remove from history',
    'Geçmişte ara': 'Search history',
    'Aramayı temizle': 'Clear search',
    'Seçimi kaldır': 'Clear selection',
    'Bugün': 'Today',
    'Dün': 'Yesterday',

    // ---- Downloads page
    'Silindi veya taşındı': 'Deleted or moved',
    'İptal edildi': 'Canceled',
    'Başarısız - indirme yarıda kaldı': 'Failed - download was interrupted',
    'Devam et': 'Resume',
    'Duraklat': 'Pause',
    'Tekrar dene': 'Retry',
    'Listeden kaldır': 'Remove from list',
    'İndirilen dosyalar burada görünür': 'Files you download appear here',
    'Dosyalar doğrudan İndirilenler klasörüne kaydedilir.': 'Files are saved straight to your Downloads folder.',
    'Tümünü temizle': 'Clear all',
    'Listeden kaldırmak dosyayı silmez. Liste yalnızca bu bilgisayarda tutulur, son 100 indirme saklanır.': 'Removing from the list does not delete the file. The list is kept only on this computer; the last 100 downloads are kept.',
    'İndirme listesi temizlensin mi?': 'Clear the downloads list?',
    'Tamamlanan, iptal edilen ve başarısız indirmeler listeden kaldırılır. Dosyalarınız silinmez.': 'Completed, canceled and failed downloads are removed from the list. Your files are not deleted.',
    'İndirilenlerde ara': 'Search downloads',

    // ---- Reader
    'Yazıyı küçült': 'Smaller text',
    'Yazıyı büyüt': 'Larger text',
    'Açık / koyu': 'Light / dark',
    'Okuma modunu kapat (Esc veya F9)': 'Close reading mode (Esc or F9)',
    '· yaklaşık': '· about',
    'dk okuma': 'min read',
    'Mondium resim büyütme': 'Mondium hover zoom',

    // ---- Site rules (site-data.js)
    'Bir alan adı ya da adres yazın.': 'Type a domain or an address.',
    'Alan adında boşluk olamaz.': 'A domain cannot contain spaces.',
    'Geçerli bir alan adı değil.': 'Not a valid domain.',
    'IP adresi: sadece bu adres korunur (tüm port ve protokoller).': 'IP address: only this address is protected (all ports and protocols).',
    'localhost ve alt adları korunur (tüm portlar).': 'localhost and its subdomains are protected (all ports).',
    'Tüm alt alan adları da korunur.': 'All subdomains are protected too.',
    'Microsoft hesabı': 'Microsoft account',
    'Microsoft iş/okul hesabı': 'Microsoft work/school account',
    'Apple Kimliği': 'Apple ID',
    'bölümlenmiş': 'partitioned',
    'çerez': 'cookie',
    'Bir temizlik zaten sürüyor.': 'A cleanup is already running.',
    'Depolama kayıt veritabanı okunamadı; IndexedDB/önbellek gibi veriler bu temizlikte hedeflenemedi.': 'The storage database could not be read; data such as IndexedDB/cache could not be targeted in this cleanup.',
    'localStorage kayıtları okunamadı; sadece başka depolaması olan sitelerin localStorage verisi temizlendi.': 'localStorage records could not be read; only localStorage of sites with other storage was cleared.',
    'Çerezler silinmedi: motor çerezlerin oluşturulma zamanını vermiyor, zaman aralığı uygulanamıyor. Çerezleri silmek için "Tüm zamanlar"ı seçin.': 'Cookies were not deleted: the engine does not record when cookies were created, so a time range cannot be applied. Choose "All time" to delete cookies.',
    'Site depolamasında yalnızca motorun "son değişiklik" zamanını tuttuğu veriler (IndexedDB, Cache Storage, service worker, OPFS) aralığa göre seçildi; zamanı bilinmeyen localStorage verisine dokunulmadı.': 'From site storage, only data with a "last modified" time (IndexedDB, Cache Storage, service workers, OPFS) was selected by range; localStorage, whose time is unknown, was not touched.',
    'Bu sitenin açık sekmesi var; sayfa veriyi yeniden oluşturmuş olabilir.': 'This site has an open tab; the page may have recreated the data.',
    'Silme isteği gönderildi ama veri hâlâ duruyor.': 'A delete request was sent but the data is still there.',
    'Temizlik tamamlanamadı:': 'Clearing could not be completed:',
    'açık sekmesi var': 'has an open tab',
    'hâlâ duruyor': 'still there',
    'Bilinmeyen işlem': 'Unknown action'
  };

  // Strings with variable parts. {0}, {1}... in order; English may use {0:one|many} for plurals.
  const PATTERNS = [
    ['{0} şunu istiyor:', '{0} wants to:'],
    ['Cihazda şu PIN görünüyor mu? {0}', 'Does the device show this PIN? {0}'],
    ['Sekme: {0} - uyutuldu (0 MB)', 'Tab: {0} - asleep (0 MB)'],
    ['Sekme: {0} - aynı süreci paylaşıyor', 'Tab: {0} - shares a process'],
    ['Sekme: {0} - {1} MB', 'Tab: {0} - {1} MB'],
    ['"{0}" kaldırılsın mı?', 'Remove "{0}"?'],
    ['{0} ile "{1}" ara', 'Search {0} for "{1}"'],
    ['"{0}" klasörünü sil', 'Delete folder "{0}"'],
    ['{0} yer işaretleri okunamadı.', 'Could not read {0} bookmarks.'],
    ['{0} profilinde yer işareti yok.', 'There are no bookmarks in this {0} profile.'],
    ['En fazla {0} kısayol eklenebilir', 'You can add up to {0} shortcuts'],
    ['{0} ({1} yer işareti)', '{0} ({1} {1:bookmark|bookmarks})'],
    ['{0} bir seri bağlantı noktasına bağlanmak istiyor', '{0} wants to connect to a serial port'],
    ['{0} bir HID cihazına bağlanmak istiyor', '{0} wants to connect to a HID device'],
    ['{0} bir USB cihazına bağlanmak istiyor', '{0} wants to connect to a USB device'],
    ['{0} bir Bluetooth cihazıyla eşleşmek istiyor', '{0} wants to pair with a Bluetooth device'],
    ['{0} bir cihaza bağlanmak istiyor', '{0} wants to connect to a device'],
    ['{0} site için kaydedilmiş izin kararı var (kamera, konum, bildirim...).', 'Saved permission decisions for {0} {0:site|sites} (camera, location, notifications...).'],
    ['{0} cihaz izni var (USB, HID, seri, Bluetooth).', '{0} device {0:permission|permissions} (USB, HID, serial, Bluetooth).'],
    ['{0} yer işareti "{1}" klasörüne aktarıldı, {2} tanesi zaten vardı. Yer işaretleri çubuğunda görebilirsiniz.', 'Imported {0} {0:bookmark|bookmarks} into the "{1}" folder; {2} {2:was|were} already there. You can find them on the bookmarks bar.'],
    ['{0} yer işareti "{1}" klasörüne aktarıldı. Yer işaretleri çubuğunda görebilirsiniz.', 'Imported {0} {0:bookmark|bookmarks} into the "{1}" folder. You can find them on the bookmarks bar.'],
    ['"{0}" klasöründeki {1} yer işareti silinsin mi?', 'Delete the {1} {1:bookmark|bookmarks} in the "{0}" folder?'],
    ['{0} yer işareti silindi.', '{0} {0:bookmark|bookmarks} deleted.'],
    ['{0} · {1} yer işareti', '{0} · {1} {1:bookmark|bookmarks}'],
    ['{0} · yer işareti yok', '{0} · no bookmarks'],
    ['{0} · okunamadı', '{0} · unreadable'],
    ['{0} yer işareti', '{0} {0:bookmark|bookmarks}'],
    ['{0} artık korunmuyor.', '{0} is no longer protected.'],
    ['{0} korunuyor. {1}', '{0} is protected. {1}'],
    ['{0} korunuyor.', '{0} is protected.'],
    ['{0} site · {1} çerez', '{0} {0:site|sites} · {1} {1:cookie|cookies}'],
    ['Daha fazla göster ({0})', 'Show more ({0})'],
    ['Koruma kapalı: korunan {0} sitedeki oturumlar da silinecek.', 'Protection is off: sessions on {0} protected {0:site|sites} will be deleted too.'],
    ['{0} site korunuyor.', '{0} {0:site is|sites are} protected.'],
    ['{0} site korunuyor', '{0} {0:site|sites} protected'],
    ['Tarama geçmişi: {0} kayıt silindi.', 'Browsing history: {0} {0:entry|entries} deleted.'],
    ['İndirme geçmişi: {0} kayıt silindi.', 'Download history: {0} {0:entry|entries} deleted.'],
    ['Çerezler: {0} silindi (doğrulandı), {1} tanesi için istek gönderildi ama hâlâ duruyor.', 'Cookies: {0} deleted (verified); {1} requested but still there.'],
    ['Çerezler: {0} silindi (doğrulandı).', 'Cookies: {0} deleted (verified).'],
    ['Site depolaması: {0} depolama alanı silindi (doğrulandı), {1} tanesi hâlâ duruyor.', 'Site storage: {0} storage {0:area|areas} deleted (verified); {1} still there.'],
    ['Site depolaması: {0} depolama alanı silindi (doğrulandı).', 'Site storage: {0} storage {0:area|areas} deleted (verified).'],
    ['{0} ile arayın veya URL yazın', 'Search {0} or type a URL'],
    ['{0} ile ara', 'Search {0}'],
    ['"{0}" ile eşleşen sayfa yok.', 'No pages match "{0}".'],
    ['{0}+ sonuç', '{0}+ results'],
    ['{0} sonuç', '{0} {0:result|results}'],
    ['{0} kayıt', '{0} {0:entry|entries}'],
    ['{0} öğe seçildi', '{0} selected'],
    ['{0} sayfa geçmişten kaldırıldı', '{0} {0:page|pages} removed from history'],
    ['{0} sayfa geçmişten kaldırılacak.', '{0} {0:page|pages} will be removed from history.'],
    ['"{0}" ile eşleşen dosya yok.', 'No files match "{0}".'],
    ['"{0}" ortak bir barındırma adı: altındaki her kullanıcı sitesi ayrıdır. Kendi sitenizi yazın (ör. kullaniciadi.{1}).', '"{0}" is a shared hosting name: every user site under it is separate. Type your own site (e.g. username.{1}).'],
    ['"{0}" bir genel son ek (ör. com, co.uk); site olarak korunamaz.', '"{0}" is a public suffix (e.g. com, co.uk); it cannot be protected as a site.'],
    ['{0} yerine {1} korunur (tüm alt alan adlarıyla birlikte).', '{1} is protected instead of {0} (with all its subdomains).'],
    ['çerez "{0}"', 'cookie "{0}"'],
    ['depolama {0} ({1} içinde)', 'storage {0} (inside {1})'],
    ['depolama {0}', 'storage {0}'],
    ['{0} uzantı yüklü. Açın, kapatın, araç çubuğunda gizleyin veya kaldırın.', '{0} {0:extension|extensions} installed. Turn them on or off, hide them from the toolbar or remove them.'],
    ['{0} sitesinin çerezleri ve site verileri silinsin mi?', "Delete {0}'s cookies and site data?"],
    ['{0} - seçenekleri aç', '{0} - open options'],
    ['Ses düzeyi: %{0}', 'Volume: {0}%'],
    ['Ses düzeyi: %{0} (bu sekme)', 'Volume: {0}% (this tab)'],
    ['Bugün - {0}', 'Today - {0}'],
    ['Dün - {0}', 'Yesterday - {0}'],
    ['Duraklatıldı - {0}', 'Paused - {0}'],
    ['{0} sn kaldı', '{0} s left'],
    ['{0} dk kaldı', '{0} min left'],
    ['{0} dk önce', '{0} min ago'],
    ['{0} saat önce', '{0} {0:hour|hours} ago'],
    ['{0} gün önce', '{0} {0:day|days} ago'],
    ['{0} dakika', '{0} minutes'],
    ['Aktarılamadı: {0}', 'Import failed: {0}'],
    ['{0} korumasını kaldır', 'Remove protection for {0}'],
    ['Ses seviyesi (%{0})', 'Volume ({0}%)'],
    ['%{0} (normal)', '{0}% (normal)'],
    ['%{0}', '{0}%']
  ];

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compiled = PATTERNS.map(([tr, en]) => {
    const order = [];
    const src = '^' + tr.split(/(\{\d+\})/).map((p) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); return '(.+?)'; } return reEsc(p); }).join('') + '$';
    return { re: new RegExp(src), order, en };
  });
  function fill(en, vals) {
    return en.replace(/\{(\d+)(?::([^|}]*)\|([^}]*))?\}/g, (m, i, one, many) => {
      const v = vals[+i];
      if (one === undefined) return v === undefined ? '' : v;
      const n = Number(String(v).replace(/[^\d.-]/g, ''));
      return n === 1 ? one : many;
    });
  }
  function translateCore(s) {
    if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
    for (const p of compiled) {
      const m = p.re.exec(s);
      if (!m) continue;
      const vals = [];
      p.order.forEach((idx, k) => { const v = m[k + 1]; vals[idx] = Object.prototype.hasOwnProperty.call(EN, v) ? EN[v] : v; });
      return fill(p.en, vals);
    }
    return null;
  }
  // Keeps leading/trailing whitespace; returns the input unchanged when there is no translation.
  function translate(text, lang) {
    if (lang !== 'en' || typeof text !== 'string' || !text) return text;
    const t = norm(text);
    if (!t || (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(t) && t[0] !== '%')) return text;
    let r = translateCore(t);
    if (r == null) {   // e.g. 'Sayfada bul...' / 'Koru:': retry without the trailing ... or :
      const m = /^(.*?)(\.\.\.|…|:)$/.exec(t);
      if (m && m[1]) { const b = translateCore(m[1].trim()); if (b != null) r = b + m[2]; }
    }
    if (r == null) return text;
    const lead = /^\s*/.exec(text)[0], trail = /\s*$/.exec(text)[0];
    return lead + r + trail;
  }

  // ---- DOM: translate text nodes and attributes as they appear (pages and browser UI)
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function startDom(lang) {
    if (lang !== 'en' || typeof document === 'undefined') return;
    document.documentElement.lang = 'en';
    const doText = (n) => { const v = n.nodeValue; if (!v || v.length > 2000) return; const t = translate(v, 'en'); if (t !== v) n.nodeValue = t; };
    const doEl = (el) => {
      for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const t = translate(v, 'en'); if (t !== v) el.setAttribute(a, t); } }
      if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { const t = translate(el.value, 'en'); if (t !== el.value) el.value = t; }
    };
    const walk = (root) => {
      if (root.nodeType === 3) { doText(root); return; }
      if (root.nodeType !== 1 && root.nodeType !== 11 && root.nodeType !== 9) return;
      if (root.nodeType === 1) { if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(root.tagName)) return; doEl(root); }
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n.nodeType === 1 && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
      });
      let n;
      while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
      // Open shadow roots that the page itself builds (e.g. menus) are walked when they are attached
    };
    let busy = false;
    const mo = new MutationObserver((list) => {
      if (busy) return;
      busy = true;
      try {
        for (const m of list) {
          if (m.type === 'childList') m.addedNodes.forEach(walk);
          else if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'attributes') doEl(m.target);
        }
      } finally { busy = false; }
    });
    mo.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (document.documentElement) walk(document.documentElement);
    // Native dialogs opened by page scripts
    for (const k of ['confirm', 'alert', 'prompt']) {
      const orig = window[k];
      if (typeof orig === 'function') window[k] = function (msg, ...rest) { return orig.call(window, translate(String(msg == null ? '' : msg), 'en'), ...rest); };
    }
  }

  const api = { EN, PATTERNS, translate, startDom };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MondiumI18n = api;
    const lang = (root.pageApi && root.pageApi.lang) || (root.browserApi && root.browserApi.lang) || 'tr';
    root.L = (tr, en) => (lang === 'en' ? en : tr);   // for strings built from several parts
    root.LANG = lang;
    startDom(lang);
  }
})(typeof window !== 'undefined' ? window : globalThis);
