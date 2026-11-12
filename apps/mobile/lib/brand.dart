import 'package:flutter/material.dart';

/// Shared source artwork. Keep the original aspect ratio and colors.
class AppBrand {
  static const logoAsset = 'assets/branding/logo.png';
  static const blue = Color(0xFF2484CC);
  static const orange = Color(0xFFC45D16);
  static const ink = Color(0xFF202B36);
  static const muted = Color(0xFF65717D);
  static const canvas = Color(0xFFFAF8F5);
  static const peach = Color(0xFFFFEBDD);
  static const pagePadding = 20.0;
  static ThemeData get theme => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: orange).copyWith(primary: orange, secondary: blue, surface: Colors.white, onSurface: ink, onPrimary: Colors.white),
    scaffoldBackgroundColor: canvas,
    appBarTheme: const AppBarTheme(backgroundColor: canvas, foregroundColor: ink, centerTitle: false, elevation: 0, scrolledUnderElevation: 0, titleSpacing: 20),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(fontSize: 34, height: 1.12, fontWeight: FontWeight.w800, letterSpacing: -1.2, color: ink),
      headlineMedium: TextStyle(fontSize: 28, height: 1.2, fontWeight: FontWeight.w800, letterSpacing: -.8, color: ink),
      titleLarge: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -.4, color: ink),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: ink),
      bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: ink),
      bodyMedium: TextStyle(fontSize: 14, height: 1.45, color: muted),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: Colors.white, contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE1E5E8))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE1E5E8))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: orange, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(48, 52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)))),
    cardTheme: CardThemeData(color: Colors.white, elevation: 0, margin: const EdgeInsets.symmetric(vertical: 7), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22), side: const BorderSide(color: Color(0xFFEEEAE5)))),
    navigationBarTheme: NavigationBarThemeData(backgroundColor: Colors.white, indicatorColor: peach, height: 76, labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 11, fontWeight: FontWeight.w700))),
    dividerTheme: const DividerThemeData(color: Color(0xFFECE9E4), space: 28),
    useMaterial3: true,
  );
}

class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.height = 40});
  final double height;
  @override
  Widget build(BuildContext context) => Image.asset(
    AppBrand.logoAsset, height: height, width: height * 0.75,
    fit: BoxFit.contain, semanticLabel: 'waweigg logo',
  );
}

class EmptyPanel extends StatelessWidget {
  const EmptyPanel({super.key, required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title, message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20), child: Column(children: [
    Container(padding: const EdgeInsets.all(24), decoration: const BoxDecoration(color: AppBrand.peach, shape: BoxShape.circle), child: Icon(icon, size: 36, color: AppBrand.orange)),
    const SizedBox(height: 20), Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
    const SizedBox(height: 8), Text(message, textAlign: TextAlign.center),
    if (action != null) ...[const SizedBox(height: 20), action!],
  ]));
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.positive = false});
  final String label;
  final bool positive;
  @override
  Widget build(BuildContext context) => Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5), decoration: BoxDecoration(color: positive ? const Color(0xFFE6F4EB) : AppBrand.peach, borderRadius: BorderRadius.circular(30)), child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: positive ? const Color(0xFF246341) : AppBrand.orange)));
}

class BrandTitle extends StatelessWidget {
  const BrandTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Row(children: [
    const BrandLogo(height: 36), const SizedBox(width: 12),
    Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis)),
  ]);
}
