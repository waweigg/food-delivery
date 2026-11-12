param([Parameter(Mandatory=$true)][string]$SdkRoot)
$ErrorActionPreference = 'Stop'
# Google release: https://github.com/android/ndk/releases/tag/r28c
$version = '28.2.13676358'
$expectedSha1 = '086bba43ff2f5eb0e387b15c8278bb4e0d89ba1d'
$expectedLength = 748118221
$url = 'https://dl.google.com/android/repository/android-ndk-r28c-windows.zip'
$sdk = [IO.Path]::GetFullPath($SdkRoot)
$ndkRoot = Join-Path $sdk 'ndk'
$destination = Join-Path $ndkRoot $version
$properties = Join-Path $destination 'source.properties'
if (Test-Path -LiteralPath $properties) {
    if ((Get-Content -LiteralPath $properties -Raw) -match '(?m)^Pkg\.Revision\s*=\s*28\.2\.13676358\s*$') {
        Write-Host "NDK $version is already installed."
        return
    }
    throw "Unexpected metadata at $properties. No files changed."
}
if (Test-Path -LiteralPath $destination) {
    throw "An incomplete installation exists at $destination. Keep it intact and ask for help before retrying."
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$cache = [IO.Path]::GetFullPath((Join-Path $projectRoot '../../work/ndk-download'))
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$archive = Join-Path $cache 'android-ndk-r28c-windows.zip'
function Test-Archive {
    if (!(Test-Path -LiteralPath $archive)) { return $false }
    if ((Get-Item -LiteralPath $archive).Length -ne $expectedLength) { return $false }
    return (Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash -eq $expectedSha1
}
if (!(Test-Archive)) {
    Write-Host 'Downloading the official Google NDK r28c archive (748 MB)...'
    $curl = Join-Path $env:SystemRoot 'System32/curl.exe'
    if (!(Test-Path -LiteralPath $curl)) { throw 'Windows curl.exe is required to download the NDK.' }
    & $curl --fail --location --retry 3 --connect-timeout 30 --output $archive $url
    if ($LASTEXITCODE -ne 0) { throw "Google NDK download failed with exit code $LASTEXITCODE." }
}
Write-Host 'Verifying the archive against Google release size and SHA-1 checksum...'
if (!(Test-Archive)) { throw 'NDK checksum verification failed. Nothing will be extracted or installed.' }
$tar = Join-Path $env:SystemRoot 'System32/tar.exe'
if (!(Test-Path -LiteralPath $tar)) { throw 'Windows tar.exe is required to extract the NDK.' }
New-Item -ItemType Directory -Path $ndkRoot -Force | Out-Null
$stage = Join-Path $ndkRoot ('.waweigg-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $stage | Out-Null
Write-Host 'Extracting NDK r28c. This may take several minutes...'
& $tar -xf $archive -C $stage
if ($LASTEXITCODE -ne 0) { throw "Extraction failed. Partial files remain at $stage for inspection." }
$source = Join-Path $stage 'android-ndk-r28c'
$sourceProperties = Join-Path $source 'source.properties'
if (!(Test-Path -LiteralPath $sourceProperties)) { throw "Archive layout was unexpected. Files remain at $stage." }
if ((Get-Content -LiteralPath $sourceProperties -Raw) -notmatch '(?m)^Pkg\.Revision\s*=\s*28\.2\.13676358\s*$') {
    throw 'Extracted NDK version does not match the required version.'
}
if (!(Test-Path -LiteralPath (Join-Path $source 'toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe'))) {
    throw 'Extracted NDK is missing its Windows compiler.'
}
# Verify both absolute paths remain inside this SDK's NDK directory before moving.
$boundary = [IO.Path]::GetFullPath($ndkRoot).TrimEnd('\') + '\'
foreach ($candidate in @($source, $destination)) {
    if (![IO.Path]::GetFullPath($candidate).StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installation path is outside the intended NDK directory.'
    }
}
if (Test-Path -LiteralPath $destination) { throw 'Destination appeared during extraction. Existing files were preserved.' }
Move-Item -LiteralPath $source -Destination $destination
# Staging directory is now empty. Do not recursively delete anything.
Remove-Item -LiteralPath $stage
Write-Host "Installed verified NDK $version at $destination."
