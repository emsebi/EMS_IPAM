$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'EMS-IPAM-Protocol.ps1') -Destination $target -Force
if (-not (Test-Path -LiteralPath (Join-Path $target 'ems-client.json'))) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ems-client.json') -Destination $target -Force
}

$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $target 'EMS-IPAM-Protocol.ps1') + '" "%1"'
$root = 'HKCU:\Software\Classes\emsipam'
New-Item -Path $root -Force | Out-Null
Set-Item -Path $root -Value 'URL:EMS IPAM Protocol'
New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$commandKey = Join-Path $root 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $commandKey -Value $command

Write-Host 'EMS Client Pack نصب شد.' -ForegroundColor Green
Write-Host "تنظیم مسیر ابزارها: $(Join-Path $target 'ems-client.json')"
