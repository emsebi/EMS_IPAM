$ErrorActionPreference = 'Stop'
$root = 'HKCU:\Software\Classes\emsipam'
if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
Write-Host 'پروتکل EMS IPAM از ویندوز حذف شد.' -ForegroundColor Yellow
