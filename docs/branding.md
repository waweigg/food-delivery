# Project branding

The user-supplied wawwieg.PNG is the project logo. Its unchanged source is stored at `apps/mobile/assets/branding/logo.png` (SHA-256: 0347fdc544445775637da95c85a873182eb5e563be7a50be24f2950ab34d283e).

Use BrandLogo and BrandTitle from lib/brand.dart on mobile screens. Sign-in, registration, recovery, role dashboards, restaurant catalog, profile forms and admin review now share this asset. The theme uses blue and orange inspired by the artwork. Keep the artwork's original colors and aspect ratio; do not redraw the symbol or infer a business name from the filename.

The user confirmed the exact brand name **waweigg** on November 11, 2026. Use that lowercase spelling for app display names, headings, accessibility labels, the admin website and payment descriptions. Existing internal application IDs and persistent Docker volumes are retained. Functional icons such as refresh, add and delete remain standard controls.

After generating Android/iOS hosts, run `flutter pub get` and `dart run flutter_launcher_icons` from apps/mobile to generate launcher assets. CI includes this step. Android icons and the native app have been installed on Pixel 8. iOS device verification remains pending. The supplied artwork is portrait; review square/masked launcher icons before release. In-app rendering preserves the full portrait artwork.

The earlier interactive chat mockup is a historical Day 2 preview, not the native source or a live app build. Its visual state is not automatically synchronized with project edits.
