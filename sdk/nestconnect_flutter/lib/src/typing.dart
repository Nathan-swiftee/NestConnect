import 'package:flutter/material.dart';

import 'theme.dart';

/// Three dots, rising in turn, where the agent's next message will appear.
///
/// Inside the thread rather than above the composer. It is the shape of a
/// message that has not arrived yet, and a band pinned over the box reads as a
/// second input instead — which is also why it takes a bubble's position and
/// corner radii.
class NestTypingDots extends StatefulWidget {
  const NestTypingDots({super.key, required this.theme});

  final NestTheme theme;

  @override
  State<NestTypingDots> createState() => _NestTypingDotsState();
}

class _NestTypingDotsState extends State<NestTypingDots>
    with SingleTickerProviderStateMixin {
  /// One cycle for all three, offset by a third each. Separate animations drift
  /// apart over a minute of typing, which reads as three unrelated dots.
  late final AnimationController _loop = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1050),
  )..repeat();

  @override
  void dispose() {
    _loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(top: 3, bottom: 1),
        child: Container(
          decoration: BoxDecoration(
            color: t.theirs,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(18),
              topRight: Radius.circular(18),
              bottomLeft: Radius.circular(6),
              bottomRight: Radius.circular(18),
            ),
            boxShadow: t.lift,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: AnimatedBuilder(
            animation: _loop,
            builder: (context, _) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < 3; i++)
                  Padding(
                    padding: EdgeInsets.only(left: i == 0 ? 0 : 5),
                    child: Transform.translate(
                      offset: Offset(0, -2.5 * _lift(i)),
                      child: Opacity(
                        // Dimmer at rest than at the top of the lift: the dots
                        // read as moving even where the two and a half pixels
                        // are too small to see.
                        opacity: 0.45 + 0.55 * _lift(i),
                        child: Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: t.muted,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Where this dot is in its hop, 0 to 1 and back, a third of a cycle behind
  /// the one before it.
  double _lift(int index) {
    final phase = (_loop.value - index / 3) % 1.0;
    // Up for the first third, down for the second, still for the last — the
    // pause is what makes it a hop rather than a wobble.
    if (phase < 1 / 3) return Curves.easeOut.transform(phase * 3);
    if (phase < 2 / 3) return Curves.easeIn.transform(1 - (phase - 1 / 3) * 3);
    return 0;
  }
}
