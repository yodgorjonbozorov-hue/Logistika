import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truckcontrol_driver/core/api/api_client.dart';
import 'package:truckcontrol_driver/core/storage/token_store.dart';

void main() {
  late TokenStore tokens;

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'tc.access': 'expired-access',
      'tc.refresh': 'refresh-1',
    });
    tokens = TokenStore(await SharedPreferences.getInstance());
  });

  String body(Object data) =>
      jsonEncode({'success': true, 'data': data, 'error': null, 'meta': null});

  String expired() => jsonEncode({
        'success': false,
        'data': null,
        'error': {'code': 'AUTH_TOKEN_EXPIRED', 'message': 'expired'},
        'meta': null,
      });

  test('parallel requests hitting an expired token refresh only once', () async {
    var refreshes = 0;
    final attempts = <String, int>{};

    final client = ApiClient(
      tokens,
      httpClient: MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/auth/refresh')) {
          refreshes++;
          // A slow refresh is exactly when the race shows up.
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return http.Response(
            body({'accessToken': 'new-access', 'refreshToken': 'new-refresh'}),
            200,
          );
        }
        attempts[path] = (attempts[path] ?? 0) + 1;
        return http.Response(attempts[path] == 1 ? expired() : body({'ok': true}), 200);
      }),
    );

    await Future.wait([
      client.request<Map<String, dynamic>>('/trips/my'),
      client.request<Map<String, dynamic>>('/expenses'),
      client.request<Map<String, dynamic>>('/events'),
    ]);

    // Three rotations would leave two requests holding a dead refresh token and
    // log the driver out in the middle of a trip.
    expect(refreshes, 1);
    expect(tokens.accessToken, 'new-access');
  });

  test('a later expiry can still refresh (single-flight, not once-per-session)', () async {
    var refreshes = 0;
    var businessCalls = 0;

    final client = ApiClient(
      tokens,
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/auth/refresh')) {
          refreshes++;
          return http.Response(body({'accessToken': 'a', 'refreshToken': 'r'}), 200);
        }
        businessCalls++;
        return http.Response(businessCalls.isOdd ? expired() : body({'ok': true}), 200);
      }),
    );

    await client.request<Map<String, dynamic>>('/trips/my');
    await client.request<Map<String, dynamic>>('/trips/my');

    expect(refreshes, 2);
  });
}
