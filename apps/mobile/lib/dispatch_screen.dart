import 'dart:async';
import 'package:flutter/material.dart';
import 'api_client.dart';

class DispatchScreen extends StatefulWidget {
  const DispatchScreen({super.key, required this.api});
  final ApiClient api;
  @override
  State<DispatchScreen> createState() => _DispatchState();
}
class _DispatchState extends State<DispatchScreen> {
  List<dynamic> jobs = [];
  String? error;
  bool busy = false;
  Timer? timer;
  @override
  void initState() { super.initState(); load(); timer = Timer.periodic(const Duration(seconds: 10), (_) { if (ModalRoute.of(context)?.isCurrent == true) { load(); } }); }
  @override
  void dispose() { timer?.cancel(); super.dispose(); }
  Future<void> load() async {
    if (busy) { return; }
    setState(() { busy = true; });
    try { jobs = await widget.api.request('/driver-admin/dispatch') as List; error = null; }
    catch (e) { error = e.toString(); }
    finally { if (mounted) { setState(() { busy = false; }); } }
  }
  Future<void> manual(Map job) async {
    try {
      final candidates = await widget.api.request('/driver-admin/dispatch/${job['order_id']}/candidates') as List;
      if (!mounted) { return; }
      final selected = await showDialog<String>(context: context, builder: (ctx) => SimpleDialog(title: const Text('Offer to a nearby driver'), children: [
        const Padding(padding: EdgeInsets.all(16), child: Text('Distance is a straight-line proxy for pickup ETA. The driver must accept. This starts a new bounded dispatch round.')),
        if (candidates.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No eligible drivers. Contact the customer to agree a wait or arrange cancellation/refund review.')),
        for (final d in candidates) SimpleDialogOption(onPressed: () => Navigator.pop(ctx, d['user_id']), child: Text('${d['name']} · ${d['vehicle']} · ${d['distanceMetres']} m')),
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
      ]));
      if (selected == null) { return; }
      await widget.api.request('/driver-admin/dispatch/${job['order_id']}/manual', body: {'driverId': selected}); await load();
    } catch (e) { if (mounted) { setState(() { error = e.toString(); }); } }
  }
  Future<void> contact(Map job) async {
    try {
      final details = await widget.api.request('/driver-admin/dispatch/${job['order_id']}/contact') as Map;
      if (!mounted) { return; }
      await showDialog<void>(context: context, builder: (ctx) => AlertDialog(title: const Text('Customer resolution'), content: SelectableText('Order ${job['order_id']}\nPhone: ${details['phone'] ?? 'Unavailable — use the registered support channel'}\nAgree a wait or escalate cancellation/refund review. No automatic refund is issued here.'), actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))]));
    } catch (e) { if (mounted) { setState(() { error = e.toString(); }); } }
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Dispatch operations'), actions: [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh))]), body: ListView(padding: const EdgeInsets.all(20), children: [
    if (busy) const LinearProgressIndicator(),
    if (error != null) Text(error!),
    const Text('Dispatch alerts appear here. If no driver is available, contact the customer and restaurant. Agree a wait or escalate cancellation and refund review; never promise an automatic refund.'),
    if (jobs.isEmpty && !busy) const Padding(padding: EdgeInsets.all(24), child: Text('No ready orders awaiting dispatch.')),
    for (final j in jobs) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Order ${j['order_id'].toString().substring(0, 8)}', style: Theme.of(context).textTheme.titleLarge),
      Text(j['pickup'] ?? 'Loading pickup'), Text('${j['state']} · ${j['attempts']} offers · round ${j['round']}'),
      if (j['issue'] != null) Text(j['issue'], style: const TextStyle(color: Colors.deepOrange)),
      TextButton(onPressed: busy ? null : () => contact(j), child: const Text('Customer resolution')),
      if (['SEARCHING', 'NEEDS_ATTENTION'].contains(j['state'])) OutlinedButton(onPressed: busy ? null : () => manual(j), child: const Text('Choose driver manually')),
    ]))),
  ]));
}
