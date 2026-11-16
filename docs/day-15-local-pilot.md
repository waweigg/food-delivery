# Day 15 local pilot rehearsal

**Go for the local simulator rehearsal. No-go for public launch.** Day 13 verified checkout through delivery and Day 14 verified local alerting, PostgreSQL restores and payment rollback. The hosted launch still requires merchant and webhook approval, private HTTPS deployment, backup and alert ownership, operator sign-off, and supervised live payment, delivery and refund evidence. The local gateway remains bound to loopback.

## Operate the pilot

1. Start the usual local microservices and open the admin portal at http://localhost:8088/admin-ui/. Sign in as the demo admin and open **Pilot**.
2. Pause new orders before configuring the window. Enter the approved restaurant IDs, staffed start and end as UTC timestamps, and the maximum number of new orders for that window. Review the restaurant IDs against the **Restaurants** page. The orders service re-quotes each checkout through the restaurants service, which checks restaurant availability, the delivery address and service coverage.
3. Confirm a restaurant operator, approved driver and support operator are available. Start the Day 14 monitor with `node scripts/day14-monitor.mjs --watch`, then select **Resume new orders**. Intake closes at the end of the window or when the cap is reached. Cancelled orders count toward the cap.
4. Use **Pilot** to track each admitted order. Use **Dispatch**, **Deliveries**, **Orders**, **Payments**, and **Settlements** for exceptions and reconciliation. If assignment, payment or data integrity becomes unreliable, **Pause new orders**, enter the reason, and continue supporting admitted orders. After an admitted window ends, configure a new window to reopen intake.
5. Reconcile the UTC day in **Payments**, then compare each finalized test allocation with its capture and its restaurant/driver payout records in **Settlements**. Record timing, support incidents, outstanding work and operator names in the handoff. Follow the Day 14 recovery runbook if balances differ or queues stall.

Orders owns the persistent control, admissions and audit history. The cap and pause share the same database lock as final admission, and checkout retries return the existing order. Payment, restaurant and driver services retain ownership of their own state. Three additive tables are created on orders startup. Development checkouts continue as before until an operator configures a pilot or pauses intake.

## Rehearsal evidence

Run `node scripts/day13-delivery-load.mjs --pilot` from the repository root. It requires the local simulator and demo credentials, uses the separate test driver, and pauses checkout on completion. It creates a five-minute staffed window for Malabar Biriyani House with a two-order cap. Wait for any earlier admitted window to end before rerunning.

- Two of three concurrent checkouts were admitted. The third hit the cap. Pausing rejected new orders while retries for the two existing orders succeeded.
- One order completed payment, kitchen preparation, driver assignment and PIN-confirmed delivery while paused. A reported customer-unreachable issue was cleared on verified handoff. Ready-to-offer took 12.1 seconds and acceptance-to-assignment took 1.2 seconds for that order.
- A second paid order was rejected by the restaurant and refunded. Repeating the refund request reused the original refund. The UTC-day totals, including earlier fixtures, matched provider and ledger records at INR 1,260 captured and INR 420 refunded, with zero differences.
- One settlement allocation matched its capture, and the restaurant and driver simulated payout records matched their respective shares. Payout retries reused their references. The payment ledger and settlement journals balanced. The test allocation does not establish an earnings policy.
- Isolated PostgreSQL acceptance passed for admin authorization, window and restaurant restrictions, concurrent cap, stale-version rejection, pause, retry and existing-order actions. The served admin bundle contains the Pilot page, the gateway rejects anonymous pilot access, and the Kubernetes manifests render.

The sanitized report is in `.local/day15-pilot-results.json`. The two pilot orders and audit history remain available for inspection. Checkout is paused. Reliability follow-up before expanding the pilot is to resolve the earlier dispatch and payment-recovery cases recorded by Day 14 monitoring and repeat the drill with named operators.
