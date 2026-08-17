import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:truckcontrol_driver/core/config.dart';
import 'package:truckcontrol_driver/core/gps/gps_service.dart';

void main() {
  LocationSettings settingsFor(TargetPlatform platform) =>
      GpsService.locationSettingsFor(platform, 'title', 'text');

  test('Android keeps the foreground-service notification', () {
    final settings = settingsFor(TargetPlatform.android);
    expect(settings, isA<AndroidSettings>());
    expect(
      (settings as AndroidSettings).foregroundNotificationConfig?.notificationTitle,
      'title',
    );
  });

  test('iOS gets Apple background settings, not Android ones', () {
    final settings = settingsFor(TargetPlatform.iOS);
    expect(settings, isA<AppleSettings>());
    final apple = settings as AppleSettings;
    expect(apple.allowBackgroundLocationUpdates, isTrue);
    expect(apple.showBackgroundLocationIndicator, isTrue);
    expect(apple.pauseLocationUpdatesAutomatically, isFalse);
  });

  test('every platform records at the configured distance filter', () {
    for (final platform in [TargetPlatform.android, TargetPlatform.iOS, TargetPlatform.linux]) {
      expect(
        settingsFor(platform).distanceFilter,
        AppConfig.gpsDistanceFilterMeters,
        reason: '$platform',
      );
    }
  });

  test('the default API url is only acceptable outside release builds', () {
    // Guards against someone shipping a release pointed at plain HTTP.
    expect(AppConfig.isSecureApiUrl, AppConfig.apiUrl.startsWith('https://'));
    expect(() => AppConfig.assertSecureInRelease(), returnsNormally);
  });
}
