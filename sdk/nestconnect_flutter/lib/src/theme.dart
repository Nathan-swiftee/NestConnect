import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

/// The channel's own look, as Flutter colours.
///
/// Derived from the appearance the server sends rather than from the host app's
/// theme, and that is the point: the brand colour, the greeting and the away
/// message are set in Settings by whoever runs the inbox, and changing one
/// should reach a customer's phone without an app release.
///
/// The neutrals are the web widget's own (`apps/web/src/widget/widget.css`),
/// copied value for value. The two surfaces are one product to the business
/// that configures them and to a customer who meets both, and a chat that is a
/// slightly different grey in the app reads as a different chat.
///
/// The host app's typography *is* inherited, so the chat reads as part of the
/// app it lives in rather than as a pasted-in web view.
class NestTheme {
  const NestTheme({
    required this.accent,
    required this.onAccent,
    required this.brightness,
    this.accentTo,
    this.headerGradient = false,
  });

  final Color accent;
  final Color onAccent;
  final Brightness brightness;

  /// The far end of the header gradient, when the business turned one on.
  final Color? accentTo;
  final bool headerGradient;

  /// The appearance, in the brightness the *business* chose — `auto` is the one
  /// case that defers to the phone.
  factory NestTheme.from(NestAppearance appearance, Brightness platform) => NestTheme(
        accent: parseColor(appearance.accent) ?? const Color(0xFF2563EB),
        onAccent: parseColor(appearance.onAccent) ?? Colors.white,
        accentTo: parseColor(appearance.accentTo ?? ''),
        headerGradient: appearance.headerGradient,
        brightness: switch (appearance.theme) {
          'dark' => Brightness.dark,
          'auto' => platform,
          _ => Brightness.light,
        },
      );

  bool get isDark => brightness == Brightness.dark;

  /* ---- the web widget's neutrals ---- */

  /// The sheet's own colour: the header's surround, the composer.
  Color get surface => isDark ? const Color(0xFF14171C) : Colors.white;

  /// What the thread and the home screen sit on. A shade off [surface], so a
  /// white bubble or card on it is a thing rather than a region.
  Color get panel => isDark ? const Color(0xFF1B1F26) : const Color(0xFFF6F7F9);

  Color get text => isDark ? const Color(0xFFEEF1F5) : const Color(0xFF12151A);
  Color get muted => isDark ? const Color(0xFF98A1B0) : const Color(0xFF646C7A);
  Color get line => isDark ? const Color(0xFF2A2F38) : const Color(0xFFE4E7EC);

  /// An agent's bubble, a card: raised off the panel.
  Color get raised => isDark ? const Color(0xFF232830) : Colors.white;

  /// The web's two-layer lift under a bubble or card — a hairline and a long
  /// soft fall — which is what makes a white thing on a near-white panel read
  /// as resting on it.
  List<BoxShadow> get lift => isDark
      ? const []
      : const [
          BoxShadow(color: Color(0x0F101828), offset: Offset(0, 1), blurRadius: 2),
          BoxShadow(
            color: Color(0x1F101828),
            offset: Offset(0, 4),
            blurRadius: 12,
            spreadRadius: -6,
          ),
        ];

  /// A card's, which is taller and so falls further.
  List<BoxShadow> get cardLift => isDark
      ? const []
      : const [
          BoxShadow(color: Color(0x0D101828), offset: Offset(0, 1), blurRadius: 2),
          BoxShadow(
            color: Color(0x47101828),
            offset: Offset(0, 8),
            blurRadius: 20,
            spreadRadius: -14,
          ),
        ];

  /* ---- the conversation ---- */

  /// The customer's own bubbles: the brand colour, because they are the thing
  /// the eye should follow down the thread.
  Color get mine => accent;
  Color get onMine => onAccent;

  /// The agent's. White on the panel, as on the web.
  Color get theirs => raised;
  Color get onTheirs => text;

  /// A second accent for depth where there is no configured gradient end.
  Color get accentDeep => shade(accent, -0.18);

  /* ---- the header ---- */

  /// The header's fill, layered the way `nestchatHeaderBackground` layers it on
  /// the web: a flat accent with light lifting from the top-left, or — with the
  /// gradient on — a mesh of three, so it reads as a surface with depth rather
  /// than a ramp along one axis.
  List<Gradient> get headerLayers {
    final to = accentTo;
    if (!headerGradient || to == null) {
      return [
        const RadialGradient(
          center: Alignment(-1, -1),
          radius: 1.4,
          colors: [Color(0x2BFFFFFF), Color(0x00FFFFFF)],
          stops: [0, 0.6],
        ),
        LinearGradient(colors: [accent, accent]),
      ];
    }
    return [
      const RadialGradient(
        center: Alignment(-1, -1),
        radius: 1.4,
        colors: [Color(0x2BFFFFFF), Color(0x00FFFFFF)],
        stops: [0, 0.6],
      ),
      RadialGradient(
        center: const Alignment(0.64, -0.84),
        radius: 0.9,
        colors: [to.withValues(alpha: 0.95), to.withValues(alpha: 0)],
        stops: const [0, 0.62],
      ),
      RadialGradient(
        center: const Alignment(-0.96, 0.16),
        radius: 0.85,
        colors: [
          shade(accent, -0.42).withValues(alpha: 0.92),
          shade(accent, -0.42).withValues(alpha: 0),
        ],
        stops: const [0, 0.62],
      ),
      LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [accent, Color.lerp(accent, to, 0.5)!, to],
        stops: const [0, 0.52, 1],
      ),
    ];
  }

  /// What overlapping faces are ringed in: the header's own colour where it is
  /// one flat colour, a soft outline in its text colour where it is a gradient
  /// — there is no single colour to cut out of a gradient.
  Color get faceRing => headerGradient && accentTo != null
      ? onAccent.withValues(alpha: 0.55)
      : accent;

  /// Toward black (negative) or white (positive) — the web's `shade`.
  static Color shade(Color c, double amount) {
    final to = amount < 0 ? Colors.black : Colors.white;
    return Color.lerp(c, to, amount.abs())!;
  }

  /// `#rrggbb` or `#rgb`, as authored in Settings. Anything else is refused
  /// rather than guessed: a wrong colour on somebody's brand is worse than the
  /// default, and silently rendering black because a `#` was missing is the
  /// kind of thing nobody reports and everybody notices.
  static Color? parseColor(String value) {
    var hex = value.trim().replaceFirst('#', '');
    if (hex.length == 3) {
      hex = hex.split('').map((c) => '$c$c').join();
    }
    if (hex.length != 6) return null;
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? null : Color(0xFF000000 | parsed);
  }
}
