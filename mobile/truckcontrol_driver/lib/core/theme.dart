import 'package:flutter/material.dart';

/// Logixa AI brand palette — the same tokens the web design system uses.
/// Deep Navy carries the interface, Electric Blue signals; dark mode is
/// mandatory (night driving, TZ §3.1).
class BrandColors {
  /// Deep Navy — the ground.
  static const navy = Color(0xFF0D1220);

  /// Card / raised surface on the navy ground.
  static const surface = Color(0xFF141B2C);

  /// Dark Graphite — secondary surface.
  static const graphite = Color(0xFF1C2431);

  /// Electric Blue — the destination node, live states, primary actions.
  static const accent = Color(0xFF0A84FF);

  /// Brighter blue for text and icons on dark grounds.
  static const accentBright = Color(0xFF3E9BFF);

  static const success = Color(0xFF30D158);
  static const warning = Color(0xFFFF9F0A);
  static const danger = Color(0xFFFF453A);

  /// Secondary text on the navy ground.
  static const muted = Color(0xFF8A93A8);

  /// Primary body text on the navy ground.
  static const textSecondary = Color(0xFFC6CEDC);

  static const border = Color(0x1FFFFFFF);
}

/// Radius ladder shared with the web app (12 / 16 / 20 / pill).
class BrandRadii {
  static const control = 12.0;
  static const card = 16.0;
  static const sheet = 20.0;
  static const pill = 100.0;
}

ThemeData buildDarkTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: BrandColors.navy,
    colorScheme: base.colorScheme.copyWith(
      primary: BrandColors.accent,
      onPrimary: Colors.white,
      secondary: BrandColors.accentBright,
      surface: BrandColors.surface,
      onSurface: Colors.white,
      error: BrandColors.danger,
      outline: BrandColors.border,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: Colors.white,
      displayColor: Colors.white,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: BrandColors.navy,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 19,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: Colors.white,
      ),
    ),
    cardTheme: CardThemeData(
      color: BrandColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BrandRadii.card),
        side: const BorderSide(color: BrandColors.border),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: BrandColors.accentBright,
      textColor: Colors.white,
    ),
    dividerTheme: const DividerThemeData(color: BrandColors.border, space: 1),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: BrandColors.accent,
        foregroundColor: Colors.white,
        elevation: 0,
        // Big touch targets — gloves on the road (TZ §3.1).
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BrandRadii.pill),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: BrandColors.border),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BrandRadii.pill),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: BrandColors.accentBright),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BrandColors.graphite,
      hintStyle: const TextStyle(color: BrandColors.muted),
      labelStyle: const TextStyle(color: BrandColors.textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.control),
        borderSide: const BorderSide(color: BrandColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.control),
        borderSide: const BorderSide(color: BrandColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.control),
        borderSide: const BorderSide(color: BrandColors.accent, width: 2),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: BrandColors.surface,
      indicatorColor: BrandColors.accent.withValues(alpha: 0.18),
      elevation: 0,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w500,
          color: states.contains(WidgetState.selected)
              ? BrandColors.accentBright
              : BrandColors.muted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 24,
          color: states.contains(WidgetState.selected)
              ? BrandColors.accentBright
              : BrandColors.muted,
        ),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: BrandColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(BrandRadii.sheet),
        ),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: BrandColors.graphite,
      contentTextStyle: const TextStyle(color: Colors.white),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BrandRadii.control),
      ),
    ),
  );
}
