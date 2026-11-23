# Windows PowerShell 5.1+; run from any working directory.
[CmdletBinding()]
param(
    [string]$DeviceId,
    [string]$FlutterSdk,
    [switch]$BackendOnly,
    [switch]$CheckOnly,
    [switch]$ReseedDemo
)

function Invoke-PartnerCommand {
    param([string]$Program, [string[]]$Arguments)
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Program @Arguments 2>&1 | ForEach-Object { Write-Host $_.ToString() }
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($commandExit -ne 0) {
        throw "$Program failed (exit $commandExit). Check the output above. Your data and configuration were preserved."
    }
}

function Read-PartnerEnv {
    param([string]$Path)
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
            $value = $Matches[2]
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$Matches[1]] = $value
        }
    }
    return $values
}

function Initialize-PartnerEnv {
    param([string]$Root)
    $path = Join-Path $Root '.env'
    if (Test-Path -LiteralPath $path) { return }
    $template = [IO.File]::ReadAllText((Join-Path $Root '.env.example'))
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $template = [regex]::Replace($template, '(?m)^([A-Z][A-Z0-9_]*)=\r?$', {
            param($match)
            $bytes = New-Object byte[] 32
            $rng.GetBytes($bytes)
            return $match.Groups[1].Value + '=' + ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
        })
    } finally { $rng.Dispose() }
    $template = $template.Replace('BETTER_AUTH_URL=http://localhost:8080', 'BETTER_AUTH_URL=http://localhost:8088')
    $template += "`nGATEWAY_PORT=8088`nPAYMENT_PROVIDER=local-test`n"
    # CreateNew prevents accidental overwrites, including concurrent setup runs.
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($template)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    Write-Host 'Created .env with unique development secrets (not printed).'
}

function Get-PartnerPort {
    param([hashtable]$Values)
    $port = 8080
    if ($Values.ContainsKey('GATEWAY_PORT')) {
        if (![int]::TryParse($Values.GATEWAY_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw 'GATEWAY_PORT in .env must be between 1 and 65535.'
        }
    }
    return $port
}

function Select-PartnerDevice {
    param([string[]]$Lines, [string]$Requested)
    $phones = @($Lines | ForEach-Object {
        if ($_ -match '^(\S+)\s+device(?:\s|$)' -and $Matches[1] -notlike 'emulator-*') { $Matches[1] }
    })
    if ($Requested) {
        if ($phones -notcontains $Requested) { throw 'The requested physical phone is not authorized. Check adb devices and the USB debugging prompt.' }
        return $Requested
    }
    if ($phones.Count -eq 0) { throw 'No authorized Android phone found. Connect a USB data cable, enable USB debugging and accept the prompt. Check adb devices; Windows may need the phone manufacturer USB driver.' }
    if ($phones.Count -gt 1) { throw 'Multiple Android phones found. Run again with -DeviceId SERIAL from adb devices.' }
    return $phones[0]
}

# Dot-sourcing exposes only the helpers for offline verification.
if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-f', 'compose.yaml', '-f', 'compose.services.yaml')
Push-Location $root
try {
    Write-Host 'Checking local prerequisites...'
    foreach ($program in @('node', 'docker')) {
        if (!(Get-Command $program -ErrorAction SilentlyContinue)) { throw "Install $program and reopen PowerShell so it is on PATH. See docs/partner-setup.md." }
    }
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Install Node.js 24 or newer.' }
    $dockerMode = & docker info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -ne 0 -or $dockerMode -ne 'linux') { throw 'Open Docker Desktop and wait for the Linux engine to be ready.' }
    Invoke-PartnerCommand docker @('compose', 'version')

    if (!$BackendOnly) {
        if ($FlutterSdk) {
            $flutter = Join-Path $FlutterSdk 'bin/flutter.bat'
            if (!(Test-Path -LiteralPath $flutter)) { throw 'FlutterSdk must point to the Flutter SDK folder containing bin/flutter.bat.' }
            $flutter = (Resolve-Path -LiteralPath $flutter).Path
        } else {
            $command = Get-Command flutter -ErrorAction SilentlyContinue
            if (!$command) { throw 'Install Flutter SDK and add its bin folder to PATH, or pass -FlutterSdk C:\path\to\flutter.' }
            $flutter = $command.Source
        }
        $sdk = $env:ANDROID_HOME
        if (!$sdk) { $sdk = $env:ANDROID_SDK_ROOT }
        if (!$sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
        $adb = Join-Path $sdk 'platform-tools/adb.exe'
        if (!(Test-Path -LiteralPath $adb)) { throw 'Install Android SDK Platform-Tools in Android Studio, or set ANDROID_HOME to your Android SDK folder.' }
        $env:ANDROID_HOME = $sdk
        $env:PATH = (Join-Path $sdk 'platform-tools') + ';' + $env:PATH
        Invoke-PartnerCommand $flutter @('--version')
        Invoke-PartnerCommand $adb @('start-server')
        $deviceLines = @(& $adb devices)
        if ($LASTEXITCODE -ne 0) { throw 'adb devices failed. Check the Android SDK installation.' }
        $phone = Select-PartnerDevice -Lines $deviceLines -Requested $DeviceId
        Write-Host "Using Android phone: $phone"
    }
    if ($CheckOnly) {
        Write-Host 'Prerequisite checks passed. No project files, containers or phone apps were changed.'
        return
    }

    Initialize-PartnerEnv $root
    $values = Read-PartnerEnv (Join-Path $root '.env')
    $required = @('BETTER_AUTH_SECRET', 'RESTAURANT_SERVICE_TOKEN', 'MENU_S3_ACCESS_KEY', 'MENU_S3_SECRET_KEY',
        'PAYMENTS_ORDER_TOKEN', 'PAYMENTS_WEBHOOK_SECRET', 'DRIVER_SERVICE_TOKEN', 'DISPATCH_ORDER_TOKEN', 'DELIVERY_PIN_KEY')
    $missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace($values[$_]) })
    if ($missing.Count) { throw ('Existing .env is incomplete. Fill these keys with separate random secrets: ' + ($missing -join ', ') + '. Setup will not overwrite it.') }
    $port = Get-PartnerPort $values
    $base = "http://localhost:$port"
    if ($values.BETTER_AUTH_URL -ne $base) { throw "For Android USB testing, set BETTER_AUTH_URL=$base in .env. Existing values were preserved." }
    if ($values.PAYMENT_PROVIDER -and $values.PAYMENT_PROVIDER -ne 'local-test') { throw 'This setup supports simulated local-test payments only. Use a separate local checkout/configuration.' }
    # Compose gives exported variables precedence over .env. Refuse silent mismatches.
    foreach ($key in @($required) + @('GATEWAY_PORT', 'BETTER_AUTH_URL', 'PAYMENT_PROVIDER')) {
        $exported = [Environment]::GetEnvironmentVariable($key, 'Process')
        $expected = $values[$key]
        if ($key -eq 'GATEWAY_PORT') { $expected = "$port" }
        if ($key -eq 'PAYMENT_PROVIDER' -and !$expected) { $expected = 'local-test' }
        if ($exported -and $exported -cne $expected) { throw "Environment variable $key overrides .env. Clear that variable in this terminal and retry." }
    }

    Write-Host 'Starting the complete Docker stack. The first download/build can take several minutes.'
    Invoke-PartnerCommand docker ($compose + @('config', '--quiet'))
    Invoke-PartnerCommand docker ($compose + @('up', '-d', '--build', '--wait', '--wait-timeout', '240'))
    $deadline = (Get-Date).AddSeconds(90)
    $healthy = $false
    do {
        try {
            $health = Invoke-RestMethod "$base/health/ready" -TimeoutSec 5
            if ($health.status -eq 'ok') { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (!$healthy) { throw "The gateway is not ready at $base. Run docker compose -f compose.yaml -f compose.services.yaml logs --tail 80." }

    $credentials = Join-Path $root '.local/demo-credentials.json'
    $pending = Join-Path $root '.local/partner-seed-pending'
    if (!(Test-Path -LiteralPath $credentials) -or (Test-Path -LiteralPath $pending) -or $ReseedDemo) {
        New-Item -ItemType Directory -Path (Join-Path $root '.local') -Force | Out-Null
        Set-Content -LiteralPath $pending -Value 'Local demo setup in progress'
        $previousBase = $env:DEMO_BASE_URL
        try {
            $env:DEMO_BASE_URL = $base
            Invoke-PartnerCommand node @('scripts/seed-malappuram-demo.mjs')
        } finally { $env:DEMO_BASE_URL = $previousBase }
        Remove-Item -LiteralPath $pending
    } else { Write-Host 'Preserved existing demo accounts, menus and driver state. Use -ReseedDemo only to refresh the sample fixtures.' }

    Write-Host "Admin: $base/admin-ui/"
    Write-Host 'Recovery emails: http://localhost:8025'
    Write-Host "Local logins (do not commit or share publicly): $credentials"
    if ($BackendOnly) { Write-Host 'Backend ready. Run without -BackendOnly when the Android phone is connected.'; return }

    Push-Location (Join-Path $root 'apps/mobile')
    try {
        Invoke-PartnerCommand $flutter @('pub', 'get')
        # Avoid the Android CLI's known "No url for ndk" failure for this SDK.
        $extension = Join-Path (Split-Path -Parent (Split-Path -Parent $flutter)) 'packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt'
        if (Test-Path -LiteralPath $extension) {
            $match = [regex]::Match([IO.File]::ReadAllText($extension), 'val ndkVersion: String = "([0-9.]+)"')
            if ($match.Success) {
                $ndkVersion = $match.Groups[1].Value
                $ndkProperties = Join-Path $sdk "ndk/$ndkVersion/source.properties"
                if (!(Test-Path -LiteralPath $ndkProperties) -and $ndkVersion -eq '28.2.13676358') {
                    & (Join-Path $root 'scripts/install-ndk.ps1') -SdkRoot $sdk
                }
            }
        }
        Invoke-PartnerCommand $adb @('-s', $phone, 'reverse', "tcp:$port", "tcp:$port")
        Write-Host 'Building and opening waweigg. Keep USB connected and Docker running. Press Ctrl+C to end the Flutter session.'
        Invoke-PartnerCommand $flutter @('run', '-d', $phone, "--dart-define=API_BASE_URL=$base")
    } finally { Pop-Location }
} catch {
    Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'See docs/partner-setup.md. Fix the reported prerequisite and run the same command again.'
    exit 1
} finally { Pop-Location }
