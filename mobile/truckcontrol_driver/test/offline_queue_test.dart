import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truckcontrol_driver/core/api/api_client.dart';
import 'package:truckcontrol_driver/core/db/app_database.dart';
import 'package:truckcontrol_driver/core/storage/token_store.dart';
import 'package:truckcontrol_driver/core/sync/offline_queue.dart';

void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  late AppDatabase db;
  late TokenStore tokens;

  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath);
    SharedPreferences.setMockInitialValues({});
    // Tokens live in the platform keystore now, not SharedPreferences.
    FlutterSecureStorage.setMockInitialValues({
      'tc.access': 'test-access',
      'tc.refresh': 'test-refresh',
    });
    tokens = TokenStore(await SharedPreferences.getInstance());
    await tokens.load();
  });

  tearDown(() => db.close());

  OfflineQueue queueWith(http.Client client) =>
      OfflineQueue(db, ApiClient(tokens, httpClient: client), tokens);

  test('events are buffered locally first and survive a dead network', () async {
    final queue = queueWith(MockClient((_) async => throw Exception('offline')));

    await queue.enqueueEvent(tripId: 'trip-1', eventType: 'REFUEL', comment: 'Litr: 302');
    // enqueueEvent fires an async sync that fails — give it a beat.
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(await queue.pendingEventCount(), 1);
    final rows = await queue.recentEvents();
    expect(rows.single['event_type'], 'REFUEL');
    expect(rows.single['synced'], 0);
  });

  test('syncAll sends an idempotent batch and marks accepted+duplicates as synced', () async {
    // Buffer two events while "offline" (the auto-sync fails silently)…
    final offlineQueue = queueWith(MockClient((_) async => throw Exception('offline')));
    final id1 = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'START');
    final id2 = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'LOADED');
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(await offlineQueue.pendingEventCount(), 2);

    // …then the network returns: one accepted, one already known (duplicate).
    final sentBodies = <Map<String, dynamic>>[];
    final onlineQueue = queueWith(MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      sentBodies.add(body);
      final ids = (body['events'] as List).map((e) => e['clientEventId']).toList();
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {
            'accepted': [ids.first],
            'duplicates': ids.skip(1).toList(),
            'rejected': [],
          },
          'error': null,
          'meta': null,
        }),
        200,
      );
    }));
    await onlineQueue.syncAll();

    expect(await onlineQueue.pendingEventCount(), 0);
    final batch = sentBodies.first['events'] as List;
    final ids = batch.map((e) => e['clientEventId']).toSet();
    expect(ids, containsAll({id1, id2}));
    // Client UUIDs are real UUIDs (the server-side idempotency key).
    expect(id1, matches(RegExp(r'^[0-9a-f-]{36}$')));
  });

  test('rejected events stay queued and count a retry (never marked synced)', () async {
    final offlineQueue = queueWith(MockClient((_) async => throw Exception('offline')));
    final id = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'REFUEL');
    await Future<void>.delayed(const Duration(milliseconds: 50));

    // The logist reassigned the trip while the driver was offline → rejected.
    final queue = queueWith(MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final ids = (body['events'] as List).map((e) => e['clientEventId']).toList();
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {
            'accepted': [],
            'duplicates': [],
            'rejected': [
              for (final rejectedId in ids) {'clientEventId': rejectedId, 'code': 'NOT_FOUND'},
            ],
          },
          'error': null,
          'meta': null,
        }),
        200,
      );
    }));
    await queue.syncAll();

    final row = (await db.db
            .query('pending_events', where: 'client_event_id = ?', whereArgs: [id]))
        .single;
    expect(row['synced'], 0, reason: 'a rejected event must never be dropped');
    expect(row['retry_count'], 1);
    expect(row['last_error'], 'NOT_FOUND');
    expect(row['last_attempt_at'], isNotNull);
    expect(await queue.pendingEventCount(), 1);
  });

  test('a mistyped odometer waits for the driver at once, not in two hours', () async {
    final offlineQueue = queueWith(MockClient((_) async => throw Exception('offline')));
    final id = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'FINISH');
    await Future<void>.delayed(const Duration(milliseconds: 50));

    final queue = queueWith(MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final ids = (body['events'] as List).map((e) => e['clientEventId']).toList();
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {
            'accepted': [],
            'duplicates': [],
            'rejected': [
              for (final rejectedId in ids)
                {'clientEventId': rejectedId, 'code': 'ODOMETER_INVALID'},
            ],
          },
          'error': null,
          'meta': null,
        }),
        200,
      );
    }));
    await queue.syncAll();

    final row = (await db.db
            .query('pending_events', where: 'client_event_id = ?', whereArgs: [id]))
        .single;
    // Re-sending the same wrong number would be refused five more times over
    // two hours before the driver was ever told about it.
    expect(row['retry_count'], OfflineQueue.maxAutoRetries);
    expect(row['synced'], 0, reason: 'the finish must not be dropped');
    expect(await queue.needsAttentionCount(), 1);
  });

  test('an event stops retrying after maxAutoRetries and the driver can resend it', () async {
    final offlineQueue = queueWith(MockClient((_) async => throw Exception('offline')));
    final id = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'DELIVERED');
    await Future<void>.delayed(const Duration(milliseconds: 50));

    // Simulate a row that already exhausted its automatic attempts.
    await db.db.update(
      'pending_events',
      {'retry_count': OfflineQueue.maxAutoRetries, 'last_error': 'NOT_FOUND'},
      where: 'client_event_id = ?',
      whereArgs: [id],
    );

    var batches = 0;
    final queue = queueWith(MockClient((request) async {
      batches++;
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final ids = (body['events'] as List).map((e) => e['clientEventId']).toList();
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {'accepted': ids, 'duplicates': [], 'rejected': []},
          'error': null,
          'meta': null,
        }),
        200,
      );
    }));

    expect(await queue.needsAttentionCount(), 1);
    await queue.syncAll();
    expect(batches, 0, reason: 'automatic retries stop, the row waits for the driver');
    expect(await queue.pendingEventCount(), 1);

    await queue.retryFailedEvents();
    expect(batches, 1);
    expect(await queue.pendingEventCount(), 0);
    expect(await queue.needsAttentionCount(), 0);
  });

  test('purgeSynced removes only old synced rows', () async {
    final queue = queueWith(MockClient((_) async => throw Exception('offline')));
    final oldSynced = await queue.enqueueEvent(tripId: 'trip-1', eventType: 'START');
    final freshSynced = await queue.enqueueEvent(tripId: 'trip-1', eventType: 'LOADED');
    final unsent = await queue.enqueueEvent(tripId: 'trip-1', eventType: 'FINISH');
    await Future<void>.delayed(const Duration(milliseconds: 50));

    final longAgo = DateTime.now().toUtc().subtract(const Duration(days: 30));
    await db.db.update(
      'pending_events',
      {'synced': 1, 'created_at': longAgo.toIso8601String()},
      where: 'client_event_id = ?',
      whereArgs: [oldSynced],
    );
    await db.db.update(
      'pending_events',
      {'synced': 1},
      where: 'client_event_id = ?',
      whereArgs: [freshSynced],
    );

    expect(await queue.purgeSynced(), 1);

    final remaining = (await db.db.query('pending_events'))
        .map((row) => row['client_event_id'])
        .toSet();
    expect(remaining, {freshSynced, unsent});
  });

  test('an upgrade from schema v1 keeps queued events and adds the retry columns', () async {
    // A real file: the point of the test is reopening the same database.
    final dir = await Directory.systemTemp.createTemp('tc-upgrade');
    addTearDown(() => dir.delete(recursive: true));
    final dbPath = p.join(dir.path, 'truckcontrol.db');

    // v1 database with one unsent event, exactly as an older app build left it.
    final legacy = await databaseFactory.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute('''
            CREATE TABLE pending_events (
              client_event_id TEXT PRIMARY KEY,
              trip_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              event_time TEXT NOT NULL,
              lat REAL, lng REAL,
              odometer INTEGER,
              comment TEXT,
              photo_path TEXT,
              photo_file_id TEXT,
              synced INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            )
          ''');
          await db.execute('''
            CREATE TABLE pending_positions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              trip_id TEXT NOT NULL,
              lat REAL NOT NULL, lng REAL NOT NULL,
              speed REAL, heading REAL,
              recorded_at TEXT NOT NULL,
              synced INTEGER NOT NULL DEFAULT 0
            )
          ''');
        },
      ),
    );
    final now = DateTime.now().toUtc().toIso8601String();
    await legacy.insert('pending_events', {
      'client_event_id': 'legacy-1',
      'trip_id': 'trip-1',
      'event_type': 'REFUEL',
      'event_time': now,
      'synced': 0,
      'created_at': now,
    });
    await legacy.close();

    final upgraded = await AppDatabase.open(path: dbPath);
    addTearDown(upgraded.close);

    final row = (await upgraded.db
            .query('pending_events', where: 'client_event_id = ?', whereArgs: ['legacy-1']))
        .single;
    expect(row['event_type'], 'REFUEL');
    expect(row['retry_count'], 0);
    expect(row['last_error'], isNull);
  });

  test('GPS points buffer and flush as one positions batch', () async {
    String? sentPath;
    late Map<String, dynamic> sentBody;
    final queue = queueWith(MockClient((request) async {
      sentPath = request.url.path;
      sentBody = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {'accepted': 2, 'dropped': 0},
          'error': null,
          'meta': null,
        }),
        200,
      );
    }));

    await queue.enqueuePosition(tripId: 'trip-1', lat: 40.1, lng: 67.8, speed: 72);
    await queue.enqueuePosition(tripId: 'trip-1', lat: 40.2, lng: 67.9);
    await queue.syncAll();

    expect(sentPath, endsWith('/tracking/positions'));
    expect((sentBody['positions'] as List).length, 2);
    final remaining = await db.db
        .query('pending_positions', where: 'synced = 0');
    expect(remaining, isEmpty);
  });
}
