import 'dart:async';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app_scope.dart';
import '../../core/api/api_client.dart';
import '../../core/i18n/app_strings.dart';
import '../../core/theme.dart';

/// How often an open conversation asks for new messages. Long enough not to
/// drain a phone that spends the day on a dashboard mount.
const _pollInterval = Duration(seconds: 20);

/// E-4: the driver's side of the trip chat (TZ §3.2).
///
/// Text and photos only, and always about one trip — the same thread the logist
/// sees in the W-4 tab. Unlike the ten status buttons this is not offline-first:
/// a message nobody can read yet is worth less than an honest failure, so a
/// send with no network reports the error instead of queueing silently.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.tripId});

  final String tripId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _poll;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading) {
      unawaited(_load(markRead: true));
      _poll = Timer.periodic(_pollInterval, (_) => unawaited(_load(markRead: true)));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool markRead = false}) async {
    final scope = AppScope.of(context);
    try {
      final rows = await scope.api.request<List<dynamic>>('/chat/${widget.tripId}/messages');
      if (markRead) {
        // Opening the thread is what marks it read; the server ignores the
        // reader's own messages, so this never marks anything for the logist.
        await scope.api.request<Map<String, dynamic>>(
          '/chat/${widget.tripId}/read',
          method: 'POST',
        );
      }
      if (!mounted) return;
      setState(() {
        _messages = rows.cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
      _scrollToEnd();
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send({String? body, String? fileId}) async {
    final scope = AppScope.of(context);
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await scope.api.request<Map<String, dynamic>>(
        '/chat/${widget.tripId}/messages',
        method: 'POST',
        body: fileId == null
            ? {'kind': 'TEXT', 'body': body}
            : {'kind': 'PHOTO', 'fileId': fileId},
      );
      _text.clear();
      await _load();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendPhoto() async {
    final scope = AppScope.of(context);
    final image = await ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: 1500,
      imageQuality: 85,
    );
    if (image == null) return;
    setState(() => _sending = true);
    final fileId = await scope.queue.uploadPhoto(image.path);
    if (!mounted) return;
    setState(() => _sending = false);
    if (fileId != null) await _send(fileId: fileId);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.t('chat.title'))),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_error!, style: const TextStyle(color: BrandColors.danger)),
            ),
          Expanded(child: _body(t)),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: _sending ? null : () => unawaited(_sendPhoto()),
                    icon: const Icon(Icons.photo_camera, color: BrandColors.accent),
                    tooltip: t.t('chat.photo'),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _text,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: t.t('chat.placeholder'),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending
                        ? null
                        : () {
                            final body = _text.text.trim();
                            if (body.isNotEmpty) unawaited(_send(body: body));
                          },
                    icon: const Icon(Icons.send),
                    tooltip: t.t('chat.send'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(AppStrings t) {
    if (_loading) return Center(child: Text(t.t('common.loading')));
    if (_messages.isEmpty) {
      return Center(
        child: Text(t.t('chat.empty'), style: const TextStyle(color: BrandColors.muted)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        controller: _scroll,
        padding: const EdgeInsets.all(12),
        itemCount: _messages.length,
        itemBuilder: (context, index) => _Bubble(message: _messages[index]),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final Map<String, dynamic> message;

  @override
  Widget build(BuildContext context) {
    final mine = message['mine'] == true;
    final time = DateTime.tryParse(message['createdAt'] as String? ?? '')?.toLocal();
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(
          color: mine ? BrandColors.accent.withValues(alpha: 0.2) : const Color(0xFF223358),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!mine && (message['senderName'] as String?)?.isNotEmpty == true)
              Text(
                message['senderName'] as String,
                style: const TextStyle(fontSize: 12, color: BrandColors.muted),
              ),
            if (message['kind'] == 'PHOTO')
              _Photo(fileId: message['fileId'] as String?)
            else
              Text(message['body'] as String? ?? ''),
            if (time != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${time.hour.toString().padLeft(2, '0')}:'
                  '${time.minute.toString().padLeft(2, '0')}',
                  style: const TextStyle(fontSize: 11, color: BrandColors.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Photos are stored files: the server hands out a short-lived URL for one.
class _Photo extends StatefulWidget {
  const _Photo({required this.fileId});

  final String? fileId;

  @override
  State<_Photo> createState() => _PhotoState();
}

class _PhotoState extends State<_Photo> {
  String? _url;
  bool _failed = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_url == null && !_failed) unawaited(_load());
  }

  Future<void> _load() async {
    final fileId = widget.fileId;
    if (fileId == null) {
      setState(() => _failed = true);
      return;
    }
    try {
      final data = await AppScope.of(context).api.request<Map<String, dynamic>>('/files/$fileId/url');
      if (mounted) setState(() => _url = data['url'] as String?);
    } on ApiException {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppStrings.of(context);
    final url = _url;
    if (_failed || (url == null && widget.fileId == null)) {
      return Text(
        t.t('chat.photoUnavailable'),
        style: const TextStyle(fontSize: 12, color: BrandColors.muted),
      );
    }
    if (url == null) return const SizedBox(height: 120, child: Center(child: Text('…')));
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        url,
        height: 160,
        fit: BoxFit.cover,
        errorBuilder: (context, _, _) => Text(
          t.t('chat.photoUnavailable'),
          style: const TextStyle(fontSize: 12, color: BrandColors.muted),
        ),
      ),
    );
  }
}
