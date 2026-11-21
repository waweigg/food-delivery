import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/main.dart';
import 'package:food_delivery/startup_screen.dart';

class SlowStartupApi extends ApiClient {
  final loaded = Completer<void>();
  @override
  Future<void> restoreSession() => loaded.future;
}

void main() {
  testWidgets('text entrance waits for session loading and exits once ready', (
    tester,
  ) async {
    final api = SlowStartupApi();
    await tester.pumpWidget(FoodDeliveryApp(api: api));
    expect(find.byType(StartupScreen), findsOneWidget);
    expect(find.text('waweigg'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.pumpAndSettle();
    expect(find.byType(StartupScreen), findsOneWidget);
    api.loaded.complete();
    await tester.pumpAndSettle();
    expect(find.byType(StartupScreen), findsNothing);
    expect(find.text('Explore'), findsOneWidget);
  });

  testWidgets('startup respects reduced motion in dark mode', (tester) async {
    var finished = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(),
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: StartupScreen(onFinished: () => finished++),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(finished, 1);
    expect(find.text('waweigg'), findsOneWidget);
    expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 1);
  });
}
