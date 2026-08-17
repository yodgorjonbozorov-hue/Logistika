import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import '../storage/token_store.dart';

class ApiException implements Exception {
  ApiException(this.code, this.message, {this.details});

  final String code;
  final String message;
  final Object? details;

  @override
  String toString() => message;
}

/// Unwraps the `{ success, data, error, meta }` envelope and refreshes the
/// rotated token pair once on AUTH_TOKEN_EXPIRED.
class ApiClient {
  ApiClient(this._tokens, {http.Client? httpClient, String? baseUrl})
      : _http = httpClient ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiUrl;

  final TokenStore _tokens;
  final http.Client _http;
  final String _baseUrl;

  void Function()? onSessionExpired;

  Future<T> request<T>(
    String path, {
    String method = 'GET',
    Object? body,
    Map<String, String>? query,
  }) async {
    var envelope = await _raw(path, method: method, body: body, query: query);

    if (envelope['success'] != true &&
        _errorCode(envelope) == 'AUTH_TOKEN_EXPIRED') {
      if (await _tryRefresh()) {
        envelope = await _raw(path, method: method, body: body, query: query);
      } else {
        onSessionExpired?.call();
      }
    }

    if (envelope['success'] == true) {
      return envelope['data'] as T;
    }
    final error = envelope['error'] as Map<String, dynamic>? ?? {};
    throw ApiException(
      (error['code'] as String?) ?? 'INTERNAL_ERROR',
      (error['message'] as String?) ?? 'Error',
      details: error['details'],
    );
  }

  String? _errorCode(Map<String, dynamic> envelope) =>
      (envelope['error'] as Map<String, dynamic>?)?['code'] as String?;

  Future<Map<String, dynamic>> _raw(
    String path, {
    required String method,
    Object? body,
    Map<String, String>? query,
  }) async {
    final uri = Uri.parse('$_baseUrl$path').replace(
      queryParameters: (query?.isEmpty ?? true) ? null : query,
    );
    final headers = <String, String>{
      'accept-language': _tokens.locale,
      // Browsers get the refresh token as an httpOnly cookie; a native client
      // has no cookie jar and needs it in the response body.
      'x-client': 'mobile',
      if (body != null) 'content-type': 'application/json',
      if (_tokens.accessToken != null)
        'authorization': 'Bearer ${_tokens.accessToken}',
    };

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _http.send(request);
    final text = await streamed.stream.bytesToString();
    try {
      return jsonDecode(text) as Map<String, dynamic>;
    } catch (_) {
      return {
        'success': false,
        'data': null,
        'error': {'code': 'INTERNAL_ERROR', 'message': 'HTTP ${streamed.statusCode}'},
        'meta': null,
      };
    }
  }

  /// Single-flight refresh: several queued requests hitting an expired token at
  /// once must not each rotate it. The first rotation wins and the rest would
  /// present a token that no longer exists — logging the driver out mid-trip.
  Future<bool>? _refreshInFlight;

  Future<bool> _tryRefresh() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<bool> _performRefresh() async {
    final refresh = _tokens.refreshToken;
    if (refresh == null) return false;
    final envelope = await _raw(
      '/auth/refresh',
      method: 'POST',
      body: {'refreshToken': refresh},
    );
    if (envelope['success'] == true) {
      final data = envelope['data'] as Map<String, dynamic>;
      await _tokens.save(
        data['accessToken'] as String,
        data['refreshToken'] as String,
      );
      return true;
    }
    await _tokens.clear();
    return false;
  }
}
