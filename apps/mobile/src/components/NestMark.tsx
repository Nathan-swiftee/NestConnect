import { Image, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * The app's mark.
 *
 * It used to be three nested bowls drawn here in SVG, while the web drew a chat
 * bubble with an amber dot — two hand-maintained logos for one product, neither
 * aware of the other. Both now come from the artwork in
 * `packages/design/brand`, and every size either platform needs is cut from it
 * by `tools/render-logo.mjs` rather than redrawn.
 *
 * The mark is a fixed green and carries no `color`: it is the same green on the
 * sign-in tile, in a launcher and on a browser tab, which is what a logo is for.
 * Anywhere it needs a ground of its own, the ground is the brand's navy — see
 * the sign-in screen, and the app icon it matches.
 */
export function NestMark({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/logo-mark.png")}
      style={{ width: size, height: size }}
      // The source is square and trimmed to the mark, so `contain` only ever
      // letterboxes by a rounding error — but it is the difference between a
      // mark that stays itself at any size and one that stretches.
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * The atmosphere behind the sign-in screen.
 *
 * Two very soft radial washes — brand green high on the left, a warm amber
 * lower right — sitting under everything at low opacity. The point is warmth
 * rather than decoration: a flat neutral ground reads as a form to fill in, and
 * this is the first screen anyone sees. It stays under 10% opacity because the
 * moment it's legible as a gradient it starts to look like a template.
 *
 * The amber is doing real work: two tints of the same green would read as a
 * wash, and it's the second hue that makes it read as light falling on
 * something. It's also the only place in the app the two brand tints meet, so
 * it belongs here and nowhere else.
 */
export function AuthGlow({
  width,
  height,
  brand,
  warm,
}: {
  width: number;
  height: number;
  brand: string;
  warm: string;
}) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="a" cx="22%" cy="12%" r="62%">
            <Stop offset="0" stopColor={brand} stopOpacity={0.2} />
            <Stop offset="1" stopColor={brand} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="b" cx="88%" cy="34%" r="52%">
            <Stop offset="0" stopColor={warm} stopOpacity={0.14} />
            <Stop offset="1" stopColor={warm} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#a)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#b)" />
        {/* A single faint disc where the two washes meet, to give the light a
            source rather than leaving it evenly smeared across the top. */}
        <Circle cx={width * 0.24} cy={height * 0.1} r={width * 0.1} fill={brand} opacity={0.05} />
      </Svg>
    </View>
  );
}
