import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/gps/gps_service.dart';
import '../../core/i18n/app_strings.dart';

/// Says why the trip is not being tracked, and offers the way out (M-11).
///
/// A driver who taps "deny" once used to get a trip with no track and nothing
/// on screen about it — the fleet finds out days later that a whole route is
/// missing. What the button does depends on what is actually blocking:
/// asking again works while the system is still willing to show the dialog,
/// and once it is not, only the settings page can undo it.
class GpsPermissionBanner extends StatelessWidget {
  const GpsPermissionBanner({super.key, required this.block, required this.onRetry});

  final GpsBlock block;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final canAskAgain = block == GpsBlock.denied;

    return Material(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          children: [
            const Icon(Icons.location_off, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t.t('gps.blocked.title'),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 2),
                  Text(t.t(_bodyKey(block)), style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: () async {
                if (canAskAgain) {
                  await onRetry();
                  return;
                }
                // The location switch lives in system settings; the permission
                // lives in the app's own page. Sending the driver to the wrong
                // one is a dead end.
                if (block == GpsBlock.serviceOff) {
                  await Geolocator.openLocationSettings();
                } else {
                  await Geolocator.openAppSettings();
                }
                await onRetry();
              },
              child: Text(t.t(canAskAgain ? 'gps.blocked.allow' : 'gps.blocked.settings')),
            ),
          ],
        ),
      ),
    );
  }

  static String _bodyKey(GpsBlock block) {
    switch (block) {
      case GpsBlock.serviceOff:
        return 'gps.blocked.serviceOff';
      case GpsBlock.denied:
        return 'gps.blocked.denied';
      case GpsBlock.deniedForever:
        return 'gps.blocked.deniedForever';
    }
  }
}
