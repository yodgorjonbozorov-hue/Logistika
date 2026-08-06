import 'package:flutter/material.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
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

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
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
      appBar: AppBar(title: Text(t.t('app.title'))),
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
