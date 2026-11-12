# Decisions

- Day 11 continues the user-requested microservices and local simulated-payment scope. Orders owns pickup/PIN delivery state; drivers owns reservations and reconciled release. Conservative development handling holds failed/unreachable/cancellation cases for audited admin resolution, without automatic refunds or reassignment. Customer tracking exposes only the assigned driver's last coordinates during active delivery, with stale status; street maps and production support policy remain deferred.

- The user confirmed the exact brand spelling **waweigg**, sample Malappuram restaurants with test prices, a web admin workspace, and native mobile experiences for customer, restaurant and delivery roles. Four local demo accounts are explicitly authorized. No real restaurant onboarding or production admin exposure is implied.

- Day 10 local dispatch policy approved by the user: 5 km pickup radius, 45-second offers, up to five drivers per automatic round, five-minute overall limit. Driver compensation remains unset; no payouts. Dispatch and reservations are owned by the driver service, with authenticated idempotent assignment confirmation in orders. Distance is a pickup-ETA proxy, not routing.

- User confirmed installed Android and iOS applications; this overrides the original plan's responsive-web scope.
- Flutter/Dart mobile foundation. Local SDK checkout: Flutter stable 3.47.9. Dependency resolution/native generation blocked by access to Dart settings directories.
- NestJS 12.3.2; Prisma and PostgreSQL adapter 7.10.1; PostgreSQL 17. npm exact resolved versions are in package-lock.json. Node 24 is the deployment target; local build uses installed Node 26.7.0.
- Superseded on Day 2 at the user's request: use microservices with Docker and Kubernetes. The implemented first service is identity (retaining apps/api path), behind an independent API gateway. Identity owns its PostgreSQL database. Future business services remain later-day work; see architecture.md.
- Public ordering stays disabled. Sign-in and access controls are implemented on Day 2; payments, orders and delivery workflows remain later-day work.
- UI branding uses the user's supplied logo. The com.example mobile identifiers are placeholders.
- Menu currency: INR, explicitly confirmed by the user on 2026-11-04. Store prices as integer paise and display two decimals. Existing prices must not be relabeled if currency configuration changes.
- Pending user decisions: country, city, timezone, service zone, taxes, fees, commission, refunds, funds recipient, payment provider, host/budget/region/domain, pilot hours and support owner.
- Day 2 uses one Flutter application with server-assigned role dashboards. Separate branded application packaging remains deferred.
- Better Auth 1.7.15 provides authentication, sessions and recovery; SMTP is configurable, and Mailpit captures local development recovery messages. No external sender account is assumed.
- User explicitly deferred hosting and production and confirmed the current scope is finishing Day 2 with a Docker/Kubernetes foundation, not implementing all remaining days.
- On 2026-11-04 the user requested continuing Day 3 in that microservice structure. Added a separate restaurant service/database; identity is checked over HTTP using the user's bearer session, with local membership authorization in restaurants.
- Customer/restaurant identities can apply and become the restaurant's initial member without identity-role escalation. Only admins approve or suspend. Existing Day 2 restaurant directory entries are legacy data and do not imply Day 3 approval.
- Approved restaurants are sent back to review when their name, address, coordinates or timezone changes. Hours/active/temporary-closure edits are immediate. Suspended restaurants cannot self-reactivate by editing.
- Opening hours use IANA timezone wall-clock time, inclusive opening and exclusive closing, with explicit overnight and full-day intervals. Every profile/review mutation is version-checked and audited atomically.
- Mobile scope requires device testing, Apple/Google signing and distribution setup; the original 15-day timeline needs reassessment before promising launch.
- Day 4 keeps menu/category/photo ownership inside the restaurant microservice. Photos use private S3-compatible storage and API-mediated upload/read authorization. Local Docker/Kubernetes use single-node SeaweedFS; hosting is deferred. Archived menu records are retained. Later order services must store immutable purchase-time item/price snapshots.

Sources: https://docs.flutter.dev/install ; https://docs.flutter.dev/platform-integration/ios/setup ; https://docs.nestjs.com/first-steps ; https://docs.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql

