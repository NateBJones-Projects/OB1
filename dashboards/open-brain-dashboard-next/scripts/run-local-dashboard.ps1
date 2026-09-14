$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'local-session-secret.ps1')
$env:SESSION_SECRET = Get-LocalDashboardSessionSecret
$env:LOCAL_DASHBOARD_AUTH = 'true'
$env:NEXT_PUBLIC_API_URL = 'https://fdbkwkrtdeumvpwmvoev.supabase.co/functions/v1/open-brain-rest'
$env:NEXT_PUBLIC_ALLOW_HARD_DELETE = 'false'

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& .\node_modules\.bin\next.cmd start -H 127.0.0.1 -p 3049
