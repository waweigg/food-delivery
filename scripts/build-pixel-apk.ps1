# Build the existing Android project when Gradle cannot verify workspace write access.
param([switch]$Online, [switch]$PhysicalAndroid)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $root 'apps/mobile'
$flutterRoot = (Resolve-Path (Join-Path $root '../../work/flutter')).Path
$stage = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP ('waweigg-' + [guid]::NewGuid().ToString('N').Substring(0,8)))).FullName
$env:FLUTTER_SUPPRESS_ANALYTICS = 'true'
if (!$env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr' }
$port = 8080
foreach ($line in Get-Content (Join-Path $root '.env')) {
    if ($line -match '^GATEWAY_PORT=(\d+)$') { $port = [int]$Matches[1] }
}
function Copy-Source($source, $destination) {
    & robocopy $source $destination /E /XD build .gradle .kotlin (Join-Path $source 'example') ios /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Failed to stage $source" }
}
$app = Join-Path $stage 'mobile'
Copy-Source $mobile $app
$plugin = Join-Path $stage 'flutter-gradle'
Copy-Source (Join-Path $flutterRoot 'packages/flutter_tools/gradle') $plugin
$settings = Join-Path $app 'android/settings.gradle.kts'
(Get-Content $settings -Raw).Replace('$flutterSdkPath/packages/flutter_tools/gradle', $plugin.Replace('\','/')) | Set-Content $settings
$metadata = Join-Path $app '.flutter-plugins-dependencies'
$plugins = Get-Content $metadata -Raw | ConvertFrom-Json
foreach ($entry in $plugins.plugins.android) {
    $destination = Join-Path $stage $entry.name
    Copy-Source $entry.path $destination
    $entry.path = $destination
}
$plugins | ConvertTo-Json -Depth 20 -Compress | Set-Content $metadata
# Keep generated Android paths short and compile Dart from the actual checkout.
$buildScript = Join-Path $app 'android/build.gradle.kts'
$outputRoot = (Join-Path $mobile 'build/pixel-gradle').Replace('\','/')
(Get-Content $buildScript -Raw).Replace('.dir("../../build")', ".dir(`"$outputRoot`")") | Set-Content $buildScript
$appScript = Join-Path $app 'android/app/build.gradle.kts'
(Get-Content $appScript -Raw).Replace('source = "../.."', ('source = "' + $mobile.Replace('\','/') + '"')) | Set-Content $appScript
# AGP checks the parent folder of its default keystore even when the key exists.
# Use the same development signing identity at an explicit temporary path.
$key = Join-Path $stage 'pixel-debug.keystore'
Copy-Item (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android/debug.keystore') $key
Add-Content $appScript ('android.signingConfigs.getByName("debug").storeFile = file("' + $key.Replace('\','/') + '")')
Push-Location $app
try {
    $apiDefine = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("API_BASE_URL=http://localhost:$port"))
    $sdk = $env:ANDROID_HOME
    if (!$sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    $ndks = (Get-ChildItem (Join-Path $sdk 'ndk') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'source.properties') }).Name -join ','
    $gradleMode = if (!$Online) { @('--offline') } else { @() }
    $target = if ($PhysicalAndroid) { 'android-arm,android-arm64' } else { 'android-x64' }
    & ./android/gradlew.bat -p android @gradleMode --no-problems-report :app:assembleDebug "-Ptarget-platform=$target" "-Pflutter.androidSdkRoot=$sdk" "-Pflutter.installedNdkVersions=$ndks" "-Pdart-defines=$apiDefine"
    if ($LASTEXITCODE -ne 0) { throw "Android build failed in $app" }
    $output = Join-Path $mobile 'build/app/outputs/flutter-apk'
    New-Item -ItemType Directory -Force $output | Out-Null
    $name = if ($PhysicalAndroid) { 'waweigg-android-usb.apk' } else { 'app-debug.apk' }
    $apk = Join-Path $output $name
    Copy-Item "$outputRoot/app/outputs/flutter-apk/app-debug.apk" $apk -Force
    (Get-FileHash -LiteralPath $apk -Algorithm SHA1).Hash.ToLowerInvariant() | Set-Content "$apk.sha1" -NoNewline
} finally {
    Pop-Location
    Remove-Item -LiteralPath $key -Force
}
