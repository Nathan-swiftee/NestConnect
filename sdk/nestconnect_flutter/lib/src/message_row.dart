import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// How far a bubble travels before letting go replies. Short — this is a
/// flick, not a drag, and every messenger that gets it right trips at about a
/// thumb's width.
const _replyDistance = 56.0;

/// Past this the bubble stops following the finger one-for-one and starts
/// resisting. Without it a hard swipe throws the bubble across the sheet,
/// which reads as a bug rather than as a gesture with a limit.
const _rubberDistance = 72.0;

/// The emoji offered. Six, because a row that needs scrolling is a menu.
const nestQuickReactions = <String>['👍', '❤️', '😂', '😮', '😢', '🙏'];

/// One pill per emoji, with a count — not one pill per person.
List<({String emoji, int count, bool mine})> collapseReactions(
  List<NestReaction> reactions,
) {
  final out = <({String emoji, int count, bool mine})>[];
  for (final r in reactions) {
    final at = out.indexWhere((o) => o.emoji == r.emoji);
    if (at == -1) {
      out.add((emoji: r.emoji, count: 1, mine: r.mine));
    } else {
      out[at] = (
        emoji: out[at].emoji,
        count: out[at].count + 1,
        mine: out[at].mine || r.mine,
      );
    }
  }
  return out;
}

/// One message, and everything you can do to it.
///
/// Two gestures share the row and must not fight. A horizontal drag replies,
/// and is claimed only once the movement is clearly sideways — so a thumb
/// travelling down the thread scrolls rather than arming a reply on every
/// bubble it passes. A long press opens the reactions, and dies the moment
/// anything moves, because a press that became a drag was a drag.
class NestMessageRow extends StatefulWidget {
  const NestMessageRow({
    super.key,
    required this.message,
    required this.theme,
    required this.child,
    required this.onReply,
    required this.onReact,
    required this.onJumpToQuote,
    this.highlighted = false,
    this.canAct = true,
  });

  final NestMessage message;
  final NestTheme theme;
  final Widget child;
  final ValueChanged<NestMessage> onReply;
  final void Function(NestMessage message, String emoji) onReact;
  final ValueChanged<NestQuote> onJumpToQuote;

  /// Flashing because a quote above was tapped and this is what it pointed at.
  final bool highlighted;

  /// False once the chat is closed: still readable, nothing left to do to it.
  final bool canAct;

  @override
  State<NestMessageRow> createState() => _NestMessageRowState();
}

class _NestMessageRowState extends State<NestMessageRow> {
  double _dx = 0;
  bool _dragging = false;
  bool _fired = false;

  bool get _armed => _dx >= _replyDistance;

  void _update(double delta) {
    final next = (_dx + delta).clamp(0.0, double.infinity);
    // Follow the finger, then resist: past the threshold each further pixel is
    // worth less, so a hard swipe eases into a stop instead of flying.
    _dx = next <= _rubberDistance
        ? next
        : _rubberDistance + (next - _rubberDistance) * 0.25;
    // The buzz lands at the threshold, not at the end of the gesture — it is
    // the answer to "is this far enough yet", and it has to arrive while the
    // finger can still act on it.
    if (_armed && !_fired) {
      _fired = true;
      HapticFeedback.selectionClick();
    } else if (!_armed) {
      _fired = false;
    }
    setState(() {});
  }

  void _release() {
    if (_armed && widget.canAct) {
      HapticFeedback.lightImpact();
      widget.onReply(widget.message);
    }
    setState(() {
      _dx = 0;
      _dragging = false;
      _fired = false;
    });
  }

  Future<void> _openReactions() async {
    if (!widget.canAct) return;
    HapticFeedback.mediumImpact();
    final mine = widget.message.reactions.where((r) => r.mine).firstOrNull?.emoji;
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => _ReactionPicker(theme: widget.theme, current: mine),
    );
    if (picked == null || !mounted) return;
    // Tapping the one already there takes it off — the same tap that put it
    // there, which is the only removal anybody goes looking for.
    widget.onReact(widget.message, picked == mine ? '' : picked);
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.message;
    final t = widget.theme;
    final mine = m.isMine;

    return GestureDetector(
      onLongPress: () => unawaited(_openReactions()),
      onHorizontalDragStart: (_) => setState(() => _dragging = true),
      onHorizontalDragUpdate: (d) {
        if (!widget.canAct) return;
        _update(d.delta.dx);
      },
      onHorizontalDragEnd: (_) => _release(),
      onHorizontalDragCancel: _release,
      behavior: HitTestBehavior.opaque,
      child: Stack(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        children: [
          // Behind the bubble, revealed by the swipe rather than moved with
          // it — the arrow belongs to the track, not to the message.
          if (_dx > 0)
            Positioned(
              left: mine ? null : 2,
              right: mine ? 2 : null,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: _armed ? t.accent : t.muted.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.reply_rounded,
                  size: 16,
                  color: _armed ? t.onAccent : t.muted,
                ),
              ),
            ),
          AnimatedContainer(
            // No animation while the finger is on it: easing during a drag is
            // what makes a bubble feel like it is lagging behind the thumb.
            duration: _dragging ? Duration.zero : const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            transform: Matrix4.translationValues(mine ? -_dx : _dx, 0, 0),
            child: Column(
              crossAxisAlignment:
                  mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (m.quote != null)
                  _QuoteChip(
                    quote: m.quote!,
                    theme: t,
                    mine: mine,
                    onTap: () => widget.onJumpToQuote(m.quote!),
                  ),
                _Flash(on: widget.highlighted, theme: t, child: widget.child),
                if (m.reactions.isNotEmpty)
                  _ReactionPills(
                    reactions: m.reactions,
                    theme: t,
                    mine: mine,
                    onTap: (emoji, isMine) =>
                        widget.canAct ? widget.onReact(m, isMine ? '' : emoji) : null,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The message a reply is answering, tucked above it.
class _QuoteChip extends StatelessWidget {
  const _QuoteChip({
    required this.quote,
    required this.theme,
    required this.mine,
    required this.onTap,
  });

  final NestQuote quote;
  final NestTheme theme;
  final bool mine;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: mine ? 0 : 12, right: mine ? 4 : 0, bottom: 2),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
          padding: const EdgeInsets.fromLTRB(9, 6, 10, 6),
          decoration: BoxDecoration(
            color: theme.accent.withValues(alpha: 0.09),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(10)),
            border: Border(left: BorderSide(color: theme.accent, width: 3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                quote.fromMe ? 'You' : (quote.authorName ?? 'Them'),
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: theme.accent,
                ),
              ),
              Text(
                quote.label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.5, color: theme.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The emoji sitting on a message.
class _ReactionPills extends StatelessWidget {
  const _ReactionPills({
    required this.reactions,
    required this.theme,
    required this.mine,
    required this.onTap,
  });

  final List<NestReaction> reactions;
  final NestTheme theme;
  final bool mine;
  final void Function(String emoji, bool isMine) onTap;

  @override
  Widget build(BuildContext context) {
    return Transform.translate(
      // Overlapping the bubble's bottom edge, the way every messenger does
      // it: the emoji belongs to the message, and a gap makes it a separate
      // object floating underneath.
      offset: const Offset(0, -8),
      child: Padding(
        padding: EdgeInsets.only(left: mine ? 0 : 14, right: mine ? 4 : 0),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final pill in collapseReactions(reactions))
              GestureDetector(
                onTap: () => onTap(pill.emoji, pill.mine),
                child: Container(
                  margin: const EdgeInsets.only(right: 3),
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: pill.mine
                        ? Color.alphaBlend(theme.accent.withValues(alpha: 0.12), theme.surface)
                        : theme.surface,
                    borderRadius: BorderRadius.circular(999),
                    // Ours is ringed, because a second tap takes it off and
                    // nothing else says so.
                    border: Border.all(color: pill.mine ? theme.accent : theme.line),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(pill.emoji, style: const TextStyle(fontSize: 12.5)),
                      if (pill.count > 1) ...[
                        const SizedBox(width: 3),
                        Text(
                          '${pill.count}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: theme.muted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The row of emoji a long press opens.
class _ReactionPicker extends StatelessWidget {
  const _ReactionPicker({required this.theme, this.current});

  final NestTheme theme;
  final String? current;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: theme.surface,
            borderRadius: BorderRadius.circular(999),
            boxShadow: const [
              BoxShadow(color: Color(0x33101828), blurRadius: 24, offset: Offset(0, 8)),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (var i = 0; i < nestQuickReactions.length; i++)
                _PickerEmoji(
                  emoji: nestQuickReactions[i],
                  index: i,
                  chosen: nestQuickReactions[i] == current,
                  theme: theme,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One emoji in the row, arriving just after the one before it — so the row
/// reads as a row being dealt rather than six things appearing at once.
class _PickerEmoji extends StatefulWidget {
  const _PickerEmoji({
    required this.emoji,
    required this.index,
    required this.chosen,
    required this.theme,
  });

  final String emoji;
  final int index;
  final bool chosen;
  final NestTheme theme;

  @override
  State<_PickerEmoji> createState() => _PickerEmojiState();
}

class _PickerEmojiState extends State<_PickerEmoji> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 260),
  );

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(Duration(milliseconds: 22 * widget.index), () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: CurvedAnimation(parent: _c, curve: Curves.easeOutBack),
      child: GestureDetector(
        onTap: () => Navigator.of(context).pop(widget.emoji),
        child: Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: widget.chosen
                ? widget.theme.accent.withValues(alpha: 0.16)
                : Colors.transparent,
          ),
          child: Text(widget.emoji, style: const TextStyle(fontSize: 27)),
        ),
      ),
    );
  }
}

/// The ring that marks the message a tapped quote pointed at.
///
/// A moment, not a state: in a thread of similar-looking bubbles, arriving
/// somewhere is not the same as being shown which one.
class _Flash extends StatelessWidget {
  const _Flash({required this.on, required this.theme, required this.child});

  final bool on;
  final NestTheme theme;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: on
            ? [BoxShadow(color: theme.accent.withValues(alpha: 0.45), blurRadius: 0, spreadRadius: 3)]
            : const [],
      ),
      child: child,
    );
  }
}
