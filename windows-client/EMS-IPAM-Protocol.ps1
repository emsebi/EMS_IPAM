param([Parameter(Mandatory=$true)][string]$UriValue)

$ErrorActionPreference = 'Stop'

function Parse-Query([string]$Value) {
    $result = @{}
    foreach ($pair in ($Value.TrimStart('?') -split '&')) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $parts = $pair -split '=', 2
        $key = [System.Uri]::UnescapeDataString(($parts[0] -replace '\+', ' '))
        $item = if ($parts.Count -gt 1) { [System.Uri]::UnescapeDataString(($parts[1] -replace '\+', ' ')) } else { '' }
        $result[$key] = $item
    }
    return $result
}

$uri = [System.Uri]$UriValue
if ($uri.Scheme -ne 'emsipam' -or $uri.Host -ne 'open') { throw 'لینک EMS IPAM معتبر نیست.' }
$query = Parse-Query $uri.Query
$toolName = ([string]$query['tool']).ToUpperInvariant()
$hostValue = [string]$query['host']
$portValue = 0
$parsedIp = $null

if (@('VNC','MIK','RDP','SSH') -notcontains $toolName) { throw 'ابزار مجاز نیست.' }
if (-not [System.Net.IPAddress]::TryParse($hostValue, [ref]$parsedIp)) { throw 'IP معتبر نیست.' }
if (-not [int]::TryParse([string]$query['port'], [ref]$portValue) -or $portValue -lt 0 -or $portValue -gt 65535) { throw 'پورت معتبر نیست.' }

$configPath = Join-Path $PSScriptRoot 'ems-client.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tool = $config.tools.$toolName
if ($null -eq $tool) { throw 'تنظیم ابزار پیدا نشد.' }
$executable = [Environment]::ExpandEnvironmentVariables([string]$tool.path)
if (-not (Test-Path -LiteralPath $executable)) { throw "فایل ابزار پیدا نشد: $executable" }

$target = if ($portValue -gt 0) { $hostValue + ':' + $portValue } else { $hostValue }
$arguments = switch ([string]$tool.mode) {
    'winbox' { @($target) }
    'rdp' { @('/v:' + $target) }
    'putty' {
        if ($portValue -gt 0) { @('-ssh', $hostValue, '-P', [string]$portValue) } else { @('-ssh', $hostValue) }
    }
    'vnc' { @($target) }
    default { throw 'حالت اجرای ابزار مجاز نیست.' }
}

Start-Process -FilePath $executable -ArgumentList $arguments
