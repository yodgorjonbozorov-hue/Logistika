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
  List<Map<String, Object?>> _stalled = const [];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_me == null) _load();
  }

  Future<void> _load() async {
    final scope = AppScope.of(context);
    try {
      final me = await scope.api.request<Map<String, dynamic>>('/auth/me');
      if (mounted) setState(() => _me = me);
    } on Exception {
      // Profile screen tolerates being offline; queue counters still update.
    }
    final pending = await scope.queue.pendingEventCount();
    final stalled = await scope.queue.needsAttentionEvents();
    if (mounted) {
      setState(() {
        _pending = pending;
        _stalled = stalled;
      });
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
        // Events the server keeps refusing: shown explicitly, never dropped.
        if (_stalled.isNotEmpty)
          Card(
            color: BrandColors.danger.withValues(alpha: 0.08),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ListTile(
                  leading: const Icon(Icons.warning_amber, color: BrandColors.danger),
                  title: Text('${t.t('sync.failed')} (${_stalled.length})'),
                  subtitle: Text(t.t('sync.failedHint')),
                ),
                for (final row in _stalled)
                  ListTile(
                    dense: true,
                    title: Text(t.t('event.${row['event_type']}')),
                    // The raw code used to be printed here. "ODOMETER_INVALID"
                    // tells a driver nothing about what to fix; t() falls back
                    // to the key, so an unmapped code still shows something.
                    subtitle: Text(
                      '${row['event_time']}'
                      '${row['last_error'] != null ? ' · ${t.t('error.${row['last_error']}')}' : ''}',
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      await scope.queue.retryFailedEvents();
                      await _load();
                    },
                    icon: const Icon(Icons.refresh),
                    label: Text(t.t('sync.retry')),
                  ),
                ),
              ],
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
