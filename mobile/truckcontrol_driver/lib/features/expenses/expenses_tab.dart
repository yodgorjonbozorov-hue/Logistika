import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';
import '../events/event_definitions.dart';

/// E-5: the driver's own entries (local queue view — synced + pending).
class ExpensesTab extends StatefulWidget {
  const ExpensesTab({super.key});

  @override
  State<ExpensesTab> createState() => _ExpensesTabState();
}

class _ExpensesTabState extends State<ExpensesTab> {
  List<Map<String, Object?>> _rows = [];
  bool _loading = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading) _load();
  }

  Future<void> _load() async {
    final scope = AppScope.of(context);
    final rows = await scope.queue.recentEvents();
    if (mounted) {
      setState(() {
        _rows = rows;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    if (_loading) return Center(child: Text(t.t('common.loading')));
    if (_rows.isEmpty) {
      return Center(
        child: Text(t.t('expenses.empty'), style: const TextStyle(color: BrandColors.muted)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _rows.length,
        separatorBuilder: (_, _) => const SizedBox(height: 4),
        itemBuilder: (context, index) {
          final row = _rows[index];
          final type = row['event_type'] as String;
          final definition = eventDefinitions.firstWhere(
            (d) => d.type == type,
            orElse: () => eventDefinitions.first,
          );
          final synced = row['synced'] == 1;
          final time = DateTime.tryParse(row['event_time'] as String? ?? '')?.toLocal();
          return Card(
            child: ListTile(
              leading: Icon(definition.icon, color: BrandColors.accentBright),
              title: Text(t.t('event.$type')),
              subtitle: Text([
                if (time != null)
                  '${time.day.toString().padLeft(2, '0')}.${time.month.toString().padLeft(2, '0')} '
                      '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
                if ((row['comment'] as String?)?.isNotEmpty ?? false) row['comment']! as String,
              ].join(' · ')),
              trailing: Icon(
                synced ? Icons.cloud_done : Icons.cloud_upload,
                color: synced ? BrandColors.success : BrandColors.muted,
              ),
            ),
          );
        },
      ),
    );
  }
}
