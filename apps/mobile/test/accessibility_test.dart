import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/brand.dart';
import 'package:food_delivery/menu_screens.dart';
import 'package:food_delivery/shopping_state.dart';
import 'package:food_delivery/storefront.dart';
import 'menu_test.dart' show MenuApi;
import 'cart_test.dart' show QuoteApi;

void main() {
  for (final (width, scale) in [(411.0, 1.0), (411.0, 2.0), (320.0, 2.0)]) {
    testWidgets('menu, basket and review at ${width}px, text scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width * 2.625, 2400);
      tester.view.devicePixelRatio = 2.625;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final semantics = tester.ensureSemantics();
      try {
        final cart = ShoppingState()
          ..setDelivery({
            'street': 'Test road, Malappuram',
            'phone': '12345678',
            'latitude': 11.074,
            'longitude': 76.074,
          });
        Widget app(Widget screen) => MaterialApp(
          theme: AppBrand.theme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: screen,
        );
        await tester.pumpWidget(
          app(
            MenuScreen(
              api: MenuApi(),
              restaurantId: 'r',
              restaurantName: 'Malabar Biriyani House (Demo)',
              shopping: cart,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.dragUntilVisible(
          find.text('Add'),
          find.byType(ListView).first,
          const Offset(0, -200),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await tester.tap(find.text('Add'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(
          app(BasketScreen(api: QuoteApi(), shopping: cart)),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await tester.pumpWidget(
          app(QuoteReview(api: QuoteApi(), shopping: cart)),
        );
        await tester.pumpAndSettle();
        final checkout = find.widgetWithText(
          FilledButton,
          'Sign in to place a test order',
        );
        await tester.dragUntilVisible(
          checkout.hitTestable(),
          find.byType(ListView),
          const Offset(0, -180),
        );
        await tester.pumpAndSettle();
        expect(checkout.hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      } finally {
        semantics.dispose();
      }
    });
  }
}
