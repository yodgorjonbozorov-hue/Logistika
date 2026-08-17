import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../db/app_database.dart';
import '../storage/token_store.dart';

class PendingEvent {
  PendingEvent({
    required this.clientEventId,
    required this.tripId,
    required this.eventType,
    required this.eventTime,
    this.lat,
    this.lng,
    this.odometer,
    this.comment,
    this.photoPath,
    this.synced = false,
  });

  final String clientEventId;
  final String tripId;
  final String eventType;
  final DateTime eventTime;
  final double? lat;
  final double? lng;
  final int? odometer;
  final String? comment;
  final String? photoPath;
  final bool synced;
}

/// Offline-first queue: events and GPS points land in SQLite first and are
/// pushed with idempotent batches (client UUID) when the network allows.
class OfflineQueue {
  OfflineQueue(this._db, this._api, this._tokens, {Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity();

  final AppDatabase _db;
  final ApiClient _api;
  final TokenStore _tokens;
  final Connectivity _connectivity;
  final _uuid = const Uuid();

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  bool _syncing = false;

  /// Sync automatically whenever connectivity comes back.
  void start() {
    _connectivitySub = _connectivity.onConnectivityChanged.listen((results) {
      if (results.any((r) => r != ConnectivityResult.none)) {
        unawaited(syncAll());
      }
    });
  }

  Future<void> dispose() async => _connectivitySub?.cancel();

  // ---------- Events ----------

  Future<String> enqueueEvent({
    required String tripId,
    required String eventType,
    double? lat,
    double? lng,
    int? odometer,
    String? comment,
    String? photoPath,
  }) async {
    final id = _uuid.v4();
    await _db.db.insert('pending_events', {
      'client_event_id': id,
      'trip_id': tripId,
      'event_type': eventType,
      'event_time': DateTime.now().toUtc().toIso8601String(),
      'lat': lat,
      'lng': lng,
      'odometer': odometer,
      'comment': comment,
      'photo_path': photoPath,
      'synced': 0,
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
    unawaited(syncAll());
    return id;
  }

  Future<int> pendingEventCount() async {
    final rows = await _db.db
        .rawQuery('SELECT COUNT(*) AS c FROM pending_events WHERE synced = 0');
    return Sqflite.firstIntValue(rows) ?? 0;
  }

  Future<List<Map<String, Object?>>> recentEvents({int limit = 50}) {
    return _db.db.query(
      'pending_events',
      orderBy: 'created_at DESC',
      limit: limit,
    );
  }

  // ---------- GPS ----------

  Future<void> enqueuePosition({
    required String tripId,
    required double lat,
    required double lng,
    double? speed,
    double? heading,
  }) async {
    await _db.db.insert('pending_positions', {
      'trip_id': tripId,
      'lat': lat,
      'lng': lng,
      'speed': speed,
      'heading': heading,
      'recorded_at': DateTime.now().toUtc().toIso8601String(),
      'synced': 0,
    });
  }

  // ---------- Sync ----------

  Future<void> syncAll() async {
    if (_syncing || !_tokens.isLoggedIn) return;
    _syncing = true;
    try {
      await _syncEvents();
      await _syncPositions();
    } on Exception {
      // Network/API failure: rows stay queued; the connectivity listener or
      // the next enqueue retries. Never crash the driver flow.
    } finally {
      _syncing = false;
    }
  }

  Future<void> _syncEvents() async {
    final rows = await _db.db
        .query('pending_events', where: 'synced = 0', orderBy: 'created_at', limit: 100);
    if (rows.isEmpty) return;

    final events = <Map<String, Object?>>[];
    for (final row in rows) {
      String? photoFileId = row['photo_file_id'] as String?;
      final photoPath = row['photo_path'] as String?;
      if (photoFileId == null && photoPath != null) {
        photoFileId = await uploadPhoto(photoPath);
        if (photoFileId != null) {
          await _db.db.update(
            'pending_events',
            {'photo_file_id': photoFileId},
            where: 'client_event_id = ?',
            whereArgs: [row['client_event_id']],
          );
        }
      }
      events.add({
        'clientEventId': row['client_event_id'],
        'tripId': row['trip_id'],
        'eventType': row['event_type'],
        'eventTime': row['event_time'],
        if (row['lat'] != null) 'lat': row['lat'],
        if (row['lng'] != null) 'lng': row['lng'],
        if (row['odometer'] != null) 'odometer': row['odometer'],
        if (row['comment'] != null) 'comment': row['comment'],
        if (photoFileId != null) 'photoFileIds': [photoFileId],
      });
    }

    final result = await _api.request<Map<String, dynamic>>(
      '/events/batch',
      method: 'POST',
      body: {'events': events},
    );
    // Both accepted and duplicate ids are safe to mark as synced.
    final done = [
      ...(result['accepted'] as List? ?? []),
      ...(result['duplicates'] as List? ?? []),
      ...((result['rejected'] as List? ?? []).map((r) => r['clientEventId'])),
    ];
    for (final id in done) {
      await _db.db.update(
        'pending_events',
        {'synced': 1},
        where: 'client_event_id = ?',
        whereArgs: [id],
      );
    }
  }

  Future<void> _syncPositions() async {
    final rows = await _db.db
        .query('pending_positions', where: 'synced = 0', orderBy: 'recorded_at', limit: 500);
    if (rows.isEmpty) return;

    await _api.request<Map<String, dynamic>>(
      '/tracking/positions',
      method: 'POST',
      body: {
        'positions': rows
            .map((row) => {
                  'tripId': row['trip_id'],
                  'lat': row['lat'],
                  'lng': row['lng'],
                  if (row['speed'] != null) 'speed': row['speed'],
                  if (row['heading'] != null) 'heading': row['heading'],
                  'recordedAt': row['recorded_at'],
                })
            .toList(),
      },
    );
    final ids = rows.map((r) => r['id']).toList();
    await _db.db.update(
      'pending_positions',
      {'synced': 1},
      where: 'id IN (${List.filled(ids.length, '?').join(',')})',
      whereArgs: ids,
    );
  }

  /// Uploads a photo and returns its stored file id, or null if it did not go
  /// through. Public because the trip chat sends photos the same way — one
  /// upload path means one retention rule for every image the driver takes.
  Future<String?> uploadPhoto(String path) async {
    final file = File(path);
    if (!file.existsSync()) return null;
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('${AppConfig.apiUrl}/files/upload'),
    )
      ..headers['authorization'] = 'Bearer ${_tokens.accessToken}'
      ..files.add(await http.MultipartFile.fromPath('file', path));
    final response = await request.send();
    final body = await response.stream.bytesToString();
    final match = RegExp('"id"\\s*:\\s*"([^"]+)"').firstMatch(body);
    return response.statusCode < 300 ? match?.group(1) : null;
  }
}
