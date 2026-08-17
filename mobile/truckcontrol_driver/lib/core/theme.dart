import 'package:flutter/material.dart';

/// Brand palette — docs/TZ.md §11. Dark mode is mandatory (night driving).
class BrandColors {
  static const navy = Color(0xFF1B2A4A);
  static const accent = Color(0xFFF5A623);
  static const success = Color(0xFF2FAE6A);
  static const danger = Color(0xFFE14B4B);
  static const muted = Color(0xFF8A94A6);
}

ThemeData buildDarkTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: BrandColors.navy,
    colorScheme: base.colorScheme.copyWith(
      primary: BrandColors.accent,
      secondary: BrandColors.accent,
      // Overriding a role colour without its `on-` pair leaves the baseline
      // scheme's contrast colour behind: a filled icon button came out amber
      // with a violet glyph. Dark navy is what reads on the brand amber.
      onPrimary: BrandColors.navy,
      onSecondary: BrandColors.navy,
      surface: const Color(0xFF223358),
      error: BrandColors.danger,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: BrandColors.navy,
      elevation: 0,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: BrandColors.accent,
        foregroundColor: BrandColors.navy,
        // Big touch targets — gloves on the road (TZ §3.1).
        minimumSize: const Size.fromHeight(56),
        // Derived from the theme's own label style rather than written from
        // scratch: a bare TextStyle replaces the button label style wholesale,
        // and takes the typography's font family down with it, so button text
        // would be set in a different typeface from the rest of the screen.
        textStyle: base.textTheme.labelLarge?.copyWith(
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      // Four labels share a 360 dp phone, and Cyrillic runs longer than Latin:
      // at the default size «Харажатларим» wrapped onto a second line and out
      // of the bar entirely. A slightly smaller label keeps all three languages
      // on one line without shrinking the tap targets.
      labelTextStyle: WidgetStateProperty.all(
        base.textTheme.labelMedium?.copyWith(fontSize: 11),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
