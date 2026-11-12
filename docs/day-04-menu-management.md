# Day 4 — Menu management

Menu management is part of the independently deployed restaurant service. Identity remains a separate service and database. Flutter is the shared Android/iOS application. The user's logo is reused in menu screens. Currency is INR, as requested; 14950 paise displays as INR 149.50.

## Run locally

1. Copy the root `.env.example` to `.env` if it does not already exist. Preserve existing values. Set separate random BETTER_AUTH_SECRET, RESTAURANT_SERVICE_TOKEN, MENU_S3_ACCESS_KEY and MENU_S3_SECRET_KEY values. Do not commit secrets.
2. From the project root run `docker compose -f compose.yaml -f compose.services.yaml up --build -d`. Migration jobs apply existing migrations plus the new menu migration. SeaweedFS creates the private menu-photos bucket with persistent storage. Its ports are not published to the host. Photo operations can briefly return 503 during storage startup; retry after it is ready.
3. Check the gateway at `http://localhost:8080/restaurants-health/ready`. This checks the restaurant database, not object storage. Complete an actual upload/read to verify storage.
4. On a Flutter-enabled machine run `node scripts/bootstrap-mobile.cjs`, then in `apps/mobile`: `flutter pub get`, `dart run flutter_launcher_icons`, `flutter analyze`, `flutter test` and `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080` for an Android emulator. iOS Simulator uses localhost:8080 and requires macOS/Xcode. Native hosts/lockfile are not generated here. Bootstrap adds iOS photo-library permission. Only gallery selection is used.
5. Sign in, open **My restaurants → Manage menu**, add categories, add an item with a price, and optionally choose a photo. Use category arrows to reorder, Edit item to change details/category, and the availability switch to hide/show an item. Archive removes it from the active menu. Archiving a category also archives all its items and asks for confirmation.
6. Once an admin approves the restaurant, **Browse restaurants → View menu** shows its available items and photos. Pending/suspended/inactive restaurants do not publish menus. Closed but approved restaurants can still show their menu; ordering remains disabled.

Docker and native runtime verification remain pending on this Windows machine. See progress.md for executed checks. Hosting and production are deferred. Local SeaweedFS is single-node development storage; pin verified image digests, provision private buckets, backups and scoped credentials when production is planned.

## API contract

Full-stack Compose keeps the identity database on Docker's internal network, without publishing host port 5432. This avoids conflicts with an existing local PostgreSQL instance. The database-only compose.yaml still publishes localhost:5432 for running the identity service directly on the host.

All routes pass through the existing gateway. Owner routes require a real identity bearer session and local restaurant membership; admin role alone does not grant menu editing. Public routes do not require sign-in. Unknown/non-owned records return 404.

| Method/path | Purpose |
| --- | --- |
| GET `/restaurant-onboarding/:id/menu` | Owner menu, hidden items included, current menuVersion |
| POST `/restaurant-onboarding/:id/menu/categories` | Create category: name, menuVersion |
| POST `/restaurant-onboarding/:id/menu/categories/:categoryId` | Rename: name, menuVersion |
| POST `/restaurant-onboarding/:id/menu/categories/reorder` | Complete active category IDs in desired order, menuVersion |
| POST `/restaurant-onboarding/:id/menu/categories/:categoryId/archive` | Archive category/items: menuVersion |
| POST `/restaurant-onboarding/:id/menu/items` | Create item |
| POST `/restaurant-onboarding/:id/menu/items/:itemId` | Update item / availability |
| POST `/restaurant-onboarding/:id/menu/items/:itemId/archive` | Archive item: menuVersion |
| POST `/restaurant-onboarding/:id/menu/photos` | Raw image bytes, Content-Type application/octet-stream |
| GET `/restaurant-onboarding/:id/menu/photos/:photoId` | Member-only photo preview |
| GET `/catalog/restaurants/:id/menu` | Approved, active restaurant's available, unarchived items |
| GET `/catalog/restaurants/:id/menu/photos/:photoId` | Photo currently referenced by a public item |

Item writes require menuVersion, categoryId, name (1–120 chars), description (0–2000 chars), priceMinor (integer 1–2147483647), currency (INR), available (boolean), photoId (owned upload ID or null). Category names are 1–80 chars. Unknown fields fail validation. Menu currency is configured through MENU_CURRENCY; the implemented price-entry convention has two decimal minor units. Do not change currency on an existing populated deployment without an explicit price migration.

Every menu write atomically increments the restaurant's menuVersion. Competing/stale writes return 409 and must reload; the app does not automatically overwrite another editor's changes. Reorders must include each active category exactly once. Composite foreign keys also prevent cross-restaurant category/photo references. Limits: 100 active categories and 1000 active items per restaurant.

## Photo handling and retained records

Uploads accept up to 5 MiB and 20 million decoded pixels. JPEG, PNG and WebP content must decode successfully and have a single frame. SVG, GIF, malformed data and oversized files fail. The service rotates according to orientation, bounds dimensions to 1600×1600, removes original metadata and re-encodes JPEG before storing an immutable random key. Names/extensions supplied by clients never become keys. Original upload bytes are not served.

Object storage uses MENU_S3_ENDPOINT, MENU_S3_REGION, MENU_S3_BUCKET, MENU_S3_ACCESS_KEY and MENU_S3_SECRET_KEY. The optional development-only `node --env-file=.env dist/init-storage.js` can provision a bucket for a manually started S3-compatible server. Compose's SeaweedFS setup provisions it directly. Clients receive API photo paths, never storage URLs/credentials. API photo responses are no-store and nosniff; private previews require the same bearer session. Upload/database failure attempts object cleanup. Abandoned successful uploads remain private; retention cleanup is a later operational task and must check references before deleting anything.

Archival keeps category/item IDs and photo records. Edits do not provide a price-history ledger. The future order service must capture immutable purchase-time names, prices and currency in its own database. No order/payment functionality or real restaurant/menu data is fabricated here.

## Verification

`apps/restaurants`: `npm run generate`, `npm run build`, `npm test`. Tests apply the actual migrations to separate PGlite PostgreSQL engines for identity and restaurants, use real Better Auth/HTTP/Prisma, and exercise the real AWS S3 client against a test-only S3rver simulator. S3rver is a development dependency, not the deployed storage engine. Docker/SeaweedFS and native device tests are separate required runtime checks.

Flutter tests cover exact paise conversion, customer read-only menu display and invalid-price form submission; they are supplied but not executed locally.

Implementation references: [SeaweedFS mini configuration](https://github.com/seaweedfs/seaweedfs/blob/master/weed/command/mini.go), [Sharp image input](https://sharp.pixelplumbing.com/api-input/), [Flutter image_picker](https://pub.dev/packages/image_picker).
