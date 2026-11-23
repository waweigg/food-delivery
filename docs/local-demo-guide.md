# waweigg local demo

The brand spelling is **waweigg**. Screen branding and the animated startup use text. Internal package IDs, launcher assets and Docker volumes are retained so existing installations and data remain intact.

**New partner laptop? Start with [the one-command Android setup guide](partner-setup.md).** It creates local configuration and accounts and uses the SDK/phone connected to that laptop.

## Open each role

- Customer: Pixel 8 → Account → sign in with the customer login. Explore → Malabar Biriyani House (Demo) → Add → View basket → Delivery address → Use Malappuram demo address → Review basket → Place test order → Make test payment. The example chicken dum biriyani costs ₹180 plus ₹30 delivery, total ₹210. All payments are simulated.
- Restaurant: sign in with the restaurant login → My restaurants. The account owns all three sample restaurants. Manage menu or Open kitchen queue to accept a paid order, prepare it and mark ready.
- Delivery: sign in with the delivery login → Driver centre → Go online. The driver is approved but initially offline. For emulator dispatch testing use a simulated location near latitude 11.074, longitude 76.0745. Keep the driver screen open; the existing freshness and foreground-only rules apply.
- Admin: open http://localhost:8088/admin-ui/ on the laptop. Sign in with the admin login. The web workspace has overview, restaurant and driver reviews, dispatch/manual offers, delivery resolution, searchable order history/cancellation, full refund requests, payment reconciliation and ledger export, plus user access controls. Refunds require a rejected/expired restaurant ticket or failed delivery. Settlement allocation and payouts remain disabled until the funds rules are set. Admin sessions are memory-only and sign-in is required after refresh. Backend role checks protect every admin API; a customer cannot gain admin access by opening this URL.

## Credentials and fixtures

The four generated local-only logins are stored in `.local/demo-credentials.json`, which is excluded from version control and never served by the admin website. Emails: customer@waweigg.test, restaurant@waweigg.test, delivery@waweigg.test and admin@waweigg.test. Passwords were generated separately for each account and supplied to the user. Do not use these demo accounts for production.

`node scripts/seed-malappuram-demo.mjs` creates or reuses these fixtures. Its operator steps are limited to development containers and exact @waweigg.test accounts; they are audited and do not alter existing administrators. Re-running intentionally resets only these sample restaurants/menus and the demo driver's approval/offline state. It never resets an existing unknown account's password.

The three fictional restaurants are Malabar Biriyani House (Demo), Coconut & Curry (Demo), and Chaya Corner (Demo). Each has three Kerala-inspired dishes. Names, prices, pickup points and all-day hours are test fixtures, not verified real businesses or merchant partnerships. The Malappuram delivery shortcut is debug-only and uses synthetic contact details. Production checkout, hosting and physical-device launch checks remain deferred.

## Layout

The customer flow uses 20 px page/card spacing, consistent section gaps, a compact home banner, wrapping restaurant actions, safe-area basket controls and responsive typography. The admin workspace uses a responsive sidebar, bounded content area, consistent table/cell spacing and a mobile-width layout. No external fonts, analytics or third-party assets are required.

Day 11: customer My test orders → paid order shows the delivery PIN and tracking timeline. Delivery account Driver centre → Confirm pickup → Food collected → enter the customer's PIN → Complete delivery. Only share the PIN at handover. Admin web → Deliveries handles reported issues and documented exceptions. See day-11-delivery.md. The same four accounts remain valid.

## Test on a physical phone

**Android on a partner's Windows laptop:** Use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-partner.ps1`. See [prerequisites and options](partner-setup.md).

**Original developer PC build workaround:** `scripts/build-pixel-apk.ps1 -PhysicalAndroid` uses the original checkout's sibling `work/flutter` folder and is not the partner setup command. It produces `apps/mobile/build/app/outputs/flutter-apk/waweigg-android-usb.apk` (add `-Online` if Gradle needs dependencies). For manual installation of that build with a phone connected and authorized:

```powershell
adb -d reverse tcp:8088 tcp:8088
adb -d install -r apps/mobile/build/app/outputs/flutter-apk/waweigg-android-usb.apk
```

Use the configured gateway port if it differs from 8088. Open waweigg on the phone and keep the USB connection and Docker stack running during backend tests. After reconnecting the cable, run the reverse command again if needed. For test orders, sign in to the local admin and open a staffed window in **Pilot** if checkout is paused. Recovery codes arrive in the local Mailpit inbox.

**iPhone:** Build and sign the Flutter app on a Mac with Xcode and an Apple Account or use an existing signed TestFlight setup. Set `--dart-define=API_BASE_URL=https://YOUR_PRIVATE_API_HOST` to a private HTTPS API the iPhone can reach. The Windows loopback address used by the Android USB build is specific to that setup. See [Apple's device testing guide](https://developer.apple.com/documentation/xcode/building-and-running-an-app) for signing and pairing steps.
