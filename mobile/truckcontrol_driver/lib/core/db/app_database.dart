import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Local buffer for the offline-first flow (TZ §3.1): everything is written
/// here first and synced to the server when connectivity allows.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  static Future<AppDatabase> open({String? path}) async {
    final dbPath = path ?? p.join(await getDatabasesPath(), 'truckcontrol.db');
    final db = await openDatabase(
      dbPath,
      version: 1,
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
    );
    return AppDatabase._(db);
  }

  Future<void> close() => db.close();
}
