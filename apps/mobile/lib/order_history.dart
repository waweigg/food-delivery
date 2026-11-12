import 'delivery_tracking.dart';
import 'payment_screen.dart';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'menu_screens.dart' show priceText;

class OrderHistory extends StatefulWidget {
  const OrderHistory({super.key, required this.api});
  final ApiClient api;
  @override
  State<OrderHistory> createState() => _OrderHistoryState();
}

class _OrderHistoryState extends State<OrderHistory> {
  late Future<dynamic> orders;
  @override
  void initState() {
    super.initState();
    orders = widget.api.request('/orders');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('My test orders')),
    body: FutureBuilder<dynamic>(
      future: orders,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: TextButton(
              onPressed: () =>
                  setState(() => orders = widget.api.request('/orders')),
              child: const Text('Could not load orders. Retry'),
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final rows = snapshot.data as List;
        if (rows.isEmpty) {
          return const Center(child: Text('No test orders yet'));
        }
        return ListView(
          children: [
            for (final row in rows)
              ListTile(
                onTap:
                    row['order_state'] == 'PLACED' &&
                        row['payment_state'] == 'UNPAID'
                    ? () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => PaymentScreen(
                              api: widget.api,
                              orderId: row['id'],
                            ),
                          ),
                        );
                        if (mounted) {
                          setState(
                            () => orders = widget.api.request('/orders'),
                          );
                        }
                      }
                    : () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DeliveryTracking(
                              api: widget.api,
                              orderId: row['id'],
                            ),
                          ),
                        );
                        if (mounted) {
                          setState(
                            () => orders = widget.api.request('/orders'),
                          );
                        }
                      },
                title: Text('Test order ${row['id'].substring(0, 8)}'),
                subtitle: Text(
                  '${row['order_state']} · ${row['payment_state']} · ${row['delivery_state'] ?? 'UNASSIGNED'}\n${row['dispatch_state'] == 'NEEDS_ATTENTION'
                      ? 'Driver delayed. Please contact restaurant support to agree a wait or request cancellation/refund review.'
                      : row['dispatch_state'] == 'SEARCHING'
                      ? 'Finding a nearby driver'
                      : row['delivery_state'] == 'ASSIGNED'
                      ? 'Your driver is assigned'
                      : ''}',
                ),
                trailing: Text('INR ${priceText(row['quote']['totalMinor'])}'),
              ),
          ],
        );
      },
    ),
  );
}
