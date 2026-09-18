import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'bubble.dart';
import 'theme.dart';

/// What a host app hands back when the customer wants to attach something.
///
/// The app owns the picker, because it already has one and already has the
/// permission. A plugin here would mean native build config and a permissions
/// prompt for every app that takes this package, used or not.
typedef NestFilePicker = Future<NestPickedFile?> Function();

/// A file the host app picked.
class NestPickedFile {
  const NestPickedFile({required this.bytes, required this.filename, required this.mime});
  final List<int> bytes;
  final String filename;
  final String mime;
}

/// The chat itself: header, thread, composer.
///
/// Usually shown by [showNestMessenger] rather than built directly, but it is a
/// plain widget — an app that wants chat on a page of its own can put it there.
class NestMessenger extends StatefulWidget {
  const NestMessenger({super.key, required this.chat, this.onPickFile, this.onClose});

  final NestConnect chat;

  /// Omit it and there is no attach button. Better than a button that opens
  /// nothing.
  final NestFilePicker? onPickFile;
  final VoidCallback? onClose;

  @override
  State<NestMessenger> createState() => _NestMessengerState();
}

class _NestMessengerState extends State<NestMessenger> {
  final _composer = TextEditingController();
  final _scroll = ScrollController();
  final _staged = <NestUpload>[];
  StreamSubscription<List<NestMessage>>? _sub;
  StreamSubscription<bool>? _closedSub;
  bool _restarting = false;
  Timer? _typing;
  bool _sending = false;
  bool _attaching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _sub = widget.chat.onMessages.listen((_) {
      if (mounted) setState(_scrollToEnd);
    });
    // Its own subscription because nothing else moves when a chat closes: no
    // message arrives, so watching the thread would never rebuild and the
    // composer would sit there looking live.
    _closedSub = widget.chat.onClosed.listen((_) {
      if (mounted) setState(() {});
    });
    // On screen: zeroes the badge, and turns the agent's ticks from delivered
    // to read — a different claim, and the only one worth showing them as read.
    unawaited(widget.chat.setViewing(true));
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
  }

  @override
  void dispose() {
    _typing?.cancel();
    unawaited(_sub?.cancel());
    unawaited(_closedSub?.cancel());
    unawaited(widget.chat.setViewing(false));
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    if (!_scroll.hasClients) return;
    // Jumped to rather than animated on a rebuild: a new message arriving while
    // somebody is reading should land, not glide, and an animation that
    // restarts on every keystroke is a thread that will not sit still.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if ((text.isEmpty && _staged.isEmpty) || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    final attachments = List<NestUpload>.from(_staged);
    _composer.clear();
    _staged.clear();
    try {
      await widget.chat.send(text, attachments: attachments);
    } on NestException catch (e) {
      // The server's own words. "That kind of file can't be attached here" is
      // an answer; "something went wrong" is a shrug.
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attach() async {
    final pick = widget.onPickFile;
    if (pick == null || _attaching) return;
    setState(() => _attaching = true);
    try {
      final file = await pick();
      if (file == null) return;
      final upload = await widget.chat.attach(
        bytes: file.bytes,
        filename: file.filename,
        mime: file.mime,
      );
      if (mounted) setState(() => _staged.add(upload));
    } on NestException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _attaching = false);
    }
  }

  void _onTyped(String value) {
    _typing?.cancel();
    // Debounced: the agent wants to see the question forming, not one request
    // per keystroke from every customer at once.
    _typing = Timer(const Duration(milliseconds: 400), () {
      unawaited(widget.chat.typing(value));
    });
  }

  Future<void> _startNewChat() async {
    setState(() {
      _restarting = true;
      _error = null;
    });
    try {
      await widget.chat.startNewChat();
      // Anything staged belonged to the conversation that just ended; carrying
      // it into a new one would attach it to a thread nobody chose it for.
      if (mounted) setState(_staged.clear);
    } on NestException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _restarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = widget.chat.config;
    final appearance = config?.appearance ?? NestAppearance.fallback;
    final theme = NestTheme.from(appearance, Theme.of(context).brightness);
    final messages = widget.chat.messages;

    return Container(
      decoration: BoxDecoration(
        color: theme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Header(
            appearance: appearance,
            theme: theme,
            online: config?.online ?? false,
            team: config?.team ?? const [],
            onClose: widget.onClose,
          ),
          Flexible(
            child: messages.isEmpty
                ? _Empty(theme: theme, appearance: appearance)
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                    itemCount: messages.length,
                    itemBuilder: (context, i) => NestBubble(
                      message: messages[i],
                      theme: theme,
                      attachmentUrl: widget.chat.attachmentUrl,
                      // Only on the first of a run. Repeating a name down five
                      // consecutive replies is noise.
                      showAuthor: i == 0 || messages[i - 1].from != messages[i].from,
                    ),
                  ),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
              color: const Color(0x14DC2626),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
              ),
            ),
          if (_staged.isNotEmpty)
            NestStagedFiles(
              files: _staged,
              onRemove: (upload) => setState(() => _staged.remove(upload)),
            ),
          if (widget.chat.isClosed)
            _ClosedNotice(
              theme: theme,
              message: appearance.closedMessage,
              newChatLabel: appearance.newChatLabel,
              busy: _restarting,
              onNewChat: _startNewChat,
            )
          else
            _Composer(
              controller: _composer,
              theme: theme,
              placeholder: appearance.placeholder,
              sending: _sending,
              attaching: _attaching,
              onAttach: widget.onPickFile == null ? null : _attach,
              onSend: _send,
              onChanged: _onTyped,
            ),
          if (appearance.showBranding)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Powered by Nest Connect',
                style: TextStyle(fontSize: 11, color: theme.muted),
              ),
            ),
          // Above the home indicator, and above the keyboard when it is up.
          SizedBox(height: MediaQuery.of(context).viewInsets.bottom > 0 ? 8 : 12),
        ],
      ),
    );
  }
}

/// Files chosen but not yet sent.
///
/// Removable, because picking the wrong photo is the most ordinary mistake
/// there is and the alternative is closing the chat to undo it. Its own widget
/// so the staged state can be looked at on its own — the messenger around it
/// needs a network to exist, and this does not.
class NestStagedFiles extends StatelessWidget {
  const NestStagedFiles({super.key, required this.files, required this.onRemove});

  final List<NestUpload> files;
  final ValueChanged<NestUpload> onRemove;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Wrap(
          spacing: 6,
          children: [
            for (final upload in files)
              Chip(
                label: Text(upload.filename, overflow: TextOverflow.ellipsis),
                onDeleted: () => onRemove(upload),
              ),
          ],
        ),
      );
}

class _Header extends StatelessWidget {
  const _Header({
    required this.appearance,
    required this.theme,
    required this.online,
    required this.team,
    this.onClose,
  });

  final NestAppearance appearance;
  final NestTheme theme;
  final bool online;
  final List<NestTeamMate> team;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [theme.accent, theme.accentDeep],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      padding: const EdgeInsets.fromLTRB(20, 18, 12, 20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (appearance.headline.isNotEmpty)
                  Text(
                    appearance.headline,
                    style: TextStyle(color: theme.onAccent.withValues(alpha: 0.75), fontSize: 13),
                  ),
                Text(
                  appearance.title,
                  style: TextStyle(
                    color: theme.onAccent,
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  // The away message is not decoration: it is the difference
                  // between a promise we keep and one made at 3am.
                  online ? appearance.subtitle : appearance.awayMessage,
                  style: TextStyle(color: theme.onAccent.withValues(alpha: 0.85), fontSize: 13),
                ),
                if (team.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _Faces(team: team, theme: theme),
                ],
              ],
            ),
          ),
          if (onClose != null)
            IconButton(
              onPressed: onClose,
              icon: Icon(Icons.close, color: theme.onAccent),
              tooltip: 'Close',
            ),
        ],
      ),
    );
  }
}

/// The people behind the counter, overlapped.
class _Faces extends StatelessWidget {
  const _Faces({required this.team, required this.theme});
  final List<NestTeamMate> team;
  final NestTheme theme;

  @override
  Widget build(BuildContext context) {
    final shown = team.take(4).toList();
    return SizedBox(
      height: 28,
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * 20,
              child: Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: theme.accentDeep,
                  border: Border.all(color: theme.accent, width: 2),
                ),
                alignment: Alignment.center,
                child: Text(
                  shown[i].name.characters.first.toUpperCase(),
                  style: TextStyle(
                    color: theme.onAccent,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.theme, required this.appearance});
  final NestTheme theme;
  final NestAppearance appearance;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 44),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.forum_outlined, size: 34, color: theme.muted),
            const SizedBox(height: 12),
            Text(
              // Not "no messages". An empty chat is an invitation, and saying
              // it is empty is the one thing that makes it feel broken.
              'Ask us anything — we read every message.',
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.muted, fontSize: 14, height: 1.4),
            ),
          ],
        ),
      );
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.theme,
    required this.placeholder,
    required this.sending,
    required this.attaching,
    required this.onSend,
    required this.onChanged,
    this.onAttach,
  });

  final TextEditingController controller;
  final NestTheme theme;
  final String placeholder;
  final bool sending;
  final bool attaching;
  final VoidCallback onSend;
  final ValueChanged<String> onChanged;
  final VoidCallback? onAttach;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        8,
        8,
        8,
        // Lifted clear of the keyboard. A composer under the keyboard is a
        // composer nobody can see what they are typing into.
        8 + MediaQuery.of(context).viewInsets.bottom,
      ),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.line)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (onAttach != null)
            IconButton(
              onPressed: attaching ? null : onAttach,
              icon: attaching
                  ? const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(Icons.add_photo_alternate_outlined, color: theme.muted),
              tooltip: 'Attach',
            ),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              minLines: 1,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              // Newline, not send. On a phone the return key is next to
              // everything, and a half-written complaint sent by accident is
              // worse than one extra tap.
              textInputAction: TextInputAction.newline,
              keyboardType: TextInputType.multiline,
              decoration: InputDecoration(
                hintText: placeholder,
                hintStyle: TextStyle(color: theme.muted),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              ),
            ),
          ),
          IconButton(
            onPressed: sending ? null : onSend,
            icon: sending
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(Icons.send_rounded, color: theme.accent),
            tooltip: 'Send',
          ),
        ],
      ),
    );
  }
}

/// What stands where the composer was, once an agent has closed the chat.
///
/// Two jobs, and the second is the one that matters. It says the conversation
/// has ended — in the business's own words, because "closed" means a resolved
/// ticket to one and an ended shift to another — and it offers the way back in.
/// Without that button this is a dead end: the customer has been told the chat
/// is over and given nothing to do about it, on a screen whose only other
/// control is the one that dismisses it.
///
/// It replaces the composer rather than disabling it. A greyed-out text field
/// invites a tap and then refuses it, which reads as the app being broken
/// rather than as the conversation being finished.
class _ClosedNotice extends StatelessWidget {
  const _ClosedNotice({
    required this.theme,
    required this.message,
    required this.newChatLabel,
    required this.busy,
    required this.onNewChat,
  });

  final NestTheme theme;

  /// The business's closing words. Deliberately blank for some of them — the
  /// chat simply stops rather than announcing that it has — so an empty string
  /// is a layout with no paragraph, not a paragraph with no text.
  final String message;
  final String newChatLabel;
  final bool busy;
  final VoidCallback onNewChat;

  @override
  Widget build(BuildContext context) {
    final label = newChatLabel.trim().isEmpty ? 'Start a new chat' : newChatLabel;
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(16, 14, 16, 14 + MediaQuery.of(context).viewInsets.bottom),
      decoration: BoxDecoration(
        color: theme.surface,
        border: Border(top: BorderSide(color: theme.line)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (message.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                message,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.muted, fontSize: 13, height: 1.4),
              ),
            ),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: busy ? null : onNewChat,
              style: FilledButton.styleFrom(
                backgroundColor: theme.accent,
                foregroundColor: theme.onAccent,
                // 44pt, so it is a target rather than a thing to aim at — this
                // is the only way forward on the screen.
                minimumSize: const Size.fromHeight(44),
              ),
              child: busy
                  ? SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: theme.onAccent),
                    )
                  : Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }
}
