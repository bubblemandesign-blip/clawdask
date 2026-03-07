$ErrorActionPreference = 'Stop'
Write-Host "Starting upload to Pixeldrain..."
curl.exe -s -T "docs\downloads\ClawDesk-Professional-Windows.zip" "https://pixeldrain.com/api/file/" > pixeldrain_result.json
Write-Host "Upload complete."
