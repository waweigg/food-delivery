$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../setup-partner.ps1')
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('waweigg-setup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
function Assert([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Assert-Fails([scriptblock]$Action, [string]$Expected) {
    $caught = $null
    try { & $Action } catch { $caught = $_.Exception.Message }
    Assert ($caught -and $caught -like "*$Expected*") "Expected failure containing: $Expected"
}
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../.env.example') -Destination (Join-Path $tempRoot '.env.example')
    Initialize-PartnerEnv $tempRoot
    $path = Join-Path $tempRoot '.env'
    $first = [IO.File]::ReadAllText($path)
    $values = Read-PartnerEnv $path
    Assert ((Get-PartnerPort $values) -eq 8088) 'New setups must use port 8088'
    Assert ($values.BETTER_AUTH_URL -eq 'http://localhost:8088') 'Auth URL must match USB forwarding'
    Assert ($values.PAYMENT_PROVIDER -eq 'local-test') 'Payments must be simulated'
    $keys = @('BETTER_AUTH_SECRET', 'RESTAURANT_SERVICE_TOKEN', 'MENU_S3_ACCESS_KEY', 'MENU_S3_SECRET_KEY',
        'PAYMENTS_ORDER_TOKEN', 'PAYMENTS_WEBHOOK_SECRET', 'DRIVER_SERVICE_TOKEN', 'DISPATCH_ORDER_TOKEN', 'DELIVERY_PIN_KEY')
    foreach ($key in $keys) { Assert ($values[$key] -match '^[a-f0-9]{64}$') "Missing random secret: $key" }
    $unique = @($keys | ForEach-Object { $values[$_] } | Select-Object -Unique)
    Assert ($unique.Count -eq $keys.Count) 'Secrets must be independent'
    Initialize-PartnerEnv $tempRoot
    Assert ([IO.File]::ReadAllText($path) -ceq $first) 'Repeat setup must preserve the existing env byte-for-byte'
    [IO.File]::WriteAllText($path, "# existing custom config`nGATEWAY_PORT='8099'`nBETTER_AUTH_URL=http://localhost:8099`n")
    $custom = [IO.File]::ReadAllText($path)
    Initialize-PartnerEnv $tempRoot
    Assert ([IO.File]::ReadAllText($path) -ceq $custom) 'Even incomplete existing configuration must be preserved'
    Assert ((Get-PartnerPort (Read-PartnerEnv $path)) -eq 8099) 'Quoted custom port must be read'
    Assert ((Get-PartnerPort @{}) -eq 8080) 'Existing env without port uses Compose default'
    foreach ($bad in @('0', '65536', 'abc', '')) { Assert-Fails { Get-PartnerPort @{GATEWAY_PORT = $bad} } 'GATEWAY_PORT' }

    $listing = @('List of devices attached', 'emulator-5554 device', 'phone-a device product:test', 'other unauthorized')
    Assert ((Select-PartnerDevice $listing) -eq 'phone-a') 'Must select only authorized physical phone'
    Assert ((Select-PartnerDevice ($listing + 'phone-b device') 'phone-b') -eq 'phone-b') 'DeviceId must choose the requested phone'
    Assert-Fails { Select-PartnerDevice @('emulator-5554 device', 'phone unauthorized') } 'No authorized Android phone'
    Assert-Fails { Select-PartnerDevice @('phone offline') } 'No authorized Android phone'
    Assert-Fails { Select-PartnerDevice ($listing + 'phone-b device') } 'Multiple Android phones'
    Assert-Fails { Select-PartnerDevice $listing 'emulator-5554' } 'not authorized'
    Assert-Fails { Select-PartnerDevice $listing 'unknown' } 'not authorized'

    Invoke-PartnerCommand $env:ComSpec @('/c', 'exit', '0')
    Assert-Fails { Invoke-PartnerCommand $env:ComSpec @('/c', 'exit', '7') } 'exit 7'
    # A non-loopback seeder target must fail before creating credentials or contacting a host.
    $previousBase = $env:DEMO_BASE_URL
    try {
        $env:DEMO_BASE_URL = 'https://example.invalid'
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = (& node (Join-Path $PSScriptRoot '../seed-malappuram-demo.mjs') 2>&1) -join "`n"
        $code = $LASTEXITCODE
        $ErrorActionPreference = $oldPreference
        Assert ($code -ne 0 -and $output -like '*loopback HTTP gateway*') 'Seeder must refuse remote targets'
    } finally { $env:DEMO_BASE_URL = $previousBase }
    Write-Host 'All partner setup checks passed.'
} finally {
    # Delete only the uniquely created temp folder after verifying its boundary.
    $resolved = [IO.Path]::GetFullPath($tempRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'waweigg-setup-test-*') {
        throw 'Refusing to clean an unexpected test path.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
