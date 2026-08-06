import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';
import '../../main.dart';

/// E-7: profile, language, pending-sync counter, logout.
class ProfileTab extends StatefulWidget {
  const ProfileTab({super.key});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  Map<String, dynamic>? _me;
  int _pending = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_me == null) _load();
  }

  Future<void> _load() async {
    final scope = AppScope.of(context);
    try {
      final me = await scope.api.request<Map<String, dynamic>>('/auth/me');
      final pending = await scope.queue.pendingEventCount();
      if (mounted) {
        setState(() {
          _me = me;
          _pending = pending;
        });
      }
    } on Exception {
      // Profile screen tolerates being offline; queue counter still updates.
      final pending = await scope.queue.pendingEventCount();
      if (mounted) setState(() => _pending = pending);
    }
  }

  Future<void> _logout() async {
    final scope = AppScope.of(context);
    await scope.gps.stop();
    await scope.tokens.clear();
    if (!mounted) return;
    TruckControlAppState.of(context).setLoggedIn(false);
  }

  static const _localeLabels = {
    'uz-latn': "O'zbekcha",
    'uz-cyrl': 'Ўзбекча',
    'ru': 'Русский',
  };

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final scope = AppScope.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_me != null)
          Card(
            child: ListTile(
              leading: const Icon(Icons.person, color: BrandColors.accent),
              title: Text((_me!['fullName'] as String?) ?? ''),
              subtitle: Text((_me!['phone'] as String?) ?? ''),
            ),
          ),
        Card(
          child: ListTile(
            leading: Icon(
              _pending > 0 ? Icons.cloud_upload : Icons.cloud_done,
              color: _pending > 0 ? BrandColors.accent : BrandColors.success,
            ),
            title: Text(_pending > 0 ? t.t('sync.pending') : t.t('sync.done')),
            subtitle: _pending > 0 ? Text('$_pending') : null,
            trailing: _pending > 0
                ? TextButton(
                    onPressed: () async {
                      await scope.queue.syncAll();
                      await _load();
                    },
                    child: Text(t.t('sync.syncNow')),
                  )
                : null,
          ),
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.language, color: BrandColors.accent),
            title: Text(t.t('profile.language')),
            trailing: DropdownButton<String>(
              value: scope.tokens.locale,
              underline: const SizedBox.shrink(),
              items: [
                for (final locale in AppStrings.supported)
                  DropdownMenuItem(value: locale, child: Text(_localeLabels[locale]!)),
              ],
              onChanged: (locale) {
                if (locale != null) TruckControlAppState.of(context).setLocale(locale);
              },
            ),
          ),
        ),
        const SizedBox(height: 16),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: BrandColors.danger,
            foregroundColor: Colors.white,
          ),
          onPressed: _logout,
          icon: const Icon(Icons.logout),
          label: Text(t.t('profile.logout')),
        ),
      ],
    );
  }
}
