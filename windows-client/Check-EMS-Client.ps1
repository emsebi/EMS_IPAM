$ErrorActionPreference = 'Stop'
$root = 'Registry::HKEY_CURRENT_USER\Software\Classes\emsipam'
$command = (Get-Item -LiteralPath (Join-Path $root 'shell\open\command')).GetValue('')
Write-Host 'EMS IPAM protocol handler:' -ForegroundColor Cyan
Write-Host $command
$log = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client\last-launch.txt'
if (Test-Path -LiteralPath $log) {
    Write-Host ''
    Write-Host 'Last launch:' -ForegroundColor Cyan
    Get-Content -LiteralPath $log
}
else { Write-Host 'No connection has been launched yet.' -ForegroundColor Yellow }
