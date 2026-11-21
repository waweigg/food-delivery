import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/brand.dart';
import 'package:food_delivery/driver_screen.dart';
import 'package:food_delivery/restaurant_screens.dart';

class PartnerApi extends ApiClient {
  String state = 'NEW';
  final actions = <String>[];
  Map<String, dynamic> get order => {
    'order_id': '12345678-local',
    'state': state,
    'deadline': DateTime.now()
        .add(const Duration(minutes: 5))
        .toIso8601String(),
    'quote': {
      'totalMinor': 21000,
      'items': [
        {'quantity': 1, 'name': 'Chicken dum biriyani'},
      ],
    },
  };
  @override
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) async {
    if (path == '/restaurant-onboarding/mine') {
      return [
        {
          'id': 'mlp-demo-malabar',
          'name': 'Malabar Biriyani House (Demo)',
          'address': 'Malappuram sample pickup location',
          'status': 'APPROVED',
          'active': true,
        },
      ];
    }
    if (path == '/driver/me') {
      return {'name': 'Demo driver', 'status': 'APPROVED'};
    }
    if (path == '/driver/offers') {
      return [
        {
          'state': 'PENDING',
          'id': 'offer',
          'order_id': '12345678-local',
          'pickup': 'Malabar Biriyani House (Demo)',
          'expires_at': DateTime.now()
              .add(const Duration(seconds: 45))
              .toIso8601String(),
        },
      ];
    }
    if (body != null) {
      actions.add(path.split('/').last);
      state = switch (actions.last) {
        'accept' => 'ACCEPTED',
        'prepare' => 'PREPARING',
        'ready' => 'READY',
        _ => state,
      };
    }
    return path == '/orders/kitchen/mlp-demo-malabar' ? [order] : order;
  }
}

void main() {
  for (final (width, scale, dark) in [
    (411.0, 1.0, false),
    (320.0, 2.0, true),
  ]) {
    testWidgets(
      'partner workflows remain reachable at $width, scale $scale, dark $dark',
      (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = PartnerApi();
        Widget app(Widget screen) => MaterialApp(
          theme: dark ? AppBrand.darkTheme : AppBrand.theme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: screen,
        );
        Future<void> tap(String label) async {
          await tester.dragUntilVisible(
            find.text(label),
            find.byType(ListView).last,
            const Offset(0, -220),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.tap(find.text(label));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }

        await tester.pumpWidget(
          app(RestaurantScreen(api: api, view: RestaurantView.mine)),
        );
        await tester.pumpAndSettle();
        await tap('Open kitchen queue');
        await tap('Order 12345678');
        for (final label in [
          'Accept order',
          'Mark as preparing',
          'Ready for pickup',
        ]) {
          await tap(label);
        }
        expect(api.actions, ['accept', 'prepare', 'ready']);
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(app(DriverScreen(api: api)));
        await tester.pumpAndSettle();
        await tap('Decline offer');
        expect(api.actions.last, 'decline');
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
