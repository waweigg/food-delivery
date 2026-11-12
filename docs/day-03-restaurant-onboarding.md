# Day 3 — Restaurant onboarding

Implemented on 2026-11-04 using the requested microservice structure. Backend checks pass; native mobile and container runtime verification remain pending. Hosting and production remain deferred.

## User flow

1. Sign in as a customer or restaurant user and open **My restaurants**.
2. Choose **Register a restaurant**. Enter the business name, pickup address, latitude/longitude, restaurant timezone, opening periods, active state and any temporary closure. Coordinates and timezone must be supplied by the operator; no launch location is assumed.
3. Submit the application. The restaurant service creates the restaurant, the applicant's membership and a submission event atomically. Status starts as PENDING. The applicant's identity role is not changed.
4. An admin opens **Restaurant approvals**, reviews the complete profile and pickup location, enters a reason, and approves or suspends it. Every decision creates an approval-history event.
5. Customers open **Browse restaurants**. Only APPROVED and active restaurants appear. Temporarily closed and outside-hours restaurants remain listed as closed. Ordering stays disabled until its later-day implementation.
6. A member may edit only their own restaurant. Changing the name, address, coordinates or timezone of an approved restaurant returns it to PENDING. A suspended restaurant stays suspended after member edits. Active-state, hours and temporary-closure changes take effect immediately.

## Service ownership

- `apps/restaurants` owns its Prisma schema, migration, PostgreSQL database, profiles, restaurant memberships and approval history.
- `apps/api` remains identity. Restaurant requests send the bearer credential to identity's `/me` endpoint. The restaurant service trusts only that response and checks restaurant membership in its own database. Revoked accounts/sessions fail immediately; an unavailable identity service causes a 503 and no protected operation proceeds.
- No identity database connection or identity database credentials are supplied to the restaurant service.
- Day 2's small identity-side restaurant directory and legacy `/restaurants/:id/private` route are retained for compatibility with prior data/tests. They are not the new catalog or onboarding authority. The mobile app now uses the restaurant service for restaurant management. Existing legacy directory entries do not automatically become approved restaurants; their operators must submit verified profiles through onboarding.
- The applicant is the initial member. Additional-member invitation/management is not implemented in this day's UI; the model supports multiple members without cross-service foreign keys.

## Opening hours

Each period has `day` (Sunday=0 through Saturday=6), `open` (minutes 0–1439) and `close` (minutes 0–1440). An earlier closing minute means the following day. Equal opening and closing minutes are rejected; a full day is 0–1440. No periods means closed. Overlapping periods, including overlaps crossing Saturday/Sunday, are rejected. Multiple non-overlapping periods per day are supported, up to 28 total.

Evaluation uses the restaurant's IANA timezone and local wall-clock time, independent of the server timezone. Opening is inclusive and closing exclusive. Overnight periods continue into the following day. During a repeated daylight-saving hour, both occurrences follow the same local schedule; nonexistent spring-forward times never occur. Temporary closure is stored as an absolute timestamp and expires exactly at its deadline. The mobile date/time picker uses the user's device time and converts it to UTC for storage.

## API contract

| Route | Purpose/access |
| --- | --- |
| GET /catalog/restaurants?offset=0 | Public approved/active catalog, up to 50 records |
| GET /catalog/restaurants/:id | Public approved/active restaurant details |
| POST /restaurant-onboarding | Authenticated customer/restaurant submits profile |
| GET /restaurant-onboarding/mine | Current user's memberships/profiles, up to 50 |
| GET /restaurant-onboarding/:id | Member-only profile and history |
| POST /restaurant-onboarding/:id/profile | Member-only full profile update with version |
| GET /admin/restaurants?offset=0 | Admin review list, up to 50 records |
| GET /admin/restaurants/:id | Admin full profile, members and history |
| POST /admin/restaurants/:id/decision | Admin APPROVED/SUSPENDED decision, reason and version |
| GET /internal/restaurants/:id/order-eligibility | Internal service-token protected current eligibility |
| GET /restaurants-health/live and /ready | Process and service/database readiness |

Creation requires name, address, latitude, longitude, timezone, hours and active. Optional `temporaryClosedUntil` is null or a timestamp with timezone. Updates also require the last-read `version`. Unknown fields, including status or member IDs supplied by clients, are rejected. Stale updates/decisions return 409; refresh before retrying. Profile/decision updates increment version and write an audit event within the same transaction.

Public catalog responses expose only id, name, pickup address/coordinates, timezone, hours, open status, availability reason and orderingEnabled=false. They do not expose membership, actor IDs, approval notes or internal version/history.

The internal eligibility endpoint checks approval, active state, temporary closure and opening hours, and returns the current version. The gateway blocks `/internal/`. Its `x-service-token` is separate from user sessions and must not be put in the mobile app. No order service exists yet: Day 6 must consume/revalidate this contract at order acceptance and address the distributed change-between-check-and-write race. An eligibility response is a current observation, not an order reservation. All ordering remains disabled on Day 3.

## Local Docker setup

In the root `.env`, set both BETTER_AUTH_SECRET and a separate random RESTAURANT_SERVICE_TOKEN (at least 32 characters each), and keep BETTER_AUTH_URL matching the mobile base URL.

```text
docker compose -f compose.yaml -f compose.services.yaml up --build -d
```

The stack now adds `restaurant-database`, `restaurants-migrate`, and `restaurants`. The restaurant database uses its own credentials and persistent volume. Its optional local development connection is port 5433; the identity database remains port 5432. The app reaches both services through gateway port 8080. Check `/health/ready` for identity and `/restaurants-health/ready` for restaurants.

To run outside Docker, copy `apps/restaurants/.env.example` to `.env`, configure RESTAURANT_DATABASE_URL, IDENTITY_URL and RESTAURANT_SERVICE_TOKEN, and run npm ci, npm run generate, npm run build, npm run migrate, `node --env-file=.env dist/init-database.js`, and npm start from apps/restaurants. The restaurant service defaults to port 3001. The identity service must also be running for protected operations.

## Kubernetes

Build/load `food-delivery-restaurants:dev` from apps/restaurants in addition to the identity and gateway images. Create a distinct `restaurants-secrets` Secret in food-delivery-dev with POSTGRES_PASSWORD, RESTAURANT_DATABASE_URL and RESTAURANT_SERVICE_TOKEN. Use user `restaurants`, host `restaurant-database:5432`, database `restaurants_development` and the same PostgreSQL password in the connection URL.

Apply `deploy/k8s`; wait for restaurant-database, `job/restaurants-migrate-day3`, then deployment/restaurants and gateway. Policies allow the restaurant service to call identity, restrict the restaurant database to its service/migration job, and restrict restaurant ingress to the gateway. A future order service will need an explicit network-policy rule for internal eligibility. No cluster changes were made in this session.

## Verification and limits

- Restaurant build, Prisma generation/schema validation: passed.
- Restaurant tests: 14 passed, including five opening-hours/validation cases and two-service integration subtests using separate disposable PostgreSQL-compatible PGlite engines, real SQL migrations, Prisma and Better Auth.
- Identity regression tests: 12 passed.
- Production dependency audit: zero reported restaurant-service vulnerabilities.
- Docker Compose validation and Kubernetes manifest rendering: passed. Docker engine access remains denied, so image builds, startup and gateway routing were not exercised in containers.
- Three new mobile tests provided; Flutter analysis/widget/device tests remain unexecuted because the prior Flutter settings/cache permissions were not granted. Android/iOS host generation and iOS/macOS build requirements remain open prerequisites.
- No real pilot restaurant, confirmed pickup location, production account or external deployment was invented. Backend tests use disposable fixtures only.

Sources used: https://nodejs.org/api/intl.html ; https://kubernetes.io/docs/concepts/services-networking/network-policies/ . Pinned Prisma remains 7.10.1; existing Prisma 7 APIs are retained.
