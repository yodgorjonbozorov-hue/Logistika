import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../config.dart';
import '../sync/offline_queue.dart';

/// Background-friendly GPS (TZ §3.3): positions buffer into SQLite via the
/// queue and are flushed as a batch every few minutes. On Android the
/// foreground-notification keeps the stream alive when the app is minimized.
class GpsService {
  GpsService(this._queue);

  final OfflineQueue _queue;

  StreamSubscription<Position>? _positionSub;
  Timer? _flushTimer;
  String? _activeTripId;

  bool get isRunning => _activeTripId != null;

  Future<bool> start({
    required String tripId,
    required String notificationTitle,
    required String notificationText,
  }) async {
    if (_activeTripId == tripId) return true;
    await stop();

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return false;
    }

    _activeTripId = tripId;
    _positionSub = Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: AppConfig.gpsDistanceFilterMeters,
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationTitle: notificationTitle,
          notificationText: notificationText,
          enableWakeLock: true,
        ),
      ),
    ).listen((position) {
      unawaited(_queue.enqueuePosition(
        tripId: tripId,
        lat: position.latitude,
        lng: position.longitude,
        speed: position.speed * 3.6, // m/s → km/h
        heading: position.heading >= 0 ? position.heading : null,
      ));
    });

    _flushTimer = Timer.periodic(
      AppConfig.gpsFlushInterval,
      (_) => unawaited(_queue.syncAll()),
    );
    return true;
  }

  Future<Position?> currentPosition() async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 10));
    } on Exception {
      // GPS timeout must never block the driver from logging an event.
      return null;
    }
  }

  Future<void> stop() async {
    await _positionSub?.cancel();
    _positionSub = null;
    _flushTimer?.cancel();
    _flushTimer = null;
    _activeTripId = null;
  }
}
