import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'bubble.dart';
import 'message_row.dart';
import 'recorder.dart';
import 'theme.dart';
import 'typing.dart';
import 'voice.dart';

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
  StreamSubscription<bool>? _typingSub;
  bool _restarting = false;
  Timer? _typing;
  bool _sending = false;
  bool _attaching = false;
  String? _error;
  /// The message the composer is answering, set by a swipe.
  NestMessage? _replyTo;
  /// Flashing, because a quote above was tapped and this is what it pointed at.
  String? _flash;
  /// One key per message, so tapping a quote can scroll to the real widget
  /// rather than to a guess at where it is.
  final _keys = <String, GlobalKey>{};

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
    // And its own again for the dots, for the same reason: an agent starting to
    // type is a change with no message attached to it.
    _typingSub = widget.chat.onAgentTyping.listen((_) {
      if (mounted) setState(_scrollToEnd);
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
    unawaited(_typingSub?.cancel());
    unawaited(widget.chat.setViewing(false));
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Put the newest message back under the composer.
  ///
  /// Zero, because the thread is built upwards — see `reverse` on the list. That
  /// is the whole reason this is reliable now. It used to jump to
  /// `maxScrollExtent`, which for a lazily built list is an *estimate* made from
  /// the rows that happen to have been laid out: with a real conversation above
  /// it, the jump landed a couple of hundred pixels short of the bottom and the
  /// message somebody had just sent was built below the fold — present, stored,
  /// delivered, and not on screen. Zero is not an estimate.
  void _scrollToEnd() {
    if (!_scroll.hasClients) return;
    // Jumped to rather than animated on a rebuild: a new message arriving while
    // somebody is reading should land, not glide, and an animation that
    // restarts on every keystroke is a thread that will not sit still.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(0);
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
    final answering = _replyTo;
    _composer.clear();
    _staged.clear();
    // The quote chip goes the moment they send, not when the reply lands: it
    // describes an intention, and the intention has been carried out.
    _replyTo = null;
    try {
      await widget.chat.send(text, attachments: attachments, replyTo: answering);
    } on NestException catch (e) {
      // The server's own words. "That kind of file can't be attached here" is
      // an answer; "something went wrong" is a shrug.
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// A finished recording, uploaded and sent as its own message.
  Future<void> _sendVoice(RecordedNote note) async {
    final answering = _replyTo;
    setState(() {
      _replyTo = null;
      _error = null;
    });
    try {
      final staged = await widget.chat.attachVoice(
        bytes: note.bytes,
        mime: note.mime,
        durationMs: note.duration.inMilliseconds,
        waveform: note.waveform,
      );
      await widget.chat.send('', attachments: [staged], replyTo: answering);
    } on NestException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  /// Tapping a quote goes to what it answers, and flashes it.
  void _jumpToQuote(NestQuote quote) {
    final key = _keys[quote.id];
    final target = key?.currentContext;
    if (target == null) return;
    unawaited(
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
        alignment: 0.5,
      ),
    );
    setState(() => _flash = quote.id);
    // Clears itself. The ring marks a moment, not a state.
    Timer(const Duration(milliseconds: 1400), () {
      if (mounted && _flash == quote.id) setState(() => _flash = null);
    });
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
    final typing = widget.chat.agentTyping && !widget.chat.isClosed;

    /// How much of the screen the keyboard has taken.
    ///
    /// Everything about the shape of this sheet follows from it, and it used to
    /// be read in one place only — the composer's own padding — which is how
    /// the thread came to be squeezed out of existence. A `Column` sized to its
    /// children hands the flexible one whatever is left, and with a header, a
    /// composer and a keyboard to pay for there was nothing left: on a 375×667
    /// phone the thread was laid out *zero pixels tall* and the column
    /// overflowed on top of that. Which is exactly the report — a message sent
    /// and not visible until the chat was closed and opened again, because
    /// closing it put the keyboard away and gave the thread its height back.
    final keyboard = MediaQuery.of(context).viewInsets.bottom;

    /// Chrome costs the thread its height, so with the keyboard up it goes.
    /// The greeting, the away line and the faces are an introduction, and
    /// somebody mid-sentence has been introduced.
    final compact = keyboard > 0;

    return Padding(
      // The whole sheet sits on top of the keyboard, rather than the composer
      // carrying it as padding inside a column that had already run out of
      // room. One place, and the thread is measured in the space that is
      // actually on screen.
      padding: EdgeInsets.only(bottom: keyboard),
      child: Container(
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
            visitorName: widget.chat.visitorName,
            compact: compact,
            onClose: widget.onClose,
          ),
          Flexible(
            child: messages.isEmpty && !typing
                ? _Empty(theme: theme, appearance: appearance)
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                    // Built from the bottom up, newest first.
                    //
                    // Not a style: it is what makes "the newest message is on
                    // screen" true by construction. Downwards, the bottom of
                    // the thread is `maxScrollExtent` — a guess, for a list
                    // that builds rows as they are needed — so the scroll that
                    // follows a new message landed short of it and the message
                    // was built below the fold. Upwards, the newest message is
                    // at offset zero, which needs no scrolling and cannot be
                    // estimated wrongly. It is also why the conversation hugs
                    // the composer instead of hanging from the header.
                    reverse: true,
                    itemCount: messages.length + (typing ? 1 : 0),
                    itemBuilder: (context, row) {
                      // The dots come first in a reversed list, which puts them
                      // last on screen — where the reply itself is about to
                      // appear, scrolling with the thread rather than hovering
                      // over it.
                      if (typing && row == 0) return NestTypingDots(theme: theme);
                      final i = messages.length - 1 - (typing ? row - 1 : row);
                      final m = messages[i];
                      final key = _keys.putIfAbsent(m.id, GlobalKey.new);
                      final voice = m.voice;
                      return NestMessageRow(
                        key: ValueKey(m.id),
                        message: m,
                        theme: theme,
                        highlighted: _flash == m.id,
                        // A message still on its way has no id the server
                        // would recognise, so there is nothing to react to
                        // and nothing to quote.
                        canAct: !widget.chat.isClosed && !m.id.startsWith('pending-'),
                        onReply: (target) => setState(() => _replyTo = target),
                        onReact: (target, emoji) =>
                            unawaited(widget.chat.react(target.id, emoji)),
                        onJumpToQuote: _jumpToQuote,
                        child: KeyedSubtree(
                          key: key,
                          // A recording is the whole bubble rather than a file
                          // listed under one: the waveform *is* the message,
                          // and wrapping it in an empty text bubble would put
                          // a box round it for no reason.
                          child: voice != null
                              ? Align(
                                  alignment: m.isMine
                                      ? Alignment.centerRight
                                      : Alignment.centerLeft,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 3),
                                    child: NestVoiceNote(
                                      attachment: voice,
                                      source: widget.chat.attachmentUrl(voice),
                                      mine: m.isMine,
                                      theme: theme,
                                    ),
                                  ),
                                )
                              : NestBubble(
                                  message: m,
                                  theme: theme,
                                  attachmentUrl: widget.chat.attachmentUrl,
                                  // Only on the first of a run. Repeating a
                                  // name down five consecutive replies is noise.
                                  showAuthor:
                                      i == 0 || messages[i - 1].from != messages[i].from,
                                ),
                        ),
                      );
                    },
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
          else ...[
            // What they are answering, above the box rather than inside it:
            // the quote is context for what they are about to type, and in
            // the field it would have to be deleted to be cleared.
            if (_replyTo != null)
              _ReplyingTo(
                theme: theme,
                message: _replyTo!,
                onCancel: () => setState(() => _replyTo = null),
              ),
            _Composer(
              controller: _composer,
              theme: theme,
              placeholder: appearance.placeholder,
              sending: _sending,
              attaching: _attaching,
              onAttach: widget.onPickFile == null ? null : _attach,
              onSend: _send,
              onChanged: _onTyped,
              onRecorded: (note) => unawaited(_sendVoice(note)),
              onRecordError: (message) => setState(() => _error = message),
            ),
          ],
          // Dropped with the keyboard up for the same reason the greeting is:
          // a line of our own branding is not worth a line of their
          // conversation.
          if (appearance.showBranding && !compact)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Powered by Nest Connect',
                style: TextStyle(fontSize: 11, color: theme.muted),
              ),
            ),
          // Clear of the home indicator. The keyboard is paid for once, above.
          SizedBox(height: compact ? 6 : 12),
        ],
      ),
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
    required this.visitorName,
    required this.compact,
    this.onClose,
  });

  final NestAppearance appearance;
  final NestTheme theme;
  final bool online;
  final List<NestTeamMate> team;

  /// Whoever the app signed in, so "Hello {name} 👋" is a greeting rather than
  /// a template nobody filled in.
  final String? visitorName;

  /// The keyboard is up, so this is an introduction nobody is reading. Title
  /// only, on one line — the rest of it is the thread's height.
  final bool compact;
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
      padding: compact
          ? const EdgeInsets.fromLTRB(20, 10, 8, 10)
          : const EdgeInsets.fromLTRB(20, 18, 12, 20),
      child: Row(
        crossAxisAlignment:
            compact ? CrossAxisAlignment.center : CrossAxisAlignment.start,
        children: [
          Expanded(
            child: compact
                ? Text(
                    fillVisitorName(appearance.title, visitorName),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.onAccent,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (appearance.headline.isNotEmpty)
                  Text(
                    fillVisitorName(appearance.headline, visitorName),
                    style: TextStyle(color: theme.onAccent.withValues(alpha: 0.75), fontSize: 13),
                  ),
                Text(
                  fillVisitorName(appearance.title, visitorName),
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
                  fillVisitorName(
                    online ? appearance.subtitle : appearance.awayMessage,
                    visitorName,
                  ),
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

/// How wide one face in the stack is, ring included.
const _faceSize = 28.0;

/// The collar between a face and the one it overlaps.
const _faceRing = 2.0;

/// How far along each face sits. Less than its width, which is the overlap.
const _faceStep = 20.0;

/// The people behind the counter, overlapped.
class _Faces extends StatelessWidget {
  const _Faces({required this.team, required this.theme});
  final List<NestTeamMate> team;
  final NestTheme theme;

  @override
  Widget build(BuildContext context) {
    final shown = team.take(4).toList();
    return SizedBox(
      height: _faceSize,
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * _faceStep,
              // Two circles, one inside the other, rather than one circle with
              // a border. A `Container` that draws its ring as a `Border` also
              // insets its child by the ring's width — so the photo was laid
              // out 24px wide inside a 28px clip, and a 28px circle takes
              // nothing off a 24px square but its corners. Which is exactly
              // what was reported: initials came out round, because text has
              // no corners to cut, and a face came out a rounded square.
              child: Container(
                width: _faceSize,
                height: _faceSize,
                // The collar, as the gap between two circles.
                padding: const EdgeInsets.all(_faceRing),
                decoration: BoxDecoration(shape: BoxShape.circle, color: theme.accent),
                child: Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    // Their own avatar colour where they have one, so the stack
                    // reads as people rather than as four identical discs.
                    color: NestTheme.parseColor(shown[i].color ?? '') ?? theme.accentDeep,
                  ),
                  // No border on this one, so the clip and the child are the
                  // same circle and a photo fills it edge to edge.
                  clipBehavior: Clip.antiAlias,
                  alignment: Alignment.center,
                  child: _Face(
                    mate: shown[i],
                    theme: theme,
                    diameter: _faceSize - _faceRing * 2,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One agent in the stack: their photo, or their initials on their own colour.
///
/// The photo is the point — a row of letters says somebody exists, a row of
/// faces says somebody is there, which is the whole reason a chat outperforms a
/// contact form. It falls back rather than failing: a broken image URL, a
/// filtered network or an agent who never uploaded one all land on initials
/// instead of an empty circle.
class _Face extends StatelessWidget {
  const _Face({required this.mate, required this.theme, required this.diameter});
  final NestTeamMate mate;
  final NestTheme theme;

  /// The circle this fills — the stack's width less its collar. Passed rather
  /// than assumed, because a photo that is not exactly the size of the circle
  /// clipping it is the difference between a face and a rounded square.
  final double diameter;

  @override
  Widget build(BuildContext context) {
    final initials = Text(
      mate.initials,
      style: TextStyle(color: theme.onAccent, fontSize: 11, fontWeight: FontWeight.w600),
    );
    final url = mate.avatarUrl;
    if (url == null || url.isEmpty) return initials;
    return Image.network(
      url,
      width: diameter,
      height: diameter,
      fit: BoxFit.cover,
      // Their initials stay under it while it loads, so the stack does not pop
      // into place a face at a time.
      loadingBuilder: (_, child, progress) => progress == null ? child : initials,
      errorBuilder: (_, __, ___) => initials,
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
    required this.onRecorded,
    required this.onRecordError,
    this.onAttach,
  });

  final TextEditingController controller;
  final NestTheme theme;
  final String placeholder;
  final bool sending;
  final bool attaching;
  final VoidCallback onSend;
  final ValueChanged<String> onChanged;
  final ValueChanged<RecordedNote> onRecorded;
  final ValueChanged<String> onRecordError;
  final VoidCallback? onAttach;

  @override
  Widget build(BuildContext context) {
    return Container(
      // The keyboard is accounted for by the sheet, once, around the whole
      // messenger — see `keyboard` in the build above. Adding it here as well
      // is what left the thread with nothing.
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
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
          // The mic gives way to send the moment there is anything to send.
          // Two buttons side by side would make the commonest action — sending
          // what you just typed — a choice between targets.
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            builder: (context, value, _) => value.text.trim().isEmpty
                ? Padding(
                    padding: const EdgeInsets.only(right: 6, bottom: 4),
                    child: NestRecorderButton(
                      theme: theme,
                      enabled: !sending,
                      onRecorded: onRecorded,
                      onError: onRecordError,
                    ),
                  )
                : IconButton(
                    onPressed: sending ? null : onSend,
                    icon: sending
                        ? const SizedBox(
                            width: 18, height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(Icons.send_rounded, color: theme.accent),
                    tooltip: 'Send',
                  ),
          ),
        ],
      ),
    );
  }
}

/// What the composer is answering.
class _ReplyingTo extends StatelessWidget {
  const _ReplyingTo({
    required this.theme,
    required this.message,
    required this.onCancel,
  });

  final NestTheme theme;
  final NestMessage message;
  final VoidCallback onCancel;

  /// What to show when the message being answered had no words of its own.
  String get _label {
    final words = message.body.trim();
    if (words.isNotEmpty) return words;
    final voice = message.voice;
    if (voice != null) return 'Voice message';
    if (message.attachments.isEmpty) return 'Message';
    return message.attachments.first.isImage ? 'Photo' : 'Attachment';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(10, 0, 10, 0),
      padding: const EdgeInsets.fromLTRB(10, 7, 4, 7),
      decoration: BoxDecoration(
        color: theme.accent.withValues(alpha: 0.08),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
        border: Border(left: BorderSide(color: theme.accent, width: 3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  message.isMine ? 'Replying to yourself' : 'Replying to ${message.authorName ?? 'them'}',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: theme.accent,
                  ),
                ),
                Text(
                  _label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12.5, color: theme.muted),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onCancel,
            icon: Icon(Icons.close_rounded, size: 18, color: theme.muted),
            tooltip: 'Stop replying',
            visualDensity: VisualDensity.compact,
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
      // As with the composer: the sheet above has already moved clear of the
      // keyboard, and counting it twice was what collapsed the thread.
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
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
