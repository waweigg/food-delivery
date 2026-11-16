# Day 13 local system verification — November 14, 2026

Scope: existing independent identity, restaurant, order, payment and driver services, PostgreSQL, Docker gateway and Flutter client. No hosted staging or live payments were used.

## Recorded results

- Identity build and 12 tests passed: roles, tenant ownership, session revocation, password recovery, origin checks and rate limits.
- Restaurants build and 22 tests passed: onboarding, catalog coverage, hours, menu ownership, prices and private photo access.
- Orders PostgreSQL acceptance passed: concurrent checkout, immutable prices, kitchen transitions/rejection, dispatch races, pickup, PIN lockout, completion and terminal privacy.
- Added explicit order-worker restart coverage: stop the worker, create persisted pending work, restart, assert all pending work drains and each event produces one activity. Passed.
- Driver and dispatch PostgreSQL suites passed: availability, retention, ownership, races, unavailable drivers, expiry, bounded attempts, ambiguous RPC recovery and terminal release.
- Payment regression passed: concurrent initiation, decline/abandon/retry, forged/repeated webhooks, delayed capture and lost notification recovery.
- Real local gateway admin flow passed: simulator capture, restaurant rejection, idempotent refund, order search/audit/cancellation, balanced ledger and reconciliation.
- Settlement SQL-backed checks passed: allocation conservation, repeated/conflicting requests, unique test payout, balanced journals and immutable history. These use a stub order response, not a full deployed settlement journey.
- Flutter analysis passed; 22 widget tests passed. A second test invocation also passed while the first analysis invocation was completing.
- Catalog smoke load: 50 requests, concurrency 5, zero failures, p50 17 ms, p95 86 ms, max 115 ms. This is a small local sample, not a pilot-capacity guarantee.
- Inspected business-service logging statements: generic recovery messages, no explicit payment token/PIN/coordinate logging in those statements. This is not an exhaustive dependency or runtime log audit.

## Fixes and test conditions

Host sandbox initially blocked local sockets and Flutter telemetry/cache access; rerunning with local access passed. Docker dependencies were initially stopped and were started. Refreshed restaurants/payments/gateway images to match source. The new load harness incorrectly required HTTP 200; the POST coverage endpoint returns valid 201. Corrected the harness to require successful HTTP plus the expected response shape; the rerun passed.

## Repeat

Start Docker Compose and seed the documented local demo fixtures first. Run `powershell -File scripts/verify-local.ps1` from the project root with Flutter on PATH. Each failure stops the runner. Individual suites were executed this session; the wrapper itself was not rerun. The admin test requires ignored `.local/demo-credentials.json`; it creates simulated orders/refunds and keeps their audit history. SQL service suites use temporary schemas. Allow the 60-second sign-in throttle to reset between repeated demo runs.

## Remaining Day 13 acceptance

The requested local delivery, limited checkout/dispatch load, and Pixel 8 visual/basic accessibility checks are complete. Physical iOS/Android, hosted staging, production capacity and a complete TalkBack audit are outside this local verification.

## Follow-up results — November 15, 2026

- Added `scripts/day13-delivery-load.mjs`: three concurrent checkouts through the real gateway, simulator payment, kitchen accept/prepare/ready, automatic dispatch, driver acceptance, pickup and customer-PIN delivery. All three completed. Repeated checkout and delivery requests were idempotent; terminal PIN/tracking disappeared and driver reservations released.
- Found and fixed dispatch issuing competing pending offers to the same driver. Candidate selection and the locked eligibility recheck now reserve a driver for one unexpired pending offer or accepted delivery. PostgreSQL dispatch regression tests passed, including three queued orders completed by one driver.
- Checkout p50 **101 ms**, p95/max **113 ms**. Ready-to-offer p50 **7,023 ms**, p95/max **13,601 ms**, including waiting behind earlier deliveries. Acceptance-to-assignment p50 **1,199 ms**, p95/max **4,063 ms**. These are only three samples, not a production capacity benchmark.
- The harness uses a separate development driver because the interactive demo driver already had an active delivery. It goes offline afterward. Test audit history remains, including two unresolved orders from the initial failing run; those need local admin attention if reused.
- Flutter analysis and **24 tests** passed. Added menu/basket/review checks at Pixel dimensions and 100%/200% text scale: no layout exceptions, labelled controls, Android tap-target sizes and text contrast.
- Fixed orange UI text contrast (previous Add button ratio 4.26, below the 4.5 test threshold) by darkening the UI accent; original logo unchanged. Updated obsolete menu copy to explain simulated payment.
- Android debug build succeeded and APK installation reported Success. Initially Android System UI stalled and the renderer produced a black capture. Dismissed the System UI error and launched Flutter with software rendering/Impeller disabled; actual app screenshots and accessibility trees then worked.
- Pixel 8 device review: location selection, sample Malappuram restaurant list, menu, add dish, basket quantity labels, missing-contact validation, demo address and live quote checked. Review showed INR 180 food + INR 30 delivery + INR 0 other charges = INR 210, with sign-in required to place an order. Inspected screenshots for readable text, margins and overlap. Android 200% text screenshots showed wrapping; the basket review action remained accessible. Restored font scale to 1.0. This is basic semantics/layout inspection, not spoken TalkBack traversal.
- Local screenshot evidence: `.local/day13-restaurants.png`, `day13-menu.png`, `day13-basket.png`, `day13-review.png`, `day13-review-large.png`; hierarchy evidence is also under `.local`. These files contain only fictional demo content and remain untracked.
- For this emulator's rendering issue, run `powershell -File scripts/open-pixel-review.ps1` after opening Pixel 8. It opens the installed app with the verified development renderer and forwards the configured local gateway. No production rendering setting was changed.

Repeat the delivery test separately with `node scripts/day13-delivery-load.mjs` from the repository root, at least 60 seconds after other demo sign-in tests. It requires Docker, local fixtures and the running Compose services; it never uses real payment credentials. Sanitized results are written to `.local/day13-delivery-results.json`.
