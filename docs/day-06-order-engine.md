# Day 6 — Local test checkout

The Android basket submits a customer-owned order through the gateway to the orders service. Identity verifies the bearer token. The restaurant service rechecks availability, currency, delivery coverage and prices. Any difference from the reviewed quote requires a new review. The order database stores the original line names, prices, quantities, charges, currency and address. Customers can see previous order references, states and totals in Account → My test orders after signing in.

POST /orders accepts a checkout key, restaurantId, basket and reviewed quote. Retries with identical content return the original order. Different content for the same customer and key returns 409. A customer-scoped database uniqueness constraint and transaction lock protect concurrent submissions. The order, initial event and outbox entry commit together. The order UUID is the receipt reference. GET /orders and GET /orders/:id return only the caller's orders.

Orders start PLACED, UNPAID and UNASSIGNED. The owner may cancel a placed, unpaid, unassigned test order using POST /orders/:id/cancel. The service records a timestamped event for placement and cancellation. No customer endpoint can mark an order paid, refunded, assigned or delivered. Database guards protect immutable fields and state changes. The later payments and delivery services must authenticate their actors before enabling those transitions. This endpoint is enabled only in development with TEST_ORDERS_ENABLED=true.

The worker consumes committed outbox events into a durable order activity table. It locks rows with SKIP LOCKED, deduplicates by event ID and commits the activity and acknowledgement together. Handler errors are retried with exponential backoff. After ten failures, inspect the retained event and its attempts before manual replay. This consumer does not dispatch deliveries or publish to an external broker.

Compose provisions an orders-db PostgreSQL instance and named volume. The service applies its additive schema at startup. For Kubernetes development, supply orders-secrets with POSTGRES_PASSWORD and ORDERS_DATABASE_URL for database orders_development, user orders and host orders-db. Keep the secret outside the repository. Kubernetes configuration has been rendered locally. Hosting and payments are deferred.

Run the backend acceptance suite against local Compose from the project root in PowerShell:

    Get-Content -Raw apps/orders/acceptance.mjs | docker compose -f compose.yaml -f compose.services.yaml run --rm -T --no-deps orders node --input-type=module

The suite creates and removes its own PostgreSQL schema and uses isolated identity and pricing fixtures. It covers concurrent replay, changed prices, cross-customer access, state protection and worker processing. The Pixel checkout separately exercises the real local services.

