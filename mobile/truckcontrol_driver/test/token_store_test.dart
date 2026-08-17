import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truckcontrol_driver/core/storage/token_store.dart';

void main() {
  Future<TokenStore> open({
    Map<String, Object> prefs = const {},
    Map<String, String> secure = const {},
  }) async {
    SharedPreferences.setMockInitialValues(prefs);
    FlutterSecureStorage.setMockInitialValues(Map.of(secure));
    final store = TokenStore(await SharedPreferences.getInstance());
    await store.load();
    return store;
  }

  test('reads tokens from the platform keystore', () async {
    final store = await open(secure: {'tc.access': 'a', 'tc.refresh': 'r'});

    expect(store.accessToken, 'a');
    expect(store.refreshToken, 'r');
    expect(store.isLoggedIn, isTrue);
  });

  test('saving writes to secure storage, never to SharedPreferences', () async {
    final store = await open();
    await store.save('new-access', 'new-refresh');

    final prefs = await SharedPreferences.getInstance();
    // A plaintext refresh token in a phone backup is a permanent takeover.
    expect(prefs.getString('tc.refresh'), isNull);
    expect(prefs.getString('tc.access'), isNull);
    expect(store.refreshToken, 'new-refresh');
  });

  test('migrates tokens left in SharedPreferences by an older build', () async {
    final store = await open(
      prefs: {'tc.access': 'legacy-access', 'tc.refresh': 'legacy-refresh'},
    );

    // The driver stays signed in across the upgrade…
    expect(store.refreshToken, 'legacy-refresh');
    // …and the plaintext copy is gone.
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('tc.refresh'), isNull);
    expect(prefs.getString('tc.access'), isNull);
  });

  test('keeps the keystore copy when both exist and still clears the old one', () async {
    final store = await open(
      prefs: {'tc.refresh': 'stale-refresh'},
      secure: {'tc.access': 'a', 'tc.refresh': 'current-refresh'},
    );

    expect(store.refreshToken, 'current-refresh');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('tc.refresh'), isNull);
  });

  test('clear removes both tokens', () async {
    final store = await open(secure: {'tc.access': 'a', 'tc.refresh': 'r'});
    await store.clear();

    expect(store.accessToken, isNull);
    expect(store.isLoggedIn, isFalse);
  });

  test('locale stays an ordinary preference', () async {
    final store = await open();
    expect(store.locale, 'uz-latn');
    await store.setLocale('ru');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('tc.locale'), 'ru');
  });
}
