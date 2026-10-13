import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useInsets } from "../insets";
import { useTheme } from "../theme";

/**
 * The strip of colour behind the home indicator / nav bar, which collapses as
 * the keyboard rises.
 *
 * It has to move because the keyboard covers that area: the avoiding view above
 * already pads by the full keyboard height, and a fixed inset underneath would
 * add a second gap the keyboard is already occupying. Driven off the same
 * animated progress the keyboard itself is on, so the two travel together
 * instead of one snapping after the other.
 */
export function BottomInset() {
  const insets = useInsets();
  const { c } = useTheme();
  const { progress } = useReanimatedKeyboardAnimation();
  // Colour included: an animated style is the only style that reaches an
  // element, so a `[{ backgroundColor }, style]` pair arrives as `style` alone
  // and the inset renders transparent. See scripts/check-layout-rules.mjs.
  const style = useAnimatedStyle(() => ({
    height: insets.bottom * (1 - progress.value),
    backgroundColor: c.surface,
  }));
  return <Animated.View style={style} />;
}
