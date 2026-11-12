import 'dart:math';
import 'package:flutter/foundation.dart';

/// Session-only exploration state. Prices are display snapshots, never order quotes.
class BasketLine {
  BasketLine(this.item, {this.quantity = 1});
  final Map<String, dynamic> item;
  int quantity;
  int get total => (item['priceMinor'] as int) * quantity;
}
class ShoppingState extends ChangeNotifier {
  String? _intent, _key;
  String checkoutKey(String intent) {
    if (_intent != intent || _key == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(16, (_) => random.nextInt(256));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      _key = '${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}';
      _intent = intent;
    }
    return _key!;
  }
  final Set<String> favourites = {};
  final Map<String, BasketLine> lines = {};
  String? restaurantId, restaurantName;
  Map<String,dynamic> delivery = {};
  String get address => delivery['street'] as String? ?? '';
  int get count => lines.values.fold(0, (sum, line) => sum + line.quantity);
  int get subtotal => lines.values.fold(0, (sum, line) => sum + line.total);
  String get currency => lines.isEmpty ? 'INR' : lines.values.first.item['currency'] as String;
  bool needsReplacement(String id) => lines.isNotEmpty && restaurantId != id;
  void favourite(String id) { if (!favourites.add(id)) { favourites.remove(id); } notifyListeners(); }
  void setDelivery(Map<String,dynamic> value) { delivery = Map.unmodifiable(value); notifyListeners(); }
  void add(String id, String name, Map<String, dynamic> item, {bool replace = false}) {
    if (needsReplacement(id) && !replace) { throw StateError('Confirm restaurant change first'); }
    if (replace) { lines.clear(); }
    if (lines.isNotEmpty && item['currency'] != currency) { throw StateError('Mixed currencies are not supported'); }
    restaurantId = id; restaurantName = name;
    final itemId = item['id'] as String;
    final existing = lines[itemId];
    if (existing == null) { lines[itemId] = BasketLine(Map<String, dynamic>.from(item)); }
    else if (existing.quantity < 99) { existing.quantity++; }
    notifyListeners();
  }
  void quantity(String id, int value) {
    if (!lines.containsKey(id) || value > 99) { return; }
    if (value <= 0) { lines.remove(id); } else { lines[id]!.quantity = value; }
    if (lines.isEmpty) { restaurantId = null; restaurantName = null; }
    notifyListeners();
  }
  void clear() { _key=null; _intent=null; lines.clear(); restaurantId = null; restaurantName = null; notifyListeners(); }
}


