@echo off
cd /d "%~dp0"
title Mondium
where node >nul 2>nul || (echo Node.js was not found. Install the LTS version from https://nodejs.org & pause & exit /b 1)
set NEED=0
if not exist node_modules\electron set NEED=1
if not exist node_modules\electron-chrome-extensions set NEED=1
if not exist node_modules\electron-chrome-web-store set NEED=1
rem Is the Widevine (castLabs) build of Electron installed?
if exist node_modules\electron\package.json (
  findstr /c:"wvcus" node_modules\electron\package.json >nul || set NEED=1
)
if "%NEED%"=="1" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
rem Some npm versions skip Electron's download step: fetch the binary if it is missing
if not exist node_modules\electron\dist\electron.exe (
  echo Downloading Electron...
  node node_modules\electron\install.js || (pause & exit /b 1)
)
call npm start
