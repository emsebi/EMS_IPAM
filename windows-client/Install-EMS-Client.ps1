$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'EMS-IPAM-Protocol.ps1') -Destination $target -Force

function Find-AppPath([string[]]$Names, [string[]]$Candidates) {
    foreach ($name in $Names) {
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
    return ''
}

$winbox = Find-AppPath @('winbox.exe','WinBox.exe') @('%LOCALAPPDATA%\Programs\WinBox\WinBox.exe','%ProgramFiles%\MikroTik\WinBox\WinBox.exe','%USERPROFILE%\Downloads\winbox64.exe','%USERPROFILE%\Downloads\winbox.exe')
$rdp = Find-AppPath @('mstsc.exe') @('%SystemRoot%\System32\mstsc.exe')
$putty = Find-AppPath @('putty.exe') @('%ProgramFiles%\PuTTY\putty.exe')
$ssh = if ($putty) { $putty } else { Find-AppPath @('ssh.exe') @('%SystemRoot%\System32\OpenSSH\ssh.exe') }
$vnc = Find-AppPath @('vncviewer.exe','tvnviewer.exe') @('%ProgramFiles%\RealVNC\VNC Viewer\vncviewer.exe','%ProgramFiles%\TigerVNC\vncviewer.exe','%ProgramFiles%\TightVNC\tvnviewer.exe')
$config = [ordered]@{ tools = [ordered]@{
    VNC = [ordered]@{ path = $vnc; mode = 'vnc' }
    MIK = [ordered]@{ path = $winbox; mode = 'winbox' }
    RDP = [ordered]@{ path = $rdp; mode = 'rdp' }
    SSH = [ordered]@{ path = $ssh; mode = $(if ($ssh -and [IO.Path]::GetFileName($ssh) -ieq 'ssh.exe') { 'openssh' } else { 'putty' }) }
} }
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'ems-client.json') -Encoding UTF8

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$command = '"' + $powershell + '" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $target 'EMS-IPAM-Protocol.ps1') + '" "%1"'
$root = 'HKCU:\Software\Classes\emsipam'
if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
New-Item -Path $root -Force | Out-Null
Set-Item -Path $root -Value 'URL:EMS IPAM Client'
New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $root -Name 'FriendlyTypeName' -Value 'EMS IPAM Client' -PropertyType String -Force | Out-Null
$iconKey = Join-Path $root 'DefaultIcon'
New-Item -Path $iconKey -Force | Out-Null
Set-Item -Path $iconKey -Value ($powershell + ',0')
$commandKey = Join-Path $root 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $commandKey -Value $command

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EmsShellRefresh {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
[EmsShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host 'EMS Client Pack installed successfully.' -ForegroundColor Green
Write-Host 'Protocol: emsipam -> EMS IPAM Client (not WinBox directly)' -ForegroundColor Cyan
foreach ($item in @(@('WinBox',$winbox),@('RDP',$rdp),@('SSH',$ssh),@('VNC',$vnc))) {
    if ($item[1]) { Write-Host ($item[0] + ': found') -ForegroundColor Green }
    else { Write-Host ($item[0] + ': not found - file selection will open on first use') -ForegroundColor Yellow }
}
