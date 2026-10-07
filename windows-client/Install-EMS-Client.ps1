# Run with Windows PowerShell 5.1 (Install.cmd selects it explicitly).
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') { throw 'Use Install.cmd with Windows PowerShell 5.1.' }
$target = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$executable = Join-Path $target 'EMS-IPAM-Client.exe'
$sourceExe = Join-Path $PSScriptRoot 'EMS-IPAM-Client.exe'
if (-not (Test-Path -LiteralPath $sourceExe)) { throw 'Extract the whole ZIP first; EMS-IPAM-Client.exe is missing.' }
if ([IO.Path]::GetFullPath($sourceExe) -ine [IO.Path]::GetFullPath($executable)) {
    Copy-Item -LiteralPath $sourceExe -Destination $executable -Force
}
foreach ($file in @('EMS-IPAM-Protocol.ps1','EMS-IPAM-Common.ps1','Check-EMS-Client.ps1','Test-EMS-Client.ps1','README-FA.txt','Configure-WinBox.cmd','Check.cmd','Test.cmd')) {
    $source = Join-Path $PSScriptRoot $file
    if ([IO.Path]::GetFullPath($source) -ine [IO.Path]::GetFullPath((Join-Path $target $file))) {
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
}
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

$winbox = Find-AppPath @('winbox.exe','WinBox.exe','winbox64.exe') @('%LOCALAPPDATA%\Programs\WinBox\WinBox.exe','%ProgramFiles%\MikroTik\WinBox\WinBox.exe','%USERPROFILE%\Downloads\winbox64.exe','%USERPROFILE%\Downloads\winbox.exe')
$rdp = Find-AppPath @('mstsc.exe') @('%SystemRoot%\System32\mstsc.exe')
$putty = Find-AppPath @('putty.exe') @('%ProgramFiles%\PuTTY\putty.exe')
$ssh = if ($putty) { $putty } else { Find-AppPath @('ssh.exe') @('%SystemRoot%\System32\OpenSSH\ssh.exe') }
$telnetNative = Find-AppPath @('telnet.exe') @('%SystemRoot%\System32\telnet.exe')
$telnet = if ($putty) { $putty } else { $telnetNative }
$vnc = Find-AppPath @('vncviewer.exe','tvnviewer.exe') @('%ProgramFiles%\RealVNC\VNC Viewer\vncviewer.exe','%ProgramFiles%\TigerVNC\vncviewer.exe','%ProgramFiles%\TightVNC\tvnviewer.exe')
$config = [ordered]@{ tools = [ordered]@{
    VNC = [ordered]@{ path = $vnc; mode = 'vnc' }
    MIK = [ordered]@{ path = $winbox; mode = 'winbox' }
    RDP = [ordered]@{ path = $rdp; mode = 'rdp' }
    SSH = [ordered]@{ path = $ssh; mode = $(if ($ssh -and [IO.Path]::GetFileName($ssh) -ieq 'ssh.exe') { 'openssh' } else { 'putty' }) }
    TELNET = [ordered]@{ path = $telnet; mode = $(if ($telnet -and [IO.Path]::GetFileName($telnet) -ieq 'telnet.exe') { 'telnet' } else { 'putty-telnet' }) }
} }

$configPath = Join-Path $target 'ems-client.json'
if (Test-Path -LiteralPath $configPath) {
    # Repair must retain custom tool paths chosen by the user.
    $previous = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($name in @('MIK','RDP','SSH','TELNET','VNC')) {
        $saved = $previous.tools.$name
        if ($saved -and $saved.path) {
            $config.tools[$name].path = [string]$saved.path
            $config.tools[$name].mode = [string]$saved.mode
        }
    }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8

$command = '"' + $executable + '" "%1"'
function Register-EmsProtocol([string]$Scheme) {
    $root = 'HKCU:\Software\Classes\' + $Scheme
    New-Item -Path $root -Force | Out-Null
    Set-Item -Path $root -Value 'URL:EMS IPAM Client'
    New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name 'FriendlyTypeName' -Value 'EMS-IPAM Client' -PropertyType String -Force | Out-Null
    New-Item -Path ($root + '\DefaultIcon') -Force | Out-Null
    Set-Item -Path ($root + '\DefaultIcon') -Value ('"' + $executable + '",0')
    # Remove a stale DelegateExecute only for our own protocol/progID.
    $commandKey = $root + '\shell\open\command'
    New-Item -Path $commandKey -Force | Out-Null
    Remove-ItemProperty -Path $commandKey -Name 'DelegateExecute' -ErrorAction SilentlyContinue
    Set-Item -Path $commandKey -Value $command
}
Register-EmsProtocol 'emsipam-client'
Register-EmsProtocol 'emsipam'
Register-EmsProtocol 'EMSIPAM.Client.Url'

$application = 'HKCU:\Software\Classes\Applications\EMS-IPAM-Client.exe'
New-Item -Path ($application + '\shell\open\command') -Force | Out-Null
Set-Item -Path ($application + '\shell\open\command') -Value $command
New-ItemProperty -Path $application -Name 'FriendlyAppName' -Value 'EMS-IPAM Client' -Force | Out-Null
New-Item -Path ($application + '\SupportedProtocols') -Force | Out-Null
$capabilities = 'HKCU:\Software\EMS-IPAM-Client\Capabilities'
New-Item -Path ($capabilities + '\UrlAssociations') -Force | Out-Null
New-ItemProperty -Path $capabilities -Name 'ApplicationName' -Value 'EMS-IPAM Client' -Force | Out-Null
New-ItemProperty -Path $capabilities -Name 'ApplicationDescription' -Value 'Open network tools from EMS-IPAM links' -Force | Out-Null
foreach ($scheme in @('emsipam-client','emsipam')) {
    New-ItemProperty -Path ($capabilities + '\UrlAssociations') -Name $scheme -Value 'EMSIPAM.Client.Url' -Force | Out-Null
    New-ItemProperty -Path ($application + '\SupportedProtocols') -Name $scheme -Value '' -Force | Out-Null
}
New-Item -Path 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
New-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'EMS-IPAM Client' -Value 'Software\EMS-IPAM-Client\Capabilities' -Force | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EmsShellRefresh {
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
[EmsShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Host 'EMS-IPAM Client 0.8.0 installed for the current Windows user.' -ForegroundColor Green
Write-Host 'Browser handler: select EMS-IPAM-Client.exe at:' -ForegroundColor Cyan
Write-Host $executable
Write-Host 'Choose WinBox INSIDE the EMS-IPAM file picker, not in the browser.' -ForegroundColor Yellow
Write-Host 'If Firefox previously saved WinBox: Settings > General > Applications > emsipam-client > Use other > select the path above.'
Write-Host 'Configure-WinBox.cmd changes your WinBox path. Test.cmd runs offline argument tests.'
& (Join-Path $target 'Check-EMS-Client.ps1')
