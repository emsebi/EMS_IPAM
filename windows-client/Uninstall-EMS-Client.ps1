$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client\EMS-IPAM-Client.exe'
$expected = '"' + $exe + '" "%1"'
foreach ($id in @('emsipam-client','emsipam','EMSIPAM.Client.Url','Applications\EMS-IPAM-Client.exe')) {
    $root = 'HKCU:\Software\Classes\' + $id
    $key = $root + '\shell\open\command'
    if ((Test-Path -LiteralPath $key) -and (Get-Item -LiteralPath $key).GetValue('') -ceq $expected) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
Remove-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'EMS-IPAM Client' -ErrorAction SilentlyContinue
if (Test-Path 'HKCU:\Software\EMS-IPAM-Client') { Remove-Item 'HKCU:\Software\EMS-IPAM-Client' -Recurse -Force }
Write-Host 'EMS-IPAM registration removed. Tool settings are retained in LocalAppData. Browser choices may need resetting.'
