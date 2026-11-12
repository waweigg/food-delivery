# Day 11 — Pickup, delivery and tracking

The order microservice owns ASSIGNED → PICKED_UP → DELIVERED, PIN verification, timeline and support resolution. The driver microservice owns the reservation, driver location and its reconciled lifecycle. They exchange authenticated HTTP requests; neither accesses the other's database. The user's microservice requirement supersedes the original plan's monolith instruction.

## Customer and driver

Only the assigned, approved driver can open delivery details, confirm actual pickup from a READY restaurant, report an issue or submit the customer's six-digit PIN. The driver receives the address/contact only for the active assignment; no PIN or PIN derivation material is returned. The customer opens My test orders → paid order to view the timeline, PIN and last observed driver coordinates. Share the PIN only at handover.

PINs derive from a cryptographically random per-order nonce using HMAC-SHA256 and a separate stable DELIVERY_PIN_KEY secret. No raw PIN is stored or logged. Preserve this secret until active orders finish. Five wrong attempts lock confirmation for 15 minutes. Failed attempts persist transactionally; concurrent attempts cannot bypass the limit. Repeated successful actions do not duplicate lifecycle events. Admin exceptions require a documented verification reason and record the administrator identity.

The customer endpoint verifies ownership before requesting location. Only ASSIGNED/PICKED_UP orders permit tracking; completed/failed orders return no PIN, coordinates or driver contact. The driver service returns only its assigned driver's last location. Foreground updates/freshness/retention retain Day 9 policy: update every 15 seconds, stale after 60 seconds, delete coordinates after 15 minutes. The screen labels stale/unavailable results, including failed refreshes, and supports manual refresh. This is coordinate-based tracking, not a street map, navigation or ETA service.

## Failure and support procedure (local development)

- Post-pickup customer cancellation is not self-service. Driver reports CANCELLATION_REQUESTED; support contacts customer and restaurant before deciding the outcome.
- For unreachable customers or failed handover, report CUSTOMER_UNREACHABLE or DELIVERY_FAILED. The assignment stays held; do not silently mark delivered or assign another driver.
- Admin web → Deliveries lists active orders, issues and PIN locks. Contact through Dispatch → Customer resolution and the restaurant. Record the verification/reason. Confirm verified delivery only after pickup and verified handover, or close as FAILED. The latter creates payment REVIEW_REQUIRED, not an automatic refund or payout.
- Reassignment after acceptance/pickup is deliberately blocked. A failed delivery must be resolved first; a replacement is a separately reviewed new order. No automatic replacement charge is made.
- Lost responses retain the driver's reservation. The dispatch worker reconciles the order's authoritative state. Only confirmed DELIVERED/FAILED releases the offer and the order's unique active-driver claim. Finished jobs are no longer polled.

## Deployment and rollback

Compose supplies a generated local DELIVERY_PIN_KEY, DRIVER_SERVICE_TOKEN and DRIVERS_URL to orders. Kubernetes uses orders-secrets for both secrets and orders-config for the URL; the same DRIVER_SERVICE_TOKEN must match drivers-secrets. An ingress policy permits orders → drivers:3004. Internal routes stay blocked by the gateway. CI includes the PostgreSQL order and driver acceptance suites.

Schema changes preserve historical orders/assignments: delivery_confirmations, active assignment flag, expanded state constraints and partial uniqueness. Applied automatically by service startup in this local environment. Back up production data and use controlled migration rollout before a real deployment. Old code cannot handle PICKED_UP/FAILED safely: do not roll back state constraints or clear held reservations. Repair forward and reconcile.

Hosting, real-money payments, physical-phone/iOS verification, street maps/background tracking, production support staffing, refund and food-disposal policy remain deferred. The local admin procedure is not a production operational approval.

## Reproducible verification

From the repository root, after configuring .env and starting Docker:

```powershell
docker compose -f compose.yaml -f compose.services.yaml build orders drivers gateway
docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/orders/acceptance.mjs:/app/acceptance.mjs:ro" orders node acceptance.mjs
docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/drivers/dispatch-acceptance.mjs:/app/dispatch-acceptance.mjs:ro" drivers node dispatch-acceptance.mjs
docker compose -f compose.yaml -f compose.services.yaml run --rm --no-deps -v "${PWD}/apps/drivers/acceptance.mjs:/app/acceptance.mjs:ro" drivers node acceptance.mjs
```

Suites create and remove isolated PostgreSQL schemas, not production/demo orders. Order tests cover ownership, pickup sequencing, wrong PIN persistence/lockout, concurrent completion, terminal privacy, repeated admin exceptions and driver assignment release. Driver tests cover forged identity, held reservations on RPC failure and reconciliation after a lost completion response, alongside Day 9/10 regressions. Mobile tests exercise confirmation, incorrect PIN correction, completion and stale tracking. Run flutter analyze and flutter test in apps/mobile; scripts/build-pixel-apk.ps1 builds the local emulator APK.
