import 'package:flutter/foundation.dart';

/// Build-time configuration.
/// Override: flutter run --dart-define=API_URL=https://api.truckcontrol.uz/api/v1
class AppConfig {
  /// 10.0.2.2 — Android emulator's alias for the host machine's localhost.
  /// Cleartext only works in debug builds (see android/app/src/debug).
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );

  /// GPS batching (TZ §3.3: every 2–5 minutes, battery-friendly).
  static const gpsFlushInterval = Duration(minutes: 3);
  static const gpsDistanceFilterMeters = 50;

  /// A release build shipped against a plain-HTTP API would send driver
  /// tokens, GPS traces and receipts in the clear. Fail loudly at startup
  /// instead — a wrong --dart-define is a build mistake, not a runtime one.
  static bool get isSecureApiUrl => apiUrl.startsWith('https://');

  static void assertSecureInRelease() {
    if (kReleaseMode && !isSecureApiUrl) {
      throw StateError(
        'API_URL must use https:// in release builds (got "$apiUrl"). '
        'Pass --dart-define=API_URL=https://…',
      );
    }
  }
}
