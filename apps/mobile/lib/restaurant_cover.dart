import 'package:flutter/material.dart';

/// Artwork for the fictional local listing. Uploaded merchant photos take precedence.
class RestaurantCover extends StatelessWidget {
  const RestaurantCover({
    super.key,
    required this.restaurantId,
    this.height = 180,
  });
  final String restaurantId;
  final double height;

  @override
  Widget build(BuildContext context) {
    final asset = switch (restaurantId) {
      'mlp-demo-malabar' => 'malabar-biriyani',
      'mlp-demo-coconut' => 'kerala-meals',
      'mlp-demo-chaya' => 'chaya-snacks',
      _ => null,
    };
    if (asset != null) {
      return Image.asset(
        'assets/food/$asset.png',
        height: height,
        width: double.infinity,
        fit: BoxFit.cover,
        excludeFromSemantics: true,
      );
    }
    final tea = restaurantId == 'mlp-demo-chaya';
    return Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: tea
              ? const [Color(0xFF594032), Color(0xFFA5744E)]
              : const [Color(0xFF173D34), Color(0xFF4E7961)],
        ),
      ),
      child: Icon(
        tea ? Icons.local_cafe_rounded : Icons.restaurant_rounded,
        size: 64,
        color: Colors.white.withValues(alpha: .85),
        semanticLabel: tea ? 'Tea and snacks' : 'Restaurant',
      ),
    );
  }
}
