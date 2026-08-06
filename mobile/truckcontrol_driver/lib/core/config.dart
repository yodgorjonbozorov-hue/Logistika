/// Build-time configuration.
/// Override: flutter run --dart-define=API_URL=https://api.truckcontrol.uz/api/v1
class AppConfig {
  /// 10.0.2.2 — Android emulator's alias for the host machine's localhost.
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );

  /// GPS batching (TZ §3.3: every 2–5 minutes, battery-friendly).
  static const gpsFlushInterval = Duration(minutes: 3);
  static const gpsDistanceFilterMeters = 50;
}
