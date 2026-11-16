# Day 14 local production-readiness rehearsal

Run the commands below from the repository root with Docker Desktop running and the local Compose stack and demo fixtures available. The gateway binding was verified as `127.0.0.1:8088` and the payment provider as `local-test`. Admin access uses the existing server-assigned ADMIN role. The Kubernetes development manifests render and expose the gateway through a private service.

## Deployment and rollback

1. Record the current image IDs, release revision, service health and migration status. Pause new orders before a coordinated recovery rehearsal if data consistency matters. Review backward compatibility for both application versions and verify services and workers using each changed image.
2. Run `node scripts/day14-recovery.mjs`. It creates dated custom PostgreSQL dumps for identity, restaurants, orders, payments and drivers, writes SHA-256 hashes, restores into a disposable PostgreSQL container with no external network, and starts the previous, candidate and previous payment images against the same restored schema. It uses the locally committed HEAD as the previous image source and the working tree as the candidate. Record the exact deployed image digests separately when rehearsing a hosted release.
3. Check the generated `evidence.json` for restored table counts, successful health checks in every phase and unchanged payment counts with balanced journals. Retain backups in protected storage and define retention before scheduling recurring runs. Dumps may contain local credentials, contact details or location data. Keep them out of tickets and source control.
4. Deploy only reviewed migrations. For an application regression, switch to the previous compatible image, restore worker/API version alignment, verify gateway and authenticated flows, and watch queues. Escalate a schema incompatibility to the data owner before making changes. Database restore serves data loss or corruption recovery and requires a separate decision about which writes to preserve.

These are per-database snapshots taken in sequence. For full-stack disaster recovery, plan a coordinated recovery point and include the SeaweedFS menu photo volume and configuration/secrets. The automated local drill restores PostgreSQL and verifies compatibility specifically for the payments image. A recurring backup scheduler, off-host copies and object-store recovery remain to be configured.

## Monitoring and incident response

- Run `node scripts/day14-monitor.mjs --watch` in a terminal for continuous local checks. It polls about once a minute and repeats persistent alerts every 15 minutes until the condition clears. A single run exits 1 when it finds an alert and 2 if alert delivery fails. Alert content contains aggregate counts and fixed check names.
- Run `node scripts/day14-monitor.mjs --test-alert`. Open Mailpit at http://localhost:8025 and search for the printed receipt. The on-duty operator should record receipt, time and name, then practice the response below.
- **Outage or failed worker** — Check which service and probe failed, inspect its health and recent logs, verify database connectivity, and restart or roll back only the affected service after diagnosis. Recheck readiness and confirm the outbox or dispatch queue drains.
- **Stalled kitchen or delivery** — Open the appropriate admin queue. Contact the restaurant or assigned driver and confirm food and handoff status. Keep an existing driver reservation in place while its outcome is uncertain. Use the audited manual dispatch or delivery resolution actions when eligible. Check that the customer-facing timeline reaches the intended state.

## Payment reconciliation and support

- In the admin portal, compare the order, payment attempt, refund status and UTC reconciliation. Check that successful captures and refunds have balanced ledger entries. A pending or ambiguous provider result requires reconciliation before any retry or support promise.
- For the simulator exercise, use a separate rejected paid order for a controlled test refund. Confirm the order moves to refunded and the ledger reversal balances. Record the local order reference and outcome in the operator handoff.
- Have the restaurant operator acknowledge one paid test ticket, confirm the ETA, and mark it preparing then ready. Have the driver accept once, confirm pickup and enter the customer's PIN at delivery. For an unavailable customer, practice reporting the issue and escalating it to support. Keep contact details and PINs out of support notes.
- Operator training and acknowledgment require the assigned people. For the hosted handoff, assign owners for incident response, payment reconciliation, restaurant operations and driver support.

## Evidence and launch gate

- Day 13 verified three complete simulated deliveries. Re-ran `node scripts/day12-local-acceptance.mjs` successfully on Day 14 for a separate simulated capture, rejection, idempotent refund, balanced reversal and UTC reconciliation.
- Local database restore passed for all five service databases. Identity restored 12 tables, restaurants 8, orders 11, payments 9 and drivers 5. Previous → candidate → previous payment health checks passed against the restored schema, retaining 27 payment attempts, 5 refunds and 54 ledger entries with zero unbalanced capture/refund journals. The source snapshot contained zero settlement payouts.
- Mailpit received the test alert and the monitor reported 4 dispatch cases needing attention and 2 delivery cases with a recorded issue in the existing local fixtures. Review these in the admin queues when reusing those orders.
- Temporarily stopped the local order worker. The monitor detected it, Mailpit received alert `2ace1fcd-0130-48bd-a06c-b3cc3f373836`, and the worker was restarted and confirmed running. That monitor pass also reported three existing order payment-recovery cases.
- Evidence is in `.local/day14/48ff3351-c7fd-46f1-9437-70c7eab61b4f/evidence.json`. The test alert receipt is `cb647053-2f43-406e-8bd1-4e6480099d79`.
- Production acceptance remains pending. Before public ordering, confirm hosting and DNS ownership, HTTPS and webhook delivery, provider approval, live secret configuration, service zone, private admin access, backup/alert ownership, and a supervised live purchase/delivery plus a separate authorized refund. Current ordering and payment services are development gated. Keep public ordering closed until these checks pass.
