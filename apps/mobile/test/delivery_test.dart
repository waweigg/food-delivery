import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/driver_screen.dart';
import 'package:food_delivery/delivery_tracking.dart';

class DeliveryApi extends ApiClient {
  String state = 'ASSIGNED';
  final calls = <String>[];
  @override
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) async {
    if (path == '/driver/me') {
      return {'name': 'Demo', 'status': 'APPROVED', 'eligible': false};
    }
    if (path == '/driver/offers') {
      return state == 'DELIVERED'
          ? []
          : [
              {
                'id': 'offer',
                'order_id': '12345678',
                'pickup': 'Demo kitchen',
                'state': 'ACCEPTED',
                'dispatch_state': state,
              },
            ];
    }
    if (path.startsWith('/orders/')) {
      return {
        'state': state,
        'pin': '123456',
        'events': [],
        'tracking': {'stale': true},
      };
    }
    if (body != null) {
      calls.add(body['action']);
      if (body['action'] == 'pickup') {
        state = 'PICKED_UP';
      }
      if (body['action'] == 'deliver') {
        if (body['pin'] != '123456') {
          throw const ApiException('Incorrect PIN', 422);
        }
        state = 'DELIVERED';
      }
    }
    return {
      'state': state,
      'address': {'street': 'Demo address'},
    };
  }
}

void main() {
  testWidgets(
    'pickup confirmation and PIN completion preserve failed entry for retry',
    (tester) async {
      final api = DeliveryApi();
      await tester.pumpWidget(MaterialApp(home: DriverScreen(api: api)));
      await tester.pumpAndSettle();
      expect(find.text('Complete delivery'), findsNothing);
      await tester.dragUntilVisible(
        find.text('Confirm pickup'),
        find.byType(ListView),
        const Offset(0, -250),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm pickup'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(api.state, 'ASSIGNED');
      await tester.tap(find.text('Food collected'));
      await tester.pumpAndSettle();
      expect(api.state, 'PICKED_UP');
      await tester.ensureVisible(find.byType(TextField));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '000000');
      await tester.ensureVisible(find.text('Complete delivery'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Complete delivery'));
      await tester.pumpAndSettle();
      expect(api.state, 'PICKED_UP');
      expect(find.textContaining('Incorrect PIN'), findsOneWidget);
      await tester.ensureVisible(find.byType(TextField));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '123456');
      await tester.ensureVisible(find.text('Complete delivery'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Complete delivery'));
      await tester.pumpAndSettle();
      expect(api.state, 'DELIVERED');
      expect(find.text('Delivery complete. Thank you!'), findsOneWidget);
      await tester.dragUntilVisible(
        find.textContaining('Delivery completed.'),
        find.byType(ListView),
        const Offset(0, 300),
      );
      expect(find.textContaining('Delivery completed.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'customer sees own PIN and explicit stale tracking with refresh',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: DeliveryTracking(api: DeliveryApi(), orderId: '12345678'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('123456'), findsOneWidget);
      expect(
        find.text('Driver location is stale or unavailable'),
        findsOneWidget,
      );
      expect(find.byTooltip('Refresh delivery'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
