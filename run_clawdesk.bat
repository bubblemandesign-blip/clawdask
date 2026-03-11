@echo off
title ClawDesk
echo [Phase 1] Cleaning Ghost Processes...
taskkill /F /IM ClawDesk.exe /T 2>nul
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM openclaw.exe /T 2>nul
taskkill /F /IM cloudflared.exe /T 2>nul

echo [Phase 2] Verifying Environment...
cd /d "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk"

set ELECTRON_RUN_AS_NODE=
set OLLAMA_API_KEY=ollama-local
echo [Phase 3] Starting ClawDesk Silently...
start /min "" npm.cmd run dev
echo ClawDesk is starting in the background. You can close this window.
timeout /t 3 /nobreak >nul
exit
