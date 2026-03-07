$DesktopPath = [Environment]::GetFolderPath('Desktop')
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\ClawDesk.lnk")
$Shortcut.TargetPath = "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\dist\win-unpacked\ClawDesk.exe"
$Shortcut.WorkingDirectory = "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\dist\win-unpacked"
$Shortcut.IconLocation = "c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\build\icon.ico"
$Shortcut.Save()
Write-Host "Shortcut created on Desktop."
