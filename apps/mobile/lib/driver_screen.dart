import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'api_client.dart';
import 'brand.dart';

class DriverScreen extends StatefulWidget {
  const DriverScreen({super.key, required this.api, this.admin = false});
  final ApiClient api;
  final bool admin;
  @override
  State<DriverScreen> createState() => _DriverState();
}

class _DriverState extends State<DriverScreen> with WidgetsBindingObserver {
  final name = TextEditingController(), vehicle = TextEditingController();
  Map<String, dynamic>? profile;
  List<dynamic> offers = [], applicants = [];
  bool loaded = false, busy = false, online = false;
  int generation = 0;
  String? error, completed;
  final pin = TextEditingController();
  Map<String, dynamic> deliveries = {};
  Timer? timer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    run(refresh);
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!busy && mounted && ModalRoute.of(context)?.isCurrent == true) {
        run(() async {
          if (online) {
            await sendLocation(generation);
          }
          await refresh();
        });
      }
    });
  }

  Future<void> offline() async {
    generation++;
    online = false;
    try {
      await widget.api.request('/driver/availability', body: {'online': false});
    } catch (_) {
      /* Server lease expires if disconnected. */
    }
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && online) {
      unawaited(offline());
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (online) {
      unawaited(offline());
    }
    pin.dispose();
    name.dispose();
    vehicle.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) {
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (online &&
          !(e is ApiException && [400, 409, 422, 429].contains(e.status))) {
        await offline();
      }
      if (mounted) {
        error = e is ApiException
            ? e.message
            : e is TimeoutException
            ? 'GPS could not find your location. Try outdoors with location enabled, then tap Go online.'
            : e.toString().replaceFirst('Exception: ', '');
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
          loaded = true;
        });
      }
    }
  }

  Future<void> refresh() async {
    if (widget.admin) {
      applicants = await widget.api.request('/driver-admin') as List;
      return;
    }
    final data = await widget.api.request('/driver/me');
    profile = data == null ? null : Map<String, dynamic>.from(data as Map);
    if (profile != null) {
      offers = await widget.api.request('/driver/offers') as List;
      deliveries = {};
      for (final o in offers) {
        if (o['state'] == 'ACCEPTED' &&
            ['ASSIGNED', 'PICKED_UP'].contains(o['dispatch_state'])) {
          deliveries[o['order_id']] = await widget.api.request(
            '/driver/deliveries/${o['order_id']}',
          );
        }
      }
      if (online && profile!['eligible'] != true) {
        await offline();
      }
    }
  }

  Future<void> sendLocation(int expected) async {
    final settings = Platform.isAndroid
        ? AndroidSettings(
            forceLocationManager: true,
            accuracy: LocationAccuracy.high,
            timeLimit: const Duration(seconds: 20),
          )
        : const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 20),
          );
    final p = await Geolocator.getCurrentPosition(locationSettings: settings);
    if (!mounted || generation != expected) {
      return;
    }
    if (p.accuracy > 100) {
      throw Exception('A more accurate GPS fix is needed. Try outdoors.');
    }
    await widget.api.request(
      '/driver/location',
      body: {
        'latitude': p.latitude,
        'longitude': p.longitude,
        'accuracy': p.accuracy,
        'observedAt': p.timestamp.toUtc().toIso8601String(),
      },
    );
  }

  Future<void> goOnline() async {
    final agreed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Share location while available'),
        content: const Text(
          'We use your precise location to find nearby deliveries. Keep this screen open and the phone unlocked. Updates stop when you leave. Only the latest location is kept and it is deleted after 15 minutes without updates. Only the customer of your active delivery can see your latest location until it ends.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (agreed != true) {
      return;
    }
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw Exception('Enable location services on your phone first.');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw Exception(
        'Location permission is needed to go online. Enable it in app settings.',
      );
    }
    final expected = ++generation;
    await sendLocation(expected);
    if (!mounted ||
        expected != generation ||
        WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      return;
    }
    await widget.api.request(
      '/driver/notifications',
      body: {'channel': 'foreground-poll'},
    );
    await widget.api.request('/driver/availability', body: {'online': true});
    if (!mounted ||
        expected != generation ||
        WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      await offline();
      return;
    }
    online = true;
    await refresh();
  }

  Future<void> progress(Map o, String action) async {
    if (action == 'pickup') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Confirm food pickup'),
          content: const Text(
            'Confirm only after the restaurant hands you this order.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Food collected'),
            ),
          ],
        ),
      );
      if (confirmed != true) {
        return;
      }
    }
    final result =
        await widget.api.request(
              '/driver/deliveries/${o['order_id']}',
              body: {
                'action': action,
                if (action == 'deliver') 'pin': pin.text.trim(),
              },
            )
            as Map;
    pin.clear();
    if (result['state'] == 'DELIVERED') {
      completed = 'Delivery completed. You can receive another offer.';
    }
    await refresh();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: BrandTitle(
        widget.admin ? 'Driver approvals' : 'Drive with waweigg',
      ),
      actions: [
        IconButton(
          onPressed: busy ? null : () => run(refresh),
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh drivers',
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (busy || !loaded) const LinearProgressIndicator(),
        if (completed != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Text(completed!),
            ),
          ),
        if (error != null && deliveries.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(error!, semanticsLabel: error),
          ),
        if (widget.admin) ...[
          if (loaded && applicants.isEmpty)
            const Text('No driver applications yet.'),
          for (final d in applicants)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d['name'],
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    Text('${d['vehicle']} · ${d['status']}'),
                    Wrap(
                      spacing: 8,
                      children: [
                        for (final status in [
                          'APPROVED',
                          'REJECTED',
                          'SUSPENDED',
                        ])
                          TextButton(
                            onPressed: busy
                                ? null
                                : () => run(() async {
                                    await widget.api.request(
                                      '/driver-admin/${Uri.encodeComponent(d['user_id'])}/review',
                                      body: {
                                        'version': d['version'],
                                        'status': status,
                                      },
                                    );
                                    await refresh();
                                  }),
                            child: Text(status),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ] else if (loaded && profile == null) ...[
          Icon(
            Icons.delivery_dining,
            size: 70,
            color: Theme.of(context).colorScheme.primary,
          ),
          Text(
            'Your next route starts here',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const Text(
            'Apply to deliver. An administrator must approve your profile before you can go online.',
          ),
          TextField(
            controller: name,
            maxLength: 100,
            decoration: const InputDecoration(labelText: 'Driver name'),
          ),
          TextField(
            controller: vehicle,
            maxLength: 100,
            decoration: const InputDecoration(
              labelText: 'Vehicle / taxi registration',
            ),
          ),
          FilledButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    if (name.text.trim().isEmpty ||
                        vehicle.text.trim().isEmpty) {
                      throw Exception('Enter your name and vehicle.');
                    }
                    await widget.api.request(
                      '/driver/apply',
                      body: {
                        'name': name.text.trim(),
                        'vehicle': vehicle.text.trim(),
                      },
                    );
                    await refresh();
                  }),
            child: const Text('Submit driver application'),
          ),
        ] else if (profile != null) ...[
          Card(
            color: online
                ? (Theme.of(context).brightness == Brightness.dark
                      ? Colors.green.shade900
                      : Colors.green.shade50)
                : Theme.of(context).colorScheme.primaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Icon(
                    Icons.delivery_dining,
                    size: 64,
                    color: online
                        ? (Theme.of(context).brightness == Brightness.dark
                              ? Colors.green.shade200
                              : Colors.green.shade700)
                        : Theme.of(context).colorScheme.primary,
                  ),
                  Text(
                    online ? 'You are online' : 'You are offline',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text('${profile!['name']} · ${profile!['status']}'),
                  const SizedBox(height: 12),
                  if (profile!['status'] == 'APPROVED')
                    FilledButton(
                      onPressed: busy
                          ? null
                          : () => run(online ? offline : goOnline),
                      child: Text(online ? 'Go offline' : 'Go online'),
                    )
                  else
                    const Text('Administrator approval is required.'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Foreground pilot: keep this screen open and your phone unlocked. Reconnect and tap Go online after interruptions. A location older than 60 seconds cannot receive offers.',
          ),
          const SizedBox(height: 24),
          Text(
            'Incoming offers',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (offers.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text(
                'No delivery offers yet. Stay online to receive nearby pickups.',
              ),
            ),
          for (final o in offers)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      o['pickup'],
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    Text(
                      'Order ${o['order_id'].toString().substring(0, 8)} · ${o['state']}',
                    ),
                    if (o['state'] == 'PENDING') ...[
                      Text(
                        'Respond before ${DateTime.parse(o['expires_at']).toLocal()}',
                      ),
                      Row(
                        children: [
                          for (final action in ['accept', 'decline'])
                            TextButton(
                              onPressed: busy
                                  ? null
                                  : () => run(() async {
                                      await widget.api.request(
                                        '/driver/offers/${o['id']}/$action',
                                        body: {},
                                      );
                                      await refresh();
                                    }),
                              child: Text(
                                action == 'accept'
                                    ? 'Accept offer'
                                    : 'Decline offer',
                              ),
                            ),
                        ],
                      ),
                    ] else if (deliveries[o['order_id']] != null) ...[
                      if (error != null &&
                          deliveries[o['order_id']]['state'] != 'PICKED_UP')
                        Text(error!),
                      Text(
                        'Restaurant ready · ${deliveries[o['order_id']]['state']}',
                      ),
                      if (deliveries[o['order_id']]['address'] != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          'Deliver to: ${deliveries[o['order_id']]['address']['street']}',
                        ),
                        Text(
                          'Phone: ${deliveries[o['order_id']]['address']['phone'] ?? ''}',
                        ),
                        Text(
                          deliveries[o['order_id']]['address']['instructions'] ??
                              '',
                        ),
                      ],
                      if (deliveries[o['order_id']]['issue'] != null)
                        Text(
                          'Support review: ${deliveries[o['order_id']]['issue']}',
                        ),
                      if (deliveries[o['order_id']]['state'] == 'ASSIGNED')
                        FilledButton(
                          onPressed: busy
                              ? null
                              : () => run(() => progress(o, 'pickup')),
                          child: const Text('Confirm pickup'),
                        ),
                      if (deliveries[o['order_id']]['state'] ==
                          'PICKED_UP') ...[
                        const Text(
                          'Ask for the customer PIN only after handing over the food.',
                        ),
                        TextField(
                          controller: pin,
                          obscureText: true,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          decoration: InputDecoration(
                            errorText: error,
                            labelText: 'Customer delivery PIN',
                          ),
                        ),
                        FilledButton(
                          onPressed: busy
                              ? null
                              : () => run(() => progress(o, 'deliver')),
                          child: const Text('Complete delivery'),
                        ),
                      ],
                      if ([
                        'ASSIGNED',
                        'PICKED_UP',
                      ].contains(deliveries[o['order_id']]['state']))
                        PopupMenuButton<String>(
                          tooltip: 'Report delivery issue',
                          onSelected: (reason) => run(() async {
                            await widget.api.request(
                              '/driver/deliveries/${o['order_id']}',
                              body: {'action': 'report', 'reason': reason},
                            );
                            await refresh();
                          }),
                          itemBuilder: (_) => [
                            for (final reason in [
                              'CUSTOMER_UNREACHABLE',
                              'DELIVERY_FAILED',
                              'CANCELLATION_REQUESTED',
                            ])
                              PopupMenuItem(
                                value: reason,
                                child: Text(reason.replaceAll('_', ' ')),
                              ),
                          ],
                          child: const Padding(
                            padding: EdgeInsets.all(12),
                            child: Text('Report delivery issue'),
                          ),
                        ),
                    ] else
                      const Text(
                        'Acceptance saved. Confirming assignment with the order service; do not accept another delivery.',
                      ),
                  ],
                ),
              ),
            ),
        ],
      ],
    ),
  );
}
