$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ProjectDir = $PSScriptRoot
if (-not $ProjectDir) { $ProjectDir = "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk" }

# The most stable launch method is now the run_clawdesk.bat
$TargetPath = Join-Path $ProjectDir "run_clawdesk.bat"

if (-not (Test-Path $TargetPath)) {
    Write-Host "Auto-detecting ClawDesk launch method..."
    $TargetPath = Join-Path $ProjectDir "dist\win-unpacked\ClawDesk.exe"
}

$ShortcutPath = Join-Path $DesktopPath "ClawDesk.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/c `"$TargetPath`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.IconLocation = "$TargetPath,0" 
$Shortcut.Save()

Write-Host "ClawDesk (Stability Edition) shortcut created on Desktop!"
Write-Host "Target: $TargetPath"
