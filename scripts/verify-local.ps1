$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Run-Step([string]$Name,[scriptblock]$Action){Write-Host $Name; & $Action; if($LASTEXITCODE -ne 0){throw "$Name failed ($LASTEXITCODE)"}}
Run-Step 'Identity' {npm --prefix apps/api test}
Run-Step 'Restaurants' {npm --prefix apps/restaurants test}
Run-Step 'Settlement accounting' {node scripts/day12-settlements-test.mjs}
Run-Step 'Compose configuration' {docker compose -f compose.yaml -f compose.services.yaml config --quiet}
Run-Step 'Orders including worker restart' {docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/orders/acceptance.mjs:/app/acceptance.mjs:ro" orders node acceptance.mjs}
Run-Step 'Drivers' {docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/drivers/acceptance.mjs:/app/acceptance.mjs:ro" drivers node acceptance.mjs}
Run-Step 'Dispatch' {docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/drivers/dispatch-acceptance.mjs:/app/dispatch-acceptance.mjs:ro" drivers node dispatch-acceptance.mjs}
Run-Step 'Payment replay and recovery' {Get-Content -Raw apps/payments/acceptance.mjs | docker compose -f compose.yaml -f compose.services.yaml exec -T payments node --input-type=module}
Run-Step 'Local admin refund flow' {node scripts/day12-local-acceptance.mjs}
Run-Step 'Limited catalog load' {node scripts/day13-local-load.mjs}
Push-Location apps/mobile
try {Run-Step 'Flutter analysis' {flutter --no-version-check analyze};Run-Step 'Flutter widgets' {flutter --no-version-check test}} finally {Pop-Location}
