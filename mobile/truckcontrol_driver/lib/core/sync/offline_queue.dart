import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
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

  /// After this many failed attempts the event stops retrying by itself and
  /// waits for the driver (needs_attention) — it is never silently dropped.
  static const maxAutoRetries = 5;

  /// Refusals a retry cannot fix, because the payload itself is what the server
  /// objected to. These skip the backoff and wait for the driver immediately.
  ///
  /// Deliberately narrow: NOT_FOUND and TRIP_INVALID_STATUS describe server
  /// state that can change back (the logist reassigns the trip, or moves it
  /// out of a status it should not have been in), so those keep retrying.
  /// A mistyped odometer never becomes right on its own.
  static const permanentRejections = <String>{'ODOMETER_INVALID'};

  /// Backoff per retry_count; the last value repeats for anything beyond.
  static const retryBackoff = <Duration>[
    Duration(seconds: 30),
    Duration(minutes: 2),
    Duration(minutes: 10),
    Duration(minutes: 30),
    Duration(hours: 2),
  ];

  /// Synced rows are kept this long for the "recent events" list, then purged
  /// so the local database does not grow without bound.
  static const syncedRetention = Duration(days: 7);

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

  /// Events the server refused often enough that automatic retries stopped.
  /// The driver has to see these — they hold receipts and delivery proof.
  Future<int> needsAttentionCount() async {
    final rows = await _db.db.rawQuery(
      'SELECT COUNT(*) AS c FROM pending_events WHERE synced = 0 AND retry_count >= ?',
      [maxAutoRetries],
    );
    return Sqflite.firstIntValue(rows) ?? 0;
  }

  Future<List<Map<String, Object?>>> needsAttentionEvents({int limit = 50}) {
    return _db.db.query(
      'pending_events',
      where: 'synced = 0 AND retry_count >= ?',
      whereArgs: [maxAutoRetries],
      orderBy: 'created_at DESC',
      limit: limit,
    );
  }

  Future<List<Map<String, Object?>>> recentEvents({int limit = 50}) {
    return _db.db.query(
      'pending_events',
      orderBy: 'created_at DESC',
      limit: limit,
    );
  }

  /// Manual "send again" from the UI: clears the backoff for the stalled rows
  /// and syncs right away.
  Future<void> retryFailedEvents() async {
    await _db.db.update(
      'pending_events',
      {'retry_count': 0, 'last_attempt_at': null},
      where: 'synced = 0 AND retry_count >= ?',
      whereArgs: [maxAutoRetries],
    );
    await syncAll();
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
      // Runs even after a failed sync: it only touches already-synced rows.
      try {
        await purgeSynced();
      } on Exception {
        // Housekeeping must never break the driver flow.
      }
    }
  }

  /// Drops rows that reached the server and are older than [syncedRetention],
  /// so a phone that has been in service for months keeps a bounded database.
  Future<int> purgeSynced({Duration? olderThan}) async {
    final cutoff = DateTime.now().toUtc().subtract(olderThan ?? syncedRetention);
    final removed = await _db.db.delete(
      'pending_events',
      where: 'synced = 1 AND created_at < ?',
      whereArgs: [cutoff.toIso8601String()],
    );
    await _db.db.delete(
      'pending_positions',
      where: 'synced = 1 AND recorded_at < ?',
      whereArgs: [cutoff.toIso8601String()],
    );
    return removed;
  }

  /// True when an event that already failed is allowed to go out again.
  bool _isDue(Map<String, Object?> row, DateTime now) {
    final retryCount = (row['retry_count'] as int?) ?? 0;
    if (retryCount == 0) return true;
    if (retryCount >= maxAutoRetries) return false; // waits for the driver
    final lastAttempt = row['last_attempt_at'] as String?;
    if (lastAttempt == null) return true;
    final backoff = retryBackoff[retryCount.clamp(0, retryBackoff.length - 1)];
    return DateTime.parse(lastAttempt).add(backoff).isBefore(now);
  }

  Future<void> _syncEvents() async {
    final now = DateTime.now().toUtc();
    final candidates = await _db.db
        .query('pending_events', where: 'synced = 0', orderBy: 'created_at', limit: 100);
    final rows = candidates.where((row) => _isDue(row, now)).toList();
    if (rows.isEmpty) return;

    final events = <Map<String, Object?>>[];
    for (final row in rows) {
      String? photoFileId = row['photo_file_id'] as String?;
      final photoPath = row['photo_path'] as String?;
      if (photoFileId == null && photoPath != null) {
        photoFileId = await _uploadPhoto(photoPath);
        if (photoFileId != null) {
          await _db.db.update(
            'pending_events',
            {'photo_file_id': photoFileId},
            where: 'client_event_id = ?',
            whereArgs: [row['client_event_id']],
          );
        } else if (File(photoPath).existsSync()) {
          // The photo is the proof (H-14). Sending the event without it means
          // the server accepts it, the row is marked synced, and the receipt
          // or delivery photo is never sent again — gone for good. The event
          // waits for the next flush instead; the file is still on the phone.
          continue;
        }
        // A photo file that is no longer on disk cannot be recovered by
        // waiting, so the event goes without it rather than jamming the queue
        // behind something that will never succeed.
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

    // Every candidate can be held back — waiting on a photo that has not
    // uploaded yet — and an empty batch is a round trip over a driver's mobile
    // data that asks the server for nothing.
    if (events.isEmpty) return;

    final result = await _api.request<Map<String, dynamic>>(
      '/events/batch',
      method: 'POST',
      body: {'events': events},
    );
    // Only accepted and duplicate ids reached the server. Rejected events stay
    // in the queue: the server refuses them for reasons that pass (the trip was
    // reassigned while the driver was offline), and marking them synced would
    // throw away receipts, expenses and delivery proof for good.
    final done = [
      ...(result['accepted'] as List? ?? []),
      ...(result['duplicates'] as List? ?? []),
    ];
    for (final id in done) {
      await _db.db.update(
        'pending_events',
        {'synced': 1},
        where: 'client_event_id = ?',
        whereArgs: [id],
      );
    }

    final attemptedAt = DateTime.now().toUtc().toIso8601String();
    for (final rejected in (result['rejected'] as List? ?? [])) {
      final entry = rejected as Map<String, dynamic>;
      final code = entry['code'] as String?;
      // Re-sending an unchanged payload the server refused on its merits will
      // be refused again, every time. Counting to five over two hours only
      // delays the moment the driver finds out the odometer was mistyped, so
      // these go straight to the "needs attention" list.
      final retry = permanentRejections.contains(code)
          ? 'retry_count = MAX(retry_count + 1, $maxAutoRetries)'
          : 'retry_count = retry_count + 1';
      await _db.db.rawUpdate(
        'UPDATE pending_events SET $retry, '
        'last_error = ?, last_attempt_at = ? WHERE client_event_id = ?',
        [code, attemptedAt, entry['clientEventId']],
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

  /// Uploads one photo and returns its stored id, or null if it did not land.
  ///
  /// Goes through [ApiClient.upload] (TASK-5.4): this used to build its own
  /// request with the raw access token — no refresh, so an expired token was
  /// just a failed upload — and dig the id out of the response text with a
  /// regex, which would have returned null for any change to the envelope.
  Future<String?> _uploadPhoto(String path) async {
    if (!File(path).existsSync()) return null;
    try {
      return await _api.upload('/files/upload', path);
    } catch (_) {
      // A failed upload is not an error the driver can act on; the event stays
      // queued and the next flush tries again.
      return null;
    }
  }
}
