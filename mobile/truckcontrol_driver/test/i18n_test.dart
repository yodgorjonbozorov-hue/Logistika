import 'package:flutter_test/flutter_test.dart';
import 'package:truckcontrol_driver/core/i18n/app_strings.dart';
import 'package:truckcontrol_driver/features/events/event_definitions.dart';

void main() {
  test('every locale translates every key (no hardcoded-text gaps)', () {
    final reference = AppStrings.messages[AppStrings.fallback]!.keys.toSet();
    for (final locale in AppStrings.supported) {
      final keys = AppStrings.messages[locale]!.keys.toSet();
      expect(keys, reference, reason: 'locale $locale key set differs');
    }
  });

  test('all 10 status buttons exist and are translated (TZ §3.2 E-3)', () {
    expect(eventDefinitions.length, 10);
    expect(eventDefinitions.map((d) => d.type).toSet().length, 10);
    for (final definition in eventDefinitions) {
      for (final locale in AppStrings.supported) {
        expect(
          AppStrings.messages[locale]![definition.i18nKey],
          isNotNull,
          reason: '${definition.i18nKey} missing in $locale',
        );
      }
    }
  });

  test('falls back to uz-latn for unknown locale codes', () {
    final strings = AppStrings('de');
    expect(strings.t('login.title'), AppStrings.messages['uz-latn']!['login.title']);
  });
}
