import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';

void main() {
  test(
    'restores a signed-in session, clears it on expiry and signs out',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      const storage = FlutterSecureStorage();
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      final base = 'http://127.0.0.1:${server.port}';
      var revoked = false;
      server.listen((request) async {
        await request.drain<void>();
        final response = request.response;
        response.headers.contentType = ContentType.json;
        switch (request.uri.path) {
          case '/api/auth/sign-in/email':
            revoked = false;
            response.headers.set('set-auth-token', 'signed-test-session');
          case '/api/auth/sign-out':
            revoked = true;
          default:
            if (revoked ||
                request.headers.value('authorization') !=
                    'Bearer signed-test-session') {
              response.statusCode = 401;
            }
        }
        response.write('{}');
        await response.close();
      });
      ApiClient newClient() => ApiClient(baseUrl: base, storage: storage);
      Future<void> login(ApiClient api) async => api.request(
        '/api/auth/sign-in/email',
        body: {'email': 'local@example.test', 'password': 'fixture'},
        captureToken: true,
      );
      final first = newClient();
      await login(first);
      expect(await storage.readAll(), {
        'waweigg.session.$base': 'signed-test-session',
      });
      final restarted = newClient();
      await restarted.restoreSession();
      expect(restarted.signedIn, isTrue);
      await restarted.request('/dashboard');
      revoked = true;
      await expectLater(
        restarted.request('/dashboard'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
      expect(restarted.signedIn, isFalse);
      expect(restarted.sessionEnded.value, 1);
      expect(await storage.readAll(), isEmpty);

      await login(restarted);
      await restarted.signOut();
      expect(revoked, isTrue);
      expect(restarted.signedIn, isFalse);
      expect(await storage.readAll(), isEmpty);
    },
  );
}
