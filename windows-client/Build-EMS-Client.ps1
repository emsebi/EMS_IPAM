# Optional developer rebuild on Windows PowerShell 5.1; Install.cmd uses the included EXE.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') { throw 'Use Windows PowerShell 5.1 (powershell.exe), not pwsh.' }
$output = Join-Path $PSScriptRoot 'EMS-IPAM-Client.exe'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ems-build-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'EMS-IPAM-Launcher.cs') -OutputAssembly $temp -OutputType WindowsApplication -ReferencedAssemblies @('System.dll','System.Core.dll','System.Windows.Forms.dll')
    Copy-Item -LiteralPath $temp -Destination $output -Force
    Write-Host 'EMS-IPAM-Client.exe rebuilt. Run Install.cmd to install it.'
} finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
