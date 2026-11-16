import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiException implements Exception {
  const ApiException(this.message, [this.status = 0]);
  final String message;
  final int status;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({String? baseUrl, FlutterSecureStorage? storage})
    : baseUrl = baseUrl ?? const String.fromEnvironment('API_BASE_URL'),
      _storage = storage;
  final String baseUrl;
  final FlutterSecureStorage? _storage;
  String get _sessionKey =>
      'waweigg.session.${baseUrl.replaceFirst(RegExp(r'/$'), '')}';
  final sessionEnded = ValueNotifier<int>(0);
  Future<void> _storageQueue = Future.value();
  String? _token;
  bool get signedIn => _token != null;
  Future<void> restoreSession() async {
    try {
      _token = await _storage?.read(key: _sessionKey);
    } catch (_) {
      // Storage can be unavailable while the device is locked. Start signed out.
    }
  }

  Future<void> _saveSession(String? token) {
    final storage = _storage;
    if (storage == null) return Future.value();
    return _storageQueue = _storageQueue.then((_) async {
      try {
        if (token == null) {
          await storage.delete(key: _sessionKey);
        } else {
          await storage.write(key: _sessionKey, value: token);
        }
      } catch (_) {
        // Keep the active session usable when device storage is unavailable.
      }
    });
  }

  Future<void> _endSession(String? previous) async {
    if (previous == null || _token != previous) return;
    _token = null;
    final deletion = _saveSession(null);
    sessionEnded.value++;
    await deletion;
  }

  Future<void> signOut() async {
    final previous = _token;
    try {
      await request('/api/auth/sign-out', body: {});
    } finally {
      await _endSession(previous);
    }
  }

  Map<String, String> get imageHeaders =>
      _token == null ? {} : {'Authorization': 'Bearer $_token'};
  String imageUrl(String path) =>
      '${baseUrl.replaceFirst(RegExp(r'/$'), '')}$path';
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) => _send(path, body: body, captureToken: captureToken);
  Future<dynamic> upload(String path, List<int> bytes) =>
      _send(path, bytes: bytes);
  Future<dynamic> _send(
    String path, {
    Map<String, dynamic>? body,
    List<int>? bytes,
    bool captureToken = false,
  }) async {
    final base = Uri.tryParse(baseUrl);
    const release = bool.fromEnvironment('dart.vm.product');
    if (base == null ||
        base.host.isEmpty ||
        !['http', 'https'].contains(base.scheme) ||
        (release && base.scheme != 'https')) {
      throw const ApiException(
        'The service connection has not been configured.',
      );
    }
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    final sentToken = _token;
    try {
      final request = await client
          .openUrl(
            body == null && bytes == null ? 'GET' : 'POST',
            Uri.parse(imageUrl(path)),
          )
          .timeout(const Duration(seconds: 10));
      request.headers.contentType = bytes == null
          ? ContentType.json
          : ContentType.binary;
      request.headers.set('Origin', base.origin);
      request.followRedirects = false;
      if (sentToken != null) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $sentToken',
        );
      }
      if (body != null) request.write(jsonEncode(body));
      if (bytes != null) request.add(bytes);
      final response = await request.close().timeout(
        const Duration(seconds: 15),
      );
      final text = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 15));
      if (response.statusCode >= 300) {
        if (response.statusCode == 401) await _endSession(sentToken);
        if (path.startsWith('/driver/deliveries/') &&
            [400, 409, 422, 429].contains(response.statusCode)) {
          final detail = (jsonDecode(text) as Map)['message'];
          throw ApiException(
            detail is String
                ? detail
                : 'Delivery could not be confirmed. Refresh and retry.',
            response.statusCode,
          );
        }
        throw ApiException(switch (response.statusCode) {
          401 =>
            'Sign-in failed or your session expired. Please sign in again.',
          400 when path == '/api/auth/reset-password' =>
            'The recovery code is invalid, expired, or already used. Request a new code.',
          400 when path == '/api/auth/change-password' =>
            'Check your current password and try again.',
          400 when path == '/me/profile' =>
            'Enter a display name of 1–100 characters.',
          403 => 'You do not have permission for this action.',
          400 => 'Check the supplied details and image format, then try again.',
          413 => 'That photo is too large. Choose an image smaller than 5 MiB.',
          409 when path == '/orders' =>
            'Your basket changed. Review the latest prices before placing the order.',
          422 when path == '/orders' =>
            'This basket is no longer available. Review your delivery address and menu items.',
          409 => 'This record changed. Refresh it before saving.',
          422 when path.endsWith('/quote') =>
            (jsonDecode(text) as Map)['message'] as String,
          404 when path.endsWith('/quote') =>
            'This restaurant is no longer available.',
          429 => 'Too many attempts. Please wait a minute and try again.',
          _ =>
            'The request could not be completed. Check your details and try again.',
        }, response.statusCode);
      }
      if (captureToken && _token == sentToken) {
        final token = response.headers.value('set-auth-token');
        if (token == null || token.isEmpty) {
          throw const ApiException('Sign-in could not be completed.');
        }
        _token = token;
        await _saveSession(token);
      }
      if (path == '/api/auth/sign-out' || path == '/api/auth/reset-password') {
        await _endSession(sentToken);
      }
      return text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const ApiException('Unable to connect. Please try again.');
    } finally {
      client.close(force: true);
    }
  }
}
