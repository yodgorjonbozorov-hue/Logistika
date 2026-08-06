import 'package:flutter/widgets.dart';

import 'core/api/api_client.dart';
import 'core/gps/gps_service.dart';
import 'core/storage/token_store.dart';
import 'core/sync/offline_queue.dart';

/// Simple service locator passed down the tree (MVP — no state-management dep).
class AppScope extends InheritedWidget {
  const AppScope({
    super.key,
    required this.tokens,
    required this.api,
    required this.queue,
    required this.gps,
    required super.child,
  });

  final TokenStore tokens;
  final ApiClient api;
  final OfflineQueue queue;
  final GpsService gps;

  static AppScope of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!;

  @override
  bool updateShouldNotify(AppScope oldWidget) => false;
}
