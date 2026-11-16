import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/main.dart';
import 'widget_test.dart' show FakeApi, signIn;

class ProfileApi extends FakeApi {
  ProfileApi() : super('CUSTOMER');
  String? updatedName;
  int resets = 0;
  @override
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) async {
    if (path == '/me/profile') {
      updatedName = body!['name'] as String;
      return {
        'id': 'u1',
        'name': updatedName,
        'email': 'local@example.test',
        'role': 'CUSTOMER',
      };
    }
    if (path == '/api/auth/reset-password') resets++;
    return super.request(path, body: body, captureToken: captureToken);
  }
}

void main() {
  testWidgets('password recovery requires a matching confirmation', (
    tester,
  ) async {
    final api = ProfileApi();
    await tester.pumpWidget(FoodDeliveryApp(api: api));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Forgot password?'));
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('I already have a recovery code'));
    await tester.tap(find.text('I already have a recovery code'));
    await tester.pumpAndSettle();
    Future<void> enter(String label, String text) =>
        tester.enterText(find.widgetWithText(TextFormField, label), text);
    await enter('Recovery code', 'local-test-code');
    await enter('Password', 'valid-password-123');
    await enter('Confirm password', 'mismatched-password');
    await tester.ensureVisible(find.text('Update password'));
    await tester.tap(find.text('Update password'));
    await tester.pumpAndSettle();
    expect(find.text('Passwords do not match'), findsOneWidget);
    expect(api.resets, 0);
    await enter('Confirm password', 'valid-password-123');
    await tester.ensureVisible(find.text('Update password'));
    await tester.tap(find.text('Update password'));
    await tester.pumpAndSettle();
    expect(api.resets, 1);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('can switch themes before login and reload the preference', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    const storage = FlutterSecureStorage();
    final api = FakeApi('CUSTOMER');
    await tester.pumpWidget(FoodDeliveryApp(api: api, storage: storage));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Follow device'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dark').last);
    await tester.pumpAndSettle();
    expect(
      Theme.of(tester.element(find.text('Appearance'))).brightness,
      Brightness.dark,
    );
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(FoodDeliveryApp(api: api, storage: storage));
    await tester.pumpAndSettle();
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
      ThemeMode.dark,
    );
  });

  testWidgets('settings save the display name and refresh the account view', (
    tester,
  ) async {
    final api = ProfileApi();
    await tester.pumpWidget(FoodDeliveryApp(api: api));
    await tester.pumpAndSettle();
    await signIn(tester);
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit profile'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), ' Updated name ');
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(api.updatedName, 'Updated name');
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Welcome, Updated name'), findsOneWidget);
  });
}
