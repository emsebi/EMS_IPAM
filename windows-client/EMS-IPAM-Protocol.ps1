param([Parameter(Mandatory=$true)][string]$UriValue)

$ErrorActionPreference = 'Stop'

function Parse-Query([string]$Value) {
    $result = @{}
    foreach ($pair in ($Value.TrimStart('?') -split '&')) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $parts = $pair -split '=', 2
        $key = [System.Uri]::UnescapeDataString(($parts[0] -replace '\+', ' '))
        $item = if ($parts.Count -gt 1) { [System.Uri]::UnescapeDataString(($parts[1] -replace '\+', ' ')) } else { '' }
        $result[$key] = $item
    }
    return $result
}

function Find-AppPath([string[]]$ExecutableNames, [string[]]$Candidates) {
    foreach ($name in $ExecutableNames) {
        foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths')) {
            $key = Join-Path $root $name
            if (Test-Path -LiteralPath $key) {
                $value = (Get-Item -LiteralPath $key).GetValue('')
                if ($value -and (Test-Path -LiteralPath $value)) { return [string]$value }
            }
        }
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and (Test-Path -LiteralPath $command.Source)) { return [string]$command.Source }
    }
    foreach ($candidate in $Candidates) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) { return $expanded }
    }
    return $null
}

function Select-ToolFile([string]$Title) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = $Title
    $dialog.Filter = 'Executable files (*.exe)|*.exe'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
    return $null
}

function Resolve-Tool([string]$Name, $ConfiguredTool) {
    $configured = [Environment]::ExpandEnvironmentVariables([string]$ConfiguredTool.path)
    if ($configured -and (Test-Path -LiteralPath $configured)) { return @{ path = $configured; mode = [string]$ConfiguredTool.mode } }
    $resolved = switch ($Name) {
        'MIK' { Find-AppPath @('winbox.exe','WinBox.exe') @('%LOCALAPPDATA%\Programs\WinBox\WinBox.exe','%ProgramFiles%\MikroTik\WinBox\WinBox.exe','%USERPROFILE%\Downloads\winbox64.exe','%USERPROFILE%\Downloads\winbox.exe') }
        'RDP' { Find-AppPath @('mstsc.exe') @('%SystemRoot%\System32\mstsc.exe') }
        'SSH' { Find-AppPath @('putty.exe','ssh.exe') @('%ProgramFiles%\PuTTY\putty.exe','%SystemRoot%\System32\OpenSSH\ssh.exe') }
        'TELNET' { Find-AppPath @('putty.exe','telnet.exe') @('%ProgramFiles%\PuTTY\putty.exe','%SystemRoot%\System32\telnet.exe') }
        'VNC' { Find-AppPath @('vncviewer.exe','tvnviewer.exe') @('%ProgramFiles%\RealVNC\VNC Viewer\vncviewer.exe','%ProgramFiles%\TigerVNC\vncviewer.exe','%ProgramFiles%\TightVNC\tvnviewer.exe') }
    }
    if (-not $resolved) { $resolved = Select-ToolFile "مسیر برنامه $Name را انتخاب کنید" }
    if (-not $resolved) { throw "برنامه $Name پیدا نشد. نصب برنامه یا انتخاب فایل اجرایی لازم است." }
    $mode = switch ($Name) { 'MIK' { 'winbox' } 'RDP' { 'rdp' } 'VNC' { 'vnc' } 'SSH' { if ([IO.Path]::GetFileName($resolved) -ieq 'ssh.exe') { 'openssh' } else { 'putty' } } 'TELNET' { if ([IO.Path]::GetFileName($resolved) -ieq 'telnet.exe') { 'telnet' } else { 'putty-telnet' } } }
    return @{ path = $resolved; mode = $mode }
}

$UriValue = $UriValue.Trim().Trim('\"')
$uri = [System.Uri]$UriValue
if ($uri.Scheme -ne 'emsipam' -or $uri.Host -ne 'open') { throw 'لینک EMS IPAM معتبر نیست.' }
$query = Parse-Query $uri.Query
$toolName = ([string]$query['tool']).ToUpperInvariant()
$hostValue = [string]$query['host']
$usernameValue = [string]$query['username']
$portValue = 0
$parsedIp = $null

if (@('VNC','MIK','RDP','SSH','TELNET') -notcontains $toolName) { throw 'ابزار مجاز نیست.' }
if (-not [System.Net.IPAddress]::TryParse($hostValue, [ref]$parsedIp)) { throw 'IP معتبر نیست.' }
if (-not [int]::TryParse([string]$query['port'], [ref]$portValue) -or $portValue -lt 0 -or $portValue -gt 65535) { throw 'پورت معتبر نیست.' }
if ($usernameValue -and $usernameValue -notmatch '^[A-Za-z0-9_.@\\-]{1,120}$') { throw 'نام کاربری معتبر نیست.' }

$configPath = Join-Path $PSScriptRoot 'ems-client.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tool = $config.tools.$toolName
if ($null -eq $tool) { throw 'تنظیم ابزار پیدا نشد.' }
$resolvedTool = Resolve-Tool $toolName $tool
$executable = [string]$resolvedTool.path
$tool.path = $executable
$tool.mode = [string]$resolvedTool.mode
$config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8

$target = if ($portValue -gt 0) { $hostValue + ':' + $portValue } else { $hostValue }
$logPath = Join-Path $PSScriptRoot 'last-launch.txt'
@("time=" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), "tool=" + $toolName, "target=" + $target) | Set-Content -LiteralPath $logPath -Encoding UTF8
$arguments = switch ([string]$tool.mode) {
    'winbox' { @($target) }
    'rdp' { @('/v:' + $target, '/prompt') }
    'putty' {
        $items = @('-ssh', $hostValue)
        if ($portValue -gt 0) { $items += @('-P', [string]$portValue) }
        if ($usernameValue) { $items += @('-l', $usernameValue) }
        $items
    }
    'openssh' {
        $sshTarget = if ($usernameValue) { $usernameValue + '@' + $hostValue } else { $hostValue }
        if ($portValue -gt 0) { @('-p', [string]$portValue, $sshTarget) } else { @($sshTarget) }
    }
    'putty-telnet' {
        $items = @('-telnet', $hostValue)
        if ($portValue -gt 0) { $items += @('-P', [string]$portValue) }
        $items
    }
    'telnet' { if ($portValue -gt 0) { @($hostValue, [string]$portValue) } else { @($hostValue) } }
    'vnc' { @($target) }
    default { throw 'حالت اجرای ابزار مجاز نیست.' }
}

Start-Process -FilePath $executable -ArgumentList $arguments
