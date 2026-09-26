$ErrorActionPreference = 'Stop'
foreach ($scheme in @('emsipam-client','emsipam')) {
    $root = 'Registry::HKEY_CURRENT_USER\Software\Classes\' + $scheme
    $commandKey = Join-Path $root 'shell\open\command'
    if (-not (Test-Path -LiteralPath $commandKey)) { throw ('Protocol is not registered: ' + $scheme) }
    $command = (Get-Item -LiteralPath $commandKey).GetValue('')
    Write-Host ($scheme + ' handler:') -ForegroundColor Cyan
    Write-Host $command
    if ($command -notmatch 'EMS-IPAM-Protocol\.ps1' -or $command -match 'winbox\.exe') {
        throw ('Invalid EMS IPAM handler: ' + $scheme)
    }
}
$log = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client\last-launch.txt'
if (Test-Path -LiteralPath $log) {
    Write-Host ''
    Write-Host 'Last launch:' -ForegroundColor Cyan
    Get-Content -LiteralPath $log
}
else { Write-Host 'No connection has been launched yet.' -ForegroundColor Yellow }
