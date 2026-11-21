import 'kitchen_screen.dart';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'brand.dart';
import 'partner_widgets.dart';
import 'restaurant_cover.dart';
import 'menu_screens.dart';

enum RestaurantView { catalog, mine, admin }

const weekDays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
String clockTime(int value) =>
    '${(value ~/ 60).toString().padLeft(2, '0')}:${(value % 60).toString().padLeft(2, '0')}';
String hoursText(dynamic hours) => (hours as List).isEmpty
    ? 'No opening hours set'
    : hours
          .map(
            (p) =>
                '${weekDays[p['day'] as int]} ${clockTime(p['open'] as int)}–${clockTime(p['close'] as int)}${p['close'] < p['open'] ? ' (next day)' : ''}',
          )
          .join('\n');

class RestaurantScreen extends StatefulWidget {
  const RestaurantScreen({super.key, required this.api, required this.view});
  final ApiClient api;
  final RestaurantView view;
  @override
  State<RestaurantScreen> createState() => _RestaurantScreenState();
}

class _RestaurantScreenState extends State<RestaurantScreen> {
  List<dynamic> rows = [];
  bool busy = false;
  bool more = false;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load({bool append = false}) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final path = switch (widget.view) {
        RestaurantView.catalog => '/catalog/restaurants',
        RestaurantView.mine => '/restaurant-onboarding/mine',
        RestaurantView.admin => '/admin/restaurants',
      };
      final result =
          await widget.api.request(
                '$path${widget.view == RestaurantView.mine ? '' : '?offset=${append ? rows.length : 0}'}',
              )
              as List;
      if (mounted) {
        setState(() {
          rows = append ? [...rows, ...result] : result;
          more = widget.view != RestaurantView.mine && result.length == 50;
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        if (e.status == 401) {
          Navigator.pop(context, true);
        } else {
          setState(() => error = e.message);
        }
      }
    } catch (_) {
      if (mounted) setState(() => error = 'Unable to load restaurants.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> openEditor([Map<String, dynamic>? row]) async {
    final expired = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => RestaurantEditor(api: widget.api, restaurant: row),
      ),
    );
    if (!mounted) return;
    if (expired == true) {
      Navigator.pop(context, true);
    } else {
      await load();
    }
  }

  Future<void> openReview(Map<String, dynamic> row) async {
    final expired = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            RestaurantReview(api: widget.api, id: row['id'] as String),
      ),
    );
    if (!mounted) return;
    if (expired == true) {
      Navigator.pop(context, true);
    } else {
      await load();
    }
  }

  Future<void> openMenu(Map<String, dynamic> row) async {
    final expired = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => MenuScreen(
          api: widget.api,
          restaurantId: row['id'] as String,
          restaurantName: row['name'] as String,
          manage: widget.view == RestaurantView.mine,
        ),
      ),
    );
    if (mounted && expired == true) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: BrandTitle(switch (widget.view) {
        RestaurantView.catalog => 'Restaurants',
        RestaurantView.mine => 'My restaurants',
        RestaurantView.admin => 'Restaurant approvals',
      }),
      actions: [
        IconButton(
          onPressed: busy ? null : () => load(),
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
        ),
      ],
    ),
    body: ListView(
      padding: AppBrand.pageInsets(context),
      children: [
        if (widget.view == RestaurantView.mine) ...[
          const PartnerHero(
            eyebrow: 'waweigg partners',
            title: 'Your kitchen. Your craft.',
            message:
                'Manage your menu, welcome new orders and keep every pickup running smoothly.',
            icon: Icons.storefront_outlined,
          ),
          PartnerSection(
            title: 'My restaurants',
            subtitle: '${rows.length} registered locations',
          ),
          OutlinedButton.icon(
            onPressed: busy ? null : () => openEditor(),
            icon: const Icon(Icons.add),
            label: const Text('Register a restaurant'),
          ),
          const SizedBox(height: 12),
        ],
        if (busy) const LinearProgressIndicator(),
        if (error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(error!, semanticsLabel: error),
          ),
        if (!busy && rows.isEmpty)
          Text(switch (widget.view) {
            RestaurantView.catalog =>
              'No approved restaurants are available yet.',
            RestaurantView.mine => 'Submit your restaurant details for review.',
            RestaurantView.admin => 'No restaurant applications yet.',
          }),
        for (final raw in rows)
          Builder(
            builder: (context) {
              final row = Map<String, dynamic>.from(raw as Map);
              return Card(
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (widget.view == RestaurantView.mine)
                      RestaurantCover(
                        restaurantId: row['id'] as String,
                        height: 150,
                      ),
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            row['name'] as String,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              StatusPill(
                                widget.view == RestaurantView.catalog
                                    ? (row['isOpen'] == true
                                          ? 'Open now'
                                          : 'Currently closed')
                                    : '${row['status']}',
                                positive: widget.view == RestaurantView.catalog
                                    ? row['isOpen'] == true
                                    : row['status'] == 'APPROVED',
                              ),
                              if (widget.view != RestaurantView.catalog)
                                StatusPill(
                                  row['active'] == true ? 'Active' : 'Inactive',
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(row['address'] as String),
                          const SizedBox(height: 18),
                          if (widget.view == RestaurantView.mine &&
                              row['status'] == 'APPROVED')
                            FilledButton.icon(
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => KitchenScreen(
                                    api: widget.api,
                                    path: '/orders/kitchen/${row['id']}',
                                  ),
                                ),
                              ),
                              icon: const Icon(Icons.soup_kitchen),
                              label: const Text('Open kitchen queue'),
                            ),
                          const SizedBox(height: 10),
                          if (widget.view != RestaurantView.admin)
                            OutlinedButton.icon(
                              onPressed: busy ? null : () => openMenu(row),
                              icon: const Icon(Icons.restaurant_menu),
                              label: Text(
                                widget.view == RestaurantView.mine
                                    ? 'Manage menu'
                                    : 'View menu',
                              ),
                            ),
                          if (widget.view == RestaurantView.catalog) ...[
                            const SizedBox(height: 8),
                            Text('Opening hours · ${row['timezone']}'),
                            Text(hoursText(row['hours'])),
                            const SizedBox(height: 8),
                            const Text('Ordering is coming soon.'),
                          ] else
                            TextButton(
                              onPressed: busy
                                  ? null
                                  : () => widget.view == RestaurantView.mine
                                        ? openEditor(row)
                                        : openReview(row),
                              child: Text(
                                widget.view == RestaurantView.mine
                                    ? 'Edit profile'
                                    : 'Review application',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        if (more)
          TextButton(
            onPressed: busy ? null : () => load(append: true),
            child: const Text('Load more'),
          ),
      ],
    ),
  );
}

class _Period {
  _Period({this.day = 1, String start = '', String end = ''})
    : open = TextEditingController(text: start),
      close = TextEditingController(text: end);
  int day;
  final TextEditingController open;
  final TextEditingController close;
  void dispose() {
    open.dispose();
    close.dispose();
  }
}

int? parseClock(String value, {bool end = false}) {
  final match = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(value.trim());
  if (match == null) return null;
  final h = int.parse(match[1]!), m = int.parse(match[2]!);
  if (end && h == 24 && m == 0) return 1440;
  return h < 24 && m < 60 ? h * 60 + m : null;
}

class RestaurantEditor extends StatefulWidget {
  const RestaurantEditor({super.key, required this.api, this.restaurant});
  final ApiClient api;
  final Map<String, dynamic>? restaurant;
  @override
  State<RestaurantEditor> createState() => _RestaurantEditorState();
}

class _RestaurantEditorState extends State<RestaurantEditor> {
  final form = GlobalKey<FormState>();
  late final TextEditingController name, address, latitude, longitude, timezone;
  final List<_Period> periods = [];
  bool active = true, busy = false;
  DateTime? closure;
  String? error;
  @override
  void initState() {
    super.initState();
    final r = widget.restaurant;
    name = TextEditingController(text: r?['name'] as String? ?? '');
    address = TextEditingController(text: r?['address'] as String? ?? '');
    latitude = TextEditingController(text: r?['latitude']?.toString() ?? '');
    longitude = TextEditingController(text: r?['longitude']?.toString() ?? '');
    timezone = TextEditingController(text: r?['timezone'] as String? ?? '');
    active = r?['active'] as bool? ?? true;
    closure = r?['temporaryClosedUntil'] == null
        ? null
        : DateTime.parse(r!['temporaryClosedUntil'] as String).toLocal();
    for (final p in r?['hours'] as List? ?? []) {
      periods.add(
        _Period(
          day: p['day'] as int,
          start: clockTime(p['open'] as int),
          end: clockTime(p['close'] as int),
        ),
      );
    }
  }

  @override
  void dispose() {
    for (final c in [name, address, latitude, longitude, timezone]) {
      c.dispose();
    }
    for (final p in periods) {
      p.dispose();
    }
    super.dispose();
  }

  Future<void> chooseClosure() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      initialDate: now,
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.now(),
    );
    if (mounted && time != null) {
      setState(
        () => closure = DateTime(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
        ),
      );
    }
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final body = <String, dynamic>{
        'name': name.text.trim(),
        'address': address.text.trim(),
        'latitude': double.parse(latitude.text),
        'longitude': double.parse(longitude.text),
        'timezone': timezone.text.trim(),
        'active': active,
        'temporaryClosedUntil': closure?.toUtc().toIso8601String(),
        'hours': periods
            .map(
              (p) => {
                'day': p.day,
                'open': parseClock(p.open.text),
                'close': parseClock(p.close.text, end: true),
              },
            )
            .toList(),
      };
      final existing = widget.restaurant;
      if (existing != null) body['version'] = existing['version'];
      await widget.api.request(
        existing == null
            ? '/restaurant-onboarding'
            : '/restaurant-onboarding/${Uri.encodeComponent(existing['id'] as String)}/profile',
        body: body,
      );
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) {
        if (e.status == 401) {
          Navigator.pop(context, true);
        } else {
          setState(
            () => error = e.status == 409
                ? 'This profile changed. Go back and reopen it before saving.'
                : e.message,
          );
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() => error = 'Please check your restaurant details.');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget input(
    TextEditingController controller,
    String label, {
    String? hint,
    double? limit,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: TextFormField(
      controller: controller,
      enabled: !busy,
      decoration: InputDecoration(
        labelText: label,
        helperText: hint,
        border: const OutlineInputBorder(),
      ),
      keyboardType: limit == null
          ? TextInputType.text
          : const TextInputType.numberWithOptions(decimal: true, signed: true),
      validator: (value) {
        if (value == null || value.trim().isEmpty) return 'Required';
        if (limit != null) {
          final n = double.tryParse(value);
          if (n == null || !n.isFinite || n.abs() > limit) {
            return 'Enter a value between -$limit and $limit';
          }
        }
        return null;
      },
    ),
  );
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: BrandTitle(
        widget.restaurant == null ? 'Register restaurant' : 'Edit restaurant',
      ),
    ),
    body: Form(
      key: form,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (widget.restaurant != null)
            Text('Status: ${widget.restaurant!['status']}'),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'New applications need admin approval. Changes to the business name, pickup location or timezone require another review.',
            ),
          ),
          input(name, 'Restaurant name'),
          input(address, 'Pickup address'),
          input(latitude, 'Pickup latitude', limit: 90),
          input(longitude, 'Pickup longitude', limit: 180),
          input(
            timezone,
            'Restaurant timezone',
            hint: 'For example: Europe/London or Asia/Qatar',
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Restaurant active'),
            value: active,
            onChanged: busy ? null : (value) => setState(() => active = value),
          ),
          const SizedBox(height: 12),
          Text('Opening hours', style: Theme.of(context).textTheme.titleLarge),
          const Text(
            'Use 24-hour times. An earlier closing time means the next day. For a full day use 00:00–24:00. No periods means closed.',
          ),
          for (final p in periods)
            Padding(
              key: ObjectKey(p),
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<int>(
                          initialValue: p.day,
                          decoration: const InputDecoration(labelText: 'Day'),
                          items: List.generate(
                            7,
                            (i) => DropdownMenuItem(
                              value: i,
                              child: Text(weekDays[i]),
                            ),
                          ),
                          onChanged: busy
                              ? null
                              : (value) => setState(() => p.day = value!),
                        ),
                      ),
                      IconButton(
                        onPressed: busy
                            ? null
                            : () => setState(() {
                                periods.remove(p);
                                p.dispose();
                              }),
                        icon: const Icon(Icons.delete_outline),
                        tooltip: 'Remove period',
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: p.open,
                          enabled: !busy,
                          decoration: const InputDecoration(
                            labelText: 'Opens · HH:mm',
                          ),
                          validator: (v) =>
                              parseClock(v ?? '') == null ? 'Use HH:mm' : null,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: TextFormField(
                          controller: p.close,
                          enabled: !busy,
                          decoration: const InputDecoration(
                            labelText: 'Closes · HH:mm',
                          ),
                          validator: (v) =>
                              parseClock(v ?? '', end: true) == null ||
                                  parseClock(v ?? '', end: true) ==
                                      parseClock(p.open.text)
                              ? 'Use a different closing time'
                              : null,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          TextButton.icon(
            onPressed: busy || periods.length >= 28
                ? null
                : () => setState(() => periods.add(_Period())),
            icon: const Icon(Icons.add),
            label: const Text('Add opening period'),
          ),
          const SizedBox(height: 12),
          Text(
            closure == null
                ? 'No temporary closure'
                : 'Closed until ${closure!.toLocal()} (your device time)',
          ),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: busy ? null : chooseClosure,
                child: const Text('Set temporary closure'),
              ),
              if (closure != null)
                TextButton(
                  onPressed: busy ? null : () => setState(() => closure = null),
                  child: const Text('Clear closure'),
                ),
            ],
          ),
          if (error != null)
            Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
          FilledButton(
            onPressed: busy ? null : save,
            child: Text(
              busy
                  ? 'Saving…'
                  : widget.restaurant == null
                  ? 'Submit for review'
                  : 'Save changes',
            ),
          ),
        ],
      ),
    ),
  );
}

class RestaurantReview extends StatefulWidget {
  const RestaurantReview({super.key, required this.api, required this.id});
  final ApiClient api;
  final String id;
  @override
  State<RestaurantReview> createState() => _RestaurantReviewState();
}

class _RestaurantReviewState extends State<RestaurantReview> {
  Map<String, dynamic>? row;
  bool busy = false;
  String? error;
  final reason = TextEditingController();
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  Future<void> load() => execute(() async {
    final data = await widget.api.request('/admin/restaurants/${widget.id}');
    if (mounted) setState(() => row = Map<String, dynamic>.from(data as Map));
  });
  Future<void> execute(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) {
        if (e.status == 401) {
          Navigator.pop(context, true);
        } else {
          setState(
            () => error = e.status == 409
                ? 'Profile changed. Refresh and review the latest details.'
                : e.message,
          );
        }
      }
    } catch (_) {
      if (mounted) setState(() => error = 'Unable to complete the review.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> decide(String status) async {
    if (reason.text.trim().isEmpty) {
      setState(() => error = 'Enter a reason for this decision.');
      return;
    }
    await execute(() async {
      await widget.api.request(
        '/admin/restaurants/${widget.id}/decision',
        body: {
          'status': status,
          'reason': reason.text.trim(),
          'version': row!['version'],
        },
      );
      if (mounted) Navigator.pop(context);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const BrandTitle('Review restaurant'),
      actions: [
        IconButton(
          onPressed: busy ? null : load,
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (busy) const LinearProgressIndicator(),
        if (error != null) Text(error!),
        if (row != null) ...[
          Text(
            row!['name'] as String,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          Text(row!['address'] as String),
          Text('Pickup: ${row!['latitude']}, ${row!['longitude']}'),
          Text('Timezone: ${row!['timezone']}'),
          Text(
            'Status: ${row!['status']} · ${row!['active'] == true ? 'Active' : 'Inactive'}',
          ),
          const SizedBox(height: 16),
          Text(hoursText(row!['hours'])),
          if (row!['temporaryClosedUntil'] != null)
            Text('Temporarily closed until ${row!['temporaryClosedUntil']}'),
          const SizedBox(height: 20),
          TextField(
            controller: reason,
            enabled: !busy,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Decision reason',
              helperText:
                  'Confirm the business details and pickup location before approval.',
            ),
          ),
          FilledButton(
            onPressed: busy ? null : () => decide('APPROVED'),
            child: const Text('Approve restaurant'),
          ),
          OutlinedButton(
            onPressed: busy ? null : () => decide('SUSPENDED'),
            child: const Text('Suspend restaurant'),
          ),
          const SizedBox(height: 16),
          Text(
            'Review history',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final event in row!['approvals'] as List)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(event['action'] as String),
              subtitle: Text('${event['reason']}\n${event['createdAt']}'),
            ),
        ],
      ],
    ),
  );
}
