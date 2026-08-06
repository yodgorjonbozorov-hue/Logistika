import 'package:flutter/material.dart';

/// The 10 status buttons — TZ §3.2 E-3. `i18nKey` maps into AppStrings.
class EventDefinition {
  const EventDefinition({
    required this.type,
    required this.icon,
    this.needsPhoto = false,
    this.needsOdometer = false,
    this.needsFuelFields = false,
    this.needsAmount = false,
  });

  final String type;
  final IconData icon;
  final bool needsPhoto;
  final bool needsOdometer;
  final bool needsFuelFields;
  final bool needsAmount;

  String get i18nKey => 'event.$type';
}

const eventDefinitions = <EventDefinition>[
  EventDefinition(type: 'START', icon: Icons.local_shipping, needsOdometer: true, needsPhoto: true),
  EventDefinition(type: 'LOADED', icon: Icons.inventory_2, needsPhoto: true),
  EventDefinition(type: 'REST', icon: Icons.restaurant),
  EventDefinition(type: 'RESUME', icon: Icons.play_arrow),
  EventDefinition(type: 'REFUEL', icon: Icons.local_gas_station, needsPhoto: true, needsFuelFields: true),
  EventDefinition(type: 'BREAKDOWN', icon: Icons.warning_amber, needsPhoto: true),
  EventDefinition(type: 'CUSTOMS', icon: Icons.flag),
  EventDefinition(type: 'EXPENSE', icon: Icons.payments, needsPhoto: true, needsAmount: true),
  EventDefinition(type: 'DELIVERED', icon: Icons.check_circle, needsPhoto: true),
  EventDefinition(type: 'FINISH', icon: Icons.sports_score, needsOdometer: true, needsPhoto: true),
];
