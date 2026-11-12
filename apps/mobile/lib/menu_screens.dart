import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'api_client.dart';
import 'brand.dart';
import 'shopping_state.dart';
import 'storefront.dart' show BasketScreen;

int? parsePrice(String value) {
  final match = RegExp(r'^(\d{1,8})(?:\.(\d{1,2}))?$').firstMatch(value.trim());
  if (match == null) return null;
  final result = int.parse(match[1]!) * 100 + int.parse((match[2] ?? '').padRight(2, '0'));
  return result > 0 && result <= 2147483647 ? result : null;
}
String priceText(int paise) => '${paise ~/ 100}.${(paise % 100).toString().padLeft(2, '0')}';

class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key, required this.api, required this.restaurantId, required this.restaurantName, this.manage = false, this.shopping, this.previewMenu});
  final Map<String, dynamic>? previewMenu;
  final ShoppingState? shopping;
  final ApiClient api;
  final String restaurantId, restaurantName;
  final bool manage;
  @override
  State<MenuScreen> createState() => _MenuScreenState();
}
class _MenuScreenState extends State<MenuScreen> {
  final localShopping = ShoppingState();
  ShoppingState get shopping => widget.shopping ?? localShopping;
  String query = '';
  String? selectedCategory;
  Map<String, dynamic>? menu;
  bool busy = false;
  String? error;
  String get path => '/${widget.manage ? 'restaurant-onboarding' : 'catalog/restaurants'}/${widget.restaurantId}/menu';
  List<dynamic> get categories => menu?['categories'] as List? ?? [];
  @override
  void initState() { super.initState(); load(); }
  @override
  void dispose() { localShopping.dispose(); super.dispose(); }
  Future<void> execute(Future<void> Function() action) async {
    setState(() { busy = true; error = null; });
    try { await action(); }
    on ApiException catch (e) {
      if (mounted) { if (e.status == 401) { Navigator.pop(context, true); } else { setState(() => error = e.message); } }
    } catch (_) { if (mounted) setState(() => error = 'Unable to update the menu. Please try again.'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> refresh() async {
    final result = widget.previewMenu ?? await widget.api.request(path) as Map;
    if (mounted) setState(() => menu = Map<String, dynamic>.from(result));
  }
  Future<void> load() => execute(refresh);
  Future<void> mutate(String suffix, Map<String, dynamic> body) => execute(() async {
    await widget.api.request('$path$suffix', body: {'menuVersion': menu!['menuVersion'], ...body});
    await refresh();
  });
  Future<void> category([Map<String, dynamic>? row]) async {
    final controller = TextEditingController(text: row?['name'] as String? ?? '');
    final name = await showDialog<String>(context: context, builder: (context) => AlertDialog(
      title: Text(row == null ? 'Add category' : 'Rename category'),
      content: TextField(controller: controller, autofocus: true, maxLength: 80, decoration: const InputDecoration(labelText: 'Category name')),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () { if (controller.text.trim().isNotEmpty) Navigator.pop(context, controller.text.trim()); }, child: const Text('Save'))],
    ));
    // The route may still animate its text field out; dispose after that animation.
    Future<void>.delayed(const Duration(milliseconds: 400), controller.dispose);
    if (name != null && mounted) await mutate(row == null ? '/categories' : '/categories/${row['id']}', {'name': name});
  }
  Future<void> archive(String suffix, String label) async {
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: Text('Archive $label?'), content: const Text('It will be removed from the menu. Archiving a category also archives its items. Existing records are kept.'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Archive'))]));
    if (confirmed == true && mounted) await mutate(suffix, {});
  }
  Future<void> move(int index, int delta) async {
    final ids = categories.map((c) => c['id']).toList();
    final item = ids.removeAt(index); ids.insert(index + delta, item);
    await mutate('/categories/reorder', {'ids': ids});
  }
  Future<void> editItem(Map<String, dynamic> category, [Map<String, dynamic>? item]) async {
    final expired = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => MenuItemEditor(api: widget.api, path: path, menuVersion: menu!['menuVersion'] as int, currency: menu!['currency'] as String, categories: categories, categoryId: category['id'] as String, item: item)));
    if (!mounted) return;
    if (expired == true) { Navigator.pop(context, true); } else { await load(); }
  }
  Map<String, dynamic> itemBody(Map<String, dynamic> item) => {for (final key in ['categoryId', 'name', 'description', 'priceMinor', 'currency', 'available', 'photoId']) key: item[key]};
  Future<void> addToBasket(Map<String, dynamic> item) async {
    var replace = false;
    if (shopping.needsReplacement(widget.restaurantId)) {
      replace = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Start a new basket?'), content: Text('Your basket contains items from ${shopping.restaurantName}. Replace them with items from ${widget.restaurantName}?'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep basket')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Start new basket'))])) ?? false;
      if (!replace || !mounted) { return; }
    }
    if (shopping.lines.isNotEmpty && !replace && shopping.currency != item['currency']) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This item uses a different currency. Clear your basket first.')));
      return;
    }
    shopping.add(widget.restaurantId, widget.restaurantName, item, replace: replace);
    if (mounted) { ScaffoldMessenger.of(context).hideCurrentSnackBar(); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${item['name']} added to your draft basket'), duration: const Duration(seconds: 2))); }
  }
  void itemDetails(Map<String, dynamic> item) {
    showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (context) => SafeArea(child: Padding(padding: const EdgeInsets.all(24), child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (item['photoUrl'] != null) MenuPhoto(api: widget.api, path: item['photoUrl'] as String),
      Text(item['name'] as String, style: Theme.of(context).textTheme.headlineMedium), const SizedBox(height: 12), Text(item['description'] as String), const SizedBox(height: 20), Text('${item['currency']} ${priceText(item['priceMinor'] as int)}', style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 20),
      FilledButton(onPressed: () { Navigator.pop(context); addToBasket(item); }, child: const Text('Add to draft basket')),
    ])))));
  }
  Widget customerMenu() => AnimatedBuilder(animation: shopping, builder: (context, _) {
    final visibleCategories = categories.where((c) => selectedCategory == null || c['id'] == selectedCategory).toList();
    final matches = visibleCategories.fold<int>(0, (sum, c) => sum + (c['items'] as List).where((i) => '${i['name']} ${i['description']}'.toLowerCase().contains(query)).length);
    return Scaffold(
      appBar: AppBar(title: const Text('Explore the menu'), actions: [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: 'Refresh menu')]),
      bottomNavigationBar: shopping.count == 0 ? null : SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(20, 10, 20, 14), child: FilledButton(onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => BasketScreen(api: widget.api, shopping: shopping))), child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: [const Icon(Icons.shopping_bag_outlined), const SizedBox(width: 10), Expanded(child: Text('View basket · ${shopping.count}')), Text('${shopping.currency} ${priceText(shopping.subtotal)}')]))))),
      body: RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 28), children: [
        Container(padding: const EdgeInsets.all(22), decoration: BoxDecoration(color: AppBrand.peach, borderRadius: BorderRadius.circular(24)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.restaurant_menu_rounded, size: 36, color: AppBrand.orange), const SizedBox(height: 18), Text(widget.restaurantName, style: Theme.of(context).textTheme.headlineMedium), const SizedBox(height: 10), const Text('Find something you’ll love, one dish at a time.'), const SizedBox(height: 16), const StatusPill('Menu preview')])),
        const SizedBox(height: 18), TextField(onChanged: (value) => setState(() => query = value.trim().toLowerCase()), decoration: const InputDecoration(hintText: 'Search this menu', prefixIcon: Icon(Icons.search))),
        const SizedBox(height: 14), if (categories.isNotEmpty) SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: const Text('All dishes'), selected: selectedCategory == null, onSelected: (_) => setState(() => selectedCategory = null))), for (final c in categories) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(c['name'] as String), selected: selectedCategory == c['id'], onSelected: (_) => setState(() => selectedCategory = c['id'] as String)))])),
        if (busy) const LinearProgressIndicator(),
        if (error != null) EmptyPanel(icon: Icons.wifi_off_rounded, title: 'The menu couldn’t load', message: error!, action: OutlinedButton(onPressed: load, child: const Text('Try again'))),
        if (!busy && error == null && matches == 0) EmptyPanel(icon: Icons.restaurant_outlined, title: query.isEmpty ? 'The kitchen is getting ready' : 'No dishes found', message: query.isEmpty ? 'Available dishes will appear here when the restaurant adds them.' : 'Try another name or choose a different category.'),
        for (final c in visibleCategories) if ((c['items'] as List).any((i) => '${i['name']} ${i['description']}'.toLowerCase().contains(query))) ...[
          Padding(padding: const EdgeInsets.only(top: 22, bottom: 8), child: Text(c['name'] as String, style: Theme.of(context).textTheme.titleLarge)),
          for (final raw in c['items'] as List) if ('${raw['name']} ${raw['description']}'.toLowerCase().contains(query)) Builder(builder: (context) {
            final item = Map<String, dynamic>.from(raw as Map);
            return Card(clipBehavior: Clip.antiAlias, child: InkWell(onTap: () => itemDetails(item), child: Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(item['name'] as String, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 7), Text(item['description'] as String, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)), const SizedBox(height: 14), Text('${item['currency']} ${priceText(item['priceMinor'] as int)}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppBrand.ink))])),
              const SizedBox(width: 12), SizedBox(width: 94, child: Column(children: [ClipRRect(borderRadius: BorderRadius.circular(14), child: item['photoUrl'] == null ? Container(height: 80, color: AppBrand.canvas, alignment: Alignment.center, child: const Icon(Icons.restaurant_rounded, color: AppBrand.orange, size: 32)) : Image.network(widget.api.imageUrl(item['photoUrl'] as String), height: 80, width: 94, fit: BoxFit.cover, errorBuilder: (_, error, stack) => const SizedBox(height: 80, child: Icon(Icons.restaurant_rounded, color: AppBrand.orange)))), const SizedBox(height: 8), SizedBox(width: double.infinity, child: OutlinedButton(onPressed: (shopping.lines[item['id']]?.quantity ?? 0) >= 99 ? null : () => addToBasket(item), child: const Text('Add')))])),
            ]))));
          }),
        ],
        const SizedBox(height: 24), Text(widget.previewMenu == null ? 'Test orders only. No payment required.' : 'Offline menu preview.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12)),
      ])),
    );
  });
  @override
  Widget build(BuildContext context) => !widget.manage ? customerMenu() : Scaffold(
    appBar: AppBar(title: BrandTitle(widget.manage ? 'Manage menu' : 'Menu'), actions: [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: 'Refresh')]),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      Text(widget.restaurantName, style: Theme.of(context).textTheme.headlineSmall),
      if (!widget.manage) const Text('Ordering is coming soon.'),
      if (busy) const LinearProgressIndicator(),
      if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!)),
      if (widget.manage && menu != null) FilledButton.icon(onPressed: busy ? null : () => category(), icon: const Icon(Icons.add), label: const Text('Add category')),
      if (!busy && menu != null && categories.isEmpty) Text(widget.manage ? 'Add your first category to start building your menu.' : 'No menu items available yet.'),
      for (final (index, raw) in categories.indexed) Builder(builder: (context) {
        final c = Map<String, dynamic>.from(raw as Map);
        return Padding(padding: const EdgeInsets.only(top: 20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c['name'] as String, style: Theme.of(context).textTheme.titleLarge),
          if (widget.manage) Wrap(children: [
            TextButton(onPressed: busy ? null : () => category(c), child: const Text('Rename')),
            IconButton(onPressed: busy || index == 0 ? null : () => move(index, -1), icon: const Icon(Icons.arrow_upward), tooltip: 'Move category up'),
            IconButton(onPressed: busy || index == categories.length - 1 ? null : () => move(index, 1), icon: const Icon(Icons.arrow_downward), tooltip: 'Move category down'),
            TextButton(onPressed: busy ? null : () => archive('/categories/${c['id']}/archive', c['name'] as String), child: const Text('Archive category')),
          ]),
          if ((c['items'] as List).isEmpty) const Text('No items in this category.'),
          for (final rawItem in c['items'] as List) Builder(builder: (context) {
            final item = Map<String, dynamic>.from(rawItem as Map);
            return Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (item['photoUrl'] != null) MenuPhoto(api: widget.api, path: item['photoUrl'] as String, private: widget.manage),
              Text(item['name'] as String, style: Theme.of(context).textTheme.titleMedium),
              if ((item['description'] as String).isNotEmpty) Text(item['description'] as String),
              Text('${item['currency']} ${priceText(item['priceMinor'] as int)}'),
              if (widget.manage) ...[
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(item['available'] == true ? 'Available' : 'Hidden from customers'), value: item['available'] as bool, onChanged: busy ? null : (value) => mutate('/items/${item['id']}', {...itemBody(item), 'available': value})),
                Wrap(children: [TextButton(onPressed: busy ? null : () => editItem(c, item), child: const Text('Edit item')), TextButton(onPressed: busy ? null : () => archive('/items/${item['id']}/archive', item['name'] as String), child: const Text('Archive item'))]),
              ],
            ])));
          }),
          if (widget.manage) OutlinedButton.icon(onPressed: busy ? null : () => editItem(c), icon: const Icon(Icons.add), label: const Text('Add item')),
        ]));
      }),
    ]),
  );
}

class MenuPhoto extends StatelessWidget {
  const MenuPhoto({super.key, required this.api, required this.path, this.private = false});
  final ApiClient api;
  final String path;
  final bool private;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 12), child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network(api.imageUrl(path), headers: private ? api.imageHeaders : null, height: 160, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, error, stack) => const SizedBox(height: 80, child: Center(child: Text('Photo unavailable'))))));
}

class MenuItemEditor extends StatefulWidget {
  const MenuItemEditor({super.key, required this.api, required this.path, required this.menuVersion, required this.currency, required this.categories, required this.categoryId, this.item});
  final ApiClient api;
  final String path, currency, categoryId;
  final int menuVersion;
  final List<dynamic> categories;
  final Map<String, dynamic>? item;
  @override
  State<MenuItemEditor> createState() => _MenuItemEditorState();
}
class _MenuItemEditorState extends State<MenuItemEditor> {
  final form = GlobalKey<FormState>();
  late final TextEditingController name, description, price;
  late String categoryId;
  String? photoId, photoUrl, error;
  bool available = true, busy = false;
  @override
  void initState() {
    super.initState(); final item = widget.item;
    name = TextEditingController(text: item?['name'] as String? ?? '');
    description = TextEditingController(text: item?['description'] as String? ?? '');
    price = TextEditingController(text: item == null ? '' : priceText(item['priceMinor'] as int));
    categoryId = widget.categoryId; photoId = item?['photoId'] as String?; photoUrl = item?['photoUrl'] as String?; available = item?['available'] as bool? ?? true;
  }
  @override
  void dispose() { name.dispose(); description.dispose(); price.dispose(); super.dispose(); }
  Future<void> execute(Future<void> Function() action) async {
    setState(() { busy = true; error = null; });
    try { await action(); }
    on ApiException catch (e) { if (mounted) { if (e.status == 401) { Navigator.pop(context, true); } else { setState(() => error = e.status == 409 ? 'The menu changed. Go back and reopen this item before saving.' : e.message); } } }
    catch (_) { if (mounted) setState(() => error = 'Unable to complete this action. Please try again.'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> upload() => execute(() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false);
    if (file == null || !mounted) return;
    if (await file.length() > 5 * 1024 * 1024) throw const ApiException('Choose a photo smaller than 5 MiB.');
    final result = await widget.api.upload('${widget.path}/photos', await file.readAsBytes()) as Map;
    if (mounted) setState(() { photoId = result['id'] as String; photoUrl = result['photoUrl'] as String; });
  });
  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    await execute(() async {
      await widget.api.request('${widget.path}/items${widget.item == null ? '' : '/${widget.item!['id']}'}', body: {'menuVersion': widget.menuVersion, 'categoryId': categoryId, 'name': name.text.trim(), 'description': description.text.trim(), 'priceMinor': parsePrice(price.text), 'currency': widget.currency, 'available': available, 'photoId': photoId});
      if (mounted) Navigator.pop(context);
    });
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: BrandTitle(widget.item == null ? 'Add menu item' : 'Edit menu item')), body: Form(key: form, child: ListView(padding: const EdgeInsets.all(20), children: [
    if (busy) const LinearProgressIndicator(),
    DropdownButtonFormField<String>(initialValue: categoryId, decoration: const InputDecoration(labelText: 'Category'), items: widget.categories.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String))).toList(), onChanged: busy ? null : (value) => setState(() => categoryId = value!)),
    TextFormField(controller: name, enabled: !busy, maxLength: 120, decoration: const InputDecoration(labelText: 'Item name'), validator: (v) => v == null || v.trim().isEmpty ? 'Enter an item name' : null),
    TextFormField(controller: description, enabled: !busy, maxLength: 2000, maxLines: 3, decoration: const InputDecoration(labelText: 'Description')),
    TextFormField(controller: price, enabled: !busy, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Price (${widget.currency})', helperText: 'For example, 149.50'), validator: (v) => parsePrice(v ?? '') == null ? 'Enter a positive price with up to two decimal places' : null),
    SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Available to customers'), value: available, onChanged: busy ? null : (v) => setState(() => available = v)),
    if (photoUrl != null) MenuPhoto(api: widget.api, path: photoUrl!, private: true),
    const Text('JPEG, PNG or WebP · up to 5 MiB and 20 megapixels'),
    Wrap(children: [TextButton.icon(onPressed: busy ? null : upload, icon: const Icon(Icons.photo_library_outlined), label: const Text('Choose photo')), if (photoId != null) TextButton(onPressed: busy ? null : () => setState(() { photoId = null; photoUrl = null; }), child: const Text('Remove photo'))]),
    if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!)),
    FilledButton(onPressed: busy ? null : save, child: const Text('Save item')),
  ])));
}


