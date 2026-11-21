import 'package:flutter/material.dart';

/// Shared typography, colors and spacing.
class AppBrand {
  static const blue = Color(0xFF2484CC);
  // Darker UI accent keeps small text legible on white and peach surfaces.
  static const orange = Color(0xFFAA4D0E);
  static const ink = Color(0xFF202B36);
  static const muted = Color(0xFF65717D);
  static const canvas = Color(0xFFFAF8F5);
  static const peach = Color(0xFFFFEBDD);
  static const pagePadding = 20.0;
  static EdgeInsets pageInsets(
    BuildContext context, {
    double top = 16,
    double bottom = 24,
  }) {
    final width = MediaQuery.sizeOf(context).width;
    final gutter = width < 360 ? 16.0 : pagePadding;
    final centeredGutter = ((width - 720) / 2).clamp(gutter, double.infinity);
    return EdgeInsets.fromLTRB(
      centeredGutter.toDouble(),
      top,
      centeredGutter.toDouble(),
      bottom + MediaQuery.paddingOf(context).bottom,
    );
  }

  static ThemeData get theme => buildTheme(Brightness.light);
  static ThemeData get darkTheme => buildTheme(Brightness.dark);

  static ThemeData buildTheme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final foreground = dark ? const Color(0xFFF5EEE8) : ink;
    final neutral = dark ? const Color(0xFFCFC0B4) : muted;
    final background = dark ? const Color(0xFF171312) : canvas;
    final surface = dark ? const Color(0xFF241E1B) : Colors.white;
    final accent = dark ? const Color(0xFFFFB68A) : orange;
    final tint = dark ? const Color(0xFF442C22) : peach;
    final outline = dark ? const Color(0xFF68574F) : const Color(0xFFE1E5E8);
    return ThemeData(
      colorScheme:
          ColorScheme.fromSeed(
            seedColor: orange,
            brightness: brightness,
          ).copyWith(
            primary: accent,
            secondary: dark ? const Color(0xFF9ECDFA) : blue,
            surface: surface,
            onSurface: foreground,
            onSurfaceVariant: neutral,
            onPrimary: dark ? const Color(0xFF40200C) : Colors.white,
            primaryContainer: tint,
          ),
      scaffoldBackgroundColor: background,
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: foreground,
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleSpacing: pagePadding,
      ),
      textTheme: TextTheme(
        headlineLarge: TextStyle(
          fontSize: 34,
          height: 1.12,
          fontWeight: FontWeight.w800,
          letterSpacing: -1.2,
          color: foreground,
        ),
        headlineMedium: TextStyle(
          fontSize: 28,
          height: 1.2,
          fontWeight: FontWeight.w800,
          letterSpacing: -.8,
          color: foreground,
        ),
        titleLarge: TextStyle(
          fontSize: 21,
          fontWeight: FontWeight.w700,
          letterSpacing: -.4,
          color: foreground,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
        bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: foreground),
        bodyMedium: TextStyle(fontSize: 14, height: 1.45, color: neutral),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 18,
          vertical: 17,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: accent, width: 2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: const EdgeInsets.symmetric(vertical: 7),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(22),
          side: BorderSide(color: dark ? outline : const Color(0xFFEEEAE5)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: tint,
        iconTheme: WidgetStatePropertyAll(IconThemeData(color: foreground)),
        height: 76,
        labelTextStyle: WidgetStateProperty.all(
          const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: dark ? outline : const Color(0xFFECE9E4),
        space: 28,
      ),
      useMaterial3: true,
    );
  }
}

class EmptyPanel extends StatelessWidget {
  const EmptyPanel({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title, message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
    child: Column(
      children: [
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: 36,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center),
        if (action != null) ...[const SizedBox(height: 20), action!],
      ],
    ),
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.positive = false});
  final String label;
  final bool positive;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: positive
          ? const Color(0xFFE6F4EB)
          : Theme.of(context).colorScheme.primaryContainer,
      borderRadius: BorderRadius.circular(30),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        color: positive
            ? const Color(0xFF246341)
            : Theme.of(context).colorScheme.primary,
      ),
    ),
  );
}

class BrandTitle extends StatelessWidget {
  const BrandTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Text(
    title,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
  );
}
