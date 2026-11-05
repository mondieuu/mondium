@echo off
cd /d "%~dp0"
title Mondium
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)
set NEED=0
if not exist node_modules\electron set NEED=1
if not exist node_modules\electron-chrome-extensions set NEED=1
if not exist node_modules\electron-chrome-web-store set NEED=1
rem Widevine'li (castLabs) Electron kurulu mu?
if exist node_modules\electron\package.json (
  findstr /c:"wvcus" node_modules\electron\package.json >nul || set NEED=1
)
if "%NEED%"=="1" (
  echo Bagimliliklar kuruluyor...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
rem Bazi npm surumleri Electron'un indirme adimini atliyor: program dosyasi yoksa elle indir
if not exist node_modules\electron\dist\electron.exe (
  echo Electron indiriliyor...
  node node_modules\electron\install.js || (pause & exit /b 1)
)
call npm start
