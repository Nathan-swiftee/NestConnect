import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Pressable, Text } from "react-native";
import { spring, springTo } from "../motion";
import { useTheme } from "../theme";

/**
 * A filter pill — the row under a list's search field that decides what the
 * list shows. One component for every list (the Inbox's statuses, Chat's
 * kinds), so they are the same size, weight and feel wherever you meet them;
 * Chat's used to be smaller and plainer than the Inbox's.
 */
export function FilterChip({
  label,
  count,
  active,
  outlined,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  /** A custom-field filter rather than one of the status ones beside it.
   *  Outlined instead of filled, so the two read as two groups rather than one
   *  row of eight equivalent chips — they answer different questions and one of
   *  them costs a request. */
  outlined?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  // Pressing gives under the finger and springs back. On a control this small
  // it's most of what tells you the tap registered — the colour change lands
  // afterwards, once the list has re-filtered.
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          press.value = springTo(0.94, spring.quick);
        }}
        onPressOut={() => {
          press.value = springTo(1, spring.base);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        // These were 12pt text in a 26pt pill, on the theory that a filter row
        // under the search field should stay out of the way. It stayed so far
        // out of the way it was hard to read and hard to hit — and this is the
        // control that decides which conversations you are looking at, which is
        // not a thing to squint at. Body-sized text now, in a pill tall enough
        // to be aimed at.
        //
        // The slop still adds to the target rather than to the chip: it carries
        // the height past 44pt without a row of buttons appearing under the
        // search field, and widens the gaps so a thumb between two chips
        // reaches the nearer one instead of neither.
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{
          backgroundColor: active ? c.brandTint : outlined ? "transparent" : c.surface2,
          ...(outlined
            ? { borderWidth: 1, borderColor: active ? c.brandStrong : c.border }
            : null),
        }}
        className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
      >
        <Text
          style={{ color: active ? c.brandStrong : c.textMuted }}
          className={`text-md ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </Text>
        {count ? (
          <Text style={{ color: active ? c.brandStrong : c.textFaint }} className="text-xs font-semibold">
            {count}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
