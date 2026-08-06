import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/api/api_client.dart';
import '../../core/i18n/app_strings.dart';
import '../../main.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _codeRequested = false;
  bool _busy = false;
  String? _error;

  Future<void> _requestCode() async {
    final scope = AppScope.of(context);
    final t = AppStrings.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await scope.api.request<Map<String, dynamic>>(
        '/auth/driver/request-code',
        method: 'POST',
        body: {'phone': _phone.text.trim()},
      );
      if (!mounted) return;
      setState(() => _codeRequested = true);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(t.t('login.codeSent'))));
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final scope = AppScope.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await scope.api.request<Map<String, dynamic>>(
        '/auth/driver/verify',
        method: 'POST',
        body: {'phone': _phone.text.trim(), 'code': _code.text.trim()},
      );
      await scope.tokens.save(
        data['accessToken'] as String,
        data['refreshToken'] as String,
      );
      if (!mounted) return;
      TruckControlAppState.of(context).setLoggedIn(true);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                t.t('app.title'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                t.t('login.title'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                enabled: !_codeRequested,
                style: const TextStyle(fontSize: 20),
                decoration: InputDecoration(
                  labelText: t.t('login.phone'),
                  hintText: '+99890XXXXXXX',
                  border: const OutlineInputBorder(),
                ),
              ),
              if (_codeRequested) ...[
                const SizedBox(height: 16),
                TextField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  style: const TextStyle(fontSize: 24, letterSpacing: 8),
                  textAlign: TextAlign.center,
                  decoration: InputDecoration(
                    labelText: t.t('login.code'),
                    counterText: '',
                    border: const OutlineInputBorder(),
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: Colors.redAccent)),
              ],
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _busy
                    ? null
                    : _codeRequested
                        ? _verify
                        : _requestCode,
                child: Text(
                  _busy
                      ? t.t('common.loading')
                      : _codeRequested
                          ? t.t('login.verify')
                          : t.t('login.sendCode'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
