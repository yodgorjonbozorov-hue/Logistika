import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Sync state of a locally buffered row.
///
/// The old schema had a single `synced` flag, and the sync code set it to 1 for
/// REJECTED events too — the server had refused them, nothing was stored on
/// either side, and the driver's work silently disappeared (H-11). A rejection
/// is a distinct outcome from success and has to be recorded as one.
class SyncState {
  static const pending = 'pending';
  static const synced = 'synced';

  /// The server refused it and will refuse it again (wrong trip, not this
  /// driver's). Kept locally, never auto-retried, surfaced to the driver.
  static const rejected = 'rejected';

  /// Ran out of retry attempts. Kept, shown, retryable by hand.
  static const failed = 'failed';
}

/// Local buffer for the offline-first flow (TZ §3.1): everything is written
/// here first and synced to the server when connectivity allows.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  static const _version = 2;

  static Future<AppDatabase> open({String? path}) async {
    final dbPath = path ?? p.join(await getDatabasesPath(), 'truckcontrol.db');
    final db = await openDatabase(
      dbPath,
      version: _version,
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
            sync_state TEXT NOT NULL DEFAULT '${SyncState.pending}',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            last_attempt_at TEXT,
            created_at TEXT NOT NULL
          )
        ''');
        await db.execute(
          'CREATE INDEX idx_pending_events_state ON pending_events (sync_state, created_at)',
        );
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
        await db.execute(
          'CREATE INDEX idx_pending_positions_synced ON pending_positions (synced, recorded_at)',
        );
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        // An upgrade runs on a phone that already holds the driver's unsynced
        // work. Add columns, never rebuild the table.
        if (oldVersion < 2) {
          await db.execute(
            "ALTER TABLE pending_events ADD COLUMN sync_state TEXT NOT NULL "
            "DEFAULT '${SyncState.pending}'",
          );
          await db.execute('ALTER TABLE pending_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
          await db.execute('ALTER TABLE pending_events ADD COLUMN last_error TEXT');
          await db.execute('ALTER TABLE pending_events ADD COLUMN last_attempt_at TEXT');
          // Rows already marked synced keep that meaning.
          await db.execute(
            "UPDATE pending_events SET sync_state = '${SyncState.synced}' WHERE synced = 1",
          );
          await db.execute(
            'CREATE INDEX IF NOT EXISTS idx_pending_events_state '
            'ON pending_events (sync_state, created_at)',
          );
          await db.execute(
            'CREATE INDEX IF NOT EXISTS idx_pending_positions_synced '
            'ON pending_positions (synced, recorded_at)',
          );
        }
      },
    );
    return AppDatabase._(db);
  }

  Future<void> close() => db.close();
}
