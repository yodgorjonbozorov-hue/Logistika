import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truckcontrol_driver/core/db/app_database.dart';

/// The v1 → v2 upgrade runs on a phone that is already holding the driver's
/// unsynced work. Losing it during an app update would be exactly the failure
/// the sync-state change is meant to prevent, so the upgrade path is tested
/// against a real v1 database rather than assumed.
void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  /// Recreates the schema as it shipped before the sync-state columns existed.
  Future<Database> openLegacyV1(String path) async {
    return databaseFactory.openDatabase(
      path,
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
  }

  test('upgrading from v1 keeps every queued row and backfills the sync state', () async {
    final path = '${(await databaseFactory.getDatabasesPath())}/upgrade-test.db';
    await databaseFactory.deleteDatabase(path);

    // 1. An old install with one delivered and one still-queued event.
    final legacy = await openLegacyV1(path);
    final now = DateTime.now().toUtc().toIso8601String();
    await legacy.insert('pending_events', {
      'client_event_id': 'already-sent',
      'trip_id': 'trip-1',
      'event_type': 'START',
      'event_time': now,
      'synced': 1,
      'created_at': now,
    });
    await legacy.insert('pending_events', {
      'client_event_id': 'still-queued',
      'trip_id': 'trip-1',
      'event_type': 'REFUEL',
      'event_time': now,
      'comment': 'Litr: 302',
      'synced': 0,
      'created_at': now,
    });
    await legacy.insert('pending_positions', {
      'trip_id': 'trip-1',
      'lat': 41.3,
      'lng': 69.2,
      'recorded_at': now,
      'synced': 0,
    });
    await legacy.close();

    // 2. The app updates.
    final upgraded = await AppDatabase.open(path: path);

    // 3. Nothing was lost, and each row got the right state.
    final events = await upgraded.db.query('pending_events', orderBy: 'client_event_id');
    expect(events, hasLength(2));

    final sent = events.firstWhere((e) => e['client_event_id'] == 'already-sent');
    expect(sent['sync_state'], SyncState.synced);

    final queued = events.firstWhere((e) => e['client_event_id'] == 'still-queued');
    expect(queued['sync_state'], SyncState.pending);
    expect(queued['comment'], 'Litr: 302'); // the driver's own text survived
    expect(queued['attempts'], 0);

    expect(await upgraded.db.query('pending_positions'), hasLength(1));

    await upgraded.close();
    await databaseFactory.deleteDatabase(path);
  });

  test('a fresh install gets the v2 schema directly', () async {
    final db = await AppDatabase.open(path: inMemoryDatabasePath);
    final columns = await db.db.rawQuery('PRAGMA table_info(pending_events)');
    final names = columns.map((c) => c['name'] as String).toSet();

    expect(names, containsAll({'sync_state', 'attempts', 'last_error', 'last_attempt_at'}));
    await db.close();
  });
}
