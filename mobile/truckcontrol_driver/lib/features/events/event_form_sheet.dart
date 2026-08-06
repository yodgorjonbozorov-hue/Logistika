import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app_scope.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';
import 'event_definitions.dart';

/// One tap → confirm sheet → queued locally with time+GPS(+photo) — TZ §3.2.
Future<void> showEventFormSheet(
  BuildContext context, {
  required EventDefinition definition,
  required String tripId,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (_) => _EventFormSheet(definition: definition, tripId: tripId),
  );
}

class _EventFormSheet extends StatefulWidget {
  const _EventFormSheet({required this.definition, required this.tripId});

  final EventDefinition definition;
  final String tripId;

  @override
  State<_EventFormSheet> createState() => _EventFormSheetState();
}

class _EventFormSheetState extends State<_EventFormSheet> {
  final _comment = TextEditingController();
  final _odometer = TextEditingController();
  final _liters = TextEditingController();
  final _amount = TextEditingController();
  String? _photoPath;
  bool _busy = false;

  Future<void> _takePhoto() async {
    final image = await ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: 1500,
      imageQuality: 85,
    );
    if (image != null) setState(() => _photoPath = image.path);
  }

  Future<void> _save() async {
    final scope = AppScope.of(context);
    final t = AppStrings.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _busy = true);

    final position = await scope.gps.currentPosition();

    // Liters/amount become structured comment data; the office turns the
    // photo into fuel_logs/expenses (AI OCR + human confirm, stage 8).
    final parts = <String>[
      if (_liters.text.isNotEmpty) '${t.t('form.liters')}: ${_liters.text}',
      if (_amount.text.isNotEmpty) '${t.t('form.amount')}: ${_amount.text}',
      if (_comment.text.isNotEmpty) _comment.text,
    ];

    await scope.queue.enqueueEvent(
      tripId: widget.tripId,
      eventType: widget.definition.type,
      lat: position?.latitude,
      lng: position?.longitude,
      odometer: int.tryParse(_odometer.text),
      comment: parts.isEmpty ? null : parts.join(' · '),
      photoPath: _photoPath,
    );

    final pending = await scope.queue.pendingEventCount();
    messenger.showSnackBar(
      SnackBar(content: Text(pending > 0 ? t.t('form.savedOffline') : t.t('form.saved'))),
    );
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final definition = widget.definition;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(definition.icon, color: BrandColors.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  t.t(definition.i18nKey),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (definition.needsOdometer) ...[
            TextField(
              controller: _odometer,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: t.t('form.odometer'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (definition.needsFuelFields) ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _liters,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: t.t('form.liters'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _amount,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: t.t('form.amount'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          if (definition.needsAmount && !definition.needsFuelFields) ...[
            TextField(
              controller: _amount,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: t.t('form.amount'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _comment,
            decoration: InputDecoration(
              labelText: t.t('form.comment'),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          if (definition.needsPhoto)
            OutlinedButton.icon(
              onPressed: _takePhoto,
              icon: Icon(_photoPath == null ? Icons.photo_camera : Icons.check,
                  color: _photoPath == null ? null : BrandColors.success),
              label: Text(_photoPath == null ? t.t('form.takePhoto') : t.t('form.photoTaken')),
            ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? t.t('common.loading') : t.t('form.save')),
          ),
        ],
      ),
    );
  }
}
