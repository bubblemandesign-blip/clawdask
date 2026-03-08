@echo off
title ClawDesk (Fixed Edition)
echo [Phase 1] Cleaning Ghost Processes...
taskkill /F /IM ClawDesk.exe /T 2>nul
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM openclaw.exe /T 2>nul

echo [Phase 2] Verifying Environment...
cd /d "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk"

echo [Phase 3] Starting ClawDesk with Zero-Crash Guard...
npm.cmd run dev
pause
