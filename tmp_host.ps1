$ErrorActionPreference = 'SilentlyContinue'
taskkill /F /IM node.exe /T
Start-Sleep -Seconds 1
Start-Job -ScriptBlock { cmd.exe /c "npx http-server c:\Users\bubbl\Downloads\clawdesk-20260304T234941Z-3-001\clawdesk\docs -p 9095" }
Start-Sleep -Seconds 3
ssh -o StrictHostKeyChecking=no -R 80:localhost:9095 nokey@localhost.run
