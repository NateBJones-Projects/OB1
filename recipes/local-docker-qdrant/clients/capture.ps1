# capture.ps1 — Send a thought to the local Open Brain Qdrant stack (port 3100)
#
# Usage:
#   .\capture.ps1 "Your thought here"
#   .\capture.ps1                        # reads from clipboard if no argument
#
# Required environment variable:
#   OPEN_BRAIN_KEY — your MCP access key (set in your PowerShell profile or system env)
#
# Note: This script targets the Qdrant stack on port 3100.
#       For the pgvector stack (port 3000), use recipes/local-docker/capture.ps1 instead.

param(
    [Parameter(Position=0)]
    [string]$Content
)

$key = $env:OPEN_BRAIN_KEY
if (-not $key) {
    Write-Error "OPEN_BRAIN_KEY environment variable is not set."
    exit 1
}

if (-not $Content) {
    $Content = Get-Clipboard
}

if (-not $Content -or $Content.Trim() -eq "") {
    Write-Error "No content to capture. Pass a string or copy something to the clipboard first."
    exit 1
}

$body = @{
    content = $Content.Trim()
    source  = "clipboard"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod `
        -Uri "http://localhost:3100/capture-external" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{ "x-brain-key" = $key } `
        -Body $body

    Write-Host "Captured: $($response.type) - $($response.topics -join ', ') (id: $($response.id))"
} catch {
    Write-Error "Failed to capture: $_"
    exit 1
}
