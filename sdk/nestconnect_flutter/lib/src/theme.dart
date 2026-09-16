import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

/// The channel's own look, as Flutter colours.
///
/// Derived from the appearance the server sends rather than from the host app's
/// theme, and that is the point: the brand colour, the greeting and the away
/// message are set in Settings by whoever runs the inbox, and changing one
/// should reach a customer's phone without an app release.
///
/// The host app's typography *is* inherited, so the chat reads as part of the
/// app it lives in rather than as a pasted-in web view.
class NestTheme {
  const NestTheme({required this.accent, required this.onAccent, required this.brightness});

  final Color accent;
  final Color onAccent;
  final Brightness brightness;

  factory NestTheme.from(NestAppearance appearance, Brightness brightness) => NestTheme(
        accent: parseColor(appearance.accent) ?? const Color(0xFF2563EB),
        onAccent: parseColor(appearance.onAccent) ?? Colors.white,
        brightness: brightness,
      );

  bool get isDark => brightness == Brightness.dark;

  /// The customer's own bubbles: the brand colour, because they are the thing
  /// the eye should follow down the thread.
  Color get mine => accent;
  Color get onMine => onAccent;

  /// The agent's. Deliberately quiet — a thread where both sides shout is a
  /// thread where neither side reads.
  Color get theirs => isDark ? const Color(0xFF26262B) : const Color(0xFFF1F2F4);
  Color get onTheirs => isDark ? const Color(0xFFECECEE) : const Color(0xFF16181D);

  Color get surface => isDark ? const Color(0xFF17171A) : Colors.white;
  Color get muted => isDark ? const Color(0xFF9B9BA3) : const Color(0xFF6B7280);
  Color get line => isDark ? const Color(0xFF2C2C31) : const Color(0xFFE6E7EA);

  /// A second accent for the header, a little off the first, so the bar has
  /// somewhere for light to come from rather than reading as printed colour.
  Color get accentDeep => HSLColor.fromColor(accent)
      .withLightness((HSLColor.fromColor(accent).lightness - 0.12).clamp(0.0, 1.0))
      .toColor();

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
