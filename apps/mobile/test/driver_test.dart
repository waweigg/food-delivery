import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/driver_screen.dart';

class DriverApi extends ApiClient {
  String status = 'PENDING';
  Map<String, dynamic>? review;
  @override
  Future<dynamic> request(String path, {Map<String, dynamic>? body, bool captureToken = false}) async {
    final profile = {'user_id': 'driver', 'name': 'Pilot', 'vehicle': 'Taxi', 'status': status, 'version': 3, 'eligible': false};
    if (path == '/driver/me') { return profile; }
    if (path == '/driver-admin') { return [profile]; }
    if (path.endsWith('/review')) { review = body; status = body!['status']; return {}; }
    return [];
  }
}
void main() {
  testWidgets('pending applicant cannot go online or accept an offer', (tester) async {
    await tester.pumpWidget(MaterialApp(home: DriverScreen(api: DriverApi())));
    await tester.pumpAndSettle();
    expect(find.text('Administrator approval is required.'), findsOneWidget);
    expect(find.text('Go online'), findsNothing);
    expect(find.text('Accept offer'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('admin reviews the selected profile with its current version', (tester) async {
    final api = DriverApi();
    await tester.pumpWidget(MaterialApp(home: DriverScreen(api: api, admin: true)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('APPROVED')); await tester.pumpAndSettle();
    expect(api.review, {'version': 3, 'status': 'APPROVED'});
    expect(find.text('Taxi · APPROVED'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
