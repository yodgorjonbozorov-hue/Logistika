import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_scope.dart';
import 'core/api/api_client.dart';
import 'core/config.dart';
import 'core/db/app_database.dart';
import 'core/gps/gps_service.dart';
import 'core/i18n/app_strings.dart';
import 'core/storage/token_store.dart';
import 'core/sync/offline_queue.dart';
import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  AppConfig.assertSecureInRelease();
  final prefs = await SharedPreferences.getInstance();
  final tokens = TokenStore(prefs);
  final api = ApiClient(tokens);
  final db = await AppDatabase.open();
  final queue = OfflineQueue(db, api, tokens)..start();
  final gps = GpsService(queue);

  runApp(TruckControlApp(tokens: tokens, api: api, queue: queue, gps: gps));
}

class TruckControlApp extends StatefulWidget {
  const TruckControlApp({
    super.key,
    required this.tokens,
    required this.api,
    required this.queue,
    required this.gps,
  });

  final TokenStore tokens;
  final ApiClient api;
  final OfflineQueue queue;
  final GpsService gps;

  @override
  State<TruckControlApp> createState() => TruckControlAppState();
}

class TruckControlAppState extends State<TruckControlApp> {
  late String _locale = widget.tokens.locale;
  late bool _loggedIn = widget.tokens.isLoggedIn;

  @override
  void initState() {
    super.initState();
    widget.api.onSessionExpired = () => setLoggedIn(false);
  }

  void setLocale(String locale) {
    widget.tokens.setLocale(locale);
    setState(() => _locale = locale);
  }

  void setLoggedIn(bool value) => setState(() => _loggedIn = value);

  @override
  Widget build(BuildContext context) {
    return AppScope(
      tokens: widget.tokens,
      api: widget.api,
      queue: widget.queue,
      gps: widget.gps,
      child: MaterialApp(
        title: 'TruckControl AI',
        debugShowCheckedModeBanner: false,
        theme: buildDarkTheme(),
        localizationsDelegates: [
          AppStringsDelegate(_locale),
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('uz'), Locale('ru')],
        home: _loggedIn ? const HomeScreen() : const LoginScreen(),
      ),
    );
  }

  static TruckControlAppState of(BuildContext context) =>
      context.findAncestorStateOfType<TruckControlAppState>()!;
}
