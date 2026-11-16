import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/main.dart';
import 'package:food_delivery/api_client.dart';

class FakeApi extends ApiClient {
  FakeApi(this.role);
  final String role;
  bool expired = false;
  bool loggedOut = false;
  @override
  Future<dynamic> request(String path, {Map<String, dynamic>? body, bool captureToken = false}) async {
    if (path == '/dashboard') {
      if (expired) throw const ApiException('Session expired', 401);
      return {'user': {'id': 'u1', 'name': 'Tester', 'role': role}, 'restaurants': [], 'driver': {'id': 'd1', 'approved': true}};
    }
    if (path == '/api/auth/sign-out') loggedOut = true;
    if (path.startsWith('/catalog/restaurants')) { return <dynamic>[]; }
    return <String, dynamic>{};
  }
}

Future<void> signIn(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.tap(find.text('Account'));
  await tester.pumpAndSettle();
  await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'tester@example.test');
  await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'correct-password');
  await tester.ensureVisible(find.text('Sign in'));
  await tester.tap(find.text('Sign in'));
  await tester.pumpAndSettle();
}

void main() {
  for (final role in ['CUSTOMER', 'RESTAURANT', 'DRIVER', 'ADMIN']) {
    testWidgets('$role gets the server-assigned dashboard and can sign out', (tester) async {
      final api = FakeApi(role);
      await tester.pumpWidget(FoodDeliveryApp(api: api));
      await signIn(tester);
      expect(find.textContaining('dashboard'), findsOneWidget);
      expect(find.text('Manage users'), role == 'ADMIN' ? findsOneWidget : findsNothing);
      await tester.ensureVisible(find.text('Sign out'));
      await tester.tap(find.text('Sign out')); await tester.pumpAndSettle();
      expect(api.loggedOut, isTrue); expect(find.text('Sign in'), findsOneWidget);
    });
  }
  testWidgets('expired session returns to sign-in', (tester) async {
    final api = FakeApi('CUSTOMER');
    await tester.pumpWidget(FoodDeliveryApp(api: api));
    await signIn(tester); api.expired = true;
    await tester.ensureVisible(find.text('Refresh'));
    await tester.tap(find.text('Refresh')); await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Session expired'), findsOneWidget);
  });
}
