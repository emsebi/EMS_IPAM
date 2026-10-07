$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'EMS-IPAM-Client'
$exe = Join-Path $target 'EMS-IPAM-Client.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'EMS-IPAM-Client.exe is missing. Run Install.cmd.' }
Write-Host ('Client version: ' + (Get-Item -LiteralPath $exe).VersionInfo.FileVersion)
$expected = '"' + $exe + '" "%1"'
foreach ($scheme in @('emsipam-client','emsipam')) {
    $key = 'HKCU:\Software\Classes\' + $scheme + '\shell\open\command'
    if (-not (Test-Path -LiteralPath $key) -or (Get-Item -LiteralPath $key).GetValue('') -cne $expected) {
        throw ('Unexpected protocol command for ' + $scheme + '. Run Repair.cmd.')
    }
    Write-Host ($scheme + ': launcher registered') -ForegroundColor Green
    $choice = 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\' + $scheme + '\UserChoice'
    if (Test-Path -LiteralPath $choice) {
        $progId = (Get-ItemProperty -LiteralPath $choice).ProgId
        Write-Host ('Windows user choice: ' + $progId)
        $choiceCommand = 'Registry::HKEY_CLASSES_ROOT\' + $progId + '\shell\open\command'
        if (-not (Test-Path -LiteralPath $choiceCommand) -or (Get-Item -LiteralPath $choiceCommand).GetValue('') -cne $expected) {
            Write-Warning ('Windows overrides the launcher for ' + $scheme + '. Open Default Apps and select EMS-IPAM Client for this protocol.')
            Write-Host 'Command: start ms-settings:defaultapps'
        }
    }
}
Write-Host 'Browser-saved application choices cannot be verified here. If a full URL reaches WinBox, change the browser handler to:' -ForegroundColor Yellow
Write-Host $exe
$log = Join-Path $target 'last-launch.txt'
if (Test-Path -LiteralPath $log) { Write-Host 'Last client launch:'; Get-Content -LiteralPath $log }
else { Write-Host 'No connection has been launched through this client yet.' }
