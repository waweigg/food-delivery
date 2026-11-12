import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

Future<Map<String, dynamic>?> selectLocation(
  BuildContext context,
  Map<String, dynamic> initial,
) => showModalBottomSheet<Map<String, dynamic>>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => LocationPicker(initial: initial),
);

class LocationPicker extends StatefulWidget {
  const LocationPicker({super.key, required this.initial});
  final Map<String, dynamic> initial;
  @override
  State<LocationPicker> createState() => _LocationPickerState();
}

class _LocationPickerState extends State<LocationPicker> {
  final form = GlobalKey<FormState>();
  late final area = TextEditingController(
    text: widget.initial['street']?.toString(),
  );
  late final lat = TextEditingController(
    text: widget.initial['latitude']?.toString(),
  );
  late final lon = TextEditingController(
    text: widget.initial['longitude']?.toString(),
  );
  bool busy = false;
  String? error;
  @override
  void dispose() {
    area.dispose();
    lat.dispose();
    lon.dispose();
    super.dispose();
  }

  void choose(double latitude, double longitude, String label) =>
      Navigator.pop(context, <String, dynamic>{
        'latitude': latitude,
        'longitude': longitude,
        'street': label,
      });
  Future<void> current() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw Exception(
          'Turn on location services, or choose a location manually.',
        );
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw Exception(
          'Location access is unavailable. Choose manually, or enable permission in app settings.',
        );
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: Platform.isAndroid
            ? AndroidSettings(
                forceLocationManager: true,
                accuracy: LocationAccuracy.high,
                timeLimit: const Duration(seconds: 20),
              )
            : const LocationSettings(
                accuracy: LocationAccuracy.high,
                timeLimit: Duration(seconds: 20),
              ),
      );
      if (position.accuracy > 100) {
        throw Exception(
          'Location is not accurate enough. Try again or select manually.',
        );
      }
      if (mounted) {
        choose(position.latitude, position.longitude, '');
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error =
              'Could not get an accurate location. Check GPS permission and try again, or enter a location below.';
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
              'Where should we deliver?',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            const Text(
              'Choose your delivery location to find restaurants that serve you. GPS is used only when you tap below.',
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: busy ? null : current,
              icon: const Icon(Icons.my_location),
              label: const Text('Use my current location'),
            ),
            if (busy) const LinearProgressIndicator(),
            if (error != null) Text(error!),
            if (kDebugMode)
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () => choose(11.074, 76.0745, 'Malappuram demo area'),
                child: const Text('Use Malappuram demo location'),
              ),
            const SizedBox(height: 16),
            const Text('Or select a location manually'),
            TextFormField(
              controller: area,
              decoration: const InputDecoration(
                labelText: 'Area or address (optional)',
              ),
              maxLength: 500,
            ),
            const Text(
              'Enter coordinates from your map app. You can add your building and contact number at checkout.',
            ),
            for (final field in [
              (lat, 'Latitude', 90),
              (lon, 'Longitude', 180),
            ])
              TextFormField(
                controller: field.$1,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                decoration: InputDecoration(labelText: field.$2),
                validator: (value) {
                  final n = double.tryParse(value ?? '');
                  return n == null || !n.isFinite || n.abs() > field.$3
                      ? 'Enter a valid ${field.$2.toLowerCase()}'
                      : null;
                },
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy
                  ? null
                  : () {
                      if (form.currentState!.validate()) {
                        choose(
                          double.parse(lat.text),
                          double.parse(lon.text),
                          area.text.trim(),
                        );
                      }
                    },
              child: const Text('Check this location'),
            ),
          ],
        ),
      ),
    ),
  );
}
