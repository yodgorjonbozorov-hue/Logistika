import 'package:flutter/material.dart';

import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';
import 'event_definitions.dart';
import 'event_form_sheet.dart';

/// E-2/E-3: current trip header + the 10 big status buttons.
class EventsTab extends StatelessWidget {
  const EventsTab({
    super.key,
    required this.trip,
    required this.loading,
    required this.onRefresh,
  });

  final Map<String, dynamic>? trip;
  final bool loading;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    if (loading) {
      return Center(child: Text(t.t('common.loading')));
    }
    final activeTrip = trip;
    if (activeTrip == null) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 80),
            const Icon(Icons.local_shipping, size: 64, color: BrandColors.muted),
            const SizedBox(height: 16),
            Text(
              t.t('trip.none'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: BrandColors.muted),
            ),
          ],
        ),
      );
    }

    final vehicle = activeTrip['vehicle'] as Map<String, dynamic>?;
    final route =
        '${activeTrip['loadingAddress'] ?? '—'} → ${activeTrip['unloadingAddress'] ?? '—'}';

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              title: Text(
                '${t.t('trip.number')} №${activeTrip['tripNumber']}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text(
                '$route\n${t.t('trip.cargo')}: ${activeTrip['cargoName'] ?? '—'}'
                '  ·  ${vehicle?['plateNumber'] ?? '—'}',
              ),
              isThreeLine: true,
            ),
          ),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.6,
            children: [
              for (final definition in eventDefinitions)
                _EventButton(definition: definition, tripId: activeTrip['id'] as String),
            ],
          ),
        ],
      ),
    );
  }
}

class _EventButton extends StatelessWidget {
  const _EventButton({required this.definition, required this.tripId});

  final EventDefinition definition;
  final String tripId;

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF223358),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.all(8),
      ),
      onPressed: () => showEventFormSheet(context, definition: definition, tripId: tripId),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(definition.icon, size: 30, color: BrandColors.accent),
          const SizedBox(height: 6),
          Text(
            t.t(definition.i18nKey),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
