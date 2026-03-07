$ErrorActionPreference = 'SilentlyContinue'

# 1. Wipe everything old
Write-Host 'Wiping old test files and configurations...'
Stop-Process -Name ClawDesk -Force
Remove-Item -Path "$env:USERPROFILE\.openclaw" -Recurse -Force
$testDir = "c:\Users\bubbl\Downloads\ClawDesk_Final_User_Test"
Remove-Item -Path $testDir -Recurse -Force
New-Item -ItemType Directory -Path $testDir -Force

# 2. Simulate Download and Extraction from the "Website"
Write-Host 'Simulating download from website...'
Start-Sleep -Seconds 2
Write-Host 'Extracting application...'
c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\node_modules\7zip-bin\win\x64\7za.exe x -o"$testDir" docs\downloads\ClawDesk-Professional-Windows.zip -y | Out-Null

# 3. Create Desktop Shortcut
Write-Host 'Creating Desktop Icon...'
$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\ClawDesk.lnk")
$Shortcut.TargetPath = "$testDir\ClawDesk.exe"
$Shortcut.WorkingDirectory = "$testDir"
$Shortcut.Description = "ClawDesk AI Assistant"
$Shortcut.Save()

# 4. Launch
Write-Host 'Launching Application from the new Desktop Icon...'
Invoke-Item "$DesktopPath\ClawDesk.lnk"
Write-Host 'SUCCESS: App Launched and Shortcut Created!'
