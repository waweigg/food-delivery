# Day 10 — Dispatch and assignment

## Implemented contract

Dispatch belongs to the driver microservice, deployed as a separate worker process sharing only its own service database. Orders remain in the independent order service/database. No cross-service database access is used in application code. The worker discovers PAID, PLACED, READY and UNASSIGNED orders through a private, token-authenticated keyset-paginated API. Existing ready development orders may be discovered on first startup.

User-approved local settings: 5 km pickup radius, 45-second offers, at most five offers per automatic round, and five minutes from discovery. Driver compensation is unset and no payouts occur. Configuration: DISPATCH_RADIUS_METRES, DISPATCH_OFFER_SECONDS, DISPATCH_MAX_ATTEMPTS and DISPATCH_LIMIT_SECONDS. Day 9 foreground-only availability and location-freshness rules still apply; physical-device and production pilot gates remain unresolved.

The worker captures pickup coordinates from the restaurant service and ranks eligible approved, online, fresh drivers by straight-line distance. Distance is a proxy for pickup ETA, not a road-route or traffic estimate. Private driver coordinates remain within the driver service. Operations candidates expose distance, name and vehicle, not coordinates. Eligibility and radius are rechecked under the driver lock before an offer is inserted.

Offers and deadlines persist in PostgreSQL. Only one driver is offered a given delivery at a time. Declined, expired, offline or stale offers progress to the next untried eligible driver. Waiting for a newly available driver cannot extend the overall deadline. Hitting the time or attempt limit creates a persisted NEEDS_ATTENTION job shown by the admin operations screen and mirrored in customer order history. The operations screen polls every ten seconds; this is an in-app alert, not an external push/SMS service.

## Race and failure handling

Acceptance takes a per-order advisory transaction lock, then locks the driver and offer. The request checks ownership, the current dispatch round/offer, approval, freshness, offer expiry and overall deadline. Database unique indexes prevent two active offers/claims for one order and two accepted deliveries for one driver. Acceptance atomically saves a RESERVED job; repeated identical acceptance is safe.

The worker confirms the reservation through `/internal/dispatch/:orderId`. The order service locks the order, verifies paid/ready eligibility, enforces unique driver/offer assignment, records DISPATCH_ASSIGNED and changes delivery_state to ASSIGNED in one transaction. The acknowledgement is idempotent. The driver screen distinguishes saved acceptance from confirmed assignment.

If confirmation fails or its response is lost, the accepted reservation stays held and is retried every five seconds. It is never automatically released/reoffered on an ambiguous network failure. Operations sees the confirmation issue. An assigned driver's stale/offline status also raises an operations issue without assigning a replacement. Discovery outages do not stop existing jobs' deadlines and reconciliation. Completion, reservation release, reassignment after pickup and delivery tracking belong to Day 11 and later lifecycle work; do not manually delete a reservation to bypass those controls.

## Operations and customer resolution

Admin → Dispatch operations lists delayed, searching, reserved and assigned jobs. Customer resolution retrieves only the order's contact phone through an authenticated service boundary; ordinary drivers and customers cannot access that admin route. Support should contact the customer and restaurant, explain the delay, and record whether the customer agrees to wait or requests cancellation/refund review. Refund execution is not implemented here and must not be promised as automatic.

Choose driver manually shows currently eligible nearby candidates. Selecting one expires any pending offer, starts an audited new bounded round and sends that driver an offer. The driver must accept. Manual fallback cannot override an existing reserved/confirmed assignment, stale GPS, approval, radius or one-active-delivery constraints. If there are no candidates, support follows the customer-resolution path above. No silent fee, compensation or refund policy is invented.

## Configuration and verification

Compose adds dispatch-worker and a generated local DISPATCH_ORDER_TOKEN shared only by the driver and order services. Kubernetes adds worker/config/network policies; add the same DISPATCH_ORDER_TOKEN to drivers-secrets and orders-secrets, then build/load both images. No cluster deployment is claimed. Database changes are additive tables/indexes and a nullable offer-round column. Back up the service databases before applying outside local development. Rolling back code must leave accepted reservations intact for reconciliation.

Tests: `apps/drivers/dispatch-acceptance.mjs` exercises the real service/worker and an isolated PostgreSQL schema with mocked order/identity/catalog HTTP boundaries. It verifies distance/radius, sequential offers, decline/expiry/disconnection, late acceptance, one winning claim, held reservations across an outage, acknowledgement recovery, no-driver alerting, attempt limits and manual guards. Driver regressions cover concurrent claims across deliveries. Order acceptance tests exercise the real assignment API and database constraints, authentication, unpaid exclusion, concurrent competing drivers, retry and customer-visible state. Native tests cover confirmed assignment presentation and manual driver selection. Pixel 8 runtime evidence is recorded in progress.md after execution.

Hosting, iOS/physical-device operational testing, external push, real merchant payment validation, actual driver payouts and delivery progression remain deferred. The default public checkout remains development/test-only.
