import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:food_delivery/api_client.dart';
import 'package:food_delivery/shopping_state.dart';
import 'package:food_delivery/storefront.dart';

class QuoteApi extends ApiClient {
  Map<String,dynamic>? sent;
  @override
  Future<dynamic> request(String path,{Map<String,dynamic>? body,bool captureToken=false}) async {
    sent=body;
    return {'currency':'INR','items':[{'name':'Bowl','quantity':1,'lineMinor':12500}],
      'subtotalMinor':12500,'deliveryMinor':3000,'otherMinor':0,'totalMinor':15500};
  }
}
void main(){
  final dish={'id':'dish','name':'Bowl','currency':'INR','priceMinor':10000};
  test('switching restaurants preserves the basket until reset is confirmed',(){
    final cart=ShoppingState()..add('a','A',dish);
    expect(()=>cart.add('b','B',dish), throwsStateError);
    expect(cart.restaurantId,'a');
    cart.add('b','B',dish,replace:true);
    expect(cart.restaurantId,'b');
    expect(cart.count,1);
  });
  testWidgets('review displays the server quote and sends no client prices',(tester) async {
    final cart=ShoppingState()..add('a','A',dish)..setDelivery({'street':'Test road','phone':'12345678','latitude':0,'longitude':0});
    final api=QuoteApi();
    await tester.pumpWidget(MaterialApp(home:QuoteReview(api:api,shopping:cart)));
    await tester.pumpAndSettle();
    expect(api.sent?['items'],[{'itemId':'dish','quantity':1}]);
    expect(find.text('INR 155.00'),findsOneWidget);
    expect(find.text('INR 30.00'),findsOneWidget);
  });
}
