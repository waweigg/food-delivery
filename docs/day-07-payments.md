# Day 7 — Test payments

The Pixel 8 uses the local-test provider. It accepts synthetic approval, decline and abandonment tokens. Use Make test payment on an order receipt, or select an unpaid order in Account → My test orders. Only a successful provider capture marks the order PAID. Fulfillment remains unassigned.

The payments microservice owns its PostgreSQL database, attempt references, webhook event IDs and reconciliation timestamps. Orders owns its own database and locks an order against cancellation while payment is reserved. Prices and currency come from the authenticated customer order. A partial unique index prevents multiple open attempts. Settlement checks the attempt, amount, currency and customer, updates the order and appends the event in one transaction. Each remote checkpoint can be retried. Keep the database volumes and secrets when restarting.

Immediate capture is used. A decline or abandonment leaves the order unpaid and allows a new attempt. A lost or ambiguous response is reconciled against the original provider record. The local simulator expires pending attempts after ten minutes. The webhook checks the signature on the raw body and the timestamp, deduplicates event IDs, and retrieves provider state before settling. A periodic sweep also checks unresolved attempts. A checkout redirect supplies no payment proof. A restaurant rejection after capture requires a refund workflow before returning funds; Day 7 does not automatically refund or dispatch an order.

## Switching to a merchant test account

Keep PAYMENT_PROVIDER=local-test for the verified Pixel workflow. Finish open simulator attempts before switching. To use the optional Stripe hosted adapter, configure PAYMENT_PROVIDER=stripe-test, STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET and PAYMENT_RETURN_URL (an HTTPS page you control). Forward Stripe test Checkout Session events to /payments/webhook, then recreate payments and gateway. Keep PAYMENTS_ORDER_TOKEN shared only between orders and payments; PAYMENTS_WEBHOOK_SECRET signs local simulator notifications. Store credentials in the local ignored environment file or a secret manager. The adapter accepts only test secret keys and verifies that sessions are in test mode. Merchant credentials and a real Stripe test transaction remain unverified. Live merchant processing is disabled.

In Kubernetes, supply payments-secrets containing POSTGRES_PASSWORD, PAYMENTS_DATABASE_URL, PAYMENTS_ORDER_TOKEN and PAYMENTS_WEBHOOK_SECRET; orders-secrets also needs the matching PAYMENTS_ORDER_TOKEN. The manifests were rendered, with no cluster rollout.

## Local verification

From the project root, with the development stack running and the Day 5 demo kitchen available:

    Get-Content -Raw apps/payments/acceptance.mjs | docker compose -f compose.yaml -f compose.services.yaml exec -T payments node --input-type=module

This creates disposable development accounts and orders. It checks simultaneous starts, ownership, rejection during active payment, decline, abandonment, retry, invalid signatures, repeated notifications, terminal-state protection and recovery from a lost notification. Flutter analysis and all 13 existing mobile tests passed. The installed Pixel 8 app also approved a simulated INR 209 payment; the orders API independently returned PAID.
