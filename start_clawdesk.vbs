' ClawDesk Silent Launcher
' This script starts ClawDesk without showing any terminal windows
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Kill any ghost processes silently
WshShell.Run "cmd /c taskkill /F /IM ClawDesk.exe /T 2>nul & taskkill /F /IM cloudflared.exe /T 2>nul", 0, True

' Clear the ELECTRON_RUN_AS_NODE variable
Set env = WshShell.Environment("Process")
env.Remove "ELECTRON_RUN_AS_NODE"

' Start ClawDesk dev server completely hidden (0 = hidden, False = don't wait)
WshShell.Run "cmd /c npm.cmd run dev", 0, False
