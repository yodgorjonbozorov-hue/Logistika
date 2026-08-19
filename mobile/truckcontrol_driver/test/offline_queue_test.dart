import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truckcontrol_driver/core/api/api_client.dart';
import 'package:truckcontrol_driver/core/db/app_database.dart';
import 'package:truckcontrol_driver/core/storage/token_store.dart';
import 'package:truckcontrol_driver/core/sync/offline_queue.dart';

/// In-memory stand-in for the platform keystore.
class FakeSecretStore implements SecretStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

String envelope(Map<String, dynamic> data) => jsonEncode({
      'success': true,
      'data': data,
      'error': null,
      'meta': null,
    });

void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  late AppDatabase db;
  late TokenStore tokens;
  late FakeSecretStore secrets;

  setUp(() async {
    db = await AppDatabase.open(path: inMemoryDatabasePath);
    SharedPreferences.setMockInitialValues({});
    secrets = FakeSecretStore()
      ..values['tc.access'] = 'test-access'
      ..values['tc.refresh'] = 'test-refresh';
    tokens = TokenStore(await SharedPreferences.getInstance(), secrets: secrets);
    await tokens.load();
  });

  tearDown(() => db.close());

  OfflineQueue queueWith(http.Client client) =>
      OfflineQueue(db, ApiClient(tokens, httpClient: client), tokens);

  final offline = MockClient((_) async => throw Exception('offline'));

  // ---------------------------------------------------------------------------
  // Baseline offline-first behaviour
  // ---------------------------------------------------------------------------

  test('events are buffered locally first and survive a dead network', () async {
    final queue = queueWith(offline);

    await queue.enqueueEvent(tripId: 'trip-1', eventType: 'REFUEL', comment: 'Litr: 302');
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(await queue.pendingEventCount(), 1);
    final rows = await queue.recentEvents();
    expect(rows.single.eventType, 'REFUEL');
    expect(rows.single.syncState, SyncState.pending);
    expect(rows.single.isSynced, isFalse);
  });

  test('syncAll sends an idempotent batch and marks accepted+duplicates as synced', () async {
    final offlineQueue = queueWith(offline);
    final id1 = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'START');
    final id2 = await offlineQueue.enqueueEvent(tripId: 'trip-1', eventType: 'LOADED');
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(await offlineQueue.pendingEventCount(), 2);

    final sentBodies = <Map<String, dynamic>>[];
    final onlineQueue = queueWith(MockClient((request) async {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      sentBodies.add(body);
      final ids = (body['events'] as List).map((e) => e['clientEventId']).toList();
      return http.Response(
        envelope({
          'accepted': [ids.first],
          'duplicates': ids.skip(1).toList(),
          'rejected': [],
        }),
        200,
      );
    }));
    await onlineQueue.syncAll();

    expect(await onlineQueue.pendingEventCount(), 0);
    final batch = sentBodies.first['events'] as List;
    final ids = batch.map((e) => e['clientEventId']).toSet();
    expect(ids, containsAll({id1, id2}));
    expect(id1, matches(RegExp(r'^[0-9a-f-]{36}$')));

    for (final event in await onlineQueue.recentEvents()) {
      expect(event.syncState, SyncState.synced);
    }
  });

  test('GPS points buffer and flush as one positions batch', () async {
    String? sentPath;
    late Map<String, dynamic> sentBody;
    final queue = queueWith(MockClient((request) async {
      sentPath = request.url.path;
      sentBody = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(envelope({'accepted': 2, 'dropped': 0}), 200);
    }));

    await queue.enqueuePosition(tripId: 'trip-1', lat: 40.1, lng: 67.8, speed: 72);
    await queue.enqueuePosition(tripId: 'trip-1', lat: 40.2, lng: 67.9);
    await queue.syncAll();

    expect(sentPath, endsWith('/tracking/positions'));
    expect((sentBody['positions'] as List).length, 2);
    expect(await queue.pendingPositionCount(), 0);
  });

  // ---------------------------------------------------------------------------
  // H-11 — a rejected event is NOT a delivered event
  // ---------------------------------------------------------------------------

  group('H-11 rejected events are never silently marked as sent', () {
    Future<String> enqueueOne() async {
      final queue = queueWith(offline);
      final id = await queue.enqueueEvent(tripId: 'trip-1', eventType: 'REFUEL', comment: 'Litr: 302');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      return id;
    }

    test('a rejected event keeps its data and is flagged, not marked synced', () async {
      final id = await enqueueOne();
      final queue = queueWith(MockClient((_) async => http.Response(
            envelope({
              'accepted': [],
              'duplicates': [],
              'rejected': [
                {'clientEventId': id, 'code': 'NOT_FOUND'},
              ],
            }),
            200,
          )));

      await queue.syncAll();

      final events = await queue.recentEvents();
      expect(events, hasLength(1));
      expect(events.single.syncState, SyncState.rejected);
      expect(events.single.isSynced, isFalse);
      expect(events.single.needsAttention, isTrue);
      expect(events.single.lastError, 'NOT_FOUND');
      // The driver's actual work is still here.
      expect(events.single.comment, 'Litr: 302');
      expect(events.single.eventType, 'REFUEL');
    });

    test('a rejected event surfaces in problemEvents for the driver', () async {
      final id = await enqueueOne();
      final queue = queueWith(MockClient((_) async => http.Response(
            envelope({
              'accepted': [],
              'duplicates': [],
              'rejected': [
                {'clientEventId': id, 'code': 'NOT_FOUND'},
              ],
            }),
            200,
          )));
      await queue.syncAll();

      expect(await queue.problemEventCount(), 1);
      expect((await queue.problemEvents()).single.clientEventId, id);
    });

    test('a rejected event is not resent forever', () async {
      final id = await enqueueOne();
      var batches = 0;
      final queue = queueWith(MockClient((_) async {
        batches++;
        return http.Response(
          envelope({
            'accepted': [],
            'duplicates': [],
            'rejected': [
              {'clientEventId': id, 'code': 'NOT_FOUND'},
            ],
          }),
          200,
        );
      }));

      await queue.syncAll();
      await queue.syncAll();
      await queue.syncAll();

      // Only the first pass sends it; afterwards it waits for the driver.
      expect(batches, 1);
      expect(await queue.pendingEventCount(), 0);
      expect(await queue.problemEventCount(), 1);
    });

    test('the driver can put a rejected event back in the queue', () async {
      final id = await enqueueOne();
      var reject = true;
      final queue = queueWith(MockClient((_) async => http.Response(
            envelope({
              'accepted': reject ? <String>[] : [id],
              'duplicates': [],
              'rejected': reject
                  ? [
                      {'clientEventId': id, 'code': 'NOT_FOUND'},
                    ]
                  : [],
            }),
            200,
          )));

      await queue.syncAll();
      expect(await queue.problemEventCount(), 1);

      reject = false;
      await queue.retryEvent(id);
      await queue.syncAll();

      expect(await queue.problemEventCount(), 0);
      expect((await queue.recentEvents()).single.syncState, SyncState.synced);
    });

    test('only an explicit discard removes an event', () async {
      final id = await enqueueOne();
      final queue = queueWith(MockClient((_) async => http.Response(
            envelope({
              'accepted': [],
              'duplicates': [],
              'rejected': [
                {'clientEventId': id, 'code': 'NOT_FOUND'},
              ],
            }),
            200,
          )));
      await queue.syncAll();
      expect(await queue.recentEvents(), hasLength(1));

      await queue.discardEvent(id);
      expect(await queue.recentEvents(), isEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // H-12 — nothing is lost when the network fails mid-flow
  // ---------------------------------------------------------------------------

  group('H-12 no data loss on failure', () {
    test('a failed batch leaves every event pending and retryable', () async {
      final queue = queueWith(offline);
      await queue.enqueueEvent(tripId: 'trip-1', eventType: 'START');
      await queue.enqueueEvent(tripId: 'trip-1', eventType: 'LOADED');
      await Future<void>.delayed(const Duration(milliseconds: 50));

      await queue.syncAll();

      expect(await queue.pendingEventCount(), 2);
      for (final event in await queue.recentEvents()) {
        expect(event.syncState, SyncState.pending);
        expect(event.attempts, greaterThan(0)); // the attempt was recorded
      }
    });

    test('an event whose photo cannot be uploaded is held back, not sent without it', () async {
      final file = await _writeTempPhoto();
      final queue0 = queueWith(offline);
      await queue0.enqueueEvent(
        tripId: 'trip-1',
        eventType: 'REFUEL',
        photoPath: file.path,
        comment: 'chek',
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));

      var batchCalls = 0;
      final queue = queueWith(MockClient((request) async {
        if (request.url.path.endsWith('/files/upload')) {
          return http.Response('upstream exploded', 502);
        }
        batchCalls++;
        return http.Response(envelope({'accepted': [], 'duplicates': [], 'rejected': []}), 200);
      }));

      await queue.syncAll();

      // Sending it now would book a receipt-less expense and orphan the photo.
      expect(batchCalls, 0);
      expect(await queue.pendingEventCount(), 1);
      final event = (await queue.recentEvents()).single;
      expect(event.photoPath, file.path);
      expect(event.lastError, contains('photo'));

      await file.delete();
    });

    test('an event whose photo file vanished is still delivered', () async {
      final file = await _writeTempPhoto();
      final queue0 = queueWith(offline);
      final id = await queue0.enqueueEvent(
        tripId: 'trip-1',
        eventType: 'REFUEL',
        photoPath: file.path,
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await file.delete(); // the OS reclaimed the cache directory

      Map<String, dynamic>? sentBody;
      final queue = queueWith(MockClient((request) async {
        if (request.url.path.endsWith('/files/upload')) {
          fail('should not try to upload a file that no longer exists');
        }
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          envelope({'accepted': [id], 'duplicates': [], 'rejected': []}),
          200,
        );
      }));

      await queue.syncAll();

      expect(sentBody, isNotNull);
      expect((sentBody!['events'] as List).single['photoFileIds'], isNull);
      expect(await queue.pendingEventCount(), 0);
    });

    test('a successful photo upload attaches the returned file id exactly once', () async {
      final file = await _writeTempPhoto();
      final queue0 = queueWith(offline);
      final id = await queue0.enqueueEvent(
        tripId: 'trip-1',
        eventType: 'EXPENSE',
        photoPath: file.path,
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));

      var uploads = 0;
      Map<String, dynamic>? sentBody;
      final queue = queueWith(MockClient((request) async {
        if (request.url.path.endsWith('/files/upload')) {
          uploads++;
          return http.Response(envelope({'id': 'file-123', 'mimeType': 'image/jpeg'}), 201);
        }
        sentBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          envelope({'accepted': [id], 'duplicates': [], 'rejected': []}),
          200,
        );
      }));

      await queue.syncAll();
      await queue.syncAll(); // a second pass must not re-upload

      expect(uploads, 1);
      expect((sentBody!['events'] as List).single['photoFileIds'], ['file-123']);
      await file.delete();
    });

    test('GPS points are deleted only after the server accepted them', () async {
      final queue = queueWith(offline);
      await queue.enqueuePosition(tripId: 'trip-1', lat: 40.1, lng: 67.8);
      await queue.syncAll();
      expect(await queue.pendingPositionCount(), 1);

      final onlineQueue = queueWith(MockClient(
        (_) async => http.Response(envelope({'accepted': 1, 'dropped': 0}), 200),
      ));
      await onlineQueue.syncAll();
      expect(await onlineQueue.pendingPositionCount(), 0);
    });

    test('a large backlog drains in one sync pass instead of one batch per pass', () async {
      final queue0 = queueWith(offline);
      for (var i = 0; i < 250; i++) {
        await queue0.enqueuePosition(tripId: 'trip-1', lat: 40.0 + i / 1000, lng: 67.0);
      }

      var batches = 0;
      final queue = queueWith(MockClient((request) async {
        if (request.url.path.endsWith('/tracking/positions')) batches++;
        return http.Response(envelope({'accepted': 1, 'dropped': 0}), 200);
      }));
      await queue.syncAll();

      expect(await queue.pendingPositionCount(), 0);
      expect(batches, 1); // 250 < the 500-point batch size
    });
  });

  // ---------------------------------------------------------------------------
  // H-16 — session tokens never touch plain SharedPreferences
  // ---------------------------------------------------------------------------

  group('H-16 token storage', () {
    test('tokens are written to the keystore, not to SharedPreferences', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final store = FakeSecretStore();
      final tokenStore = TokenStore(prefs, secrets: store);
      await tokenStore.load();

      await tokenStore.save('access-value', 'refresh-value');

      expect(store.values['tc.access'], 'access-value');
      expect(store.values['tc.refresh'], 'refresh-value');
      expect(prefs.getString('tc.access'), isNull);
      expect(prefs.getString('tc.refresh'), isNull);
      expect(prefs.getKeys(), isNot(contains('tc.refresh')));
    });

    test('an existing plaintext session is migrated and the plaintext removed', () async {
      SharedPreferences.setMockInitialValues({
        'tc.access': 'legacy-access',
        'tc.refresh': 'legacy-refresh',
      });
      final prefs = await SharedPreferences.getInstance();
      final store = FakeSecretStore();
      final tokenStore = TokenStore(prefs, secrets: store);

      await tokenStore.load();

      expect(tokenStore.refreshToken, 'legacy-refresh');
      expect(store.values['tc.refresh'], 'legacy-refresh');
      // The insecure copy is gone — a migration that leaves it behind fixes nothing.
      expect(prefs.getString('tc.refresh'), isNull);
      expect(prefs.getString('tc.access'), isNull);
    });

    test('clear removes both tokens from the keystore', () async {
      SharedPreferences.setMockInitialValues({});
      final store = FakeSecretStore();
      final tokenStore = TokenStore(await SharedPreferences.getInstance(), secrets: store);
      await tokenStore.load();
      await tokenStore.save('a', 'b');

      await tokenStore.clear();

      expect(store.values, isEmpty);
      expect(tokenStore.isLoggedIn, isFalse);
    });

    test('the locale stays in SharedPreferences — it is not a secret', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final tokenStore = TokenStore(prefs, secrets: FakeSecretStore());
      await tokenStore.load();

      await tokenStore.setLocale('ru');

      expect(prefs.getString('tc.locale'), 'ru');
      expect(tokenStore.locale, 'ru');
    });
  });
}

/// A real file on disk: the queue checks `existsSync()`, so a fake path would
/// exercise the "photo vanished" branch rather than the upload branch.
Future<File> _writeTempPhoto() async {
  final dir = await Directory.systemTemp.createTemp('tc-photo');
  final file = File('${dir.path}/receipt.jpg');
  await file.writeAsBytes([0xff, 0xd8, 0xff, 0x00]); // JPEG magic bytes
  return file;
}
