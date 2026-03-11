@echo off
setlocal
echo ===================================================
echo   ClawDesk Local Model Engine Installer (Phase 11)
echo ===================================================
echo.
echo Checking for Winget...
where winget >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [Error] Winget is not installed. Please install Winget or Ollama manually.
    pause
    exit /b 1
)

echo Checking for Ollama...
where ollama >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [Info] Ollama not found. Installing Ollama...
    winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
    if %ERRORLEVEL% neq 0 (
        echo [Error] Failed to install Ollama. Please try installing it manually from https://ollama.com
        pause
        exit /b 1
    )
    echo [Success] Ollama installed successfully.
    
    :: We need to refresh environment variables or start the Ollama service to use it immediately
    echo Starting Ollama service...
    start "" "C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama app.exe"
    timeout /t 5 >nul
) else (
    echo [Info] Ollama is already installed.
)

echo.
echo Pulling GLM-4 Model...
echo This may take some time depending on your internet connection.
:: Try to pull the model
C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe pull glm4
if %ERRORLEVEL% neq 0 (
    :: Fallback if not in AppData path
    ollama pull glm4
)

echo.
echo ===================================================
echo   Installation Complete!
echo   Ollama and GLM-4 are ready for use.
echo ===================================================
pause
