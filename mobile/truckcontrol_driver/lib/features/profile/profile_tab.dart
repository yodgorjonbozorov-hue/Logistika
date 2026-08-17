import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';
import '../../main.dart';
import 'rating_format.dart';

/// E-7: profile, language, pending-sync counter, logout.
class ProfileTab extends StatefulWidget {
  const ProfileTab({super.key});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  Map<String, dynamic>? _me;
  Map<String, dynamic>? _rating;
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
      final rating = await scope.api.request<Map<String, dynamic>?>('/drivers/me/rating');
      final pending = await scope.queue.pendingEventCount();
      if (mounted) {
        setState(() {
          _me = me;
          _rating = rating;
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
        _RatingCard(rating: _rating),
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

/// E-7: the driver's own rating, with the three numbers it is made of.
///
/// The score alone would be a verdict nobody can argue with; the penalties are
/// shown next to it so a driver can see which of the three to work on (TZ W-6).
class _RatingCard extends StatelessWidget {
  const _RatingCard({required this.rating});

  final Map<String, dynamic>? rating;

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final data = rating;
    if (data == null) return const SizedBox.shrink();

    final centis = (data['ratingCentis'] as num?)?.toInt();
    final trips = (data['trips'] as num?)?.toInt() ?? 0;
    final late = (data['lateTrips'] as num?)?.toInt() ?? 0;
    final breakdowns = (data['breakdowns'] as num?)?.toInt() ?? 0;
    final fuelBp = (data['fuelDeviationBp'] as num?)?.toInt();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.star, color: BrandColors.accent),
                const SizedBox(width: 12),
                Expanded(child: Text(t.t('rating.title'))),
                Text(
                  formatRating(centis),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                ),
              ],
            ),
            if (centis == null) ...[
              const SizedBox(height: 8),
              Text(
                t.t('rating.pending'),
                style: const TextStyle(fontSize: 12, color: BrandColors.muted),
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: [
                _Stat(label: t.t('rating.trips'), value: '$trips'),
                _Stat(label: t.t('rating.late'), value: '$late'),
                _Stat(label: t.t('rating.breakdowns'), value: '$breakdowns'),
                _Stat(label: t.t('rating.fuel'), value: formatDeviation(fuelBp)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: BrandColors.muted)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
    );
  }
}
