$ErrorActionPreference = 'Stop'
Write-Host "Getting Gofile server..."
$serverJson = curl.exe -s "https://api.gofile.io/servers"
$serverInfo = $serverJson | ConvertFrom-Json
$serverName = $serverInfo.data.servers[0].name
Write-Host "Uploading to $serverName.gofile.io..."
curl.exe -s -F "file=@docs\downloads\ClawDesk-Professional-Windows.zip" "https://$($serverName).gofile.io/contents/uploadfile" > gofile_result.json
Write-Host "Upload complete."
