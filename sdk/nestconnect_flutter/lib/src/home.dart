import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// The screen a customer lands on, when the business has turned one on.
///
/// The same arrangement as the web widget's, deliberately: a card for the chat
/// itself, the customer's own earlier conversations under it, and the
/// business's other ways of being reached below that. Somebody who has used
/// the website and then the app should recognise the second one.
///
/// Cards rather than a list, and that is the point of it. A list of rows is a
/// menu of equal things; a stack of cards with a line of explanation each says
/// what every option is *for* — which is the difference between "Email" and
/// "Email — we answer within a day".
class NestHomeScreen extends StatelessWidget {
  const NestHomeScreen({
    super.key,
    required this.home,
    required this.theme,
    required this.greeting,
    required this.conversations,
    required this.loadingConversations,
    required this.onStartChat,
    required this.onOpenConversation,
    required this.onOpenLink,
  });

  final NestHome home;
  final NestTheme theme;

  /// The channel's own opening line, shown above the cards where there is one.
  final String greeting;

  /// This customer's earlier conversations, newest first.
  final List<NestPastConversation> conversations;
  final bool loadingConversations;

  final VoidCallback onStartChat;
  final ValueChanged<NestPastConversation> onOpenConversation;
  final ValueChanged<NestHomeCard> onOpenLink;

  @override
  Widget build(BuildContext context) {
    // The live one, if there is one, is the chat card's business rather than a
    // row in the history: tapping "Send us a message" should land in the
    // conversation already going, not start beside it.
    final past = conversations.where((c) => c.closed).toList(growable: false);
    final live = conversations.where((c) => !c.closed).toList(growable: false);

    var step = 0;
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
      children: [
        if (greeting.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
            child: Text(
              greeting,
              style: TextStyle(fontSize: 14, height: 1.45, color: theme.muted),
            ),
          ),

        // The chat's own door. First, always, and not one of the configured
        // cards — those are links out, and this is the thing itself.
        _Card(
          theme: theme,
          index: step++,
          accented: true,
          icon: _Glyph(name: 'chat', theme: theme, onAccent: true),
          label: home.chatLabel,
          sublabel: live.isEmpty
              ? home.chatSublabel
              // What is actually waiting beats what usually happens: somebody
              // with a chat open wants to be told it is open, not told how
              // quickly we normally reply.
              : _previewLine(live.first),
          trailing: Icons.send_rounded,
          onTap: onStartChat,
        ),

        if (loadingConversations)
          const Padding(
            padding: EdgeInsets.only(top: 14),
            child: Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          )
        else if (past.isNotEmpty) ...[
          _Heading(theme: theme, text: past.length == 1 ? 'Earlier' : 'Earlier conversations'),
          for (final conversation in past)
            _Card(
              theme: theme,
              index: step++,
              icon: _Glyph(name: 'history', theme: theme),
              label: _previewLine(conversation),
              sublabel: _whenLine(conversation),
              trailing: Icons.chevron_right_rounded,
              onTap: () => onOpenConversation(conversation),
            ),
        ],

        if (home.cards.isNotEmpty) ...[
          _Heading(theme: theme, text: 'Other ways to reach us'),
          for (final card in home.cards)
            _Card(
              theme: theme,
              index: step++,
              icon: card.icon == null ? null : _Glyph(name: card.icon!, theme: theme),
              label: card.label,
              sublabel: card.sublabel,
              trailing: Icons.north_east_rounded,
              onTap: () => onOpenLink(card),
            ),
        ],
      ],
    );
  }
}

/// "You: where is my order?" — or the agent's words, as they were said.
String _previewLine(NestPastConversation c) =>
    c.preview.isEmpty ? 'Conversation' : (c.fromMe ? 'You: ${c.preview}' : c.preview);

/// When it was, in the words somebody would use out loud.
String _whenLine(NestPastConversation c) {
  final ago = DateTime.now().difference(c.at);
  final who = c.closed ? 'Resolved' : 'Last message';
  if (ago.inMinutes < 1) return '$who · just now';
  if (ago.inMinutes < 60) return '$who · ${ago.inMinutes}m ago';
  if (ago.inHours < 24) return '$who · ${ago.inHours}h ago';
  if (ago.inDays < 7) return '$who · ${ago.inDays}d ago';
  return '$who · ${c.at.day}/${c.at.month}/${c.at.year}';
}

class _Heading extends StatelessWidget {
  const _Heading({required this.theme, required this.text});
  final NestTheme theme;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(6, 18, 6, 8),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.6,
            color: theme.muted,
          ),
        ),
      );
}

/// One card, arriving a beat after the one above it.
///
/// The stagger is 45ms a card, which is short enough not to be a wait and long
/// enough that the stack reads as being dealt rather than appearing. Past about
/// six cards it stops mattering, and the server caps the configured ones at six.
class _Card extends StatefulWidget {
  const _Card({
    required this.theme,
    required this.index,
    required this.label,
    required this.sublabel,
    required this.trailing,
    required this.onTap,
    this.icon,
    this.accented = false,
  });

  final NestTheme theme;
  final int index;
  final String label;
  final String sublabel;
  final IconData trailing;
  final VoidCallback onTap;
  final Widget? icon;

  /// The chat's own card, in the brand colour. One of them, so it reads as the
  /// thing to do rather than as one option of five.
  final bool accented;

  @override
  State<_Card> createState() => _CardState();
}

class _CardState extends State<_Card> with SingleTickerProviderStateMixin {
  late final AnimationController _in = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 260),
  );

  @override
  void initState() {
    super.initState();
    final delay = Duration(milliseconds: 45 * widget.index);
    // Forward after its turn. `Future.delayed` rather than a staggered interval
    // on one controller because each card owns its own arrival and the list is
    // built lazily — a card scrolled into view later should still arrive.
    Future<void>.delayed(delay, () {
      if (mounted) _in.forward();
    });
  }

  @override
  void dispose() {
    _in.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    final fg = widget.accented ? t.onAccent : t.onTheirs;
    final curve = CurvedAnimation(parent: _in, curve: Curves.easeOutCubic);

    return AnimatedBuilder(
      animation: curve,
      builder: (context, child) => Opacity(
        opacity: curve.value,
        // Up rather than in from the side: the stack is being dealt onto the
        // screen, and sideways reads as a page turning.
        child: Transform.translate(offset: Offset(0, 10 * (1 - curve.value)), child: child),
      ),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Material(
          color: widget.accented ? t.accent : t.surface,
          borderRadius: BorderRadius.circular(16),
          elevation: widget.accented ? 2 : 0,
          shadowColor: t.accent.withValues(alpha: 0.35),
          child: InkWell(
            onTap: widget.onTap,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: widget.accented ? null : Border.all(color: t.line),
              ),
              padding: const EdgeInsets.fromLTRB(14, 13, 12, 13),
              child: Row(
                children: [
                  if (widget.icon != null)
                    Padding(padding: const EdgeInsets.only(right: 11), child: widget.icon),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          widget.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: fg,
                          ),
                        ),
                        if (widget.sublabel.trim().isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              widget.sublabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12.5,
                                color: widget.accented
                                    ? t.onAccent.withValues(alpha: 0.82)
                                    : t.muted,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Icon(
                    widget.trailing,
                    size: 18,
                    color: widget.accented ? t.onAccent.withValues(alpha: 0.9) : t.muted,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The mark on a card.
///
/// Drawn from a fixed set keyed by name, not from an emoji the business typed.
/// An emoji is rendered by whatever operating system the customer is holding —
/// 💬 is a different object on Android, iOS and a Mac — so a row of them ends up
/// in four styles at four weights. A name this build does not recognise draws
/// the neutral mark rather than nothing, so an icon added to the server later
/// still gets a card that looks finished.
class _Glyph extends StatelessWidget {
  const _Glyph({required this.name, required this.theme, this.onAccent = false});

  final String name;
  final NestTheme theme;
  final bool onAccent;

  static const _icons = <String, IconData>{
    'chat': Icons.chat_bubble_rounded,
    'whatsapp': Icons.whatshot_rounded,
    'email': Icons.alternate_email_rounded,
    'phone': Icons.call_rounded,
    'instagram': Icons.camera_alt_rounded,
    'facebook': Icons.thumb_up_alt_rounded,
    'help': Icons.help_outline_rounded,
    'book': Icons.menu_book_rounded,
    'history': Icons.history_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final icon = _icons[name] ?? Icons.north_east_rounded;
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: onAccent
            ? theme.onAccent.withValues(alpha: 0.18)
            : theme.accent.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(10),
      ),
      alignment: Alignment.center,
      child: Icon(icon, size: 18, color: onAccent ? theme.onAccent : theme.accent),
    );
  }
}
