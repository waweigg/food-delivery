# Day 5 — Customer cart and delivery address

Customers browse a restaurant menu, choose quantities, and review a quote. Switching restaurants requires confirmation before replacing the basket. A basket and its delivery details last for the app session. Enter the street address, contact number, delivery coordinates and optional instructions. No map credentials are needed.

The gateway forwards POST /catalog/restaurants/:id/quote to the restaurant microservice. The request contains item IDs, quantities, INR and the delivery details. A repeatable-read transaction checks the restaurant's approval, active state, hours and temporary closure, the delivery radius, and each item's ownership, category, availability, currency and database price. The response contains line totals and the subtotal, delivery, other charges and total in integer paise. Client-supplied prices are rejected. A quote creates no order or payment and stores no delivery details.

Local development uses DELIVERY_RADIUS_METRES=5000, DELIVERY_FEE_MINOR=3000 and OTHER_CHARGES_MINOR=0. Coverage is measured in a straight line from the restaurant to the delivery entrance. Manual coordinates are used as supplied. The same development settings are present in Compose and the Kubernetes development config. This change requires no new database migration.

To populate an empty local catalog for testing, run from the project directory in PowerShell:

    Get-Content -Raw scripts/day5-local-demo.mjs | docker compose -f compose.yaml -f compose.services.yaml exec -T restaurants node --input-type=module

This fixture is optional and local to development. Choose waweigg Test Kitchen (demo), add the paneer rice bowl, and enter 12.9716 latitude and 77.5946 longitude with a test address and contact number. One bowl costs INR 179 plus INR 30 delivery, for INR 209. Use latitude 13.0716 with the same longitude to test an outside-zone address. The offline sample menu is a UI preview and cannot provide a server quote.
