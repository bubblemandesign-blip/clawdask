$start = Get-Date
$body = @{
    model = "glm-4-9b"
    messages = @(
        @{ role = "user"; content = "Reply with exactly one word: yes." }
    )
    max_tokens = 10
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:8847/v1/chat/completions" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 300
    $end = Get-Date

    $duration = ($end - $start).TotalSeconds
    Write-Output "Time to response: $duration seconds"
    Write-Output "Result: $($response.choices[0].message.content)"
} catch {
    Write-Output "Error: $_"
}
