import 'dart:async';
import 'package:flutter/material.dart';
import 'api_client.dart';

class DeliveryTracking extends StatefulWidget {
  const DeliveryTracking({super.key, required this.api, required this.orderId});
  final ApiClient api;
  final String orderId;
  @override
  State<DeliveryTracking> createState() => _DeliveryTrackingState();
}

class _DeliveryTrackingState extends State<DeliveryTracking> {
  Map? delivery;
  String? error;
  bool busy = false;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (ModalRoute.of(context)?.isCurrent == true) {
        load();
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    if (busy) {
      return;
    }
    setState(() {
      busy = true;
    });
    try {
      final result =
          await widget.api.request('/orders/${widget.orderId}/delivery') as Map;
      if (mounted) {
        setState(() {
          delivery = result;
          error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error =
              'Updates unavailable. Refresh to retry; the last status may be out of date.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final tracking = delivery?['tracking'] as Map?;
    final stale = error != null || tracking?['stale'] != false;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your delivery'),
        actions: [
          IconButton(
            tooltip: 'Refresh delivery',
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (busy) const LinearProgressIndicator(),
            if (error != null) Text(error!),
            if (delivery != null) ...[
              Text(
                delivery!['state'].toString().replaceAll('_', ' '),
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              if (delivery!['pin'] != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        const Text('Your delivery PIN'),
                        SelectableText(
                          delivery!['pin'],
                          style: Theme.of(context).textTheme.headlineLarge,
                        ),
                        const Text(
                          'Share this only when you receive your food. Your driver cannot see this PIN.',
                        ),
                      ],
                    ),
                  ),
                ),
              if (delivery!['issue'] != null)
                Text(
                  'Support review: ${delivery!['issue'].toString().replaceAll('_', ' ')}',
                ),
              if (tracking != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          stale ? Icons.location_off : Icons.delivery_dining,
                        ),
                        Text(
                          stale
                              ? 'Driver location is stale or unavailable'
                              : 'Latest driver location',
                        ),
                        if (tracking['latitude'] != null)
                          Text(
                            '${tracking['latitude']}, ${tracking['longitude']}',
                          ),
                        if (tracking['observedAt'] != null)
                          Text(
                            'Updated ${DateTime.parse(tracking['observedAt']).toLocal()}',
                          ),
                        const Text(
                          'Foreground location updates every 15 seconds. Pull down or tap Refresh if updates stop.',
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 24),
              Text(
                'Order timeline',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              for (final e in delivery!['events'] as List)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.check_circle_outline),
                  title: Text(
                    e['kind']
                        .toString()
                        .replaceAll('TEST_', '')
                        .replaceAll('_', ' '),
                  ),
                  subtitle: Text(
                    DateTime.parse(e['created_at']).toLocal().toString(),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
