@echo off
REM Double-click to start Patch on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Patch needs Node.js. Install the LTS version from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)
if not exist "node_modules\@elevenlabs\client" (
  echo First run: installing the voice library ^(one time, about 20 seconds^)...
  call npm install --no-audit --no-fund
)
node server.mjs %*
pause
