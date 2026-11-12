import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/restaurant_screens.dart';

class RestaurantFake extends ApiClient {
  Map<String, dynamic>? submitted;
  @override
  Future<dynamic> request(String path, {Map<String, dynamic>? body, bool captureToken = false}) async {
    if (path.startsWith('/catalog/restaurants')) {
      return [
      {'id': 'r1', 'name': 'Test Kitchen', 'address': 'Test pickup location', 'isOpen': false, 'timezone': 'UTC', 'hours': [{'day': 1, 'open': 1320, 'close': 120}]},
      ];
    }
    if (path == '/restaurant-onboarding') { submitted = body; return {'id': 'r1', 'status': 'PENDING'}; }
    return [];
  }
}
void main() {
  test('clock parsing supports explicit 24-hour close and rejects malformed times', () {
    expect(parseClock('24:00', end: true), 1440);
    expect(parseClock('24:00'), null);
    expect(parseClock('12:60'), null);
    expect(hoursText([{'day': 6, 'open': 1320, 'close': 120}]), contains('(next day)'));
  });
  testWidgets('catalog shows backend availability and overnight hours without order controls', (tester) async {
    await tester.pumpWidget(MaterialApp(home: RestaurantScreen(api: RestaurantFake(), view: RestaurantView.catalog)));
    await tester.pumpAndSettle();
    expect(find.text('Test Kitchen'), findsOneWidget);
    expect(find.text('Currently closed'), findsOneWidget);
    expect(find.textContaining('(next day)'), findsOneWidget);
    expect(find.text('Ordering is coming soon.'), findsOneWidget);
  });
  testWidgets('empty registration cannot submit a restaurant', (tester) async {
    final api = RestaurantFake();
    await tester.pumpWidget(MaterialApp(home: RestaurantEditor(api: api)));
    // Text fields also contain Scrollables; target the outer form list.
    final formScroll = find.descendant(
      of: find.byType(ListView),
      matching: find.byType(Scrollable),
    ).first;
    await tester.scrollUntilVisible(
      find.text('Submit for review'),
      300,
      scrollable: formScroll,
    );
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(api.submitted, isNull);
  });
}
