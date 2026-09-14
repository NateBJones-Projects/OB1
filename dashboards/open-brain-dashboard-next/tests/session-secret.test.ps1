param([Parameter(Mandatory=$true)][string]$StoreDirectory)
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '..\scripts\local-session-secret.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'FAIL: persistent protected session-secret helper is missing' }
. $helper
$first = Get-LocalDashboardSessionSecret -StoreDirectory $StoreDirectory
$second = Get-LocalDashboardSessionSecret -StoreDirectory $StoreDirectory
if ($first.Length -lt 32 -or $first -cne $second) { throw 'FAIL: session secret did not persist' }
$secretFile = Join-Path $StoreDirectory 'session-secret.dpapi'
$encoded = [IO.File]::ReadAllText($secretFile)
if ($encoded.Contains($first)) { throw 'FAIL: stored secret is plaintext' }
$acl = Get-Acl -LiteralPath $StoreDirectory
if (-not $acl.AreAccessRulesProtected) { throw 'FAIL: secret directory inherits permissions' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($rule in $acl.Access) {
    $id = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($id -ne $sid -and $id -ne 'S-1-5-18') { throw 'FAIL: unexpected secret directory principal' }
}
$runner = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\scripts\run-local-dashboard.ps1'))
if ($runner -notmatch 'Get-LocalDashboardSessionSecret' -or $runner -match 'RandomNumberGenerator') { throw 'FAIL: launcher still rotates the session secret' }
if ($runner -notmatch 'LOCAL_DASHBOARD_AUTH') { throw 'FAIL: local-only remember option is not enabled' }
# Corruption must not silently rotate the key or grant a session.
[IO.File]::WriteAllText($secretFile, 'corrupt fixture')
$rejected = $false
try { $null = Get-LocalDashboardSessionSecret -StoreDirectory $StoreDirectory } catch { $rejected = $true }
if (-not $rejected) { throw 'FAIL: corrupt storage was accepted' }
Write-Output 'PASS: persistent DPAPI secret, owner-only ACL, launcher wiring, corrupt-store rejection'
