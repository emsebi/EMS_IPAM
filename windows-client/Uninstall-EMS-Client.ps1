$ErrorActionPreference = 'Stop'
foreach ($scheme in @('emsipam-client','emsipam')) {
    $root = 'HKCU:\Software\Classes\' + $scheme
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
Write-Host 'پروتکل EMS IPAM از ویندوز حذف شد.' -ForegroundColor Yellow
