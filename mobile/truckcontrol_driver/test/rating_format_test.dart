import 'package:flutter_test/flutter_test.dart';
import 'package:truckcontrol_driver/features/profile/rating_format.dart';

void main() {
  group('formatRating', () {
    test('reads hundredths as a score', () {
      expect(formatRating(437), '4.37');
      expect(formatRating(500), '5.00');
      // Two digits after the point, so 4.05 never shows as 4.5.
      expect(formatRating(405), '4.05');
    });

    test('says nothing rather than zero when there is no score yet', () {
      expect(formatRating(null), '—');
    });
  });

  group('formatDeviation', () {
    test('turns basis points into a signed percentage', () {
      expect(formatDeviation(420), '+4.2%');
      expect(formatDeviation(0), '0.0%');
    });

    test('keeps the sign when a driver burns less than the norm', () {
      expect(formatDeviation(-315), '-3.2%');
    });

    test('rounds half up, and carries into the whole part', () {
      expect(formatDeviation(425), '+4.3%');
      expect(formatDeviation(495), '+5.0%');
    });

    test('says nothing when the deviation is unknown', () {
      expect(formatDeviation(null), '—');
    });
  });
}
