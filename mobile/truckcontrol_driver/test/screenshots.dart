import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:truckcontrol_driver/core/api/api_client.dart';
import 'package:truckcontrol_driver/core/db/app_database.dart';
import 'package:truckcontrol_driver/core/gps/gps_service.dart';
import 'package:truckcontrol_driver/core/storage/token_store.dart';
import 'package:truckcontrol_driver/core/sync/offline_queue.dart';
import 'package:truckcontrol_driver/features/events/event_definitions.dart';
import 'package:truckcontrol_driver/main.dart';

/// Renders every screen of the driver app to PNG — `screenshots/`.
///
/// This is a generator, not a check, which is why the file is `screenshots.dart`
/// and not `*_test.dart`: `flutter test` skips it, and golden images depend on
/// the host's font rasterisation, so comparing them across machines would fail
/// for reasons that have nothing to do with the app.
///
///   flutter test test/screenshots.dart --update-goldens
///
/// The app itself is unmodified: the real `TruckControlApp` is mounted with the
/// same widgets a phone runs. Only the outside world is faked — the API answers
/// from a canned map, the database is in-memory, and no plugin is touched.
void main() {
  sqfliteFfiInit();
  // No isolate: a widget test runs inside FakeAsync, and work handed to another
  // isolate never comes back there — the screens would sit on "loading" forever.
  databaseFactory = databaseFactoryFfiNoIsolate;

  // A phone, not a tablet: 360 × 780 logical pixels at 3×.
  const size = Size(1080, 2340);
  const pixelRatio = 3.0;

  setUpAll(_loadFonts);

  Future<void> shoot(WidgetTester tester, String name) async {
    await expectLater(
      find.byType(TruckControlApp),
      matchesGoldenFile('../screenshots/$name.png'),
    );
  }

  /// Mounts the real app with a fake outside world.
  Future<_Harness> pumpApp(
    WidgetTester tester, {
    bool loggedIn = true,
    String locale = 'uz-latn',
    List<dynamic> trips = const [],
    List<dynamic> messages = const [],
    Future<void> Function(OfflineQueue queue, AppDatabase db)? seedQueue,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = pixelRatio;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({
      'tc.locale': locale,
      if (loggedIn) 'tc.access': 'demo-access',
      if (loggedIn) 'tc.refresh': 'demo-refresh',
    });
    final tokens = TokenStore(await SharedPreferences.getInstance());
    final db = await AppDatabase.open(path: inMemoryDatabasePath);
    addTearDown(db.close);

    final api = ApiClient(
      tokens,
      baseUrl: 'http://screenshots.test/api/v1',
      httpClient: _fakeApi(trips, messages: messages),
    );
    // `start()` is deliberately not called: it subscribes to connectivity_plus,
    // and no plugin is available in a widget test.
    final queue = OfflineQueue(db, api, tokens);
    if (seedQueue != null) await seedQueue(queue, db);

    await tester.pumpWidget(
      TruckControlApp(tokens: tokens, api: api, queue: queue, gps: GpsService(queue)),
    );
    await tester.pumpAndSettle();
    return _Harness(db: db, queue: queue);
  }

  // ---------- E-1 login ----------

  testWidgets('01 login, phone step', (tester) async {
    await pumpApp(tester, loggedIn: false);
    await shoot(tester, '01-login-phone');
  });

  testWidgets('02 login, SMS code step', (tester) async {
    await pumpApp(tester, loggedIn: false);
    await tester.enterText(find.byType(TextField).first, '+998901234567');
    await tester.tap(find.byType(ElevatedButton));
    await tester.pumpAndSettle();
    await shoot(tester, '02-login-code');
  });

  // ---------- E-2 / E-3 trip and the ten buttons ----------

  testWidgets('03 trip tab with no assigned trip', (tester) async {
    await pumpApp(tester);
    await shoot(tester, '03-trip-empty');
  });

  testWidgets('04 trip tab with an active trip and the ten buttons', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await shoot(tester, '04-trip-active');
  });

  // One sheet per input shape: odometer+photo, fuel fields, amount, bare.
  for (final entry in const {
    '05-event-start': 'START',
    '06-event-refuel': 'REFUEL',
    '07-event-expense': 'EXPENSE',
    '08-event-rest': 'REST',
  }.entries) {
    testWidgets('${entry.key} sheet', (tester) async {
      await pumpApp(tester, trips: [_trip]);
      final definition = eventDefinitions.firstWhere((d) => d.type == entry.value);
      await tester.tap(find.byIcon(definition.icon).first);
      await tester.pumpAndSettle();
      await shoot(tester, entry.key);
    });
  }

  // ---------- E-4 trip chat ----------

  testWidgets('09 chat with the logist', (tester) async {
    await pumpApp(tester, trips: [_trip], messages: _messages);
    await tester.tap(find.byIcon(Icons.forum));
    await tester.pumpAndSettle();
    await shoot(tester, '09-chat');
  });

  testWidgets('10 chat before anyone has written', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await tester.tap(find.byIcon(Icons.forum));
    await tester.pumpAndSettle();
    await shoot(tester, '10-chat-empty');
  });

  // ---------- E-5 my entries ----------

  testWidgets('11 expenses tab, nothing recorded yet', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await tester.tap(find.byIcon(Icons.receipt_long));
    await tester.pumpAndSettle();
    await shoot(tester, '11-expenses-empty');
  });

  testWidgets('12 expenses tab, sent and still queued', (tester) async {
    await pumpApp(tester, trips: [_trip], seedQueue: _seedEvents);
    await tester.tap(find.byIcon(Icons.receipt_long));
    await tester.pumpAndSettle();
    await shoot(tester, '12-expenses-list');
  });

  // ---------- E-6 documents ----------

  testWidgets('13 documents tab', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await tester.tap(find.byIcon(Icons.folder));
    await tester.pumpAndSettle();
    await shoot(tester, '13-documents');
  });

  // ---------- E-7 profile ----------

  testWidgets('14 profile, everything synced', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await tester.tap(find.byIcon(Icons.person));
    await tester.pumpAndSettle();
    await shoot(tester, '14-profile-synced');
  });

  testWidgets('15 profile with queued events waiting for network', (tester) async {
    await pumpApp(tester, trips: [_trip], seedQueue: _seedEvents);
    await tester.tap(find.byIcon(Icons.person));
    await tester.pumpAndSettle();
    await shoot(tester, '15-profile-pending');
  });

  testWidgets('16 profile, language picker open', (tester) async {
    await pumpApp(tester, trips: [_trip]);
    await tester.tap(find.byIcon(Icons.person));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await shoot(tester, '16-profile-language');
  });

  // ---------- All three languages ----------

  for (final entry in const {
    '17-trip-uz-cyrl': 'uz-cyrl',
    '18-trip-ru': 'ru',
  }.entries) {
    testWidgets('${entry.key} trip tab', (tester) async {
      await pumpApp(tester, locale: entry.value, trips: [_trip]);
      await shoot(tester, entry.key);
    });
  }

  for (final entry in const {
    '19-profile-uz-cyrl': 'uz-cyrl',
    '20-profile-ru': 'ru',
  }.entries) {
    testWidgets('${entry.key} profile tab', (tester) async {
      await pumpApp(tester, locale: entry.value, trips: [_trip]);
      await tester.tap(find.byIcon(Icons.person));
      await tester.pumpAndSettle();
      await shoot(tester, entry.key);
    });
  }

  testWidgets('21 login in Russian', (tester) async {
    await pumpApp(tester, loggedIn: false, locale: 'ru');
    await shoot(tester, '21-login-ru');
  });
}

class _Harness {
  _Harness({required this.db, required this.queue});

  final AppDatabase db;
  final OfflineQueue queue;
}

/// The trip a driver would actually be looking at.
const _trip = {
  'id': '00000000-0000-4000-8000-000000000001',
  'tripNumber': '128',
  'status': 'ASSIGNED',
  'cargoName': 'Paxta tolasi',
  'loadingAddress': 'Toshkent',
  'unloadingAddress': 'Samarqand',
  'vehicle': {'plateNumber': '01 A 777 AA'},
  'driverAdvance': '50000000',
};

/// A short conversation, as a driver would find it after a delivery question.
/// Text only: `Image.network` cannot fetch anything in a widget test, so a photo
/// bubble here would render its own failure message rather than a photo.
final _messages = <Map<String, dynamic>>[
  {
    'id': 'm1',
    'mine': false,
    'senderName': 'Dilshod (logist)',
    'kind': 'TEXT',
    'body': 'Salom! Samarqandga qachon yetib borasiz?',
    'createdAt': '2026-08-17T09:12:00.000Z',
  },
  {
    'id': 'm2',
    'mine': true,
    'senderName': null,
    'kind': 'TEXT',
    'body': "Kechqurun 18:00 larda bo'laman, hozir Jizzax yaqinidaman.",
    'createdAt': '2026-08-17T09:15:00.000Z',
  },
  {
    'id': 'm3',
    'mine': false,
    'senderName': 'Dilshod (logist)',
    'kind': 'TEXT',
    'body': "Rahmat. Yuk topshirilgach chekni suratga olib yuboring.",
    'createdAt': '2026-08-17T09:16:00.000Z',
  },
];

/// A rating with something to look at: a couple of late trips and a small fuel
/// overrun, so the card shows how the score is made rather than a bare 5.00.
const _rating = {
  'driverId': '00000000-0000-4000-8000-0000000000f2',
  'driverName': 'Sanjar Rahimov',
  'ratingCentis': 437,
  'trips': 24,
  'lateTrips': 2,
  'breakdowns': 1,
  'fuelDeviationBp': 420,
  'penalties': {'lateness': 13, 'fuel': 0, 'breakdowns': 6},
  'lateShareBp': 833,
  'breakdownRateBp': 417,
};

/// Two entries already sent, one still waiting for a network.
Future<void> _seedEvents(OfflineQueue queue, AppDatabase db) async {
  await queue.enqueueEvent(
    tripId: _trip['id']! as String,
    eventType: 'START',
    odometer: 184320,
    comment: null,
  );
  await queue.enqueueEvent(
    tripId: _trip['id']! as String,
    eventType: 'REFUEL',
    comment: "Litr: 180 · Summa (so'm): 2340000",
  );
  await queue.enqueueEvent(
    tripId: _trip['id']! as String,
    eventType: 'REST',
    comment: 'Chorvoq oshxonasi',
  );
  // The first two made it to the server; the last one is still queued, which is
  // what gives the tab its two different cloud icons.
  await db.db.rawUpdate(
    "UPDATE pending_events SET synced = 1 WHERE event_type IN ('START', 'REFUEL')",
  );
}

/// The whole backend, as far as these screens are concerned.
http.Client _fakeApi(List<dynamic> trips, {List<dynamic> messages = const []}) {
  return MockClient((request) async {
    final path = request.url.path;
    Object? data;
    if (path.endsWith('/trips/my')) {
      data = trips;
    } else if (path.endsWith('/chat/messages') || path.contains('/chat/')) {
      data = path.endsWith('/unread')
          ? {'unread': messages.where((m) => (m as Map)['mine'] != true).length}
          : path.endsWith('/read')
              ? {'read': 0}
              : messages;
    } else if (path.endsWith('/drivers/me/rating')) {
      data = _rating;
    } else if (path.endsWith('/auth/me')) {
      data = {
        'id': '00000000-0000-4000-8000-0000000000f1',
        'fullName': 'Sanjar Rahimov',
        'phone': '+998 90 123 45 67',
        'role': 'DRIVER',
      };
    } else if (path.endsWith('/auth/driver/request-code')) {
      data = {'sent': true};
    } else if (path.endsWith('/auth/driver/verify')) {
      data = {'accessToken': 'demo-access', 'refreshToken': 'demo-refresh'};
    } else {
      // Anything else is the offline queue flushing itself: `enqueueEvent`
      // fires a sync, and an empty batch result leaves the seeded rows exactly
      // as the screenshot needs them.
      data = {'accepted': <String>[], 'duplicates': <String>[], 'rejected': <Object>[]};
    }
    return http.Response(
      jsonEncode({'success': true, 'data': data, 'error': null, 'meta': null}),
      200,
      headers: {'content-type': 'application/json'},
    );
  });
}

/// Widget tests ship no fonts, so without this every label renders as a box.
/// DejaVu goes on the end of the same family as a glyph fallback, for the
/// characters Roboto lacks — the "→" in a route line.
Future<void> _loadFonts() async {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) {
    throw StateError('FLUTTER_ROOT is unset; run this through `flutter test`.');
  }
  final fonts = Directory('$root/bin/cache/artifacts/material_fonts');

  // Every weight, not just the three the app names: the app asks for w600 and
  // w800, which the SDK does not ship, and a weight with no neighbours to
  // interpolate between falls back to the engine's box-drawing test font.
  final roboto = <String>[
    for (final weight in const [
      'Thin',
      'Light',
      'Regular',
      'Medium',
      'Bold',
      'Black',
    ])
      '${fonts.path}/Roboto-$weight.ttf',
    // Optional: a machine without DejaVu simply loses the arrow glyph.
    ...const [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ].where((path) => File(path).existsSync()),
  ];
  await _load('Roboto', roboto);
  await _load('MaterialIcons', ['${fonts.path}/MaterialIcons-Regular.otf']);

}

Future<void> _load(String family, List<String> paths) async {
  final loader = FontLoader(family);
  for (final path in paths) {
    final bytes = File(path).readAsBytesSync();
    loader.addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
  }
  await loader.load();
}
