param(
    [string]$UriValue,
    [string]$UriBase64,
    [switch]$ConfigureWinBox,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'

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
        'MIK' { Find-AppPath @('winbox.exe','WinBox.exe','winbox64.exe') @('%LOCALAPPDATA%\Programs\WinBox\WinBox.exe','%ProgramFiles%\MikroTik\WinBox\WinBox.exe','%USERPROFILE%\Downloads\winbox64.exe','%USERPROFILE%\Downloads\winbox.exe') }
        'RDP' { Find-AppPath @('mstsc.exe') @('%SystemRoot%\System32\mstsc.exe') }
        'SSH' { Find-AppPath @('putty.exe','ssh.exe') @('%ProgramFiles%\PuTTY\putty.exe','%SystemRoot%\System32\OpenSSH\ssh.exe') }
        'TELNET' { Find-AppPath @('putty.exe','telnet.exe') @('%ProgramFiles%\PuTTY\putty.exe','%SystemRoot%\System32\telnet.exe') }
        'VNC' { Find-AppPath @('vncviewer.exe','tvnviewer.exe') @('%ProgramFiles%\RealVNC\VNC Viewer\vncviewer.exe','%ProgramFiles%\TigerVNC\vncviewer.exe','%ProgramFiles%\TightVNC\tvnviewer.exe') }
    }
    if (-not $resolved) { $resolved = Select-ToolFile "EMS-IPAM: select the $Name executable (not the EMS-IPAM launcher)" }
    if (-not $resolved) { throw "Tool selection cancelled or $Name was not found." }
    if ([IO.Path]::GetFileName($resolved) -ieq 'EMS-IPAM-Client.exe') { throw 'Choose the tool executable, not EMS-IPAM-Client.exe.' }
    $mode = switch ($Name) { 'MIK' { 'winbox' } 'RDP' { 'rdp' } 'VNC' { 'vnc' } 'SSH' { if ([IO.Path]::GetFileName($resolved) -ieq 'ssh.exe') { 'openssh' } else { 'putty' } } 'TELNET' { if ([IO.Path]::GetFileName($resolved) -ieq 'telnet.exe') { 'telnet' } else { 'putty-telnet' } } }
    return @{ path = $resolved; mode = $mode }
}


try {
    . (Join-Path $PSScriptRoot 'EMS-IPAM-Common.ps1')
    if ($UriBase64) {
        if ($UriValue) { throw 'Pass only one link.' }
        $UriValue = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($UriBase64))
    }
    if ($ConfigureWinBox) {
        $request = ConvertFrom-EmsUri 'emsipam-client://open?tool=MIK&host=192.0.2.1&port=8291'
    } else { $request = ConvertFrom-EmsUri $UriValue }
    if ($ValidateOnly) { $request | ConvertTo-Json -Compress; exit 0 }
    $configPath = Join-Path $PSScriptRoot 'ems-client.json'
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $toolName = $request.Tool
    $tool = $config.tools.$toolName
    if ($null -eq $tool) { throw 'Tool configuration is missing. Run Install.cmd again.' }
    if ($ConfigureWinBox) {
        $selected = Select-ToolFile 'EMS-IPAM: select winbox.exe or winbox64.exe'
        if (-not $selected) { exit 0 }
        if ([IO.Path]::GetFileName($selected) -ieq 'EMS-IPAM-Client.exe') { throw 'Select WinBox itself in this window.' }
        $tool.path = $selected
        $tool.mode = 'winbox'
    }
    $resolvedTool = Resolve-Tool $toolName $tool
    $executable = [string]$resolvedTool.path
    if ([IO.Path]::GetExtension($executable) -ine '.exe' -or [IO.Path]::GetFileName($executable) -ieq 'EMS-IPAM-Client.exe') {
        throw 'The configured tool must be a tool executable (.exe), not the EMS-IPAM launcher.'
    }
    $arguments = @(Get-EmsArguments $request ([string]$resolvedTool.mode))
    $tool.path = $executable
    $tool.mode = [string]$resolvedTool.mode
    $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8
    if ($ConfigureWinBox) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show('WinBox path saved. Return to the panel and click MIK.', 'EMS-IPAM Client') | Out-Null
        exit 0
    }
    Start-Process -FilePath $executable -ArgumentList $arguments -ErrorAction Stop | Out-Null
    @('version=0.8.0'; ('time=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'));
      'status=launched'; ('tool=' + $toolName); ('target=' + $request.Target);
      ('executable=' + $executable)) | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-launch.txt') -Encoding UTF8
} catch {
    $message = $_.Exception.Message
    if ($ValidateOnly) { Write-Error $message; exit 1 }
    @('version=0.8.0'; ('time=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'));
      'status=error'; ('error=' + $message)) | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-launch.txt') -Encoding UTF8
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($message + "`nRun Check.cmd for diagnostics.", 'EMS-IPAM Client',
        [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    exit 1
}
