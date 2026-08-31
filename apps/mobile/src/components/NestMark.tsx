import { View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import {
  BRAND,
  MARK_ARCH,
  MARK_NODES,
  MARK_NODE_R,
  MARK_STEM,
  MARK_STROKE,
} from "@ding/design/logo";

/**
 * The app's mark, from the geometry the web draws from too.
 *
 * It used to be three nested bowls here and a speech bubble with an amber dot
 * on the web — two different logos for one product, neither aware of the other,
 * which is what happens when a mark is drawn twice instead of shared once.
 * `@ding/design/logo` is now the only place the shape exists, and the app icon
 * and favicon are generated from the same numbers rather than exported by hand.
 *
 * `color` defaults to the brand green rather than white: a logo holds its value
 * wherever it lands. Pass a colour only for somewhere it genuinely has to be
 * monochrome, like a knockout on a solid brand tile.
 */
export function NestMark({ size = 28, color = BRAND.green }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path d={MARK_STEM} stroke={color} strokeWidth={MARK_STROKE} strokeLinecap="round" />
      <Path d={MARK_ARCH} stroke={color} strokeWidth={MARK_STROKE} strokeLinecap="round" />
      {MARK_NODES.map((n) => (
        <Circle key={`${n.cx}-${n.cy}`} cx={n.cx} cy={n.cy} r={MARK_NODE_R} fill={color} />
      ))}
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
