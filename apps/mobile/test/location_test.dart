import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/storefront.dart';

class CoverageApi extends ApiClient {
  final calls = <Map<String, dynamic>>[];
  bool fail = false;
  Completer<dynamic>? pending;
  Map<String, dynamic> result(bool nearby) => {
    'restaurants': nearby
        ? [
            {
              'id': 'near',
              'name': 'Nearby kitchen',
              'address': 'Malappuram',
              'isOpen': false,
            },
          ]
        : [],
    'hasMore': false,
  };
  @override
  Future<dynamic> request(
    String path, {
    Map<String, dynamic>? body,
    bool captureToken = false,
  }) async {
    if (path != '/catalog/coverage') {
      return {};
    }
    calls.add(body!);
    if (fail) {
      throw const ApiException('Connection failed');
    }
    if (pending != null) {
      return pending!.future;
    }
    return result(body['latitude'] == 11.074);
  }
}

Future<void> demo(WidgetTester tester) async {
  await tester.tap(find.text('Select location'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Use Malappuram demo location'));
  await tester.pumpAndSettle();
}

Future<void> outside(WidgetTester tester) async {
  await tester.tap(find.text('Delivering to'));
  await tester.pumpAndSettle();
  await tester.enterText(find.widgetWithText(TextFormField, 'Latitude'), '0');
  await tester.enterText(find.widgetWithText(TextFormField, 'Longitude'), '0');
  await tester.ensureVisible(find.text('Check this location'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Check this location'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'late response cannot restore restaurants from the previous location',
    (tester) async {
      final api = CoverageApi();
      final old = Completer<dynamic>();
      api.pending = old;
      await tester.pumpWidget(MaterialApp(home: Storefront(api: api)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Select location'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use Malappuram demo location'));
      await tester.pump(const Duration(milliseconds: 400));
      api.pending = null;
      await tester.tap(find.text('Delivering to'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Latitude'),
        '0',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Longitude'),
        '0',
      );
      await tester.ensureVisible(find.text('Check this location'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Check this location'));
      await tester.pumpAndSettle();
      old.complete(api.result(true));
      await tester.pumpAndSettle();
      expect(find.text('Nearby kitchen'), findsNothing);
      expect(find.text('We don’t serve this location yet'), findsOneWidget);
    },
  );
  testWidgets(
    'location gates discovery; closed coverage differs from unsupported location',
    (tester) async {
      final api = CoverageApi();
      await tester.pumpWidget(MaterialApp(home: Storefront(api: api)));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty);
      expect(find.text('Select location'), findsOneWidget);
      await demo(tester);
      expect(find.text('Nearby kitchen'), findsOneWidget);
      expect(find.textContaining('We serve this area'), findsOneWidget);
      await outside(tester);
      expect(find.text('Nearby kitchen'), findsNothing);
      expect(find.text('We don’t serve this location yet'), findsOneWidget);
    },
  );
  testWidgets('network errors are not presented as an unsupported area', (
    tester,
  ) async {
    final api = CoverageApi()..fail = true;
    await tester.pumpWidget(MaterialApp(home: Storefront(api: api)));
    await tester.pumpAndSettle();
    await demo(tester);
    expect(find.text('Couldn’t check availability'), findsOneWidget);
    expect(find.text('We don’t serve this location yet'), findsNothing);
    api.fail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Nearby kitchen'), findsOneWidget);
  });
}
