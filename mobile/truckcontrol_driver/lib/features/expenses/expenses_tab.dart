import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/db/app_database.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/sync/offline_queue.dart';
import '../../core/theme.dart';
import '../events/event_definitions.dart';

/// E-5: the driver's own entries (local queue view).
///
/// Every row now shows its REAL sync state. Previously an event the server had
/// refused was marked `synced` and displayed with the same "delivered" tick as
/// a successful one, so the driver had no way to know their work never arrived
/// (H-11). Rejected and failed rows are called out and can be retried or —
/// only ever explicitly — discarded.
class ExpensesTab extends StatefulWidget {
  const ExpensesTab({super.key});

  @override
  State<ExpensesTab> createState() => _ExpensesTabState();
}

class _ExpensesTabState extends State<ExpensesTab> {
  List<PendingEvent> _rows = [];
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

  Future<void> _retry(PendingEvent event) async {
    await AppScope.of(context).queue.retryEvent(event.clientEventId);
    await _load();
  }

  Future<void> _discard(PendingEvent event) async {
    final t = AppStrings.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(t.t('sync.discardConfirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(t.t('common.cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(t.t('sync.discard')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await AppScope.of(context).queue.discardEvent(event.clientEventId);
    await _load();
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

    final problems = _rows.where((e) => e.needsAttention).length;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _rows.length + (problems > 0 ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 4),
        itemBuilder: (context, index) {
          if (problems > 0 && index == 0) {
            return Card(
              color: BrandColors.danger.withValues(alpha: 0.15),
              child: ListTile(
                leading: const Icon(Icons.warning_amber, color: BrandColors.danger),
                title: Text('${t.t('sync.problemBanner')} ($problems)'),
              ),
            );
          }
          final event = _rows[index - (problems > 0 ? 1 : 0)];
          return _EventCard(
            event: event,
            onRetry: () => _retry(event),
            onDiscard: () => _discard(event),
          );
        },
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event, required this.onRetry, required this.onDiscard});

  final PendingEvent event;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final definition = eventDefinitions.firstWhere(
      (d) => d.type == event.eventType,
      orElse: () => eventDefinitions.first,
    );
    final time = event.eventTime.toLocal();

    final (IconData icon, Color color, String label) = switch (event.syncState) {
      SyncState.synced => (Icons.cloud_done, BrandColors.success, t.t('sync.done')),
      SyncState.rejected => (Icons.error_outline, BrandColors.danger, t.t('sync.rejected')),
      SyncState.failed => (Icons.sync_problem, BrandColors.danger, t.t('sync.failed')),
      _ => (Icons.cloud_upload, BrandColors.muted, t.t('sync.pending')),
    };

    return Card(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(definition.icon, color: BrandColors.accent),
            title: Text(t.t('event.${event.eventType}')),
            subtitle: Text([
              '${time.day.toString().padLeft(2, '0')}.${time.month.toString().padLeft(2, '0')} '
                  '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
              if (event.comment?.isNotEmpty ?? false) event.comment!,
              label,
            ].join(' · ')),
            trailing: Icon(icon, color: color),
          ),
          if (event.needsAttention)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      event.lastError ?? '',
                      style: const TextStyle(color: BrandColors.muted, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  TextButton(onPressed: onRetry, child: Text(t.t('common.retry'))),
                  TextButton(onPressed: onDiscard, child: Text(t.t('sync.discard'))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
