import Svg, { Circle, Path, Rect, type SvgProps } from "react-native-svg";
import type { ChannelType } from "@ding/schemas";
import type { ThemeColors } from "./theme";

/**
 * The web's icon set, ported to react-native-svg.
 *
 * The path data is copied verbatim from apps/web/src/lib/icons.tsx — these are
 * the same glyphs, not lookalikes, so a screen built from them reads as the same
 * product. Keep the two files in step: if a glyph changes on the web, change it
 * here too.
 *
 * The one necessary difference is colour. The web leans on `currentColor` and
 * lets CSS cascade a colour in; React Native has no cascade, so every icon takes
 * an explicit `color` (defaulting to `currentColor`, which react-native-svg
 * resolves to black — always pass one). `size` sets both width and height, since
 * every glyph is drawn in a square viewBox.
 */
export interface IconProps {
  /** Width and height in px. The viewBox is square, so one number does both. */
  size?: number;
  color?: string;
}

type P = IconProps & Omit<SvgProps, "color">;

/** Stroked glyph: the common case — outline drawn in `color`, no fill. */
function stroke(d: string, sw = 1.8, extra?: Partial<SvgProps>) {
  return function Icon({ size = 22, color = "currentColor", ...rest }: P) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...extra} {...rest}>
        <Path
          d={d}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap={(extra?.strokeLinecap as never) ?? "round"}
          strokeLinejoin={(extra?.strokeLinejoin as never) ?? "round"}
        />
      </Svg>
    );
  };
}

/** Solid glyph: filled with `color`, no outline. */
function solid(d: string, viewBox = "0 0 24 24") {
  return function Icon({ size = 22, color = "currentColor", ...rest }: P) {
    return (
      <Svg width={size} height={size} viewBox={viewBox} {...rest}>
        <Path d={d} fill={color} />
      </Svg>
    );
  };
}

/* ---- chrome ---- */

export const InboxIcon = stroke("M3 12h5l2 3h4l2-3h5M4 6h16a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1Z");
export const SearchIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={1.9} />
    <Path d="m20 20-3-3" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
  </Svg>
);
export const BackIcon = stroke("M15 18l-6-6 6-6", 2.1);
export const ChevronRight = stroke("m9 6 6 6-6 6", 2.2);
export const ChevronDown = stroke("m6 9 6 6 6-6", 2.2);
export const XIcon = stroke("M6 6l12 12M18 6 6 18", 2);
export const PlusIcon = stroke("M12 5v14M5 12h14", 2);
export const CheckIcon = stroke("M20 6 9 17l-5-5", 2.1);
export const MoreIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
    <Circle cx="5" cy="12" r="2" fill={color} />
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Circle cx="19" cy="12" r="2" fill={color} />
  </Svg>
);

/* ---- composer ---- */

export const SendIcon = stroke("M4 12h15M13 6l6 6-6 6", 2);
export const AttachIcon = stroke(
  "M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.4-7.4",
);
export const EmojiIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} />
    <Path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M9 9.5h.01M15 9.5h.01" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </Svg>
);
export const NoteIcon = stroke("M4 5h16v10H9l-5 4V5Z", 2);
export const MicIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Rect x="9" y="2.5" width="6" height="11" rx="3" stroke={color} strokeWidth={1.8} />
    <Path
      d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  </Svg>
);
export const BoltIcon = solid("M13 2 4 14h6l-1 8 9-12h-6l1-8Z");
export const SparkleIcon = stroke(
  "M12 3.5c.7 3.4 1.9 4.6 5.3 5.3-3.4.7-4.6 1.9-5.3 5.3-.7-3.4-1.9-4.6-5.3-5.3 3.4-.7 4.6-1.9 5.3-5.3ZM18 15.2c.35 1.7.95 2.3 2.65 2.65-1.7.35-2.3.95-2.65 2.65-.35-1.7-.95-2.3-2.65-2.65 1.7-.35 2.3-.95 2.65-2.65Z",
  1.7,
);
export const ReplyIcon = stroke("M9 8 4 12l5 4M4.5 12H14a6 6 0 0 1 6 6v1", 1.9);
export const TrashIcon = stroke(
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6",
);
export const EditIcon = stroke("M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2 4 20ZM13.5 6.5l4 4");

/* ---- thread + list state ---- */

export const ClockIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} />
    <Path d="M12 7.5V12l3 2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const SnoozeIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="13" r="8" stroke={color} strokeWidth={1.8} />
    <Path d="M12 9v4l2.5 2.5M9 2h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const CheckCircleIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.9} />
    <Path d="m8.5 12 2.5 2.5 4.5-5" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const ReopenIcon = stroke("M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5", 1.9);
export const AlertIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.9} />
    <Path d="M12 8v4.5" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    <Path d="M12 16h.01" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </Svg>
);
export const ProfileIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={1.8} />
    <Path d="M4 20a8 8 0 0 1 16 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const TagIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    <Circle cx="7.5" cy="7.5" r="1.5" fill={color} />
  </Svg>
);
export const LogoutIcon = stroke("M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9");
export const DocIcon = stroke(
  "M14 3v4.5a1 1 0 0 0 1 1h4.5M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8L14 3Z",
  1.7,
);
export const DownloadIcon = stroke("M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5M5 18.5h14");
export const PlayIcon = solid("M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z");
export const PauseIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
    <Rect x="6" y="5" width="4" height="14" rx="1.3" fill={color} />
    <Rect x="14" y="5" width="4" height="14" rx="1.3" fill={color} />
  </Svg>
);
export const ImageIcon = ({ size = 22, color = "currentColor", ...rest }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
    <Rect x="3" y="4" width="18" height="16" rx="2" stroke={color} strokeWidth={1.8} />
    <Circle cx="8.5" cy="9.5" r="1.6" stroke={color} strokeWidth={1.8} />
    <Path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L18 19" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/** The read-receipt ticks, in their own wider viewBoxes (as on the web). */
export const CheckSingle = ({ size = 16, color = "currentColor", ...rest }: P) => (
  <Svg width={(size * 18) / 14} height={size} viewBox="0 0 18 14" fill="none" {...rest}>
    <Path d="M2 8l4 4 9-10" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const CheckDouble = ({ size = 16, color = "currentColor", ...rest }: P) => (
  <Svg width={(size * 22) / 14} height={size} viewBox="0 0 22 14" fill="none" {...rest}>
    <Path d="M1 8l3.5 3.5L12 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M9 11l1 1 8.5-9.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/* ---- channel badges ---- */

const WaGlyph = solid(
  "M12.04 2.5c-5.2 0-9.42 4.22-9.42 9.42 0 1.66.44 3.28 1.26 4.71L2.5 21.5l4.99-1.31a9.4 9.4 0 0 0 4.55 1.16c5.2 0 9.42-4.22 9.42-9.42 0-2.52-.98-4.89-2.76-6.67a9.36 9.36 0 0 0-6.66-2.76Zm5.5 13.4c-.23.65-1.36 1.25-1.87 1.32-.48.07-1.09.1-1.76-.11-.4-.13-.93-.3-1.6-.59-2.82-1.22-4.66-4.06-4.8-4.25-.14-.19-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.36.26-.28.57-.35.76-.35.19 0 .38 0 .54.01.17.01.41-.07.64.49.23.57.8 1.97.87 2.11.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.69-.81.88-1.09.19-.28.37-.23.64-.14.26.1 1.66.78 1.94.93.28.14.47.21.54.32.07.12.07.7-.16 1.35Z",
);
const GroupGlyph = solid(
  "M8.5 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7 .1a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Zm-7 1.3c-3 0-5.6 1.55-5.6 3.85V18.4h11.2v-1.75c0-2.3-2.6-3.85-5.6-3.85Zm7 .25c-.44 0-.86.04-1.26.11 1.05.86 1.66 1.98 1.66 3.24v1.4h5.2v-1.6c0-2.02-2.55-3.15-5.6-3.15Z",
);
const EmailGlyph = solid(
  "M4 5h16c1.1 0 2 .9 2 2v.5l-10 5.6L2 7.5V7c0-1.1.9-2 2-2Zm18 4.8V17c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V9.8l9.52 5.33c.3.16.66.16.96 0L22 9.8Z",
);

export interface ChannelMeta {
  /** Key into the theme palette — resolved per scheme by the caller. */
  colorKey: "wa" | "group" | "email";
  label: string;
  Glyph: (p: P) => JSX.Element;
}

/** Mirrors the web's channelMeta. Colour comes back as a token key rather than a
 *  CSS var, because a native component reads the palette for the active scheme. */
export function channelMeta(type: ChannelType): ChannelMeta {
  switch (type) {
    case "whatsapp":
      return { colorKey: "wa", label: "WhatsApp", Glyph: WaGlyph };
    case "whatsapp_group":
      return { colorKey: "group", label: "WhatsApp group", Glyph: GroupGlyph };
    default:
      return { colorKey: "email", label: "Email", Glyph: EmailGlyph };
  }
}

/** The channel's colour for the current scheme, in one call. */
export function channelColor(type: ChannelType, c: ThemeColors): string {
  return c[channelMeta(type).colorKey];
}
