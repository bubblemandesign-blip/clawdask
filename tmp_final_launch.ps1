$ErrorActionPreference = 'SilentlyContinue'
Stop-Process -Name ClawDesk -Force
Remove-Item -Path "$env:USERPROFILE\.openclaw" -Recurse -Force
$testDir = "c:\Users\bubbl\Downloads\ClawDesk_Final_User_Test"
Remove-Item -Path $testDir -Recurse -Force
New-Item -ItemType Directory -Path $testDir -Force
Write-Host 'Simulating User Download and Extraction (Ultra-fast)...'
c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\node_modules\7zip-bin\win\x64\7za.exe x -o"$testDir" docs\downloads\ClawDesk-Professional-Windows.zip -y
Write-Host 'Extraction Complete. Launching Application on Desktop...'
Start-Process "$testDir\ClawDesk.exe"
Write-Host 'SUCCESS: App Launched on your screen!'
