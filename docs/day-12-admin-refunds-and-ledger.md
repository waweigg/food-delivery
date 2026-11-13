# Day 12 — Admin, refunds and ledger

Local Day 12 foundation. The admin web app now has searchable order records and details with lifecycle events, a guarded cancellation action, payment/refund records, daily simulator reconciliation, and ledger CSV export. The existing dispatch admin already offers nearby manual driver assignment for unassigned orders. Day 11 still blocks reassignment after an accepted offer or pickup; support must resolve the existing delivery first.

## Refund flow

Only an admin may request a refund. The request requires a support reason and is full amount only. The order service first creates an idempotent refund reservation and checks that the order is captured, not actively assigned/picked up, and has a rejected/expired kitchen ticket or failed delivery. The payment service then queues provider work. A worker retries pending refunds, uses the attempt ID as the stable provider idempotency key, confirms the provider result, and only then marks the order refunded. The payment recovery queue is updated and the customer payment state becomes `REFUNDED`. The database allows one refund per captured attempt, preventing repeated requests from over-refunding.

`local-test` refunds update the simulator's independent provider record. The optional `stripe-test` adapter asks Stripe to refund the test checkout session and waits for a succeeded provider status before finalizing the order. A pending or ambiguous provider response remains visible and is retried; it is not represented as a completed refund.

## Accounting and settlement boundary

The payments service writes append-only double-entry records for captures and refund reversals. Each journal balances across `PROCESSOR_CLEARING` and `CUSTOMER_FUNDS_HELD`. Admin reconciliation compares payments, ledger totals and the local simulator's transaction records by UTC day. The ledger can be exported as CSV.

Settlement allocation is intentionally not configured: commission, merchant funds recipient, driver earnings and payout schedule have not been approved. The admin ledger API therefore reports settlement as not ready; it does not mark restaurant or driver earnings as paid, and no payout is sent or recorded. A real settlement export and external payout confirmation workflow remains outstanding until these rules are decided.

## Admin order controls

Search accepts order ID, customer ID or phone. Details expose the order snapshot and audit timeline to authenticated admins. Cancellation records the actor and reason and is limited to unpaid or fully refunded orders with no open payment, an unassigned/failed delivery and a rejected/expired or absent kitchen ticket. The admin cannot cancel an active delivery or bypass refund rules.

Manual offers use the existing driver service and require driver acceptance. No new direct assignment bypass or post-acceptance reassignment was added.

## Verification status

The local core flow was built and verified on November 14, 2026. The payment acceptance script created a local test order, captured the simulator payment, rejected the kitchen ticket, requested the same full refund twice, verified the customer order became `REFUNDED`, confirmed admin search/detail and the refund audit event, cancelled the refunded order, and checked the balanced ledger plus zero UTC reconciliation differences. No real payment or payout occurred. This was an API integration check; admin browser visuals were not separately inspected.

Additional checks passed: `node --check` on changed JavaScript, application of both changed SQL schemas to isolated PGlite databases, Compose config rendering, and Kubernetes manifest rendering. To repeat the vertical flow from the project root, with the local services up and `.local/demo-credentials.json` present:

```powershell
node scripts/day12-local-acceptance.mjs
```

The local admin portal is http://localhost:8088/admin-ui/.

Day 12 is **not fully complete**. Docker service builds, schema startup migrations and health checks passed, and the local payment/refund acceptance flow passed. However, commission, driver earnings, merchant funds recipient and payout schedule remain unset. Settlement readiness is therefore false, no externally confirmed payout can be recorded, and earnings are not marked paid. Post-acceptance driver reassignment remains blocked by the documented Day 11 safety policy. Settle those product decisions before claiming full finance/settlement acceptance. Run from the project root after the policy is decided:

```powershell
docker compose -f compose.yaml -f compose.services.yaml config --quiet
docker compose -f compose.yaml -f compose.services.yaml build orders payments gateway
docker compose -f compose.yaml -f compose.services.yaml up -d
```

The payment regression/ledger acceptance suite is also available:

```powershell
Get-Content -Raw apps/payments/acceptance.mjs | docker compose -f compose.yaml -f compose.services.yaml exec -T payments node --input-type=module
```
