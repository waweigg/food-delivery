$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gatewayPort = 8080
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^GATEWAY_PORT=(\d+)$') { $gatewayPort = [int]$Matches[1] }
    }
}
if ($gatewayPort -lt 1 -or $gatewayPort -gt 65535) { throw 'Invalid GATEWAY_PORT in project .env.' }
$backendUrl = "http://localhost:$gatewayPort"
$flutterRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '../../work/flutter'))
$androidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$flutter = Join-Path $flutterRoot 'bin/flutter.bat'
$adb = Join-Path $androidSdk 'platform-tools/adb.exe'
if (!(Test-Path -LiteralPath $flutter)) { throw "Flutter SDK missing: $flutter" }
if (!(Test-Path -LiteralPath $adb)) { throw 'Install the Android SDK using Android Studio first.' }
$env:PATH = (Join-Path $flutterRoot 'bin') + ';' + (Join-Path $androidSdk 'platform-tools') + ';' + $env:PATH
$env:ANDROID_HOME = $androidSdk
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    $previousPreference = $ErrorActionPreference
    $commandExit = 0
    try {
        # Windows PowerShell represents native stderr as error records. Display
        # those records without mistaking a warning for a terminating error.
        $ErrorActionPreference = 'Continue'
        & $Program @Arguments 2>&1 | ForEach-Object { Write-Host $_.ToString() }
        $commandExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($commandExit -eq -1073741515) {
        throw 'Windows could not load a required DLL (0xC0000135). Install or repair Microsoft Visual C++ v14 Redistributable x64 from https://aka.ms/vc14/vc_redist.x64.exe, then retry. This PC was missing the system Visual C++ runtime DLLs.'
    }
    if ($commandExit -ne 0) { throw "$Program exited with code $commandExit. Read the tool output above." }
}
Push-Location $projectRoot
try {
    Invoke-Checked $adb @('start-server')
    function Get-PixelDevice {
        $devices = & $adb devices
        if ($LASTEXITCODE -ne 0) { throw 'Android device connection failed.' }
        foreach ($line in $devices) {
            if ($line -match '^(emulator-\d+)\s+device\s*$') {
                $serial = $Matches[1]
                $avdName = @(& $adb -s $serial emu avd name 2>$null)
                if ($avdName -contains 'Pixel_8') { return $serial }
            }
        }
        return $null
    }
    $deviceId = Get-PixelDevice
    $emulatorProcess = $null
    if (!$deviceId) {
        $emulator = Join-Path $androidSdk 'emulator/emulator.exe'
        if (!(Test-Path -LiteralPath $emulator)) { throw 'Install Android Emulator in Android Studio SDK Manager.' }
        $avds = @(& $emulator -list-avds)
        if ($avds -notcontains 'Pixel_8') { throw 'Create a virtual phone named Pixel_8 in Android Studio Device Manager.' }
        $offline = @(& $adb devices | Where-Object { $_ -match '^emulator-\d+\s+offline\s*$' })
        if ($offline.Count -eq 0) {
            $logFolder = [IO.Path]::GetFullPath((Join-Path $projectRoot '../../work/emulator-logs'))
            New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
            $logId = [Guid]::NewGuid().ToString('N')
            $errorLog = Join-Path $logFolder "$logId.stderr.log"
            Write-Host 'Opening Pixel 8...'
            $emulatorProcess = Start-Process -FilePath $emulator -ArgumentList @('-avd', 'Pixel_8') -WindowStyle Normal -PassThru -RedirectStandardOutput (Join-Path $logFolder "$logId.stdout.log") -RedirectStandardError $errorLog
        }
        Write-Host 'Waiting for Pixel 8 to connect (up to three minutes)...'
        $deadline = (Get-Date).AddMinutes(3)
        while (!$deviceId -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 3
            $deviceId = Get-PixelDevice
            if (!$deviceId -and $emulatorProcess -and $emulatorProcess.HasExited) {
                if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog | Write-Host }
                throw "Pixel 8 exited before connecting. Emulator log: $errorLog"
            }
        }
        if (!$deviceId) { throw 'Pixel 8 did not connect. Check its window for an error. If another emulator is offline, close it and retry.' }
    }
    Write-Host "Connected to Pixel 8 ($deviceId). Waiting for Android to finish starting..."
    $deadline = (Get-Date).AddMinutes(3)
    $booted = $false
    while ((Get-Date) -lt $deadline) {
        $bootState = @(& $adb -s $deviceId shell getprop sys.boot_completed 2>$null)
        if (($bootState -join '').Trim() -eq '1') { $booted = $true; break }
        Start-Sleep -Seconds 3
    }
    if (!$booted) { throw 'Pixel 8 connected but Android has not finished booting. Wait for its home screen and retry.' }
    $health = Invoke-RestMethod "$backendUrl/health/live" -TimeoutSec 10
    if ($health.status -ne 'ok') { throw 'Start the Docker services before running the app.' }
    # Match this Flutter SDK's NDK requirement; a newer installed NDK does not satisfy it.
    $extensionFile = Join-Path $flutterRoot 'packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt'
    $ndkMatch = [regex]::Match((Get-Content -LiteralPath $extensionFile -Raw), 'val ndkVersion: String = "([0-9.]+)"')
    if (!$ndkMatch.Success) { throw 'Cannot determine the NDK version required by Flutter.' }
    $ndkVersion = $ndkMatch.Groups[1].Value
    $ndkProperties = Join-Path $androidSdk "ndk/$ndkVersion/source.properties"
    if (!(Test-Path -LiteralPath $ndkProperties)) {
        if ($ndkVersion -ne '28.2.13676358') { throw "No verified archive installer is configured for NDK $ndkVersion." }
        # The current Android CLI reports 'No url for ndk'; use Google's verified archive.
        & (Join-Path $PSScriptRoot 'install-ndk.ps1') -SdkRoot $androidSdk
    }
    if (!(Test-Path -LiteralPath $ndkProperties)) { throw "NDK $ndkVersion installation did not complete." }
    if ((Get-Content -LiteralPath $ndkProperties -Raw) -notmatch ('(?m)^Pkg\.Revision\s*=\s*' + [regex]::Escape($ndkVersion) + '\s*$')) {
        throw "NDK metadata does not match required version $ndkVersion."
    }
    Write-Host 'Preparing Flutter. The first build downloads dependencies and can take several minutes.'
    Invoke-Checked $flutter @('config', '--android-sdk', $androidSdk)
    Invoke-Checked $flutter @('doctor', '--android-licenses')
    Invoke-Checked 'node' @('scripts/bootstrap-mobile.cjs')
    Set-Location (Join-Path $projectRoot 'apps/mobile')
    Invoke-Checked $flutter @('pub', 'get')
    Invoke-Checked (Join-Path $flutterRoot 'bin/dart.bat') @('run', 'flutter_launcher_icons')
    Invoke-Checked $flutter @('analyze')
    Invoke-Checked $flutter @('test')
    Invoke-Checked $adb @('-s', $deviceId, 'reverse', "tcp:$gatewayPort", "tcp:$gatewayPort")
    Invoke-Checked $flutter @('run', '-d', $deviceId, "--dart-define=API_BASE_URL=$backendUrl")
} finally {
    Pop-Location
}
