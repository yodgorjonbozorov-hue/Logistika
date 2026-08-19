import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the driver's session lives.
///
/// Tokens used to sit in SharedPreferences — an XML file in the app sandbox,
/// readable by anyone with a rooted phone, an ADB backup or a file-manager app
/// with storage permission. A 30-day refresh token there is a 30-day account
/// takeover (H-16). They now go to the platform keystore instead:
/// EncryptedSharedPreferences on Android, the Keychain on iOS.
///
/// The locale is NOT a secret and stays in SharedPreferences: it is read on
/// every frame that renders text, and a keystore round trip for it would be
/// pure overhead.
abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class KeystoreSecretStore implements SecretStore {
  KeystoreSecretStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class TokenStore {
  TokenStore(this._prefs, {SecretStore? secrets}) : _secrets = secrets ?? KeystoreSecretStore();

  static const _accessKey = 'tc.access';
  static const _refreshKey = 'tc.refresh';
  static const _localeKey = 'tc.locale';

  final SharedPreferences _prefs;
  final SecretStore _secrets;

  // Cached in memory so the hot path (every request's Authorization header)
  // does not hit the keystore.
  String? _accessToken;
  String? _refreshToken;
  bool _loaded = false;

  /// Must be awaited once at startup, before the first authenticated request.
  Future<void> load() async {
    _accessToken = await _secrets.read(_accessKey);
    _refreshToken = await _secrets.read(_refreshKey);

    // One-time migration off the old plaintext location, so an existing
    // install is not logged out — and the plaintext copy is removed.
    if (_refreshToken == null && _prefs.containsKey(_refreshKey)) {
      final legacyAccess = _prefs.getString(_accessKey);
      final legacyRefresh = _prefs.getString(_refreshKey);
      if (legacyRefresh != null) {
        await save(legacyAccess ?? '', legacyRefresh);
      }
      await _prefs.remove(_accessKey);
      await _prefs.remove(_refreshKey);
    }
    _loaded = true;
  }

  bool get isLoaded => _loaded;
  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;
  bool get isLoggedIn => _refreshToken != null;

  String get locale => _prefs.getString(_localeKey) ?? 'uz-latn';

  Future<void> save(String access, String refresh) async {
    _accessToken = access;
    _refreshToken = refresh;
    await _secrets.write(_accessKey, access);
    await _secrets.write(_refreshKey, refresh);
  }

  Future<void> clear() async {
    _accessToken = null;
    _refreshToken = null;
    await _secrets.delete(_accessKey);
    await _secrets.delete(_refreshKey);
  }

  Future<void> setLocale(String locale) => _prefs.setString(_localeKey, locale);
}
