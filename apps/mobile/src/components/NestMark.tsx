import { View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * The app's mark: three nested bowls.
 *
 * Chosen because it survives being small and monochrome, which is most of what
 * a mark has to do — it's the tab icon, the splash, the thing on the sign-in
 * screen. Three concentric arcs read as a nest at 24pt and still read as one at
 * 96pt, and they carry the product's actual idea without illustrating it: every
 * conversation gathered into one place, whichever channel it arrived on.
 *
 * Stroked rather than filled, with round caps, so it holds its weight against
 * the brand tile behind it instead of turning into a solid blob at small sizes.
 */
export function NestMark({ size = 28, color = "#fff" }: { size?: number; color?: string }) {
  const w = Math.round(size * 0.09);
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Outer, middle, inner — each an arc from left to right curving under,
          which is what makes a bowl rather than a dome. */}
      <Path d="M3 13 A13 13 0 0 0 29 13" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Path d="M8 13 A8 8 0 0 0 24 13" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.82} />
      <Path d="M13 13 A3 3 0 0 0 19 13" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.64} />
    </Svg>
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
