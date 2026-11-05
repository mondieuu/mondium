@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mondium - building the installer
where node >nul 2>nul || (echo Node.js was not found. Install the LTS version from https://nodejs.org & pause & exit /b 1)

echo [1/2] Checking dependencies...
call npm install --no-audit --no-fund || (echo. & echo npm install failed. & pause & exit /b 1)

echo.
echo [2/2] Building the installer (the first build can take a few minutes)...
call npm run dist:win || (echo. & echo Building the installer failed. Check the error above. & pause & exit /b 1)

echo.
echo Done! The installer is in the "dist" folder: Mondium-Setup-*.exe
start "" "%~dp0dist"
pause
