import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'messenger.dart';
import 'theme.dart';

/// Whether there is a conversation worth coming back to: one with something
/// said in it, that an agent has not closed.
///
/// What decides whether closing the chat minimises it or puts it away. A chat
/// with nothing in it has nothing to show in a bar, and a closed one has
/// nothing more coming.
bool nestChatActive(NestConnect chat) => chat.isOpen && !chat.isClosed && chat.messages.isNotEmpty;

/// How far above the bottom of the safe area the minimised chat sits, by
/// default: clear of a tab bar, which most apps have along the bottom and which
/// the bar must not cover — the customer would lose their way around the app to
/// a chat they put down.
const nestMinimisedLift = 88.0;

/// Whether the minimised chat is on screen — so [NestLauncher] can step aside
/// for it rather than sit underneath it.
final nestMinimisedShowing = ValueNotifier<bool>(false);

OverlayEntry? _entry;

/// Put the minimised chat over the app.
///
/// In the root overlay, so it stays put as the app moves between screens: the
/// conversation is still going on whichever page the customer is on.
void showNestMinimised(
  OverlayState overlay, {
  required NestConnect chat,
  required VoidCallback onOpen,
  double lift = nestMinimisedLift,
}) {
  hideNestMinimised();
  final entry = OverlayEntry(
    builder: (context) => NestMinimisedChat(
      chat: chat,
      lift: lift,
      onOpen: () {
        hideNestMinimised();
        onOpen();
      },
      onDismiss: hideNestMinimised,
    ),
  );
  _entry = entry;
  overlay.insert(entry);
  nestMinimisedShowing.value = true;
}

/// Take the minimised chat away — on sign-out, say, or when the app has a
/// screen it should not sit over. Opening the chat again does this itself.
void hideNestMinimised() {
  final entry = _entry;
  _entry = null;
  nestMinimisedShowing.value = false;
  if (entry == null) return;
  void remove() {
    entry
      ..remove()
      ..dispose();
  }

  // Not built yet — inserted this frame — and so not removable yet either.
  // An entry whose overlay has gone with its app never will be, and needs
  // nothing doing.
  if (entry.mounted) {
    remove();
  } else {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (entry.mounted) remove();
    });
  }
}

/// The chat, minimised: who is talking, the last thing said, and how much is
/// waiting — a bar along the bottom of the app that opens the conversation
/// again when tapped.
///
/// The point of it is the reply. Somebody who closes the chat mid-conversation
/// is usually waiting on an answer, and with the chat put away the only sign
/// one came was a badge on a button. Here it arrives in full, live, with the
/// agent's face on it, and somebody typing shows as somebody typing.
class NestMinimisedChat extends StatefulWidget {
  const NestMinimisedChat({
    super.key,
    required this.chat,
    required this.onOpen,
    required this.onDismiss,
    this.lift = nestMinimisedLift,
  });

  final NestConnect chat;

  /// Distance above the bottom of the safe area — see [nestMinimisedLift].
  final double lift;
  final VoidCallback onOpen;
  final VoidCallback onDismiss;

  @override
  State<NestMinimisedChat> createState() => _NestMinimisedChatState();
}

class _NestMinimisedChatState extends State<NestMinimisedChat> {
  final _subs = <StreamSubscription<Object?>>[];

  @override
  void initState() {
    super.initState();
    void redraw(Object? _) {
      if (mounted) setState(() {});
    }

    _subs
      ..add(widget.chat.onMessages.listen(redraw))
      ..add(widget.chat.onUnread.listen(redraw))
      ..add(widget.chat.onAgentTyping.listen(redraw))
      ..add(widget.chat.onClosed.listen(redraw));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    // Signed out, or started over, underneath it: nothing left to come back to.
    if (!chat.isOpen || chat.messages.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => widget.onDismiss());
      return const SizedBox.shrink();
    }

    final config = chat.config;
    final appearance = config?.appearance ?? NestAppearance.fallback;
    final theme = NestTheme.from(appearance, Theme.of(context).brightness);
    final team = config?.team ?? const <NestTeamMate>[];
    final last = chat.messages.last;
    final lastAgent = chat.messages.lastWhere(
      (m) => m.from == NestAuthor.agent,
      orElse: () => last,
    );
    // The agent who has been answering — or, before anyone has, the first face
    // on the team, which is who the header has been showing all along.
    final who = lastAgent.from == NestAuthor.agent
        ? (lastAgent.authorName ?? (team.isEmpty ? null : team.first.name))
        : (team.isEmpty ? null : team.first.name);
    final unread = chat.unread;
    final media = MediaQuery.of(context);

    // Words rather than the thread's dots: those are drawn on a bubble the
    // colour of this bar, and on it they vanish.
    final preview = chat.agentTyping
        ? Text(
            'typing…',
            maxLines: 1,
            style: TextStyle(color: theme.accent, fontSize: 13.5, fontWeight: FontWeight.w600),
          )
        : Text(
            nestPreview(last),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: unread > 0 ? theme.text : theme.muted,
              fontSize: 13.5,
              fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.w400,
            ),
          );

    final bar = Material(
      color: theme.raised,
      elevation: 10,
      shadowColor: Colors.black.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: widget.onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
          child: Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  NestAgentFace(name: who ?? appearance.title, team: team, theme: theme, size: 40),
                  if (config?.online ?? false)
                    Positioned(
                      right: -1,
                      bottom: -1,
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: const Color(0xFF22C55E),
                          shape: BoxShape.circle,
                          border: Border.all(color: theme.raised, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      who ?? appearance.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(color: theme.text, fontSize: 14.5, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 3),
                    SizedBox(height: 18, child: preview),
                  ],
                ),
              ),
              if (unread > 0) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  constraints: const BoxConstraints(minWidth: 22),
                  decoration: BoxDecoration(
                    color: theme.accent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    unread > 9 ? '9+' : '$unread',
                    textAlign: TextAlign.center,
                    style:
                        TextStyle(color: theme.onAccent, fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              IconButton(
                tooltip: 'Hide',
                visualDensity: VisualDensity.compact,
                onPressed: widget.onDismiss,
                icon: Icon(Icons.close_rounded, size: 18, color: theme.muted),
              ),
            ],
          ),
        ),
      ),
    );

    return Positioned(
      left: 12,
      right: 12,
      bottom: media.padding.bottom + media.viewInsets.bottom + widget.lift,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            builder: (context, t, child) => Opacity(
              opacity: t,
              child: Transform.translate(offset: Offset(0, (1 - t) * 40), child: child),
            ),
            // Swiped away sideways, like a notification, as well as by its ×.
            child: Dismissible(
              key: const ValueKey('nest-minimised'),
              onDismissed: (_) => widget.onDismiss(),
              child: bar,
            ),
          ),
        ),
      ),
    );
  }
}

/// One line saying what a message was, for somewhere with room for one line.
String nestPreview(NestMessage m) {
  final mine = m.from == NestAuthor.visitor;
  final body = m.body.trim().replaceAll(RegExp(r'\s+'), ' ');
  String what;
  if (body.isNotEmpty) {
    what = body;
  } else if (m.attachments.any((a) => a.isVoice)) {
    what = 'Voice message';
  } else if (m.attachments.any((a) => a.isImage)) {
    what = 'Photo';
  } else if (m.attachments.isNotEmpty) {
    what = m.attachments.first.filename;
  } else {
    what = '…';
  }
  return mine ? 'You: $what' : what;
}
