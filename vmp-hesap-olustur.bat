@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Widevine VMP imza hesabi (castLabs EVS)
echo.
echo  Netflix, Disney+, Exxen, BluTV, Spotify gibi DRM'li sitelerin video oynatabilmesi icin
echo  tarayicinin ucretsiz castLabs EVS hizmetiyle imzalanmasi gerekiyor. Bu islem BIR KEZ yapilir.
echo.

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" ( where py >nul 2>nul && set PY=py )
if "%PY%"=="" (
  echo Python bulunamadi. https://www.python.org/downloads/ adresinden kurun.
  echo Kurarken "Add python.exe to PATH" kutusunu isaretlemeyi unutmayin.
  pause & exit /b 1
)

echo [1/3] castLabs EVS araci kuruluyor...
%PY% -m pip install --upgrade castlabs-evs || (pause & exit /b 1)

echo.
echo [2/3] Hesap olusturma: e-posta, ad ve sifre soracak, sonra e-postaniza gelen kodu isteyecek.
echo       (Zaten hesabiniz varsa bu adimda hata alirsiniz, sorun degil.)
%PY% -m castlabs_evs.account signup
%PY% -m castlabs_evs.account reauth

echo.
echo [3/3] Gelistirme surumu (kur-ve-calistir.bat) imzalaniyor...
if exist node_modules\electron\dist (
  %PY% -m castlabs_evs.vmp sign-pkg node_modules\electron\dist
) else (
  echo Henuz kurulum yapilmamis, bu adim atlandi.
)

echo.
echo Tamam. Simdi "kurulum-dosyasi-olustur.bat" ile kurulum dosyasini yeniden olusturun;
echo kurulum dosyasi otomatik olarak imzalanacak.
pause
