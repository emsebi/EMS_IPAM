param([switch]$LogicOnly)
# Offline Windows acceptance test. No network connection or device is used.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'EMS-IPAM-Common.ps1')
$count = 0
function Assert-Equal($Actual, $Expected, [string]$Name) {
    if (($Actual | ConvertTo-Json -Compress) -cne ($Expected | ConvertTo-Json -Compress)) { throw "FAIL: $Name" }
    $script:count++
    Write-Host ('PASS: ' + $Name) -ForegroundColor Green
}
foreach ($case in @(
    @('emsipam-client://open?tool=MIK&host=192.168.1.4&port=8291','192.168.1.4'),
    @('emsipam-client://open?tool=MIK&host=192.0.2.4&port=9191','192.0.2.4:9191'),
    @('emsipam://open?tool=MIK&host=192.0.2.4&port=0','192.0.2.4'),
    @('emsipam-client://open?tool=MIK&host=2001%3Adb8%3A%3A4&port=8291','[2001:db8::4]'),
    @('emsipam-client://open?tool=MIK&host=2001%3Adb8%3A%3A4&port=9191','[2001:db8::4]:9191')
)) {
    $request = ConvertFrom-EmsUri $case[0]
    Assert-Equal @(Get-EmsArguments $request 'winbox') @($case[1]) ('WinBox target ' + $case[1])
}
$request = ConvertFrom-EmsUri 'emsipam-client://open?tool=SSH&host=192.0.2.4&port=2222&username=DOMAIN%5Cuser'
Assert-Equal @(Get-EmsArguments $request 'putty') @('-ssh','192.0.2.4','-P','2222','-l','DOMAIN\user') 'SSH port and decoded username'
foreach ($bad in @(
    'https://open?tool=MIK&host=192.0.2.4&port=8291',
    'emsipam-client://other?tool=MIK&host=192.0.2.4&port=8291',
    'emsipam-client://open/run?tool=MIK&host=192.0.2.4&port=8291',
    'emsipam-client://open?tool=CMD&host=192.0.2.4&port=8291',
    'emsipam-client://open?tool=MIK&host=127.1&port=8291',
    'emsipam-client://open?tool=MIK&host=bad&port=8291',
    'emsipam-client://open?tool=MIK&host=192.0.2.4&port=65536',
    'emsipam-client://open?tool=MIK&host=192.0.2.4&port=-1',
    'emsipam-client://open?tool=MIK&host=192.0.2.4&port=8291&port=22',
    'emsipam-client://open?tool=MIK&host=192.0.2.4&port=8291&password=secret',
    'emsipam-client://open?tool=SSH&host=192.0.2.4&port=22&username=user%22%20-command%20bad'
)) {
    $rejected = $false
    try { ConvertFrom-EmsUri $bad | Out-Null } catch { $rejected = $true }
    Assert-Equal $rejected $true 'Invalid link rejected'
}
foreach ($case in @(
    @('RDP','rdp',3389,@('/v:192.0.2.4:3389','/prompt')),
    @('SSH','openssh',2222,@('-p','2222','192.0.2.4')),
    @('TELNET','putty-telnet',23,@('-telnet','192.0.2.4','-P','23')),
    @('TELNET','telnet',23,@('192.0.2.4','23')),
    @('VNC','vnc',5900,@('192.0.2.4:5900'))
)) {
    $request = ConvertFrom-EmsUri ('emsipam-client://open?tool=' + $case[0] + '&host=192.0.2.4&port=' + $case[2])
    Assert-Equal @(Get-EmsArguments $request $case[1]) $case[3] ('Arguments for ' + $case[1])
}
if ($LogicOnly) { Write-Host "All $count logic tests passed (no Windows launcher execution)."; exit 0 }
$exe = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client\EMS-IPAM-Client.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Install the client first to run the launcher integration test.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ems-client-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    Copy-Item -LiteralPath $exe -Destination $temp
    foreach ($name in @('EMS-IPAM-Protocol.ps1','EMS-IPAM-Common.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $temp }
    $recorder = Join-Path $temp 'capture.exe'
    Add-Type -OutputAssembly $recorder -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.IO;
public static class CaptureEmsArguments {
    public static void Main(string[] args) {
        File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "captured.txt"), args);
    }
}
'@
    @{tools=@{MIK=@{path=$recorder;mode='winbox'}}} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $temp 'ems-client.json') -Encoding UTF8
    foreach ($case in @(@('8291','192.168.1.4'),@('9191','192.168.1.4:9191'))) {
        $capture = Join-Path $temp 'captured.txt'
        if (Test-Path $capture) { Remove-Item $capture }
        $link = 'emsipam-client://open?tool=MIK&host=192.168.1.4&port=' + $case[0]
        $process = Start-Process -FilePath (Join-Path $temp 'EMS-IPAM-Client.exe') -ArgumentList ('"' + $link + '"') -Wait -PassThru
        Assert-Equal $process.ExitCode 0 'Launcher exit code'
        $captured = @()
        for ($i=0; $i -lt 40; $i++) {
            try { $captured = @(Get-Content -LiteralPath $capture -ErrorAction Stop) } catch { $captured = @() }
            if ($captured.Count -eq 1 -and $captured[0] -ceq $case[1]) { break }
            Start-Sleep -Milliseconds 100
        }
        Assert-Equal $captured @($case[1]) 'Actual child receives only address'
    }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
Write-Host ("All $count offline tests passed. Browser association and real WinBox still need the manual check.") -ForegroundColor Green
