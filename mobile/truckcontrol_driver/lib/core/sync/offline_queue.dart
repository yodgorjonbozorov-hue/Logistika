import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../db/app_database.dart';
import '../storage/token_store.dart';

/// How many times a transient failure is retried before the row is parked as
/// `failed` and shown to the driver. Parking beats retrying forever: a row that
/// can never succeed would otherwise block the queue behind it.
const _maxAttempts = 5;

/// Rows per network round trip.
const _eventBatchSize = 100;
const _positionBatchSize = 500;

/// Safety valve so a huge backlog cannot spin forever inside one sync pass.
const _maxBatchesPerRun = 20;

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
    this.syncState = SyncState.pending,
    this.lastError,
    this.attempts = 0,
  });

  factory PendingEvent.fromRow(Map<String, Object?> row) => PendingEvent(
        clientEventId: row['client_event_id'] as String,
        tripId: row['trip_id'] as String,
        eventType: row['event_type'] as String,
        eventTime: DateTime.parse(row['event_time'] as String),
        lat: row['lat'] as double?,
        lng: row['lng'] as double?,
        odometer: row['odometer'] as int?,
        comment: row['comment'] as String?,
        photoPath: row['photo_path'] as String?,
        syncState: (row['sync_state'] as String?) ?? SyncState.pending,
        lastError: row['last_error'] as String?,
        attempts: (row['attempts'] as int?) ?? 0,
      );

  final String clientEventId;
  final String tripId;
  final String eventType;
  final DateTime eventTime;
  final double? lat;
  final double? lng;
  final int? odometer;
  final String? comment;
  final String? photoPath;
  final String syncState;
  final String? lastError;
  final int attempts;

  bool get isSynced => syncState == SyncState.synced;
  bool get needsAttention => syncState == SyncState.rejected || syncState == SyncState.failed;
}

/// Offline-first queue: events and GPS points land in SQLite first and are
/// pushed with idempotent batches (client UUID) when the network allows.
///
/// Nothing the driver entered is ever discarded because a request failed. Rows
/// leave `pending` only when the server confirms them; anything the server
/// refuses is kept, marked, and surfaced instead of being quietly flagged as
/// sent (H-11/H-12).
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

  /// Fires whenever queue state changes, so the UI can show a live badge.
  final _changes = StreamController<void>.broadcast();
  Stream<void> get changes => _changes.stream;

  /// Sync automatically whenever connectivity comes back.
  void start() {
    _connectivitySub = _connectivity.onConnectivityChanged.listen((results) {
      if (results.any((r) => r != ConnectivityResult.none)) {
        unawaited(syncAll());
      }
    });
  }

  Future<void> dispose() async {
    await _connectivitySub?.cancel();
    await _changes.close();
  }

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
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.db.insert('pending_events', {
      'client_event_id': id,
      'trip_id': tripId,
      'event_type': eventType,
      'event_time': now,
      'lat': lat,
      'lng': lng,
      'odometer': odometer,
      'comment': comment,
      'photo_path': photoPath,
      'synced': 0,
      'sync_state': SyncState.pending,
      'attempts': 0,
      'created_at': now,
    });
    _notify();
    unawaited(syncAll());
    return id;
  }

  Future<int> pendingEventCount() async {
    final rows = await _db.db.rawQuery(
      'SELECT COUNT(*) AS c FROM pending_events WHERE sync_state = ?',
      [SyncState.pending],
    );
    return Sqflite.firstIntValue(rows) ?? 0;
  }

  /// Events the driver needs to know about: refused by the server, or out of
  /// retries. Previously these were indistinguishable from delivered events.
  Future<List<PendingEvent>> problemEvents() async {
    final rows = await _db.db.query(
      'pending_events',
      where: 'sync_state IN (?, ?)',
      whereArgs: [SyncState.rejected, SyncState.failed],
      orderBy: 'created_at DESC',
    );
    return rows.map(PendingEvent.fromRow).toList();
  }

  Future<int> problemEventCount() async {
    final rows = await _db.db.rawQuery(
      'SELECT COUNT(*) AS c FROM pending_events WHERE sync_state IN (?, ?)',
      [SyncState.rejected, SyncState.failed],
    );
    return Sqflite.firstIntValue(rows) ?? 0;
  }

  Future<List<PendingEvent>> recentEvents({int limit = 50}) async {
    final rows = await _db.db.query(
      'pending_events',
      orderBy: 'created_at DESC',
      limit: limit,
    );
    return rows.map(PendingEvent.fromRow).toList();
  }

  /// Puts a rejected/failed event back in the queue after the driver fixed
  /// whatever caused it (picked the right trip, regained coverage).
  Future<void> retryEvent(String clientEventId) async {
    await _db.db.update(
      'pending_events',
      {'sync_state': SyncState.pending, 'attempts': 0, 'last_error': null},
      where: 'client_event_id = ?',
      whereArgs: [clientEventId],
    );
    _notify();
    unawaited(syncAll());
  }

  /// Explicit, driver-initiated discard. The only path that removes work.
  Future<void> discardEvent(String clientEventId) async {
    await _db.db.delete(
      'pending_events',
      where: 'client_event_id = ? AND sync_state IN (?, ?)',
      whereArgs: [clientEventId, SyncState.rejected, SyncState.failed],
    );
    _notify();
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

  Future<int> pendingPositionCount() async {
    final rows = await _db.db
        .rawQuery('SELECT COUNT(*) AS c FROM pending_positions WHERE synced = 0');
    return Sqflite.firstIntValue(rows) ?? 0;
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
      _notify();
    }
  }

  Future<void> _syncEvents() async {
    // Drain in batches rather than one batch per call: a driver back from a
    // week in the mountains could otherwise need dozens of sync passes.
    for (var batch = 0; batch < _maxBatchesPerRun; batch++) {
      final rows = await _db.db.query(
        'pending_events',
        where: 'sync_state = ?',
        whereArgs: [SyncState.pending],
        orderBy: 'created_at',
        limit: _eventBatchSize,
      );
      if (rows.isEmpty) return;
      if (!await _pushEventBatch(rows)) return;
    }
  }

  /// Returns false when the batch could not be delivered, so the caller stops.
  Future<bool> _pushEventBatch(List<Map<String, Object?>> rows) async {
    final events = <Map<String, Object?>>[];
    final deferred = <String>{};

    for (final row in rows) {
      final clientEventId = row['client_event_id'] as String;
      var photoFileId = row['photo_file_id'] as String?;
      final photoPath = row['photo_path'] as String?;

      if (photoFileId == null && photoPath != null) {
        final outcome = await _uploadPhoto(photoPath);
        switch (outcome.status) {
          case _PhotoStatus.uploaded:
            photoFileId = outcome.fileId;
            await _db.db.update(
              'pending_events',
              {'photo_file_id': photoFileId},
              where: 'client_event_id = ?',
              whereArgs: [clientEventId],
            );
          case _PhotoStatus.missingFile:
            // The OS reclaimed the file. The photo is gone either way, so send
            // the event rather than blocking it forever on an upload that can
            // never succeed.
            await _recordError(clientEventId, 'photo file no longer on device');
          case _PhotoStatus.failed:
            // The photo still exists and the upload failed — hold the WHOLE
            // event back. Sending it now would deliver a receipt-less expense
            // and strand the photo locally with nothing pointing at it (H-12).
            await _recordError(clientEventId, 'photo upload failed, will retry');
            deferred.add(clientEventId);
            continue;
        }
      }

      events.add({
        'clientEventId': clientEventId,
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

    if (events.isEmpty) return false; // everything in this batch was deferred

    final Map<String, dynamic> result;
    try {
      result = await _api.request<Map<String, dynamic>>(
        '/events/batch',
        method: 'POST',
        body: {'events': events},
      );
    } on Exception catch (error) {
      // The batch never reached the server: every row stays pending.
      for (final event in events) {
        await _recordError(event['clientEventId']! as String, error.toString());
      }
      return false;
    }

    final accepted = (result['accepted'] as List? ?? []).cast<String>();
    final duplicates = (result['duplicates'] as List? ?? []).cast<String>();
    final rejected = (result['rejected'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map((r) => MapEntry(r['clientEventId'] as String, r['code'] as String? ?? 'REJECTED'));

    // Accepted and duplicate both mean "the server holds this event" — safe.
    for (final id in [...accepted, ...duplicates]) {
      await _db.db.update(
        'pending_events',
        {'synced': 1, 'sync_state': SyncState.synced, 'last_error': null},
        where: 'client_event_id = ?',
        whereArgs: [id],
      );
    }

    // Rejected does NOT mean stored. The row stays unsynced and is flagged for
    // the driver instead of silently vanishing (H-11).
    for (final entry in rejected) {
      await _db.db.update(
        'pending_events',
        {
          'synced': 0,
          'sync_state': SyncState.rejected,
          'last_error': entry.value,
          'last_attempt_at': DateTime.now().toUtc().toIso8601String(),
        },
        where: 'client_event_id = ?',
        whereArgs: [entry.key],
      );
    }

    return deferred.isEmpty;
  }

  /// Records a failed attempt and parks the row once it runs out of retries.
  Future<void> _recordError(String clientEventId, String message) async {
    await _db.db.rawUpdate(
      '''
      UPDATE pending_events
      SET attempts = attempts + 1,
          last_error = ?,
          last_attempt_at = ?,
          sync_state = CASE WHEN attempts + 1 >= ? THEN ? ELSE sync_state END
      WHERE client_event_id = ?
      ''',
      [
        message,
        DateTime.now().toUtc().toIso8601String(),
        _maxAttempts,
        SyncState.failed,
        clientEventId,
      ],
    );
  }

  Future<void> _syncPositions() async {
    for (var batch = 0; batch < _maxBatchesPerRun; batch++) {
      final rows = await _db.db.query(
        'pending_positions',
        where: 'synced = 0',
        orderBy: 'recorded_at',
        limit: _positionBatchSize,
      );
      if (rows.isEmpty) break;

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

      // Delivered points are deleted, not just flagged: a truck produces
      // thousands a day and an ever-growing table on a cheap phone eventually
      // fills the storage and takes the app down with it.
      final ids = rows.map((r) => r['id']).toList();
      await _db.db.delete(
        'pending_positions',
        where: 'id IN (${List.filled(ids.length, '?').join(',')})',
        whereArgs: ids,
      );
      if (rows.length < _positionBatchSize) break;
    }
  }

  Future<_PhotoOutcome> _uploadPhoto(String path) async {
    if (!File(path).existsSync()) return const _PhotoOutcome(_PhotoStatus.missingFile);
    final fileId = await _api.uploadFile(path);
    return fileId == null
        ? const _PhotoOutcome(_PhotoStatus.failed)
        : _PhotoOutcome(_PhotoStatus.uploaded, fileId);
  }

  void _notify() {
    if (!_changes.isClosed) _changes.add(null);
  }
}

enum _PhotoStatus { uploaded, missingFile, failed }

class _PhotoOutcome {
  const _PhotoOutcome(this.status, [this.fileId]);
  final _PhotoStatus status;
  final String? fileId;
}
