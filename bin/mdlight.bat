@echo off
rem mdlight launcher (ASCII only: cmd.exe parses .bat in the ANSI code page)
rem Prefers the single-file native WebView2 exe; falls back to the JS launcher.
setlocal
set "HERE=%~dp0"
if exist "%HERE%..\dist\native\mdlight.exe" (
  start "" "%HERE%..\dist\native\mdlight.exe" %*
  exit /b %errorlevel%
)
where node >nul 2>nul
if errorlevel 1 (
  echo [mdlight] Neither the exe nor Node.js was found.
  echo [mdlight] Build the exe:    npm run build:native
  echo [mdlight] Or install Node 18+: https://nodejs.org/
  pause
  exit /b 1
)
node "%HERE%..\dist\mdlight.mjs" %*
endlocal