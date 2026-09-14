# Windows-only local dashboard session encryption key. Never print the return value.
function Get-LocalDashboardSessionSecret {
    param([string]$StoreDirectory = (Join-Path $env:LOCALAPPDATA 'OpenBrainDashboard\Auth'))
    $ErrorActionPreference = 'Stop'
    $StoreDirectory = [IO.Path]::GetFullPath($StoreDirectory)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $tag = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($StoreDirectory.ToLowerInvariant()))).Replace('-', '') }
    finally { $sha.Dispose() }
    $mutex = New-Object Threading.Mutex($false, "Local\OpenBrainSession-$($sid.Value)-$tag")
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(15000) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Session storage is busy; retry the dashboard launch.' }
        if (-not (Test-Path -LiteralPath $StoreDirectory)) {
            $null = New-Item -ItemType Directory -Path $StoreDirectory
        }
        if ((Get-Item -LiteralPath $StoreDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Session storage must be a local directory, not a link.'
        }
        $directory = [IO.DirectoryInfo]::new($StoreDirectory)
        $acl = if ($PSVersionTable.PSEdition -eq 'Core') {
            [IO.FileSystemAclExtensions]::GetAccessControl($directory, [Security.AccessControl.AccessControlSections]::Access)
        } else {
            $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
        }
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($existing in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { $null = $acl.RemoveAccessRuleSpecific($existing) }
        foreach ($principal in @($sid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        if ($PSVersionTable.PSEdition -eq 'Core') {
            [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl)
        } else {
            $directory.SetAccessControl($acl)
        }
        $path = Join-Path $StoreDirectory 'session-secret.dpapi'
        if (-not (Test-Path -LiteralPath $path)) {
            $bytes = New-Object byte[] 48
            $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
            $secure = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
            try { $encrypted = ConvertFrom-SecureString $secure } finally { $secure.Dispose() }
            $temp = Join-Path $StoreDirectory ([IO.Path]::GetRandomFileName())
            try {
                [IO.File]::WriteAllText($temp, $encrypted)
                [IO.File]::Move($temp, $path)
            } finally {
                if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
            }
        }
        if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Session secret must not be a link.'
        }
        try {
            $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($path))
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
            if ($value.Length -lt 32) { throw 'Invalid secret' }
            return $value
        } catch {
            throw 'Cannot decrypt the dashboard session secret for this Windows user. Storage was not replaced.'
        }
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
