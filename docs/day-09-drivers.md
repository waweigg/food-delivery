# Day 9 — Driver onboarding and location

## Scope and architecture

`apps/drivers` is an independent Node/PostgreSQL microservice on port 3004. It owns driver applications, approval/version checks, availability, the latest location, foreground notification registrations, offers and audit records. Identity remains authoritative for authentication and disabled accounts. A CUSTOMER or DRIVER identity can apply; approval in this service is required regardless of legacy identity driver flags. There is no public role promotion.

Docker Compose adds drivers, drivers-db and a private persistent volume. Gateway exposes `/driver`, `/driver-admin` and `/drivers-health`; `/internal/` remains blocked. Schema creation is additive and idempotent on startup. It changes only the driver database. Development Kubernetes manifests include a separate database, service, secret references and ingress network policies. No hosted or Kubernetes deployment is claimed.

## Native flow

Account → Driver centre → enter name and vehicle → Submit driver application. Admin → Driver approvals → approve, reject or suspend with optimistic version checking. Review clears availability and coordinates and expires pending offers. The approved driver opens Driver centre and chooses Go online, reads the location explanation, and grants while-in-use permission. Go offline ends availability. App backgrounding, locking or leaving the screen also attempts offline immediately. If the network is lost, the server lease fails closed after the freshness cutoff; reconnect requires an explicit Go online.

The proposed local pilot defaults are foreground-only, a 60-second freshness cutoff and 900-second precise-location retention. The user requested an explanation; production policy is not approved. Location is refreshed approximately every 15 seconds while online. The server accepts at most one update per five seconds, rejects fixes older than the cutoff, more than five seconds in the future, out-of-order fixes, invalid coordinates and accuracy worse than 100 metres. Receipt time and device observation time are separate. Only one latest fix is stored, with cleanup every ten seconds; deletion may take up to one cleanup interval after expiry. No location history or location logging is created. Persistent-volume backups, if later enabled, need a separate retention policy.

The native implementation uses geolocator with Android coarse/fine and iOS when-in-use permissions, following [the package's platform instructions](https://pub.dev/packages/geolocator). It requests no background location permission. For iOS Swift Package Manager builds set `BYPASS_PERMISSION_LOCATION_ALWAYS=1`; macOS CI does this. iOS device behavior remains unverified on this Windows machine.

## APIs and dispatch boundary

- GET `/driver/me`; POST `/driver/apply` with name and vehicle.
- GET `/driver-admin`; POST `/driver-admin/:userId/review` with status and version, ADMIN only. Neither admin listing nor public customers receive coordinates.
- POST `/driver/location` with latitude, longitude, accuracy and observedAt; owner derives exclusively from the session. Extra fields, including another driver's ID, are rejected.
- POST `/driver/notifications` with channel `foreground-poll`. This is durable registration for in-app polling, not FCM/APNs push.
- POST `/driver/availability` with online boolean; online requires approval, fresh location and notification registration.
- GET `/driver/offers`; POST `/driver/offers/:id/accept` or `/decline`. Ineligible drivers cannot see pending offers or accept them. Accepted reservations are visible to their approved owner.
- Service-only GET `/internal/drivers/eligible` returns eligible IDs, not coordinates. POST `/internal/drivers/offers` takes id, orderId, driverId and pickup, protected with DRIVER_SERVICE_TOKEN. Offers expire after 45 seconds. Row locks and partial unique indexes enforce one accepted delivery per driver and one pending/accepted offer per order. Same-result retries are idempotent. Accepting one offer expires the driver's other pending offers.

Automatic dispatch, order validation by the dispatcher, customer tracking, reservation completion/cancellation and reconciliation with the orders service belong to Day 10. The driver service does not mark real orders assigned or delivered. No customer location API is exposed; later tracking must be restricted to the customer owning that active delivery. External push credentials and delivery are deferred; this pilot relies on the open screen polling the persisted inbox.

## Verification and launch gate

Backend acceptance command: pipe `apps/drivers/acceptance.mjs` to `docker compose -f compose.yaml -f compose.services.yaml run --rm -T --no-deps drivers node --input-type=module`. It uses an isolated disposable schema and mocked identity HTTP boundary, exercising the real driver service and PostgreSQL. It covers approval/version, disabled identity, ownership, timestamp/accuracy/rate rejection, notification registration, offline/stale exclusion, private inbox, competing acceptance, idempotent retry, suspension and location deletion. Native widget tests cover approval gating and versioned admin review. CI includes these checks.

Pixel 8 operational checks passed on November 10, 2026: application, approval refresh, GPS online, background/offline, lock-screen/offline, explicit reconnect after network interruption, incoming simulated offer/decline and manual offline. The updated APK was installed and the approved driver's screen left open offline. Android uses GPS LocationManager to avoid the extra Google Location Accuracy consent prompt; the test resumes with the normal Android launcher intent. Emulator coordinates and the incoming offer are synthetic. Physical Android and iPhone pilots, battery/OS-specific behavior and a supervised foreground-only operating procedure must be validated before real driver launch. Background delivery availability is intentionally unsupported, not a passed production capability. Hosting remains deferred at the user's request.
