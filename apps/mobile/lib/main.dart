import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'account_settings.dart';
import 'api_client.dart';
import 'brand.dart';
import 'storefront.dart';
import 'startup_screen.dart';

void main() => runApp(const FoodDeliveryApp());

class FoodDeliveryApp extends StatefulWidget {
  const FoodDeliveryApp({super.key, this.api, this.storage});
  final ApiClient? api;
  final FlutterSecureStorage? storage;

  @override
  State<FoodDeliveryApp> createState() => _FoodDeliveryAppState();
}

class _FoodDeliveryAppState extends State<FoodDeliveryApp> {
  static const themeKey = 'waweigg.appearance';
  late final storage =
      widget.storage ??
      (widget.api == null
          ? const FlutterSecureStorage(
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.unlocked_this_device,
              ),
            )
          : null);
  late final api = widget.api ?? ApiClient(storage: storage);
  ThemeMode mode = ThemeMode.system;
  bool ready = false;
  bool entranceFinished = false;
  Future<void> preferenceWrite = Future.value();

  @override
  void initState() {
    super.initState();
    restore();
  }

  Future<void> restore() async {
    final Future<String?> readTheme =
        storage?.read(key: themeKey).catchError((Object _) => null) ??
        Future.value(null);
    await api.restoreSession();
    final saved = await readTheme;
    if (!mounted) return;
    setState(() {
      mode = ThemeMode.values.firstWhere(
        (value) => value.name == saved,
        orElse: () => ThemeMode.system,
      );
      ready = true;
    });
  }

  void changeTheme(ThemeMode value) {
    setState(() => mode = value);
    preferenceWrite = preferenceWrite.then((_) async {
      try {
        await storage?.write(key: themeKey, value: value.name);
      } catch (_) {
        // The choice still applies for this visit.
      }
    });
  }

  @override
  Widget build(BuildContext context) => AppearanceSettings(
    mode: mode,
    onChanged: changeTheme,
    child: MaterialApp(
      title: 'waweigg',
      debugShowCheckedModeBanner: false,
      theme: AppBrand.theme,
      darkTheme: AppBrand.darkTheme,
      themeMode: mode,
      home: ready && entranceFinished
          ? Storefront(api: api)
          : StartupScreen(
              onFinished: () {
                if (mounted && !entranceFinished) {
                  setState(() => entranceFinished = true);
                }
              },
            ),
    ),
  );
}
