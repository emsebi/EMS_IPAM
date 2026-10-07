# Pure validation/argument functions. Dot-sourcing this file never starts a tool.
function ConvertFrom-EmsUri([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 4096) { throw 'Invalid EMS-IPAM link.' }
    $uri = $null
    if (-not [Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$uri)) { throw 'Invalid EMS-IPAM link.' }
    if (@('emsipam-client','emsipam') -notcontains $uri.Scheme -or $uri.Host -ne 'open' -or
        $uri.UserInfo -or $uri.Port -ne -1 -or $uri.Fragment -or @('','/') -notcontains $uri.AbsolutePath) {
        throw 'Invalid EMS-IPAM link endpoint.'
    }
    $query = @{}
    foreach ($pair in ($uri.Query.TrimStart('?') -split '&')) {
        if (-not $pair) { continue }
        $parts = $pair -split '=', 2
        $key = [Uri]::UnescapeDataString(($parts[0] -replace '\+', ' '))
        if (@('tool','host','port','username') -notcontains $key -or $query.ContainsKey($key) -or $parts.Count -ne 2) {
            throw 'Invalid or duplicate link parameter.'
        }
        $query[$key] = [Uri]::UnescapeDataString(($parts[1] -replace '\+', ' '))
    }
    $toolName = ([string]$query.tool).ToUpperInvariant()
    if (@('MIK','RDP','SSH','TELNET','VNC') -notcontains $toolName) { throw 'Unsupported tool.' }
    $hostValue = [string]$query.host
    $parsedIp = $null
    if (-not [Net.IPAddress]::TryParse($hostValue, [ref]$parsedIp) -or $hostValue -match '[%\s]') { throw 'Invalid IP address.' }
    # Reject legacy short/hex/octal IPv4 forms rather than connecting to an unexpected host.
    if ($parsedIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $parsedIp.ToString() -cne $hostValue) { throw 'Use a dotted-decimal IPv4 address.' }
    $hostValue = $parsedIp.ToString()
    $portValue = 0
    if ([string]$query.port -notmatch '^\d{1,5}$' -or -not [int]::TryParse([string]$query.port, [ref]$portValue) -or $portValue -gt 65535) { throw 'Invalid port.' }
    $usernameValue = [string]$query.username
    if ($usernameValue -and $usernameValue -notmatch '^[A-Za-z0-9_.@\\-]{1,120}$') { throw 'Invalid username.' }
    $address = if ($hostValue.Contains(':')) { '[' + $hostValue + ']' } else { $hostValue }
    # WinBox's default port needs no suffix, matching the address the user expects.
    $target = if ($portValue -gt 0 -and -not ($toolName -eq 'MIK' -and $portValue -eq 8291)) { $address + ':' + $portValue } else { $address }
    return [pscustomobject]@{ Tool = $toolName; HostValue = $hostValue; Port = $portValue; Username = $usernameValue; Target = $target }
}

function Get-EmsArguments($Request, [string]$Mode) {
    $allowed = @{ MIK=@('winbox'); RDP=@('rdp'); SSH=@('putty','openssh'); TELNET=@('putty-telnet','telnet'); VNC=@('vnc') }
    if ($allowed[$Request.Tool] -notcontains $Mode) { throw 'Tool configuration mode does not match the request.' }
    $target = $Request.Target
    $hostValue = $Request.HostValue
    $portValue = $Request.Port
    $usernameValue = $Request.Username
    switch ($Mode) {
        'winbox' { @($target) }
        'rdp' { @(('/v:' + $target), '/prompt') }
        'putty' {
            $items = @('-ssh', $hostValue)
            if ($portValue -gt 0) { $items += @('-P', [string]$portValue) }
            if ($usernameValue) { $items += @('-l', $usernameValue) }
            $items
        }
        'openssh' {
            $items = @()
            if ($portValue -gt 0) { $items += @('-p', [string]$portValue) }
            if ($usernameValue) { $items += @('-l', $usernameValue) }
            $items + @($hostValue)
        }
        'putty-telnet' {
            $items = @('-telnet', $hostValue)
            if ($portValue -gt 0) { $items += @('-P', [string]$portValue) }
            $items
        }
        'telnet' { if ($portValue -gt 0) { @($hostValue, [string]$portValue) } else { @($hostValue) } }
        'vnc' { @($target) }
    }
}
