import 'package:shared_preferences/shared_preferences.dart';

class TokenStore {
  TokenStore(this._prefs);

  static const _accessKey = 'tc.access';
  static const _refreshKey = 'tc.refresh';
  static const _localeKey = 'tc.locale';

  final SharedPreferences _prefs;

  String? get accessToken => _prefs.getString(_accessKey);
  String? get refreshToken => _prefs.getString(_refreshKey);
  bool get isLoggedIn => refreshToken != null;

  String get locale => _prefs.getString(_localeKey) ?? 'uz-latn';

  Future<void> save(String access, String refresh) async {
    await _prefs.setString(_accessKey, access);
    await _prefs.setString(_refreshKey, refresh);
  }

  Future<void> clear() async {
    await _prefs.remove(_accessKey);
    await _prefs.remove(_refreshKey);
  }

  Future<void> setLocale(String locale) => _prefs.setString(_localeKey, locale);
}
