$ErrorActionPreference = 'Stop'

$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
$env:NEXT_PUBLIC_API_URL = 'https://fdbkwkrtdeumvpwmvoev.supabase.co/functions/v1/open-brain-rest'
$env:NEXT_PUBLIC_ALLOW_HARD_DELETE = 'false'

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& .\node_modules\.bin\next.cmd start -H 127.0.0.1 -p 3049
