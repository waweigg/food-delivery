import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/menu_screens.dart';

class MenuApi extends ApiClient {
  MenuApi() : super(baseUrl: 'http://localhost');
  final calls = <String>[];
  @override
  Future<dynamic> request(String path, {Map<String, dynamic>? body, bool captureToken = false}) async {
    calls.add(path);
    return {'currency': 'INR', 'menuVersion': 1, 'categories': [{'id': 'c', 'name': 'Mains', 'items': [{'id': 'i', 'categoryId': 'c', 'name': 'Test meal', 'description': 'Fixture description', 'priceMinor': 14950, 'currency': 'INR', 'available': true, 'photoId': null, 'photoUrl': null}]}]};
  }
}
void main() {
  test('rupees convert to integer paise without rounding', () {
    expect(parsePrice('149.50'), 14950);
    expect(parsePrice('0.01'), 1);
    expect(parsePrice('12.5'), 1250);
    expect(priceText(1250), '12.50');
    for (final invalid in ['-1', '0', '1.001', 'NaN', '1e3', '21474836.48']) { expect(parsePrice(invalid), isNull); }
  });
  testWidgets('customer menu shows INR prices and no editing actions', (tester) async {
    final api = MenuApi();
    await tester.pumpWidget(MaterialApp(home: MenuScreen(api: api, restaurantId: 'r', restaurantName: 'Fixture')));
    await tester.pumpAndSettle();
    expect(find.text('INR 149.50'), findsOneWidget);
    expect(find.text('Edit item'), findsNothing);
    expect(api.calls, ['/catalog/restaurants/r/menu']);
  });
  testWidgets('owner can reach add-item form and cannot submit invalid prices', (tester) async {
    final api = MenuApi();
    await tester.pumpWidget(MaterialApp(home: MenuItemEditor(api: api, path: '/restaurant-onboarding/r/menu', menuVersion: 1, currency: 'INR', categories: const [{'id': 'c', 'name': 'Mains'}], categoryId: 'c')));
    await tester.enterText(find.byType(TextFormField).at(0), 'Test meal');
    await tester.enterText(find.byType(TextFormField).at(2), '-10');
    await tester.ensureVisible(find.text('Save item'));
    await tester.tap(find.text('Save item'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a positive price with up to two decimal places'), findsOneWidget);
    expect(api.calls, isEmpty);
  });
}
