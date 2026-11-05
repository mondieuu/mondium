@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Widevine VMP signing account (castLabs EVS)
echo.
echo  Streaming services with DRM (Netflix, Disney+, Spotify...) need the browser to be signed
echo  with the free castLabs EVS service to play protected video. You only do this ONCE.
echo.

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" ( where py >nul 2>nul && set PY=py )
if "%PY%"=="" (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo While installing, tick "Add python.exe to PATH".
  pause & exit /b 1
)

echo [1/3] Installing the castLabs EVS tool...
%PY% -m pip install --upgrade castlabs-evs || (pause & exit /b 1)

echo.
echo [2/3] Creating the account: it asks for an e-mail, a name and a password, then the code sent to your e-mail.
echo       (If you already have an account this step fails, which is fine.)
%PY% -m castlabs_evs.account signup
%PY% -m castlabs_evs.account reauth

echo.
echo [3/3] Signing the development build (run-dev.bat)...
if exist node_modules\electron\dist (
  %PY% -m castlabs_evs.vmp sign-pkg node_modules\electron\dist
) else (
  echo Dependencies are not installed yet, skipped this step.
)

echo.
echo Done. Now build the installer again with "build-installer.bat";
echo the installer will be signed automatically.
pause
