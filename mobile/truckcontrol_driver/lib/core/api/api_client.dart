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

  /// Multipart upload, returning the stored file id.
  ///
  /// Lives here rather than in the sync queue because this is the one place
  /// that owns an http.Client: building a `MultipartRequest` and calling
  /// `send()` elsewhere silently uses a fresh default client, which ignores the
  /// injected one (so it cannot be tested) and every timeout configured on it.
  ///
  /// Returns null when the upload failed; the caller decides whether that means
  /// "retry later" or "give up on the photo".
  Future<String?> uploadFile(String filePath, {Duration timeout = const Duration(seconds: 60)}) async {
    try {
      final request = http.MultipartRequest('POST', Uri.parse('$_baseUrl/files/upload'))
        ..headers['authorization'] = 'Bearer ${_tokens.accessToken}'
        ..files.add(await http.MultipartFile.fromPath('file', filePath));

      final streamed = await _http.send(request).timeout(timeout);
      final body = await streamed.stream.bytesToString();
      if (streamed.statusCode >= 300) return null;

      // Parsed, not regex-scraped: the envelope is JSON and a regex would
      // happily match an "id" from anywhere else in the payload.
      final envelope = jsonDecode(body) as Map<String, dynamic>;
      if (envelope['success'] != true) return null;
      return (envelope['data'] as Map<String, dynamic>?)?['id'] as String?;
    } on Exception {
      return null;
    }
  }

  Future<bool> _tryRefresh() async {
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
