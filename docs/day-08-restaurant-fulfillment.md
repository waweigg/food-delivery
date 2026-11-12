# Day 8 — Restaurant fulfillment

Approved restaurant members open My restaurants → Open kitchen queue. Only successfully captured payments enter the queue. Each ticket stores the immutable order snapshot, acceptance deadline and preparation estimate.

The local acceptance window is KITCHEN_ACCEPT_MINUTES=30. Staff accept with a 1–180 minute estimate, move ACCEPTED to PREPARING, then mark READY for pickup. Repeated requests for the current resulting state succeed without creating another event or capture. Other transitions return a conflict. Every queue read and action verifies restaurant membership through the restaurants service.

The orders microservice writes payment confirmation and its kitchen ticket together. The existing outbox worker creates durable in-app alerts with bounded retries. The native queue polls every eight seconds while visible and supports manual refresh, so delayed alerts cannot hide an order.

Rejected or expired tickets block dispatch at the database boundary and create one REFUND_PENDING recovery record. Admin → Payment recovery lists these and capture failures. Refund execution remains an operator review task for the later refund workflow. Unpaid failed captures never become kitchen tickets. Historical orders paid before this feature retain their old history and are not automatically added.

Verification: Docker acceptance tests cover ownership, polling without an alert, eight concurrent acceptance requests producing one event, preparing and ready, rejection, expiry and prevention of dispatch. Existing order-engine acceptance tests also pass. Kubernetes uses the configured development acceptance window. Hosted deployment, external push notifications and real merchant payments remain deferred.

Pixel 8 verification on November 10, 2026: the installed APK completed Accept order → Mark as preparing → Ready for pickup on a captured simulator order, and the customer API confirmed READY. A second captured order was left on its acceptance screen. Flutter analysis and all 13 existing mobile tests passed. Native sessions are memory-only, so closing the application requires signing in again.
