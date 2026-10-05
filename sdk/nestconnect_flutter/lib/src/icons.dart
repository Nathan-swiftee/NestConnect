import 'package:flutter/material.dart';

/// The marks on the home screen's cards — the same drawings the web widget uses,
/// path for path.
///
/// Not Material icons, and that is the reason this file exists. The set has no
/// WhatsApp, Instagram or Facebook glyph, so the nearest-looking icon got used —
/// which put a *flame* on a card that said "Message us on WhatsApp". A brand
/// card that does not carry the brand's own mark is a card people do not see.
///
/// Drawn from the web's SVG path data by a small parser rather than through a
/// package: the paths use a handful of commands, Flutter's `Path` already has
/// SVG-style arcs, and an app taking this SDK should not inherit a rendering
/// dependency for six 20-pixel icons.
class NestCardIcon extends StatelessWidget {
  const NestCardIcon({super.key, required this.name, required this.color, this.size = 20});

  /// `chat`, `whatsapp`, `email`, `phone`, `instagram`, `facebook`, `telegram`
  /// or `link`. Anything else draws the chat mark, as the web does.
  final String name;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => CustomPaint(
        size: Size.square(size),
        painter: _IconPainter(_glyphs[name] ?? _glyphs['chat']!, color),
      );
}

/// One drawing: shapes, each filled or stroked.
class _Glyph {
  const _Glyph(this.shapes);
  final List<_Shape> shapes;
}

class _Shape {
  const _Shape.path(this.d, {this.fill = false}) : circle = null;
  const _Shape.circle((double, double, double) this.circle, {this.fill = false}) : d = null;

  final String? d;
  final (double, double, double)? circle;
  final bool fill;
}

const _stroke = 1.8;

final _glyphs = <String, _Glyph>{
  'whatsapp': const _Glyph([
    _Shape.path(
      'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.26-8.24Zm-2.6 4.03c-.15 0-.4.06-.61.29-.21.23-.8.79-.8 1.92 0 1.13.82 2.22.94 2.38.11.15 1.6 2.44 3.87 3.42.54.23.96.37 1.29.48.54.17 1.03.15 1.42.09.44-.07 1.34-.55 1.53-1.08.19-.53.19-.98.13-1.08-.06-.09-.21-.15-.44-.27-.23-.11-1.34-.66-1.55-.74-.21-.08-.36-.11-.51.11-.15.23-.58.74-.71.89-.13.15-.26.17-.49.06-.23-.12-.96-.36-1.83-1.13-.68-.6-1.13-1.35-1.27-1.58-.13-.23-.01-.35.1-.47.1-.1.23-.27.34-.4.11-.14.15-.23.23-.38.08-.16.04-.29-.02-.4-.06-.12-.51-1.23-.7-1.68-.18-.44-.37-.38-.51-.39h-.43Z',
      fill: true,
    ),
  ]),
  'email': const _Glyph([
    _Shape.path('M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5Z'),
    _Shape.path('m3.5 7 7.4 5.3a2 2 0 0 0 2.2 0L20.5 7'),
  ]),
  'phone': const _Glyph([
    _Shape.path(
      'M7.7 3.5h-2A2.2 2.2 0 0 0 3.5 6c.4 6.9 6.1 12.6 13 13a2.2 2.2 0 0 0 2.5-2.2v-2a1.5 1.5 0 0 0-1.2-1.47l-2.6-.52a1.5 1.5 0 0 0-1.5.63l-.7 1a12.4 12.4 0 0 1-5-5l1-.7a1.5 1.5 0 0 0 .63-1.5l-.52-2.6A1.5 1.5 0 0 0 7.7 3.5Z',
    ),
  ]),
  'instagram': const _Glyph([
    _Shape.path('M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z'),
    _Shape.circle((12, 12, 4)),
    _Shape.circle((17.2, 6.8, 1.1), fill: true),
  ]),
  'facebook': const _Glyph([
    _Shape.path(
      'M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z',
      fill: true,
    ),
  ]),
  'telegram': const _Glyph([
    _Shape.path(
      'M21.7 4.3c-.28-.24-.72-.28-1.3-.05L3.1 11.2c-.6.24-.95.6-.93.98.02.38.4.68 1.03.85l4.2 1.16 1.66 4.9c.13.38.36.6.66.63.3.03.6-.13.86-.44l2.3-2.7 4.4 3.24c.36.27.7.36.98.27.28-.1.48-.4.58-.85l3.1-14.1c.13-.6.06-1-.24-1.24ZM8.9 14.1l8.5-5.6-6.9 6.6-.3 3.1-1.3-4.1Z',
      fill: true,
    ),
  ]),
  'link': const _Glyph([
    _Shape.circle((12, 12, 9)),
    _Shape.path('M3.2 12h17.6M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z'),
  ]),
  'chat': const _Glyph([
    _Shape.path('M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-2.8-.4L4 21l1.4-4a8.2 8.2 0 0 1-1.4-4.6 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 7.5Z'),
  ]),
};

class _IconPainter extends CustomPainter {
  _IconPainter(this.glyph, this.color);
  final _Glyph glyph;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    // The paths are drawn on a 24-unit grid, like the web's viewBox.
    final scale = size.width / 24;
    canvas.save();
    canvas.scale(scale);
    final fill = Paint()..color = color;
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = _stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final shape in glyph.shapes) {
      final paint = shape.fill ? fill : stroke;
      if (shape.d != null) {
        canvas.drawPath(svgPath(shape.d!), paint);
      } else if (shape.circle != null) {
        final (cx, cy, r) = shape.circle!;
        canvas.drawCircle(Offset(cx, cy), r, paint);
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_IconPainter old) => old.color != color || old.glyph != glyph;
}

/// SVG path data as a Flutter [Path].
///
/// The commands the web's icons use, and their relative forms: M L H V C S Q A
/// Z. Arcs go to `arcToPoint`, which takes SVG's own arc parameters, so there is
/// no centre-parameterisation maths here to get wrong.
Path svgPath(String d) {
  final path = Path();
  final tokens = RegExp(r'[MmLlHhVvCcSsQqAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
      .allMatches(d)
      .map((m) => m.group(0)!)
      .toList();

  var i = 0;
  var cmd = '';
  var x = 0.0, y = 0.0;
  var startX = 0.0, startY = 0.0;
  // The last cubic's second control point, for `S`, which mirrors it.
  double? lastCx, lastCy;

  bool isCommand(String t) => RegExp(r'^[A-Za-z]$').hasMatch(t);
  double next() => double.parse(tokens[i++]);
  // Arc flags may be packed with no separator ("0 01.5 2"); the tokenizer has
  // already split numbers, and a flag is the first character of a token here.
  bool flag() {
    final t = tokens[i];
    if (t.length > 1 && (t[0] == '0' || t[0] == '1') && !t.startsWith('0.')) {
      tokens[i] = t.substring(1);
      return t[0] == '1';
    }
    i++;
    return t == '1';
  }

  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++];
    final rel = cmd == cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M':
        final nx = next(), ny = next();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        path.moveTo(x, y);
        startX = x;
        startY = y;
        // Further pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        lastCx = null;
      case 'L':
        final nx = next(), ny = next();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        path.lineTo(x, y);
        lastCx = null;
      case 'H':
        final nx = next();
        x = rel ? x + nx : nx;
        path.lineTo(x, y);
        lastCx = null;
      case 'V':
        final ny = next();
        y = rel ? y + ny : ny;
        path.lineTo(x, y);
        lastCx = null;
      case 'C':
        var x1 = next(), y1 = next(), x2 = next(), y2 = next(), nx = next(), ny = next();
        if (rel) {
          x1 += x;
          y1 += y;
          x2 += x;
          y2 += y;
          nx += x;
          ny += y;
        }
        path.cubicTo(x1, y1, x2, y2, nx, ny);
        lastCx = x2;
        lastCy = y2;
        x = nx;
        y = ny;
      case 'S':
        var x2 = next(), y2 = next(), nx = next(), ny = next();
        if (rel) {
          x2 += x;
          y2 += y;
          nx += x;
          ny += y;
        }
        final x1 = lastCx == null ? x : 2 * x - lastCx;
        final y1 = lastCy == null ? y : 2 * y - lastCy;
        path.cubicTo(x1, y1, x2, y2, nx, ny);
        lastCx = x2;
        lastCy = y2;
        x = nx;
        y = ny;
      case 'Q':
        var x1 = next(), y1 = next(), nx = next(), ny = next();
        if (rel) {
          x1 += x;
          y1 += y;
          nx += x;
          ny += y;
        }
        path.quadraticBezierTo(x1, y1, nx, ny);
        x = nx;
        y = ny;
        lastCx = null;
      case 'A':
        final rx = next(), ry = next(), rotation = next();
        final large = flag(), sweep = flag();
        final nx = next(), ny = next();
        final ex = rel ? x + nx : nx, ey = rel ? y + ny : ny;
        path.arcToPoint(
          Offset(ex, ey),
          radius: Radius.elliptical(rx, ry),
          // Degrees, as SVG writes it — `arcToPoint` takes the same unit.
          rotation: rotation,
          largeArc: large,
          clockwise: sweep,
        );
        x = ex;
        y = ey;
        lastCx = null;
      case 'Z':
        path.close();
        x = startX;
        y = startY;
        lastCx = null;
      default:
        i++;
    }
  }
  return path;
}
