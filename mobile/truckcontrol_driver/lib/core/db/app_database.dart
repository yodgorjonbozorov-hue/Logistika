import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Local buffer for the offline-first flow (TZ §3.1): everything is written
/// here first and synced to the server when connectivity allows.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  /// Bumped whenever the local schema changes — every version needs a matching
  /// step in [_upgrade], because a driver's phone carries unsent work that must
  /// survive the app update (TASK-1.2).
  static const schemaVersion = 2;

  static Future<AppDatabase> open({String? path}) async {
    final dbPath = path ?? p.join(await getDatabasesPath(), 'truckcontrol.db');
    final db = await openDatabase(
      dbPath,
      version: schemaVersion,
      onCreate: (db, version) async {
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
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            last_attempt_at TEXT,
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
      onUpgrade: _upgrade,
    );
    return AppDatabase._(db);
  }

  /// Existing rows keep their data; the new retry columns start at their
  /// defaults, so a queued event that was never sent is simply retried.
  static Future<void> _upgrade(Database db, int from, int to) async {
    if (from < 2) {
      await db.execute(
        'ALTER TABLE pending_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
      );
      await db.execute('ALTER TABLE pending_events ADD COLUMN last_error TEXT');
      await db.execute('ALTER TABLE pending_events ADD COLUMN last_attempt_at TEXT');
    }
  }

  Future<void> close() => db.close();
}
