@echo off
setlocal
echo ===================================================
echo   ClawDesk "TURBO FIX": Permanent AI Engine Setup
echo ===================================================
echo.
echo Launching robust setup script...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-ollama.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Setup failed. Please check the messages above.
    pause
    exit /b 1
)
exit /b 0
