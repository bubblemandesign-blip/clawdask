# ClawDesk Ollama Setup & Model Puller
# This script ensures Ollama is installed, running, and HAS THE REQUIRED MODEL.

$ErrorActionPreference = "Stop"

function Write-Host-Color {
    param($Message, $Color = "White")
    Write-Host "[ClawDesk] $Message" -ForegroundColor $Color
}

Write-Host-Color "Starting Bulletproof AI Engine Setup..." "Cyan"

# 1. Check for Ollama
$ollamaPath = $null
try {
    $ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
} catch {}

if (-not $ollamaPath) {
    # Try common appdata path
    $appDataPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $appDataPath) {
        $ollamaPath = $appDataPath
    }
}

if (-not $ollamaPath) {
    Write-Host-Color "Ollama not found. Attempting installation via Winget..." "Yellow"
    try {
        & winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
        Write-Host-Color "Ollama installation triggered successfully." "Green"
        
        # Refresh environment variables for current session
        $env:PATH = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        $ollamaPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    } catch {
        Write-Host-Color "Winget installation failed. Please install Ollama manually from https://ollama.com" "Red"
        exit 1
    }
} else {
    Write-Host-Color "Ollama is already installed." "Green"
}

# 2. Ensure Ollama is running
$process = Get-Process ollama -ErrorAction SilentlyContinue
if (-not $process) {
    Write-Host-Color "Ollama is not running. Starting Ollama app..." "Yellow"
    $appPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
    if (Test-Path $appPath) {
        Start-Process $appPath
    } else {
        # Fallback to direct exe if app wrapper isn't found
        Start-Process $ollamaPath "serve" -WindowStyle Hidden
    }
}

# 3. Wait for API to be ready
Write-Host-Color "Waiting for Ollama API to respond..." "Cyan"
$maxRetries = 20
$retryCount = 0
$apiReady = $false

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -ErrorAction SilentlyContinue
        if ($response) {
            $apiReady = $true
            break
        }
    } catch {}
    $retryCount++
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline
}

if (-not $apiReady) {
    Write-Host-Color "Timeout! Ollama API failed to start. Please check if it's blocked by a firewall." "Red"
    exit 1
}
Write-Host-Color "Ollama API is ONLINE." "Green"

# 4. Pull GLM-4 Model
Write-Host-Color "Pulling GLM-4 model (this will take a few minutes)..." "Cyan"
Write-Host-Color "Please do not close this window." "Gray"

# We use the CLI for pulling because it provides its own progress bar
& $ollamaPath pull glm4

if ($LASTEXITCODE -eq 0) {
    Write-Host-Color "SUCCESS! AI Engine is ready for ClawDesk." "Green"
} else {
    Write-Host-Color "Model pull failed. Please check your internet connection." "Red"
    exit 1
}

Write-Host-Color "Setup Complete. You can now close this window and restart ClawDesk." "Cyan"
pause
