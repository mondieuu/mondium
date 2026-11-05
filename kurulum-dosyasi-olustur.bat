@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mondium - kurulum dosyasi olusturuluyor
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)

echo [1/2] Bagimliliklar kontrol ediliyor...
call npm install --no-audit --no-fund || (echo. & echo npm install basarisiz oldu. & pause & exit /b 1)

echo.
echo [2/2] Kurulum dosyasi olusturuluyor (ilk seferde birkac dakika surebilir)...
call npm run dist:win || (echo. & echo Kurulum dosyasi olusturulamadi. Yukaridaki hatayi kontrol edin. & pause & exit /b 1)

echo.
echo Tamamlandi! Kurulum dosyasi "dist" klasorunde: Mondium-Kurulum-*.exe
start "" "%~dp0dist"
pause
