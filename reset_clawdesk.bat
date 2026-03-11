@echo off
setlocal
echo ===================================================
echo   ClawDesk Environment Reset Utility (Phase 13)
echo ===================================================
echo.
echo [WARNING] This will delete all local configurations and state.
echo This simulates a "New User" experience.
echo.
set /p confirm="Are you sure you want to proceed? (y/n): "
if /i "%confirm%" neq "y" (
    echo Reset cancelled.
    pause
    exit /b 0
)

echo.
echo [1/4] Terminating running processes...
taskkill /F /IM ClawDesk.exe /T 2>nul
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM cloudflared.exe /T 2>nul
timeout /t 2 >nul

echo [2/4] Wiping AppData (ClawDesk)...
rmdir /s /q "%APPDATA%\ClawDesk" 2>nul
if %ERRORLEVEL% equ 0 (echo   [Success] Done.) else (echo   [Info] Folder not found or already clean.)

echo [3/4] Wiping Global Configuration (.openclaw)...
rmdir /s /q "%USERPROFILE%\.openclaw" 2>nul
if %ERRORLEVEL% equ 0 (echo   [Success] Done.) else (echo   [Info] Folder not found or already clean.)

echo [4/4] Cleaning local runtimes...
rmdir /s /q "bin" 2>nul
del /q ".env" 2>nul
if %ERRORLEVEL% equ 0 (echo   [Success] Done.) else (echo   [Info] Cleaned local runtime folder.)

echo.
echo ===================================================
echo   Reset Complete!
echo   You can now launch ClawDesk to experience the
echo   Quick Setup and Onboarding as a new user.
echo ===================================================
pause
