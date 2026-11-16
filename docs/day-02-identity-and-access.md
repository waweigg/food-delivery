# Day 2: Identity and access

Implementation is present. Backend acceptance checks pass locally. Mobile runtime and container/cluster execution remain unverified; hosting and production are deferred by the user.

## Implemented behavior

- Better Auth 1.7.15 handles email/password registration, signed bearer sessions, sign-in, logout, and password recovery. Passwords require 12–128 characters. Sessions are stored in PostgreSQL, expire after 24 hours unless renewed, and are checked against current account permissions on every protected request. Cookie caching is disabled.
- Public registration always creates a customer. Client-supplied roles and disabled flags cannot grant permissions. Privileged accounts are provisioned through an operator CLI, not a mobile role selector.
- Restaurant private access requires a membership for the requested restaurant. Driver private access requires both ownership and current approval. The admin list and audit routes require ADMIN.
- Admin disable/enable changes, session revocation and their audit events are committed in one transaction. Admins cannot disable themselves or other admins through the mobile endpoint.
- Password recovery uses a one-hour, single-use token entered in the app. A successful reset invalidates existing sessions. Missing recovery mail configuration returns a generic service-unavailable response before account lookup.
- Login, registration and recovery endpoints have database-backed rate limits. Auth-library origin/CSRF checks remain enabled. Business API routes accept bearer headers only, never ambient cookies.
- Flutter restores the server-issued session from Android encrypted storage or the iOS device Keychain. The server still checks expiry and revocation. Account → Settings includes device, light and dark appearance and signed-in profile and password editing. Profile editing changes the display name. Password changes rotate the current session and revoke other sessions. Android local builds also require SDK Platform 35 for a native dependency.
- All ordering functionality remains disabled.

## Run with Docker locally

1. Copy the root `.env.example` to `.env`. Set a random `BETTER_AUTH_SECRET` of at least 32 characters; keep it out of source control. Set `BETTER_AUTH_URL` to the exact base URL used by the mobile app.
2. Run `docker compose -f compose.yaml -f compose.services.yaml up --build -d` from the project root. This starts PostgreSQL, a migration job, identity service, identity worker, gateway, and Mailpit.
3. Check `http://localhost:8080/health/ready`. Mailpit's local inbox is at `http://localhost:8025`; recovery messages are captured locally and are not delivered to real inboxes.
4. Set mobile `API_BASE_URL` to match `BETTER_AUTH_URL`. For Android Emulator use `http://10.0.2.2:8080`; for iOS Simulator use `http://localhost:8080`. Use HTTPS for release builds. Debug HTTP may need platform-specific network exceptions; none are enabled for release.
5. Register a customer through the app. Follow the controlled provisioning steps below for other roles.

The gateway binds to loopback by default. Real phones need a reachable development HTTPS endpoint or a deliberate local networking setup. The identity service has no published host port; only the gateway is intended for client traffic.

## Run the backend without Docker

Use a reachable PostgreSQL database and the existing README setup. Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SMTP_URL` and `MAIL_FROM` in `apps/api/.env`. For a standalone service keep TRUST_GATEWAY unset. Run `npm ci`, `npm run generate`, `npm run build`, `npm run migrate`, `node --env-file=.env dist/init-database.js`, then `npm start`.

The automated integration test uses a disposable in-memory PGlite PostgreSQL engine over its PostgreSQL wire protocol. It runs actual SQL migrations, Prisma queries, password hashing, sessions, HTTP requests and access checks; it does not mock the database or auth library. Only email delivery is captured by the test. It is not a replacement for staging tests against managed PostgreSQL.

## Controlled role provisioning

The operator must independently confirm the intended person's account/email ownership before provisioning; public registration does not verify email ownership. Register the account, then from apps/api run:

```text
npm run provision -- owner@example.com ADMIN
npm run provision -- restaurant-member@example.com RESTAURANT EXISTING_RESTAURANT_ID
npm run provision -- approved-driver@example.com DRIVER
```

For Docker use `docker compose -f compose.yaml -f compose.services.yaml exec identity npm run provision -- ...`.

Only the first admin can be provisioned by this command. Further admins need a separately reviewed operator process. Restaurant records must already exist; the restaurant onboarding flow is Day 3, and tests create fixtures solely in the disposable test database. The driver command represents an operator's completed approval decision; it does not perform background checks or licensing verification. Provisioning revokes prior sessions and records an audit event. Sign in again afterward. No default admin or passwords are seeded.

## API routes

| Route | Access |
| --- | --- |
| POST /api/auth/sign-up/email | Public, customer only |
| POST /api/auth/sign-in/email | Public, rate limited |
| POST /api/auth/sign-out | Current session |
| POST /api/auth/request-password-reset | Public, generic response, rate limited |
| POST /api/auth/reset-password | Valid one-time token |
| POST /api/auth/change-password | Current session and password |
| GET /me and /dashboard | Current active bearer session |
| POST /me/profile | Current session, own display name only |
| GET /restaurants/:id/private | Matching restaurant member |
| GET /drivers/:id/private | Matching approved driver |
| GET /admin/users and /admin/audit | Admin |
| POST /admin/users/:id/disable | Admin; body: disabled boolean |

Mobile requests send Origin matching BETTER_AUTH_URL and Authorization using the signed `set-auth-token` response header. Do not log or store the token in ordinary preferences.

## Remaining verification

- Flutter analyze/widget tests, Android build/device run, and iOS simulator/device run: blocked by Flutter settings/cache access and unavailable native build environments.
- Docker build/startup and Kubernetes rollout: configuration validated, runtime blocked by Docker engine access; no cluster deployment performed.
- Real external recovery email and hosted verification: explicitly deferred by the user.

References: https://better-auth.com/docs/plugins/bearer ; https://better-auth.com/docs/integrations/express ; https://better-auth.com/docs/concepts/rate-limit ; https://better-auth.com/docs/authentication/email-password
