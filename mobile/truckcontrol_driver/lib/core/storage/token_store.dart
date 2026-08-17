import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Token storage.
///
/// Tokens live in the platform keystore (iOS Keychain / Android
/// EncryptedSharedPreferences), not in SharedPreferences: a driver's phone is a
/// work tool that gets rooted, backed up and handed around, and a plaintext
/// 30-day refresh token in a backup is a permanent account takeover.
///
/// The locale stays in SharedPreferences — it is a display preference, and
/// reading it synchronously keeps the first frame simple.
class TokenStore {
  TokenStore(this._prefs, {FlutterSecureStorage? secureStorage})
      : _secure = secureStorage ??
            const FlutterSecureStorage(
              // Android encrypts by default in v11 (AES-GCM via the KeyStore).
              // first_unlock keeps the token readable to the background GPS
              // service after a reboot, without exposing it on a locked phone.
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  static const _accessKey = 'tc.access';
  static const _refreshKey = 'tc.refresh';
  static const _localeKey = 'tc.locale';

  final SharedPreferences _prefs;
  final FlutterSecureStorage _secure;

  String? _access;
  String? _refresh;

  /// Reads the keystore once at startup; callers use the cached values, which
  /// keeps the request path synchronous.
  Future<void> load() async {
    _access = await _secure.read(key: _accessKey);
    _refresh = await _secure.read(key: _refreshKey);
    await _migrateFromSharedPreferences();
  }

  /// Older builds kept tokens in SharedPreferences. Move them across once and
  /// wipe the plaintext copy, so an upgrade does not silently sign the driver
  /// out mid-trip and does not leave the old copy behind either.
  Future<void> _migrateFromSharedPreferences() async {
    final legacyAccess = _prefs.getString(_accessKey);
    final legacyRefresh = _prefs.getString(_refreshKey);
    if (legacyAccess == null && legacyRefresh == null) return;

    if (_refresh == null && legacyRefresh != null) {
      await save(legacyAccess ?? '', legacyRefresh);
    }
    await _prefs.remove(_accessKey);
    await _prefs.remove(_refreshKey);
  }

  String? get accessToken => _access;
  String? get refreshToken => _refresh;
  bool get isLoggedIn => _refresh != null;

  String get locale => _prefs.getString(_localeKey) ?? 'uz-latn';

  Future<void> save(String access, String refresh) async {
    _access = access;
    _refresh = refresh;
    await _secure.write(key: _accessKey, value: access);
    await _secure.write(key: _refreshKey, value: refresh);
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
    await _secure.delete(key: _accessKey);
    await _secure.delete(key: _refreshKey);
  }

  Future<void> setLocale(String locale) => _prefs.setString(_localeKey, locale);
}
