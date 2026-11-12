import 'location_picker.dart';
import 'payment_screen.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'api_client.dart';
import 'brand.dart';
import 'identity_screen.dart';
import 'menu_screens.dart';
import 'shopping_state.dart';

class Storefront extends StatefulWidget {
  const Storefront({super.key, required this.api});
  final ApiClient api;
  @override
  State<Storefront> createState() => _StorefrontState();
}

class _StorefrontState extends State<Storefront> {
  final shopping = ShoppingState();
  final search = TextEditingController();
  List<dynamic> restaurants = [];
  int tab = 0;
  bool busy = false, more = false, openOnly = false;
  int requestVersion = 0;
  String locationKey = "";
  bool checked = false;
  bool get hasLocation =>
      shopping.delivery["latitude"] is num &&
      shopping.delivery["longitude"] is num;
  String? error;
  @override
  void initState() {
    super.initState();
    shopping.addListener(locationChanged);
  }

  @override
  void dispose() {
    shopping.removeListener(locationChanged);
    shopping.dispose();
    search.dispose();
    super.dispose();
  }

  void locationChanged() {
    final key =
        '${shopping.delivery['latitude']}:${shopping.delivery['longitude']}';
    if (key == locationKey) {
      return;
    }
    locationKey = key;
    setState(() {
      restaurants = [];
      more = false;
      checked = false;
      search.clear();
    });
    load();
  }

  Future<void> chooseLocation() async {
    final selected = await selectLocation(context, shopping.delivery);
    if (selected != null && mounted) {
      shopping.setDelivery(selected);
    }
  }

  Future<void> load({bool append = false}) async {
    if (!hasLocation || (append && busy)) {
      return;
    }
    final version = ++requestVersion;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result =
          await widget.api.request(
                '/catalog/coverage',
                body: {
                  'latitude': shopping.delivery['latitude'],
                  'longitude': shopping.delivery['longitude'],
                  'offset': append ? restaurants.length : 0,
                },
              )
              as Map;
      if (mounted && version == requestVersion) {
        setState(() {
          restaurants = append
              ? [...restaurants, ...result['restaurants'] as List]
              : result['restaurants'] as List;
          more = result['hasMore'] == true;
          checked = true;
        });
      }
    } catch (_) {
      if (mounted && version == requestVersion) {
        setState(
          () => error =
              'We couldn’t check this location. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted && version == requestVersion) {
        setState(() => busy = false);
      }
    }
  }

  void menu(Map<String, dynamic> restaurant) {
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => MenuScreen(
          api: widget.api,
          restaurantId: restaurant['id'] as String,
          restaurantName: restaurant['name'] as String,
          shopping: shopping,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: shopping,
    builder: (context, _) => Scaffold(
      body: IndexedStack(
        index: tab,
        children: [
          discovery(false),
          discovery(true),
          BasketScreen(
            api: widget.api,
            shopping: shopping,
            embedded: true,
            onExplore: () => setState(() => tab = 0),
          ),
          IdentityScreen(
            api: widget.api,
            active: tab == 3,
            onBrowse: () => setState(() => tab = 0),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (value) => setState(() => tab = value),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: 'Explore',
          ),
          const NavigationDestination(
            icon: Icon(Icons.favorite_border),
            selectedIcon: Icon(Icons.favorite),
            label: 'Saved',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: shopping.count > 0,
              label: Text('${shopping.count}'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
            label: 'Basket',
          ),
          const NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Account',
          ),
        ],
      ),
    ),
  );

  Widget discovery(bool saved) {
    final query = saved ? '' : search.text.trim().toLowerCase();
    final filtered = restaurants
        .where(
          (r) =>
              (!saved || shopping.favourites.contains(r['id'])) &&
              (!openOnly || r['isOpen'] == true) &&
              (r['name'] as String).toLowerCase().contains(query),
        )
        .toList();
    final title = shopping.address.isNotEmpty
        ? shopping.address
        : hasLocation
        ? 'Selected location (${(shopping.delivery['latitude'] as num).toStringAsFixed(3)}, ${(shopping.delivery['longitude'] as num).toStringAsFixed(3)})'
        : 'Choose your delivery location';
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: () => load(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
          children: [
            Row(
              children: [
                const BrandLogo(height: 42),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'waweigg',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => tab = 3),
                  icon: const Icon(Icons.person_outline),
                  tooltip: 'Your account',
                ),
              ],
            ),
            const SizedBox(height: 18),
            Card(
              child: ListTile(
                leading: const Icon(
                  Icons.location_on_outlined,
                  color: AppBrand.orange,
                ),
                title: const Text('Delivering to'),
                subtitle: Text(title),
                trailing: const Icon(Icons.keyboard_arrow_down),
                onTap: chooseLocation,
              ),
            ),
            const SizedBox(height: 20),
            if (!hasLocation)
              EmptyPanel(
                icon: Icons.location_on_outlined,
                title: 'Good food starts with your location',
                message:
                    'Select where you want delivery. We’ll show only restaurants within your delivery area.',
                action: FilledButton(
                  onPressed: chooseLocation,
                  child: const Text('Select location'),
                ),
              )
            else if (busy && !checked)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Column(
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('Checking restaurants near you…'),
                  ],
                ),
              )
            else if (error != null)
              EmptyPanel(
                icon: Icons.wifi_off_rounded,
                title: 'Couldn’t check availability',
                message: error!,
                action: OutlinedButton(
                  onPressed: () => load(),
                  child: const Text('Retry'),
                ),
              )
            else if (checked && restaurants.isEmpty)
              EmptyPanel(
                icon: Icons.location_off_outlined,
                title: 'We don’t serve this location yet',
                message:
                    'There are no restaurants delivering to this location. Try another delivery address.',
                action: FilledButton(
                  onPressed: chooseLocation,
                  child: const Text('Change location'),
                ),
              )
            else if (checked) ...[
              Text(
                saved
                    ? 'Your nearby favourites'
                    : 'Restaurants delivering to you',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              if (restaurants.every((r) => r['isOpen'] != true))
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'We serve this area, but these restaurants are currently closed. Browse their menus and check back later.',
                  ),
                ),
              if (shopping.lines.isNotEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'Your basket is saved for this visit. Review it to check delivery availability at this address.',
                  ),
                ),
              const SizedBox(height: 16),
              if (!saved)
                TextField(
                  controller: search,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Search nearby restaurants',
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('All restaurants'),
                    selected: !openOnly,
                    onSelected: (_) => setState(() => openOnly = false),
                  ),
                  ChoiceChip(
                    label: const Text('Open now'),
                    selected: openOnly,
                    onSelected: (value) => setState(() => openOnly = value),
                  ),
                ],
              ),
              if (busy) const LinearProgressIndicator(),
              if (filtered.isEmpty)
                EmptyPanel(
                  icon: Icons.search_off,
                  title: saved
                      ? 'No saved restaurants here'
                      : 'No matching restaurants',
                  message: 'Try another filter or location.',
                ),
              for (final r in filtered)
                RestaurantTile(
                  restaurant: Map<String, dynamic>.from(r as Map),
                  saved: shopping.favourites.contains(r['id']),
                  onSave: () => shopping.favourite(r['id'] as String),
                  onTap: () => menu(Map<String, dynamic>.from(r)),
                ),
              if (more)
                OutlinedButton(
                  onPressed: busy ? null : () => load(append: true),
                  child: const Text('Load more restaurants'),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class FoodHero extends StatelessWidget {
  const FoodHero({super.key});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppBrand.peach,
      borderRadius: BorderRadius.circular(24),
    ),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'YOUR NEXT FAVOURITE',
                style: TextStyle(
                  color: AppBrand.orange,
                  fontSize: 10,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Good food. Great mood.',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 6),
              const Text(
                'Find a little joy on the menu.',
                style: TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Container(
          width: 64,
          height: 64,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
          ),
          child: const Center(
            child: Icon(
              Icons.ramen_dining_rounded,
              size: 38,
              color: AppBrand.orange,
            ),
          ),
        ),
      ],
    ),
  );
}

class RestaurantTile extends StatelessWidget {
  const RestaurantTile({
    super.key,
    required this.restaurant,
    required this.saved,
    required this.onSave,
    required this.onTap,
  });
  final Map<String, dynamic> restaurant;
  final bool saved;
  final VoidCallback onSave, onTap;
  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 112,
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFFE7F0F7), Color(0xFFF9E6D7)],
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.storefront_rounded,
                  size: 58,
                  color: AppBrand.orange,
                ),
                const Spacer(),
                Align(
                  alignment: Alignment.topRight,
                  child: IconButton.filledTonal(
                    onPressed: onSave,
                    tooltip: saved ? 'Unsave restaurant' : 'Save restaurant',
                    icon: Icon(saved ? Icons.favorite : Icons.favorite_border),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  restaurant['name'] as String,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  restaurant['address'] as String,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 16,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusPill(
                      restaurant['isOpen'] == true
                          ? 'Open now'
                          : 'Currently closed',
                      positive: restaurant['isOpen'] == true,
                    ),
                    const Text(
                      'View menu →',
                      style: TextStyle(
                        color: AppBrand.orange,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

Future<void> editDeliveryAddress(
  BuildContext context,
  ShoppingState shopping,
) async {
  final value = await showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => DeliveryForm(initial: shopping.delivery),
  );
  if (value != null) shopping.setDelivery(value);
}

class DeliveryForm extends StatefulWidget {
  const DeliveryForm({super.key, required this.initial});
  final Map<String, dynamic> initial;
  @override
  State<DeliveryForm> createState() => _DeliveryFormState();
}

class _DeliveryFormState extends State<DeliveryForm> {
  final form = GlobalKey<FormState>();
  final values = <String, dynamic>{};
  Widget field(String key, String label, {int? range, int max = 500}) =>
      TextFormField(
        initialValue: widget.initial[key]?.toString(),
        maxLength: max,
        decoration: InputDecoration(labelText: label),
        keyboardType: range != null
            ? const TextInputType.numberWithOptions(decimal: true, signed: true)
            : key == 'phone'
            ? TextInputType.phone
            : TextInputType.text,
        validator: (raw) {
          final v = (raw ?? '').trim();
          if (key == 'instructions') return null;
          if (v.isEmpty) return 'Required';
          if (range != null) {
            final n = double.tryParse(v);
            if (n == null || !n.isFinite || n.abs() > range) {
              return 'Enter a coordinate between -$range and $range';
            }
          }
          if (key == 'phone' &&
              (!RegExp(r'^\+?[0-9 ()-]+$').hasMatch(v) ||
                  !RegExp(
                    r'^\d{7,15}$',
                  ).hasMatch(v.replaceAll(RegExp(r'\D'), '')))) {
            return 'Enter a valid contact number';
          }
          return null;
        },
        onSaved: (raw) {
          final v = (raw ?? '').trim();
          values[key] = range == null ? v : double.parse(v);
        },
      );
  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        8,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: Form(
        key: form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Delivery address',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            if (kDebugMode) ...[
              OutlinedButton.icon(
                icon: const Icon(Icons.location_city_outlined),
                label: const Text('Use Malappuram demo address'),
                onPressed: () => Navigator.pop(context, <String, dynamic>{
                  'street': 'Demo home, Malappuram, Kerala',
                  'latitude': 11.074,
                  'longitude': 76.0745,
                  'phone': '0000000000',
                  'instructions': 'Local test only — do not deliver',
                }),
              ),
              const SizedBox(height: 16),
            ],
            field('street', 'Building, street and area'),
            field('phone', 'Contact number', max: 32),
            const Text(
              'Enter the coordinates of your delivery entrance to check coverage.',
            ),
            field('latitude', 'Latitude', range: 90, max: 24),
            field('longitude', 'Longitude', range: 180, max: 24),
            field('instructions', 'Delivery instructions (optional)'),
            FilledButton(
              onPressed: () {
                if (form.currentState!.validate()) {
                  form.currentState!.save();
                  Navigator.pop(context, values);
                }
              },
              child: const Text('Use this address'),
            ),
          ],
        ),
      ),
    ),
  );
}

class BasketScreen extends StatelessWidget {
  const BasketScreen({
    super.key,
    required this.shopping,
    required this.api,
    this.embedded = false,
    this.onExplore,
  });
  final ShoppingState shopping;
  final ApiClient api;
  final bool embedded;
  final VoidCallback? onExplore;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: shopping,
    builder: (context, _) => Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !embedded,
        title: const Text('Your basket'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (shopping.lines.isEmpty)
            EmptyPanel(
              icon: Icons.shopping_bag_outlined,
              title: 'Something delicious is missing',
              message:
                  'Explore a restaurant’s menu and add a few favourites to your draft basket.',
              action: FilledButton(
                onPressed: onExplore ?? () => Navigator.pop(context),
                child: const Text('Explore restaurants'),
              ),
            )
          else ...[
            const StatusPill('Draft basket'),
            const SizedBox(height: 12),
            Text(
              shopping.restaurantName!,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Saved for this visit. Prices and availability need to be confirmed before ordering.',
            ),
            const SizedBox(height: 16),
            for (final entry in shopping.lines.entries)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.value.item['name'] as String,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${shopping.currency} ${priceText(entry.value.total)}',
                              style: const TextStyle(
                                color: AppBrand.ink,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => shopping.quantity(
                              entry.key,
                              entry.value.quantity - 1,
                            ),
                            tooltip: 'Remove one ${entry.value.item['name']}',
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                          Text('${entry.value.quantity}'),
                          IconButton(
                            onPressed: entry.value.quantity >= 99
                                ? null
                                : () => shopping.quantity(
                                    entry.key,
                                    entry.value.quantity + 1,
                                  ),
                            tooltip: 'Add one ${entry.value.item['name']}',
                            icon: const Icon(
                              Icons.add_circle_outline,
                              color: AppBrand.orange,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 20),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.location_on_outlined,
                color: AppBrand.orange,
              ),
              title: const Text('Delivery address'),
              subtitle: Text(
                shopping.address.isEmpty
                    ? 'Add building, street and area'
                    : shopping.address,
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => editDeliveryAddress(context, shopping),
            ),
            const Divider(),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Item subtotal',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: AppBrand.ink,
                    ),
                  ),
                ),
                Text(
                  '${shopping.currency} ${priceText(shopping.subtotal)}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ],
            ),
            const SizedBox(height: 10),
            const Text(
              'Review your basket to check delivery coverage, current prices and fees.',
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => shopping.restaurantId == 'local-sample'
                      ? OrderReview(shopping: shopping)
                      : QuoteReview(api: api, shopping: shopping),
                ),
              ),
              child: const Text('Review basket'),
            ),
            TextButton(
              onPressed: shopping.clear,
              child: const Text('Clear basket'),
            ),
          ],
        ],
      ),
    ),
  );
}

class OrderReview extends StatelessWidget {
  const OrderReview({super.key, required this.shopping});
  final ShoppingState shopping;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Order review')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const StatusPill('Preview · no order will be placed'),
        const SizedBox(height: 24),
        Text(
          'Almost at the table.',
          style: Theme.of(context).textTheme.headlineLarge,
        ),
        const SizedBox(height: 12),
        const Text(
          'This is a preview of your basket. Checkout and live delivery tracking are coming in a later update.',
        ),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  shopping.restaurantName ?? 'Restaurant',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                for (final line in shopping.lines.values)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text('${line.quantity} × ${line.item['name']}'),
                  ),
                const Divider(),
                Text(
                  'Item subtotal: ${shopping.currency} ${priceText(shopping.subtotal)}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
          ),
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.location_on_outlined),
          title: const Text('Delivery address'),
          subtitle: Text(
            shopping.address.isEmpty ? 'Not added yet' : shopping.address,
          ),
          onTap: () async {
            await editDeliveryAddress(context, shopping);
          },
        ),
        const SizedBox(height: 20),
        const FilledButton(
          onPressed: null,
          child: Text('Ordering not available yet'),
        ),
        const SizedBox(height: 8),
        const Text(
          'No payment will be collected.',
          textAlign: TextAlign.center,
        ),
      ],
    ),
  );
}

class QuoteReview extends StatefulWidget {
  const QuoteReview({super.key, required this.api, required this.shopping});
  final ApiClient api;
  final ShoppingState shopping;
  @override
  State<QuoteReview> createState() => _QuoteReviewState();
}

class _QuoteReviewState extends State<QuoteReview> {
  Map<String, dynamic>? quote;
  String? error;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    final cart = widget.shopping;
    setState(() {
      quote = null;
      error = null;
      busy = cart.delivery.isNotEmpty;
    });
    if (!busy) {
      return;
    }
    if (cart.address.trim().isEmpty ||
        (cart.delivery['phone']?.toString().trim() ?? '').isEmpty) {
      setState(() {
        busy = false;
        error =
            'Add your building, street and contact number before reviewing this basket.';
      });
      return;
    }
    try {
      final result = await widget.api.request(
        '/catalog/restaurants/${cart.restaurantId}/quote',
        body: {
          'address': cart.delivery,
          'currency': cart.currency,
          'items': [
            for (final e in cart.lines.entries)
              {'itemId': e.key, 'quantity': e.value.quantity},
          ],
        },
      );
      if (mounted) {
        setState(() => quote = Map<String, dynamic>.from(result as Map));
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Map<String, dynamic>? receipt;
  Future<void> place() async {
    if (busy || quote == null) return;
    if (!widget.api.signedIn) {
      await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) =>
              IdentityScreen(api: widget.api, returnAfterLogin: true),
        ),
      );
      if (mounted) setState(() {});
      return;
    }
    final cart = widget.shopping;
    final basket = {
      'address': cart.delivery,
      'currency': cart.currency,
      'items': [
        for (final e in cart.lines.entries)
          {'itemId': e.key, 'quantity': e.value.quantity},
      ],
    };
    final data = {
      'restaurantId': cart.restaurantId,
      'basket': basket,
      'review': quote,
    };
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.api.request(
        '/orders',
        body: {...data, 'key': cart.checkoutKey(jsonEncode(data))},
      );
      cart.clear();
      if (mounted) {
        setState(() => receipt = Map<String, dynamic>.from(result as Map));
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          error = e.message;
          if (e.status == 409 || e.status == 422) quote = null;
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget amount(String title, int minor) =>
      ListTile(title: Text(title), trailing: Text('INR ${priceText(minor)}'));
  @override
  Widget build(BuildContext context) {
    final confirmed = receipt;
    if (confirmed != null) {
      final details = confirmed['quote'];
      return Scaffold(
        appBar: AppBar(title: const Text('Test order placed')),
        body: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 54),
            const SizedBox(height: 18),
            Text(
              'Order ${confirmed['id']}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            for (final line in details['items'])
              amount(
                '${line['quantity']} × ${line['name']}',
                line['lineMinor'],
              ),
            amount('Total', details['totalMinor']),
            Text(
              confirmed['payment_state'] == 'PAID'
                  ? 'Paid with test funds.'
                  : 'Unpaid test order.',
            ),
            if (confirmed['payment_state'] != 'PAID')
              FilledButton(
                onPressed: () async {
                  final paid = await Navigator.push<bool>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => PaymentScreen(
                        api: widget.api,
                        orderId: confirmed['id'],
                      ),
                    ),
                  );
                  if (mounted && paid == true) {
                    setState(() => confirmed['payment_state'] = 'PAID');
                  }
                },
                child: const Text('Make test payment'),
              ),
            FilledButton(
              onPressed: () => Navigator.popUntil(context, (r) => r.isFirst),
              child: const Text('Back to Explore'),
            ),
          ],
        ),
      );
    }
    final q = quote;
    return Scaffold(
      appBar: AppBar(title: const Text('Order review')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            widget.shopping.restaurantName ?? '',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          ListTile(
            title: const Text('Delivery address'),
            subtitle: Text(
              widget.shopping.address.isEmpty
                  ? 'Add your address to check delivery'
                  : widget.shopping.address,
            ),
            trailing: const Icon(Icons.edit_outlined),
            onTap: busy
                ? null
                : () async {
                    await editDeliveryAddress(context, widget.shopping);
                    if (mounted) await refresh();
                  },
          ),
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            EmptyPanel(
              icon: Icons.info_outline,
              title: 'Basket needs attention',
              message: error!,
              action: OutlinedButton(
                onPressed: refresh,
                child: const Text('Check again'),
              ),
            ),
          if (q != null) ...[
            for (final line in q['items'] as List)
              amount(
                '${line['quantity']} × ${line['name']}',
                line['lineMinor'] as int,
              ),
            const Divider(),
            amount('Food subtotal', q['subtotalMinor'] as int),
            amount('Delivery fee', q['deliveryMinor'] as int),
            amount('Other charges', q['otherMinor'] as int),
            const Divider(),
            amount('Total', q['totalMinor'] as int),
            const Text(
              'Local test only. Use simulated payment; an approved test driver can receive an offer after the restaurant marks the order ready.',
            ),
            FilledButton(
              onPressed: busy ? null : place,
              child: Text(
                widget.api.signedIn
                    ? 'Place test order'
                    : 'Sign in to place a test order',
              ),
            ),
          ],
        ],
      ),
    );
  }
}
