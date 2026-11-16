import 'package:flutter/material.dart';

import 'api_client.dart';
import 'brand.dart';

class AppearanceSettings extends InheritedWidget {
  const AppearanceSettings({
    super.key,
    required this.mode,
    required this.onChanged,
    required super.child,
  });
  final ThemeMode mode;
  final ValueChanged<ThemeMode> onChanged;

  static AppearanceSettings? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppearanceSettings>();

  @override
  bool updateShouldNotify(AppearanceSettings oldWidget) =>
      oldWidget.mode != mode;
}

class AccountSettingsScreen extends StatefulWidget {
  const AccountSettingsScreen({
    super.key,
    required this.api,
    this.user,
    this.onProfileChanged,
  });
  final ApiClient api;
  final Map<String, dynamic>? user;
  final ValueChanged<Map<String, dynamic>>? onProfileChanged;

  @override
  State<AccountSettingsScreen> createState() => _AccountSettingsScreenState();
}

class _AccountSettingsScreenState extends State<AccountSettingsScreen> {
  late Map<String, dynamic>? account = widget.user;

  @override
  void initState() {
    super.initState();
    widget.api.sessionEnded.addListener(clearAccount);
  }

  void clearAccount() => setState(() => account = null);

  @override
  void dispose() {
    widget.api.sessionEnded.removeListener(clearAccount);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final appearance = AppearanceSettings.of(context);
    final user = account;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: AppBrand.pageInsets(context),
        children: [
          if (appearance != null) ...[
            Text('Appearance', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            DropdownButtonFormField<ThemeMode>(
              initialValue: appearance.mode,
              decoration: const InputDecoration(
                labelText: 'Theme',
                prefixIcon: Icon(Icons.brightness_6_outlined),
              ),
              items: const [
                DropdownMenuItem(
                  value: ThemeMode.system,
                  child: Text('Follow device'),
                ),
                DropdownMenuItem(value: ThemeMode.light, child: Text('Light')),
                DropdownMenuItem(value: ThemeMode.dark, child: Text('Dark')),
              ],
              onChanged: (value) {
                if (value != null) appearance.onChanged(value);
              },
            ),
          ],
          if (user != null) ...[
            const SizedBox(height: 24),
            Text('Account', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.person_outline),
                    title: const Text('Edit profile'),
                    subtitle: Text(user['email']?.toString() ?? ''),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () async {
                      final profile =
                          await Navigator.push<Map<String, dynamic>>(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AccountEditScreen(
                                api: widget.api,
                                name: user['name'] as String,
                              ),
                            ),
                          );
                      if (profile != null &&
                          context.mounted &&
                          account != null) {
                        setState(() => account = profile);
                        widget.onProfileChanged?.call(profile);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Profile updated.')),
                        );
                      }
                    },
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.lock_outline),
                    title: const Text('Change password'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () async {
                      final changed = await Navigator.push<bool>(
                        context,
                        MaterialPageRoute(
                          builder: (_) => AccountEditScreen(api: widget.api),
                        ),
                      );
                      if (changed == true && context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Password changed. Other devices were signed out.',
                            ),
                          ),
                        );
                      }
                    },
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class AccountEditScreen extends StatefulWidget {
  const AccountEditScreen({super.key, required this.api, this.name});
  final ApiClient api;
  final String? name;

  @override
  State<AccountEditScreen> createState() => _AccountEditScreenState();
}

class _AccountEditScreenState extends State<AccountEditScreen> {
  final form = GlobalKey<FormState>();
  late final name = TextEditingController(text: widget.name);
  final current = TextEditingController();
  final password = TextEditingController();
  final confirmation = TextEditingController();
  bool busy = false;
  bool visible = false;
  String? error;
  bool get editingProfile => widget.name != null;

  @override
  void dispose() {
    name.dispose();
    current.dispose();
    password.dispose();
    confirmation.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (busy || !form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (editingProfile) {
        final profile = await widget.api.request(
          '/me/profile',
          body: {'name': name.text.trim()},
        );
        if (mounted) {
          Navigator.pop(context, Map<String, dynamic>.from(profile as Map));
        }
      } else {
        await widget.api.request(
          '/api/auth/change-password',
          body: {
            'currentPassword': current.text,
            'newPassword': password.text,
            'revokeOtherSessions': true,
          },
          captureToken: true,
        );
        if (mounted) Navigator.pop(context, true);
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => error = failure.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget passwordField(
    TextEditingController controller,
    String label,
    String hint,
    String? Function(String) validate,
  ) => TextFormField(
    controller: controller,
    enabled: !busy,
    obscureText: !visible,
    autocorrect: false,
    enableSuggestions: false,
    autofillHints: [hint],
    decoration: InputDecoration(labelText: label),
    validator: (value) => validate(value ?? ''),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(editingProfile ? 'Edit profile' : 'Change password'),
    ),
    body: Form(
      key: form,
      child: ListView(
        padding: AppBrand.pageInsets(context),
        children: [
          if (editingProfile)
            TextFormField(
              controller: name,
              enabled: !busy,
              maxLength: 100,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Display name'),
              validator: (value) =>
                  (value?.trim().isEmpty ?? true) ? 'Enter your name' : null,
            )
          else ...[
            passwordField(
              current,
              'Current password',
              AutofillHints.password,
              (value) => value.isEmpty ? 'Enter your current password' : null,
            ),
            const SizedBox(height: 12),
            passwordField(
              password,
              'New password',
              AutofillHints.newPassword,
              (value) => value.length < 12 || value.length > 128
                  ? 'Use 12–128 characters'
                  : null,
            ),
            const SizedBox(height: 12),
            passwordField(
              confirmation,
              'Confirm new password',
              AutofillHints.newPassword,
              (value) =>
                  value != password.text ? 'Passwords do not match' : null,
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show passwords'),
              value: visible,
              onChanged: busy
                  ? null
                  : (value) => setState(() => visible = value),
            ),
          ],
          const SizedBox(height: 16),
          if (error != null) ...[
            Semantics(
              liveRegion: true,
              child: Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
            const SizedBox(height: 12),
          ],
          FilledButton(
            onPressed: busy ? null : save,
            child: Text(busy ? 'Saving…' : 'Save changes'),
          ),
        ],
      ),
    ),
  );
}
