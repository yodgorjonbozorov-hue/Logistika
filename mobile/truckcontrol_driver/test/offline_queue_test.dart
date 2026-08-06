import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
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
    SharedPreferences.setMockInitialValues({
      'tc.access': 'test-access',
      'tc.refresh': 'test-refresh',
    });
    tokens = TokenStore(await SharedPreferences.getInstance());
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
