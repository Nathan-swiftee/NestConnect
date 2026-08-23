import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { spring, springTo } from "../motion";

/**
 * The primary action. Disabled while a request is in flight *and* while the
 * form is incomplete, so a double-tap can't send twice — the most common way a
 * phone form goes wrong.
 *
 * It gives under the finger. On a 52pt slab an opacity change is easy to miss,
 * and the press is often the last thing that happens before a network round
 * trip — so it's the one moment where the button has to say "yes, I got that"
 * on its own, before anything else can.
 */
export function Button({
  title,
  busy,
  variant = "primary",
  ...props
}: PressableProps & { title: string; busy?: boolean; variant?: "primary" | "quiet" }) {
  const disabled = props.disabled || busy;
  const primary = variant === "primary";
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, busy: !!busy }}
        {...props}
        onPressIn={(e) => {
          // Shallower than a chip's: the same proportional scale on something
          // this wide would visibly shrink the whole button.
          if (!disabled) press.value = springTo(0.975, spring.quick);
          props.onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.value = springTo(1, spring.base);
          props.onPressOut?.(e);
        }}
        disabled={disabled}
        className={[
          "min-h-[52px] flex-row items-center justify-center rounded-12 px-5",
          primary ? "bg-brand" : "bg-transparent",
          disabled ? "opacity-50" : "active:opacity-80",
        ].join(" ")}
      >
        {busy ? (
          <ActivityIndicator color={primary ? "#fff" : undefined} />
        ) : (
          <Text className={primary ? "text-lg font-semibold text-white" : "text-lg font-medium text-muted"}>
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}
