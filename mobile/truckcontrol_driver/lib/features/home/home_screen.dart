import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
import '../chat/chat_screen.dart';
import '../events/events_tab.dart';
import '../expenses/expenses_tab.dart';
import '../profile/profile_tab.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  Map<String, dynamic>? _activeTrip;
  bool _loading = true;
  int _unread = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading) _loadTrip();
  }

  Future<void> _loadTrip() async {
    final scope = AppScope.of(context);
    try {
      final trips = await scope.api.request<List<dynamic>>('/trips/my');
      if (!mounted) return;
      setState(() {
        _activeTrip = trips.isEmpty ? null : trips.first as Map<String, dynamic>;
        _loading = false;
      });
      final trip = _activeTrip;
      if (trip != null) unawaited(_loadUnread(trip['id'] as String));
      if (trip != null && trip['status'] == 'IN_PROGRESS') {
        final t = AppStrings.of(context);
        await scope.gps.start(
          tripId: trip['id'] as String,
          notificationTitle: t.t('gps.notification.title'),
          notificationText: t.t('gps.notification.text'),
        );
      }
    } on Exception {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The unread badge on the chat button. A chat nobody notices is a chat
  /// nobody answers, so this is refreshed with the trip rather than only when
  /// the thread is opened.
  Future<void> _loadUnread(String tripId) async {
    try {
      final data = await AppScope.of(context)
          .api
          .request<Map<String, dynamic>>('/chat/$tripId/unread');
      if (mounted) setState(() => _unread = (data['unread'] as num?)?.toInt() ?? 0);
    } on Exception {
      // The badge is a nicety; failing to fetch it must not disturb the screen.
    }
  }

  Future<void> _openChat(String tripId) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => ChatScreen(tripId: tripId)),
    );
    await _loadUnread(tripId);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final trip = _activeTrip;
    final tabs = [
      EventsTab(trip: _activeTrip, loading: _loading, onRefresh: _loadTrip),
      const ExpensesTab(),
      Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(t.t('documents.note'), textAlign: TextAlign.center),
        ),
      ),
      const ProfileTab(),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Text(t.t('app.title')),
        actions: [
          if (trip != null)
            IconButton(
              tooltip: t.t('chat.title'),
              onPressed: () => unawaited(_openChat(trip['id'] as String)),
              icon: Badge.count(
                count: _unread,
                isLabelVisible: _unread > 0,
                child: const Icon(Icons.forum),
              ),
            ),
        ],
      ),
      body: tabs[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.route), label: t.t('tab.trip')),
          NavigationDestination(icon: const Icon(Icons.receipt_long), label: t.t('tab.expenses')),
          NavigationDestination(icon: const Icon(Icons.folder), label: t.t('tab.documents')),
          NavigationDestination(icon: const Icon(Icons.person), label: t.t('tab.profile')),
        ],
      ),
    );
  }
}
