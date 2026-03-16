@echo off
setlocal
echo [ClawDesk] Updating OpenClaw Kernel to v2026.3.13...

:: Ensure we are in the project root
cd /d "%~dp0"

:: Clear npm cache for a clean update if needed
:: call npm cache clean --force

echo [1/3] Updating package.json...
call npm install openclaw@2026.3.13 --save-exact

echo [2/3] Rebuilding Electron dependencies...
call npm install

echo [3/3] Verifying installation...
call npm run typecheck

echo [SUCCESS] OpenClaw Kernel updated to v2026.3.8.
echo Please restart the application via run_clawdesk.bat
pause
