@echo off
REM Double-click to start Kestrel on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Kestrel needs Node.js. Install the LTS version from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)
if not exist "node_modules\ccxt" (
  echo First run: installing Kestrel's parts ^(one time, about a minute^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Couldn't install. Check the internet connection and try again.
    pause
    exit /b 1
  )
)
node server.mjs %*
pause
