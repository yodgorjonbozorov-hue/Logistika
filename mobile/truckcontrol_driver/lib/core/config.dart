import 'package:flutter/foundation.dart';

/// Build-time configuration.
/// Override: flutter build apk --dart-define=API_URL=https://api.truckcontrol.uz/api/v1
class AppConfig {
  /// Production default is HTTPS. The old default was a plain-http emulator
  /// address, so a release build shipped without --dart-define would have sent
  /// credentials and GPS traces in the clear (M-16).
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: kReleaseMode
        ? 'https://api.truckcontrol.uz/api/v1'
        // 10.0.2.2 — Android emulator's alias for the host machine's localhost.
        : 'http://10.0.2.2:3000/api/v1',
  );

  /// GPS batching (TZ §3.3: every 2–5 minutes, battery-friendly).
  static const gpsFlushInterval = Duration(minutes: 3);
  static const gpsDistanceFilterMeters = 50;

  /// A release build must never talk to an unencrypted endpoint, whatever was
  /// passed at build time. Checked at startup so a misconfigured build fails
  /// immediately and visibly rather than leaking silently in the field.
  static void assertSecureInRelease() {
    if (kReleaseMode && !apiUrl.startsWith('https://')) {
      throw StateError(
        'Refusing to start a release build against a non-HTTPS API URL: $apiUrl',
      );
    }
  }
}
