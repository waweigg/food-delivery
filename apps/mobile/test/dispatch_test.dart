import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/dispatch_screen.dart';
import 'package:food_delivery/driver_screen.dart';

class DispatchApi extends ApiClient {
  Map<String, dynamic>? manual;
  @override
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) async {
    if (path == '/driver/me') {
      return {'name': 'Pilot', 'status': 'APPROVED', 'eligible': false};
    }
    if (path == '/driver/offers') {
      return [
        {
          'id': 'offer',
          'order_id': '12345678',
          'pickup': 'Test kitchen',
          'state': 'ACCEPTED',
          'dispatch_state': 'ASSIGNED',
        },
      ];
    }
    if (path.startsWith('/driver/deliveries/')) {
      return {'state': 'ASSIGNED'};
    }
    if (path.endsWith('/candidates')) {
      return [
        {
          'user_id': 'pilot',
          'name': 'Pilot',
          'vehicle': 'Taxi',
          'distanceMetres': 50,
        },
      ];
    }
    if (path.endsWith('/manual')) {
      manual = body;
      return {};
    }
    return [
      {
        'order_id': '12345678',
        'pickup': 'Kitchen',
        'state': 'NEEDS_ATTENTION',
        'attempts': 5,
        'round': 1,
        'issue': 'No driver available',
      },
    ];
  }
}

void main() {
  testWidgets('confirmed driver assignment has no second acceptance action', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: DriverScreen(api: DispatchApi())),
    );
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('Confirm pickup'),
      find.byType(ListView),
      const Offset(0, -250),
    );
    expect(find.text('Confirm pickup'), findsOneWidget);
    expect(find.text('Accept offer'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('manual dispatch offers only the selected eligible driver', (
    tester,
  ) async {
    final api = DispatchApi();
    await tester.pumpWidget(MaterialApp(home: DispatchScreen(api: api)));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Choose driver manually'));
    await tester.tap(find.text('Choose driver manually'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilot · Taxi · 50 m'));
    await tester.pumpAndSettle();
    expect(api.manual, {'driverId': 'pilot'});
    await tester.pumpWidget(const SizedBox());
  });
}
