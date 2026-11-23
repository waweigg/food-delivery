# Run waweigg on your Android phone

This guide is for a **Windows 10/11 laptop and a physical Android phone**. Each laptop runs its own Docker microservices and databases. No hosting account, payment keys or Kubernetes cluster is needed. Payments are simulated. The phone reaches the laptop through USB port forwarding; Wi-Fi and firewall changes are unnecessary.

## Install once

1. Install [Git](https://git-scm.com/downloads), Node.js 24 or newer, and Docker Desktop. Open Docker Desktop and wait for its **Linux containers** engine to be ready. If Docker asks for WSL/virtualization setup, finish that first.
2. Install the Flutter SDK, add its `bin` folder to PATH and reopen PowerShell. The project's last verified SDK is **Flutter 3.47.9**; use that version to reproduce the existing build. Android Studio's Flutter plugin alone is insufficient.
3. Install Android Studio. In **SDK Manager**, install Android SDK Platform-Tools, Command-line Tools, and the Android platform/build tools requested by `flutter doctor`. Use Android Studio's bundled JDK. Follow [Flutter's Android setup](https://docs.flutter.dev/platform-integration/android/setup).
4. Run `flutter doctor` and `flutter doctor --android-licenses`; review and accept required Android SDK licenses yourself. Resolve Android toolchain errors. Windows desktop/Visual Studio and iOS/Xcode warnings do not prevent Android builds.
5. On your phone, enable Developer options (usually tap **Build number** seven times), then **USB debugging**. Connect a USB **data** cable, unlock the phone and accept its debugging authorization prompt. Some Windows phones need the manufacturer's USB driver. See [Android's device instructions](https://developer.android.com/studio/run/device).

## Clone and run

Accept the repository invitation first if the repository is private. Open PowerShell in a normal writable development folder, then:

```powershell
git clone https://github.com/waweigg/food-delivery.git
cd food-delivery
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-partner.ps1
```

After cloning, **the last line is the single setup/run command**. `ExecutionPolicy Bypass` applies only to that PowerShell process; it does not disable Windows security settings. Keep security protections enabled.

The script checks Node, Docker, Flutter and the authorized physical phone; creates `.env` only if absent; generates independent random development secrets; builds and waits for the full Compose stack; creates the fictional Malappuram restaurants and four demo accounts on first setup; fetches Flutter packages; forwards the gateway port over USB; and builds/opens the **debug** app on the phone. Android 12+ startup and customer/restaurant/delivery screens use the current text branding and UI.

The first run needs internet access and may take several minutes for Docker images, Flutter/Gradle dependencies and Android components. For the project's NDK 28.2.13676358, setup uses the existing checksum-verified Google archive installer if that NDK is missing (about 750 MB download). Other Flutter SDK versions may require installing their matching NDK through SDK Manager.

No emulator is needed. The script ignores emulators and stops if multiple physical phones are connected unless `-DeviceId` selects one. It does not install prerequisite applications, change system security settings, accept SDK licenses, open checkout or publish anything.

## Logins and sample flow

Open `.local/demo-credentials.json` locally in your editor. It contains separate generated passwords for:

| Account | Email | Where to check |
| --- | --- | --- |
| Customer | customer@waweigg.test | Account → sign in → Explore → select Malappuram demo area → restaurant → add food → Basket |
| Restaurant | restaurant@waweigg.test | Account → My restaurants → Manage menu / Open kitchen queue |
| Delivery | delivery@waweigg.test | Account → Driver centre → offers, pickup and customer PIN completion |
| Admin | admin@waweigg.test | Laptop browser → http://localhost:8088/admin-ui/ |

The demo chicken biriyani is ₹180 plus ₹30 delivery (₹210 total). Restaurants, addresses, contact details and payments are test data. Driver availability uses the phone's actual GPS, with the existing 5 km dispatch radius near the Malappuram sample pickup locations. A physical phone elsewhere can inspect the UI but will not receive those nearby offers. Use an Android emulator's simulated Malappuram location for that dispatch scenario; the existing Pixel review workflow is separate from this physical-phone script. Never make a real delivery from sample data.

If checkout is paused, the admin can use **Pilot** to configure a local staffed window with sample restaurant IDs (for example `mlp-demo-malabar`), UTC opening/closing times and an order cap, then resume it. The setup preserves existing pilot settings. See [local demo flows](local-demo-guide.md). Recovery emails appear at http://localhost:8025.

If an existing `.env` uses a different gateway port, use that port in the admin URL. Setup requires `BETTER_AUTH_URL=http://localhost:PORT` and forwards that same port to the phone. New setups use 8088; an existing configuration is never silently rewritten. The demo seeder receives the selected loopback URL from setup.

## Next time and useful options

Open Docker Desktop, connect/unlock the phone, then run the same setup command. Keep the USB cable connected and Docker running while testing backend features. Press Ctrl+C to end the Flutter session; containers and data remain. After reconnecting USB, rerun setup to restore forwarding. Each laptop has its own accounts; your colleague's passwords and database are not downloaded from GitHub.

```powershell
# Start backend and create demo accounts without needing Flutter or a phone:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-partner.ps1 -BackendOnly

# Check tools and connected phone without changing project files or starting services:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-partner.ps1 -CheckOnly

# Flutter not on PATH, or more than one phone connected:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-partner.ps1 -FlutterSdk C:\dev\flutter -DeviceId YOUR_PHONE_SERIAL

# Explicitly refresh only the known sample fixtures:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-partner.ps1 -BackendOnly -ReseedDemo
```

Normal repeats preserve `.env`, accounts, menus and driver state. `-ReseedDemo` intentionally resets the sample restaurant/menu fixtures and the demo driver's approval/offline state. It does not reset unknown account passwords. An interrupted first seed is retried on the next run using its local pending marker. Preserve `.local/demo-credentials.json`; deleting it does not delete accounts and prevents the script from recovering their generated passwords. Do not copy your original developer's `.env`, `.local`, SDK folders or absolute paths.

To stop the local services without deleting their data:

```powershell
docker compose -f compose.yaml -f compose.services.yaml stop
```

To get later code updates, first save/commit your own edits, run `git pull --ff-only`, then rerun setup.

## Troubleshooting

| Message or symptom | What to do |
| --- | --- |
| `node`, `docker` or Flutter missing | Install the prerequisite and reopen PowerShell. Android Studio alone does not install Flutter. |
| Docker engine unavailable | Start Docker Desktop and wait for Linux containers; finish any WSL setup it requests. |
| No authorized phone / `unauthorized` | Unlock phone, accept USB debugging, try a data cable and check the OEM USB driver. Run `adb devices` if platform-tools is on PATH. |
| Multiple phones | Use `-DeviceId SERIAL`; setup does not guess. |
| Incomplete existing `.env` | Fill the named missing values using separate random secrets; retain all existing secrets. Never post this file in an issue or chat. |
| Exported variable overrides `.env` | Clear only the variable named by setup from that terminal, or open a clean terminal with matching configuration. |
| Port already allocated | Check Docker containers/apps using 8088, 8025 or 5433. Stop the conflicting local service or intentionally adjust the relevant Compose mapping. If changing the gateway port in `.env`, also update `BETTER_AUTH_URL`. |
| Gradle/SDK/NDK build failure | Run `flutter doctor`, accept Android licenses and install the requested SDK/NDK. Keep internet available for first build. Do not disable Windows security controls. Include the actual error when asking for help. |
| App opens but cannot load restaurants | Keep Docker running and USB connected, rerun setup, select the Malappuram demo area and sign in using this laptop's credentials. |
| New phone shows a blank list | Choose the Malappuram demo area; services are restricted by delivery location. Other locations may correctly show unavailable service. |

Service diagnostics (check logs locally; redact secrets before sharing):

```powershell
docker compose -f compose.yaml -f compose.services.yaml ps
docker compose -f compose.yaml -f compose.services.yaml logs --tail 80
```

This script targets Windows/physical Android. macOS/Linux users can run the same Compose stack and Flutter app manually using their installed SDK and USB forwarding. iPhone builds require Mac/Xcode signing or a configured TestFlight build. Hosting and production payments are outside this local setup.

## Setup script verification

The offline PowerShell checks use temporary folders and fake device listings, without Docker, a phone or credentials:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\setup-partner.tests.ps1
```
