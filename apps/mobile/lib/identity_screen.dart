import 'driver_screen.dart';
import 'dispatch_screen.dart';
import 'kitchen_screen.dart';
import 'order_history.dart';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'account_settings.dart';
import 'restaurant_screens.dart';
import 'brand.dart';
import 'partner_widgets.dart';

enum AuthMode { signIn, signUp, recover, reset }

class IdentityScreen extends StatefulWidget {
  const IdentityScreen({
    super.key,
    required this.api,
    this.returnAfterLogin = false,
    this.active = true,
    this.onBrowse,
  });
  final ApiClient api;
  final VoidCallback? onBrowse;
  final bool returnAfterLogin, active;
  @override
  State<IdentityScreen> createState() => _IdentityScreenState();
}

class _IdentityScreenState extends State<IdentityScreen>
    with WidgetsBindingObserver {
  final form = GlobalKey<FormState>();
  final name = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final code = TextEditingController();
  final confirmation = TextEditingController();
  AuthMode mode = AuthMode.signIn;
  bool busy = false;
  bool showPassword = false;
  String? message;
  Map<String, dynamic>? dashboard;
  List<dynamic>? adminUsers;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.api.sessionEnded.addListener(sessionEnded);
    if (widget.api.signedIn) run(refresh);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.api.sessionEnded.removeListener(sessionEnded);
    name.dispose();
    email.dispose();
    password.dispose();
    code.dispose();
    confirmation.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        widget.active &&
        widget.api.signedIn &&
        !busy) {
      run(refresh);
    }
  }

  void sessionEnded() {
    setState(() {
      dashboard = null;
      adminUsers = null;
      mode = AuthMode.signIn;
      message = 'Please sign in to continue.';
    });
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await action();
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          message = error.message;
          if (error.status == 401) {
            dashboard = null;
            adminUsers = null;
            mode = AuthMode.signIn;
          }
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => message = 'Something went wrong. Please try again.');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void didUpdateWidget(IdentityScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active && widget.api.signedIn && !busy) {
      run(refresh);
    }
  }

  void changeMode(AuthMode value) {
    setState(() {
      mode = value;
      message = null;
      password.clear();
      confirmation.clear();
      code.clear();
      showPassword = false;
    });
  }

  Future<void> refresh() async {
    final revision = widget.api.sessionEnded.value;
    final data = await widget.api.request('/dashboard');
    if (mounted && revision == widget.api.sessionEnded.value) {
      setState(() => dashboard = Map<String, dynamic>.from(data as Map));
    }
  }

  Future<void> openSettings() async {
    final user = dashboard?['user'];
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => AccountSettingsScreen(
          api: widget.api,
          user: user is Map ? Map<String, dynamic>.from(user) : null,
          onProfileChanged: (value) {
            if (mounted && dashboard != null) {
              setState(() => dashboard!['user'] = value);
            }
          },
        ),
      ),
    );
  }

  Future<void> restaurants(RestaurantView view) async {
    final expired = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => RestaurantScreen(api: widget.api, view: view),
      ),
    );
    if (mounted && expired == true) {
      setState(() {
        dashboard = null;
        adminUsers = null;
        mode = AuthMode.signIn;
        message = 'Your session expired. Please sign in again.';
      });
    }
  }

  Future<void> submit() async {
    if (!(form.currentState?.validate() ?? false)) return;
    await run(() async {
      switch (mode) {
        case AuthMode.signIn:
          await widget.api.request(
            '/api/auth/sign-in/email',
            body: {'email': email.text.trim(), 'password': password.text},
            captureToken: true,
          );
          await refresh();
        case AuthMode.signUp:
          await widget.api.request(
            '/api/auth/sign-up/email',
            body: {
              'name': name.text.trim(),
              'email': email.text.trim(),
              'password': password.text,
            },
            captureToken: true,
          );
          await refresh();
        case AuthMode.recover:
          await widget.api.request(
            '/api/auth/request-password-reset',
            body: {'email': email.text.trim()},
          );
          if (mounted) {
            setState(() {
              mode = AuthMode.reset;
              message =
                  'If this account exists, a recovery code will be emailed to you.';
            });
          }
        case AuthMode.reset:
          await widget.api.request(
            '/api/auth/reset-password',
            body: {'token': code.text.trim(), 'newPassword': password.text},
          );
          if (mounted) {
            setState(() {
              mode = AuthMode.signIn;
              code.clear();
              confirmation.clear();
              showPassword = false;
              message = 'Password updated. Sign in with your new password.';
            });
          }
      }
      password.clear();
      if (mounted && widget.returnAfterLogin && dashboard != null) {
        Navigator.pop(context, true);
      }
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const BrandTitle('waweigg'),
      actions: [
        IconButton(
          onPressed: busy ? null : openSettings,
          icon: const Icon(Icons.settings_outlined),
          tooltip: 'Settings',
        ),
      ],
    ),
    body: SafeArea(
      child: Align(
        // Workspaces start at the top; authentication stays vertically balanced.
        alignment: dashboard == null ? Alignment.center : Alignment.topCenter,
        child: SingleChildScrollView(
          padding: dashboard == null
              ? const EdgeInsets.all(24)
              : AppBrand.pageInsets(context),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (dashboard != null)
                  ...dashboardView().expand(
                    (child) => [child, const SizedBox(height: 10)],
                  )
                else if (widget.api.signedIn) ...[
                  if (!busy)
                    OutlinedButton(
                      onPressed: () => run(refresh),
                      child: const Text('Retry loading account'),
                    ),
                  if (!busy)
                    TextButton(
                      onPressed: signOut,
                      child: const Text('Sign out'),
                    ),
                ] else
                  ...authForm(),
                if (busy)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(),
                  ),
                if (message != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Semantics(liveRegion: true, child: Text(message!)),
                  ),
                const SizedBox(height: 20),
                const Text(
                  'Made for your everyday cravings.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  List<Widget> authForm() => [
    Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Your cravings.\nYour waweigg.',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                const Text(
                  'A little joy, just for you.',
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
    const SizedBox(height: 26),
    Text(switch (mode) {
      AuthMode.signIn => 'Welcome back',
      AuthMode.signUp => 'Create your account',
      AuthMode.recover => 'Recover your account',
      AuthMode.reset => 'Set a new password',
    }, style: Theme.of(context).textTheme.headlineMedium),
    const SizedBox(height: 8),
    Text(switch (mode) {
      AuthMode.signIn => 'Sign in to manage your account and restaurants.',
      AuthMode.signUp => 'Your next favourite starts here.',
      AuthMode.recover => 'We’ll help you get back to your account.',
      AuthMode.reset => 'Choose a password you haven’t used before.',
    }),
    const SizedBox(height: 24),
    AutofillGroup(
      child: Form(
        key: form,
        child: Column(
          children: [
            if (mode == AuthMode.signUp)
              field(
                name,
                'Name',
                validator: (s) =>
                    (s?.trim().isEmpty ?? true) ? 'Enter your name' : null,
              ),
            if (mode != AuthMode.reset)
              field(
                email,
                'Email',
                keyboard: TextInputType.emailAddress,
                validator: (s) =>
                    s != null &&
                        RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(s.trim())
                    ? null
                    : 'Enter a valid email',
              ),
            if (mode == AuthMode.reset)
              field(
                code,
                'Recovery code',
                validator: (s) => (s?.trim().isEmpty ?? true)
                    ? 'Enter the code from your email'
                    : null,
              ),
            if (mode != AuthMode.recover)
              field(
                password,
                'Password',
                secret: true,
                validator: (s) => s == null || s.isEmpty
                    ? 'Enter your password'
                    : mode != AuthMode.signIn &&
                          (s.length < 12 || s.length > 128)
                    ? 'Use 12–128 characters'
                    : null,
              ),
            if (mode == AuthMode.reset || mode == AuthMode.signUp)
              field(
                confirmation,
                'Confirm password',
                secret: true,
                validator: (s) =>
                    s == password.text ? null : 'Passwords do not match',
              ),
          ],
        ),
      ),
    ),
    const SizedBox(height: 16),
    FilledButton(
      onPressed: busy ? null : submit,
      child: Text(switch (mode) {
        AuthMode.signIn => 'Sign in',
        AuthMode.signUp => 'Create account',
        AuthMode.recover => 'Send recovery code',
        AuthMode.reset => 'Update password',
      }),
    ),
    if (mode == AuthMode.signIn) ...[
      TextButton(
        onPressed: busy ? null : () => changeMode(AuthMode.signUp),
        child: const Text('Create a customer account'),
      ),
      TextButton(
        onPressed: busy ? null : () => changeMode(AuthMode.recover),
        child: const Text('Forgot password?'),
      ),
    ] else
      TextButton(
        onPressed: busy ? null : () => changeMode(AuthMode.signIn),
        child: const Text('Back to sign in'),
      ),
    if (mode == AuthMode.recover)
      TextButton(
        onPressed: busy ? null : () => changeMode(AuthMode.reset),
        child: const Text('I already have a recovery code'),
      ),
  ];
  Widget field(
    TextEditingController controller,
    String label, {
    bool secret = false,
    TextInputType? keyboard,
    String? Function(String?)? validator,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(
      controller: controller,
      enabled: !busy,
      obscureText: secret && !showPassword,
      autocorrect: false,
      enableSuggestions: !secret,
      keyboardType: keyboard,
      autofillHints: secret
          ? [
              mode == AuthMode.signIn
                  ? AutofillHints.password
                  : AutofillHints.newPassword,
            ]
          : label == 'Email'
          ? [AutofillHints.email]
          : null,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(
          secret
              ? Icons.lock_outline
              : label == 'Email'
              ? Icons.mail_outline
              : Icons.person_outline,
        ),
        suffixIcon: controller == password
            ? IconButton(
                tooltip: showPassword ? 'Hide password' : 'Show password',
                onPressed: busy
                    ? null
                    : () => setState(() => showPassword = !showPassword),
                icon: Icon(
                  showPassword
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                ),
              )
            : null,
      ),
      validator: validator,
    ),
  );
  List<Widget> dashboardView() {
    final data = dashboard!;
    final user = data['user'] as Map;
    final role = user['role'] as String;
    final roleName = switch (role) {
      'ADMIN' => 'Admin',
      'RESTAURANT' => 'Restaurant',
      'DRIVER' => 'Driver',
      _ => 'Customer',
    };
    return [
      if (role == 'RESTAURANT' || role == 'DRIVER') ...[
        PartnerHero(
          eyebrow: 'waweigg partners',
          title: '$roleName dashboard',
          message:
              'Welcome, ${user['name']}. ${role == 'RESTAURANT' ? 'Good food starts with your kitchen.' : 'Your next delivery starts here.'}',
          icon: role == 'RESTAURANT'
              ? Icons.storefront_outlined
              : Icons.delivery_dining_outlined,
        ),
        PartnerSection(
          title: role == 'RESTAURANT'
              ? 'Restaurant workspace'
              : 'Delivery workspace',
          subtitle: role == 'RESTAURANT'
              ? 'Menus, orders and pickup preparation.'
              : 'Availability, offers and active deliveries.',
        ),
      ] else ...[
        Text(
          '$roleName dashboard',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        Text('Welcome, ${user['name']}'),
      ],
      if (role == 'CUSTOMER' || role == 'DRIVER')
        OutlinedButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => DriverScreen(api: widget.api)),
          ),
          child: const Text('Driver centre'),
        ),
      if (role == 'CUSTOMER' && widget.onBrowse != null)
        FilledButton(
          onPressed: busy ? null : widget.onBrowse,
          child: const Text('Browse restaurants'),
        ),
      if (role == 'CUSTOMER' || role == 'RESTAURANT')
        OutlinedButton(
          onPressed: busy ? null : () => restaurants(RestaurantView.mine),
          child: const Text('My restaurants'),
        ),
      if (role == 'RESTAURANT') ...[
        const Text(
          'Manage your restaurant profiles and approval status in My restaurants.',
        ),
      ],
      if (role == 'ADMIN') ...[
        OutlinedButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => DispatchScreen(api: widget.api)),
          ),
          child: const Text('Dispatch operations'),
        ),
        OutlinedButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DriverScreen(api: widget.api, admin: true),
            ),
          ),
          child: const Text('Driver approvals'),
        ),
        OutlinedButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => KitchenScreen(
                api: widget.api,
                path: '/orders/kitchen-admin/recovery',
                recovery: true,
              ),
            ),
          ),
          child: const Text('Payment recovery'),
        ),
        FilledButton(
          onPressed: busy ? null : () => restaurants(RestaurantView.admin),
          child: const Text('Restaurant approvals'),
        ),
        OutlinedButton(
          onPressed: busy ? null : () => run(loadUsers),
          child: const Text('Manage users'),
        ),
        OutlinedButton(
          onPressed: busy
              ? null
              : () => run(() async {
                  final events =
                      await widget.api.request('/admin/audit') as List;
                  if (mounted) {
                    setState(
                      () => message = events.isEmpty
                          ? 'No administrative actions yet.'
                          : events
                                .take(10)
                                .map(
                                  (e) => '${e['action']} · ${e['createdAt']}',
                                )
                                .join('\n'),
                    );
                  }
                }),
          child: const Text('View audit history'),
        ),
        if (adminUsers != null)
          for (final account in adminUsers!)
            ListTile(
              title: Text(account['name'] as String),
              subtitle: Text(account['role'] as String),
              trailing: account['role'] == 'ADMIN'
                  ? null
                  : TextButton(
                      onPressed: busy
                          ? null
                          : () => run(() async {
                              await widget.api.request(
                                '/admin/users/${Uri.encodeComponent(account['id'] as String)}/disable',
                                body: {'disabled': account['disabled'] != true},
                              );
                              await loadUsers();
                            }),
                      child: Text(
                        account['disabled'] == true ? 'Enable' : 'Disable',
                      ),
                    ),
            ),
      ],
      if (dashboard?['user']?['role'] == 'CUSTOMER')
        OutlinedButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute<void>(
              builder: (_) => OrderHistory(api: widget.api),
            ),
          ),
          child: const Text('My test orders'),
        ),
      OutlinedButton(
        onPressed: busy ? null : () => run(refresh),
        child: const Text('Refresh'),
      ),
      TextButton(
        onPressed: busy ? null : signOut,
        child: const Text('Sign out'),
      ),
    ];
  }

  Future<void> signOut() => run(() async {
    try {
      await widget.api.signOut();
    } on ApiException catch (error) {
      if (error.status != 401) {
        throw const ApiException(
          'Signed out on this device. The server could not confirm sign-out.',
        );
      }
    } finally {
      if (mounted) {
        changeMode(AuthMode.signIn);
        setState(() {
          dashboard = null;
          adminUsers = null;
        });
      }
    }
  });
  Future<void> loadUsers() async {
    final users = await widget.api.request('/admin/users');
    if (mounted) setState(() => adminUsers = users as List);
  }
}
