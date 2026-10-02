import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// How wide one face in the stack is. The web's is 34; this is a little larger,
/// because a phone is held further from the eye than it looks, and at 28 the
/// faces read as dots rather than as people.
const nestFaceSize = 38.0;

/// How far each face tucks under the one before it.
const _faceOverlap = 10.0;

/// The gap cut between overlapping faces, so the header shows through.
const _faceGap = 2.5;

/// The top of the messenger: who this is, and who is there to answer.
///
/// The web widget's header, rebuilt: the business's logo in one corner and the
/// people behind the counter in the other, then the greeting at a size worth
/// reading, on the brand colour or the brand gradient.
///
/// Three shapes of it:
///  * [fade] — the home screen's, which dissolves at the bottom into the panel
///    so the first card can ride up into it and the two read as one surface;
///  * full — over a conversation, with a clean edge, because a fade over a
///    scrolling thread is just colour going muddy above the messages;
///  * [compact] — one line, while the keyboard is up or an old conversation is
///    being read. The greeting is an introduction, and somebody mid-sentence has
///    been introduced.
class NestHeader extends StatelessWidget {
  const NestHeader({
    super.key,
    required this.appearance,
    required this.theme,
    required this.online,
    required this.team,
    required this.teamTotal,
    required this.visitorName,
    this.fade = false,
    this.compact = false,
    this.title,
    this.onBack,
    this.onClose,
  });

  final NestAppearance appearance;
  final NestTheme theme;
  final bool online;
  final List<NestTeamMate> team;
  final int teamTotal;
  final String? visitorName;
  final bool fade;
  final bool compact;

  /// What the compact header says, where it should say something other than the
  /// channel's own title — "Conversation with Sam", say.
  final String? title;

  final VoidCallback? onBack;
  final VoidCallback? onClose;

  /// How much of the bottom of a fading header is given to the fade. The cards
  /// are pulled up by this much less twenty, so they start inside the colour.
  static const fadeDepth = 100.0;

  /// How far the home screen's first card rides up into the header.
  static const overlap = 70.0;

  @override
  Widget build(BuildContext context) {
    final on = theme.onAccent;
    final content = compact ? _compact(on) : _full(on);

    return Stack(
      children: [
        // The fill, layered: depth first, the colour under it.
        for (final layer in theme.headerLayers.reversed)
          Positioned.fill(child: DecoratedBox(decoration: BoxDecoration(gradient: layer))),
        if (fade)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 94,
            child: DecoratedBox(
              decoration: BoxDecoration(
                // A smoothstep sampled eight times rather than a two-stop ramp.
                // A linear fade changes at a constant rate and then stops, and
                // the eye reads that corner as an edge even though there is no
                // edge in the pixels. This starts and finishes at rest.
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    for (final a in const [0.0, 0.043, 0.156, 0.316, 0.5, 0.684, 0.844, 0.957, 1.0, 1.0])
                      theme.panel.withValues(alpha: a),
                  ],
                  stops: const [0, 0.096, 0.202, 0.298, 0.394, 0.489, 0.596, 0.691, 0.787, 1],
                ),
              ),
            ),
          ),
        content,
      ],
    );
  }

  Widget _compact(Color on) => Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 10, 8),
        child: Row(
          children: [
            if (onBack != null) _BackButton(color: on, onTap: onBack!, label: false)
            else const SizedBox(width: 12),
            if (team.isNotEmpty) ...[
              _Faces(team: team, total: 0, theme: theme, size: 30, max: 3),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                title ?? fillVisitorName(appearance.title, visitorName),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: on, fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
            if (onClose != null) _CloseButton(color: on, onTap: onClose!),
          ],
        ),
      );

  Widget _full(Color on) {
    final logo = appearance.logoUrl;
    final headline = fillVisitorName(appearance.headline, visitorName);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 14, fade ? fadeDepth : 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: nestFaceSize,
            child: Row(
              children: [
                // Back takes the logo's corner rather than sitting beside it:
                // both are the top-left, and only one of them is something to
                // press.
                if (onBack != null)
                  _BackButton(color: on, onTap: onBack!, label: true)
                else if (logo != null && logo.isNotEmpty)
                  _Logo(url: logo),
                const Spacer(),
                if (team.isNotEmpty) _Faces(team: team, total: teamTotal, theme: theme),
                if (onClose != null) ...[
                  const SizedBox(width: 10),
                  _CloseButton(color: on, onTap: onClose!),
                ],
              ],
            ),
          ),
          const SizedBox(height: 30),
          if (headline.trim().isNotEmpty)
            Text(
              headline,
              style: TextStyle(
                color: on.withValues(alpha: 0.62),
                fontSize: 25,
                fontWeight: FontWeight.w700,
                height: 1.25,
                letterSpacing: -0.5,
              ),
            ),
          Text(
            fillVisitorName(appearance.title, visitorName),
            style: TextStyle(
              color: on,
              fontSize: 25,
              fontWeight: FontWeight.w700,
              height: 1.25,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            // The away message is not decoration: it is the difference between
            // a promise we keep and one made at 3am.
            fillVisitorName(online ? appearance.subtitle : appearance.awayMessage, visitorName),
            style: TextStyle(color: on.withValues(alpha: 0.82), fontSize: 13, height: 1.35),
          ),
        ],
      ),
    );
  }
}

/// The business's mark. Capped rather than trusted — a logo is whatever size
/// its owner exported it at — and silent when it will not load: a broken-image
/// glyph in the corner is worse than no logo.
class _Logo extends StatelessWidget {
  const _Logo({required this.url});
  final String url;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 28, maxWidth: 140),
        child: Image.network(
          url,
          fit: BoxFit.contain,
          alignment: Alignment.centerLeft,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        ),
      );
}

class _BackButton extends StatelessWidget {
  const _BackButton({required this.color, required this.onTap, required this.label});
  final Color color;
  final VoidCallback onTap;

  /// "‹ Back" in the full header, a bare arrow in the compact one.
  final bool label;

  @override
  Widget build(BuildContext context) => Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Semantics(
            button: true,
            label: 'Back',
            child: Padding(
              padding: EdgeInsets.fromLTRB(label ? 2 : 8, 6, label ? 10 : 8, 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.chevron_left_rounded, color: color, size: 26),
                  if (label)
                    Text(
                      'Back',
                      style: TextStyle(
                        color: color.withValues(alpha: 0.9),
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
}

class _CloseButton extends StatelessWidget {
  const _CloseButton({required this.color, required this.onTap});
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: color.withValues(alpha: 0.16),
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Tooltip(
            message: 'Close',
            child: SizedBox(
              width: 32,
              height: 32,
              child: Icon(Icons.close_rounded, size: 19, color: color),
            ),
          ),
        ),
      );
}

/// The people behind the counter, overlapped, with the first on top.
///
/// The gap between them is *cut*, not drawn. A ring in some colour is a collar,
/// and on a gradient there is no colour that is right at both ends of it — so
/// each face has a bite taken out where the one in front overlaps it, and what
/// shows through is the header itself. The same as the web's mask.
class _Faces extends StatelessWidget {
  const _Faces({
    required this.team,
    required this.total,
    required this.theme,
    this.size = nestFaceSize,
    this.max = 4,
  });

  final List<NestTeamMate> team;
  final int total;
  final NestTheme theme;
  final double size;
  final int max;

  @override
  Widget build(BuildContext context) {
    final shown = team.take(max).toList();
    final more = total - shown.length;
    final count = shown.length + (more > 0 ? 1 : 0);
    final overlap = _faceOverlap * size / nestFaceSize;
    final step = size - overlap;

    Widget at(int i, Widget face) => Positioned(
          left: i * step,
          child: i == 0
              ? face
              : ClipPath(clipper: _Bite(size: size, overlap: overlap), child: face),
        );

    return Semantics(
      label: '${total > shown.length ? total : shown.length} people can answer',
      child: SizedBox(
        width: size + (count - 1) * step,
        height: size,
        child: Stack(
          children: [
            // Painted last-first, so the first face ends up on top.
            if (more > 0) at(shown.length, _More(count: more, theme: theme, size: size)),
            for (var i = shown.length - 1; i >= 0; i--)
              at(i, _Face(mate: shown[i], theme: theme, size: size)),
          ],
        ),
      ),
    );
  }
}

/// A face, less the part the face in front of it covers, less a sliver more.
class _Bite extends CustomClipper<Path> {
  const _Bite({required this.size, required this.overlap});
  final double size;
  final double overlap;

  @override
  Path getClip(Size s) {
    final r = size / 2;
    final face = Path()..addOval(Rect.fromCircle(center: Offset(r, r), radius: r));
    // The face in front sits one step to the left.
    final front = Path()
      ..addOval(Rect.fromCircle(center: Offset(r - (size - overlap), r), radius: r + _faceGap));
    return Path.combine(PathOperation.difference, face, front);
  }

  @override
  bool shouldReclip(_Bite old) => old.size != size || old.overlap != overlap;
}

/// One agent: their photo, or their initials on their own colour.
///
/// The photo is the point — a row of letters says somebody exists, a row of
/// faces says somebody is there. It falls back rather than failing: a broken
/// URL or an agent who never uploaded one lands on initials, not an empty disc.
class _Face extends StatelessWidget {
  const _Face({required this.mate, required this.theme, required this.size});
  final NestTeamMate mate;
  final NestTheme theme;
  final double size;

  @override
  Widget build(BuildContext context) {
    final own = NestTheme.parseColor(mate.color ?? '');
    // A face with its own colour carries white initials, whatever the header
    // is. Only a face with no colour sits on the accent and takes its text.
    final ink = own != null ? Colors.white : theme.onAccent;
    final initials = Center(
      child: Text(
        mate.initials,
        style: TextStyle(color: ink, fontSize: size * 0.32, fontWeight: FontWeight.w700),
      ),
    );
    final url = mate.avatarUrl;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: own ?? theme.onAccent.withValues(alpha: 0.22),
      ),
      clipBehavior: Clip.antiAlias,
      child: url == null || url.isEmpty
          ? initials
          : Image.network(
              url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              // Initials until there is a frame to draw. A loading builder is
              // handed no progress before the first byte, which reads as
              // "done", and the circle is drawn empty.
              frameBuilder: (_, child, frame, __) => frame == null ? initials : child,
              errorBuilder: (_, __, ___) => initials,
            ),
    );
  }
}

/// "+2": everybody else who could answer.
class _More extends StatelessWidget {
  const _More({required this.count, required this.theme, required this.size});
  final int count;
  final NestTheme theme;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: theme.onAccent.withValues(alpha: 0.22),
        ),
        alignment: Alignment.center,
        // Centred in the part that is visible, not in the whole circle: the
        // left edge is under the face in front.
        padding: EdgeInsets.only(left: _faceOverlap * size / nestFaceSize / 2),
        child: Text(
          '+$count',
          style: TextStyle(
            color: theme.onAccent,
            fontSize: size * 0.3,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}
