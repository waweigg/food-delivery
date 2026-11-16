# Open an already-installed development APK using the renderer verified on Pixel 8.
$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$devices = @(& $adb devices | Where-Object { $_ -match '^emulator-\d+\s+device\s*$' })
if ($devices.Count -ne 1) { throw 'Open only the Pixel 8 emulator before running this script.' }
$serial = ($devices[0] -split '\s+')[0]
if (@(& $adb -s $serial emu avd name) -notcontains 'Pixel_8') { throw 'The connected emulator must be Pixel_8.' }
$port = 8080
foreach ($line in Get-Content (Join-Path $PSScriptRoot '../.env')) {
    if ($line -match '^GATEWAY_PORT=(\d+)$') { $port = [int]$Matches[1] }
}
& $adb -s $serial reverse "tcp:$port" "tcp:$port"
if ($LASTEXITCODE -ne 0) { throw 'Could not forward the local gateway.' }
& $adb -s $serial shell am force-stop com.example.food_delivery
& $adb -s $serial shell am start -n com.example.food_delivery/.MainActivity --ez enable-software-rendering true --ez enable-impeller false
if ($LASTEXITCODE -ne 0) { throw 'Could not launch the installed app.' }
