import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

/**
 * The top of every tab: a title, a line under it, and the tab's buttons.
 *
 * One component because six hand-built headers had drifted — different
 * padding, one with a subtitle and one without, buttons with a circle behind
 * them and buttons without — so switching tabs made the title jump and the
 * icons change weight. The Inbox's header is the reference: 12 above and
 * below, the title over a muted line, 40-point round buttons.
 *
 * The subtitle line is always laid out, even when there's nothing to say yet
 * (a count still loading), so the header is the same height on every tab and
 * from the first frame.
 */
export function TabHeader({
  title,
  subtitle,
  left,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** In place of the title and subtitle — the Inbox's, which is also its
   *  view switcher. It should keep the same two lines. */
  left?: ReactNode;
  /** The buttons on the right: `HeaderButton`s, or anything 40 high. */
  children?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2 px-4 pb-3 pt-3">
      {left ?? (
        <View className="flex-1">
          <Text numberOfLines={1} accessibilityRole="header" className="text-2xl font-semibold tracking-tight text-fg">
            {title}
          </Text>
          <Text numberOfLines={1} className="pt-0.5 text-sm text-muted">
            {subtitle || " "}
          </Text>
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A round header button. Quiet ones sit on the same grey circle as the
 * Inbox's bell; the one that makes something new is filled.
 */
export function HeaderButton({
  label,
  onPress,
  icon,
  fill,
  selected,
}: {
  label: string;
  onPress: () => void;
  /** Drawn at the size and colour handed to it. */
  icon: (props: { size: number; color: string }) => ReactNode;
  /** The filled colour of the screen's main action. */
  fill?: string;
  /** A toggle that's on. */
  selected?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      feel="chip"
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={8}
      style={{ backgroundColor: fill ?? (selected ? c.brandTint : c.surface2) }}
      className="h-10 w-10 flex-none items-center justify-center rounded-full"
    >
      {icon({ size: fill ? 22 : 19, color: fill ? "#fff" : selected ? c.brandStrong : c.textMuted })}
    </Touchable>
  );
}
