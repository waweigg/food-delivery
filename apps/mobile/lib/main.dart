import 'package:flutter/material.dart';
import 'api_client.dart';
import 'storefront.dart';
import 'brand.dart';

void main() => runApp(const FoodDeliveryApp());

class FoodDeliveryApp extends StatelessWidget {
  const FoodDeliveryApp({super.key, this.api});
  final ApiClient? api;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'waweigg',
    debugShowCheckedModeBanner: false,
    theme: AppBrand.theme,
    home: Storefront(api: api ?? ApiClient()),
  );
}
