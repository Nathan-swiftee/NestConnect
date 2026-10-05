import 'package:flutter/material.dart';

import 'theme.dart';

/// A shimmer over grey shapes — the shape of what is loading, rather than a
/// spinner where it will be.
///
/// The point is that nothing moves when it arrives. A spinner is replaced by
/// content of a different size, so the screen jumps; a skeleton is replaced by
/// content of the size it already drew, so the screen simply fills in. It also
/// says *what* is coming — three conversation rows — which a spinner cannot.
///
/// One sweep shared by everything inside it, so a column of bones shimmers as
/// one surface instead of each block pulsing on its own clock.
class NestShimmer extends StatefulWidget {
  const NestShimmer({super.key, required this.theme, required this.child});

  final NestTheme theme;
  final Widget child;

  @override
  State<NestShimmer> createState() => _NestShimmerState();
}

class _NestShimmerState extends State<NestShimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _sweep = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..repeat();

  @override
  void dispose() {
    _sweep.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = widget.theme.isDark ? const Color(0xFF262B33) : const Color(0xFFE9ECF0);
    final shine = widget.theme.isDark ? const Color(0xFF323843) : const Color(0xFFF5F7F9);
    return AnimatedBuilder(
      animation: _sweep,
      builder: (context, child) => ShaderMask(
        blendMode: BlendMode.srcATop,
        shaderCallback: (bounds) {
          // A band a third of the width, travelling from off the left edge to
          // off the right one.
          final t = _sweep.value * 2 - 0.5;
          return LinearGradient(
            colors: [base, shine, base],
            stops: [
              (t - 0.25).clamp(0.0, 1.0),
              t.clamp(0.0, 1.0),
              (t + 0.25).clamp(0.0, 1.0),
            ],
          ).createShader(bounds);
        },
        child: child,
      ),
      child: widget.child,
    );
  }
}

/// One grey shape. Its colour is irrelevant — [NestShimmer] paints over it —
/// but it has to be opaque for the shimmer to have something to paint on.
class NestBone extends StatelessWidget {
  const NestBone({super.key, this.width, this.height = 12, this.radius = 6, this.circle = false});

  final double? width;
  final double height;
  final double radius;
  final bool circle;

  @override
  Widget build(BuildContext context) => Container(
        width: circle ? height : width,
        height: height,
        decoration: BoxDecoration(
          color: Colors.black,
          shape: circle ? BoxShape.circle : BoxShape.rectangle,
          borderRadius: circle ? null : BorderRadius.circular(radius),
        ),
      );
}

/// A conversation row that has not arrived yet: a face, a name, a line.
class NestConversationBone extends StatelessWidget {
  const NestConversationBone({super.key, this.wide = true});

  /// Alternates, so a column of them does not read as one repeated stamp.
  final bool wide;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(
          children: [
            const NestBone(height: 38, circle: true),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  NestBone(width: wide ? 190 : 140, height: 12),
                  const SizedBox(height: 8),
                  NestBone(width: wide ? 120 : 160, height: 10),
                ],
              ),
            ),
          ],
        ),
      );
}

/// A thread that has not arrived yet: bubbles on both sides, in a shape a real
/// conversation has.
class NestThreadBone extends StatelessWidget {
  const NestThreadBone({super.key});

  @override
  Widget build(BuildContext context) {
    Widget bubble(double w, {required bool mine, double h = 38}) => Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: Padding(
            padding: EdgeInsets.only(left: mine ? 0 : 34, bottom: 10),
            child: NestBone(width: w, height: h, radius: 18),
          ),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          bubble(170, mine: false, h: 56),
          bubble(120, mine: true),
          bubble(210, mine: true, h: 56),
          bubble(150, mine: false),
        ],
      ),
    );
  }
}
