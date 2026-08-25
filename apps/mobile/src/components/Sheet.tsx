import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fadeTo, spring, springTo, timing } from "../motion";
import { useTheme, useThemeVars } from "../theme";

/**
 * The animated bottom sheet every sheet in the app is built on.
 *
 * React Native's own `animationType="slide"` was doing this before, and the
 * problem with it isn't that it looks bad — it's that it's a linear slide of a
 * fixed duration with a scrim that appears instantly. Nothing physical moves
 * like that, and next to a spring it reads as a slide *show*. This runs the
 * panel on a spring and cross-fades the scrim with it, so the sheet arrives the
 * way a sheet should: fast at first, then settling.
 *
 * The reason it's a shared component rather than a prop on each sheet is the
 * exit. A `Modal` unmounts the instant `visible` goes false, which kills any
 * exit animation before it starts — so the unmount has to be held back until
 * the animation has finished. That's fiddly, easy to get subtly wrong, and
 * there are six sheets in this app; doing it once is the only version of this
 * that stays correct.
 */
export function Sheet({
  visible,
  onClose,
  children,
  /** Screen-reader label for the scrim, which is also the dismiss target. */
  closeLabel = "Close",
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  const { c } = useTheme();
  const themeVars = useThemeVars();
  const insets = useSafeAreaInsets();

  // Kept mounted through the exit, then torn down. Without this the Modal
  // disappears on the same frame `visible` flips and there is nothing left on
  // screen to animate out.
  const [mounted, setMounted] = useState(visible);
  const open = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      open.value = springTo(1, spring.settle);
      return;
    }
    open.value = fadeTo(0, timing.base);
    const t = setTimeout(() => setMounted(false), timing.base.duration + 40);
    return () => clearTimeout(t);
  }, [visible, open]);

  const scrim = useAnimatedStyle(() => ({ opacity: open.value }));
  const panel = useAnimatedStyle(() => ({
    // Percent of its own height, so a tall sheet and a short one travel for the
    // same length of time rather than the tall one appearing to fall further.
    transform: [{ translateY: `${(1 - open.value) * 100}%` }],
  }));

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      accessibilityViewIsModal
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* A Modal renders outside the root that publishes the palette, so the
          scheme's variables are re-applied here — otherwise the colour utilities
          inside resolve against nothing. */}
      <View style={themeVars} className="flex-1 justify-end">
        <Animated.View style={[{ backgroundColor: c.scrim }, scrim]} className="absolute inset-0">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            className="flex-1"
          />
        </Animated.View>

        <Animated.View style={panel}>
          {/* Stop taps inside the sheet from reaching the scrim behind it. A
              sink, not a control: left accessible, a screen reader announces the
              whole sheet as one button and can skip everything inside it. */}
          <Pressable
            onPress={() => {}}
            accessible={false}
            style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 12 }}
            className="rounded-t-24 px-4 pt-3"
          >
            <View style={{ backgroundColor: c.borderStrong }} className="mb-3 h-1 w-9 self-center rounded-full" />
            {children}
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
