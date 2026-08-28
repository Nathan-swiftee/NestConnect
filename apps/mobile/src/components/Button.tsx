import { ActivityIndicator, Text, type PressableProps } from "react-native";
import { Touchable } from "./Touchable";

/**
 * The primary action. Disabled while a request is in flight *and* while the
 * form is incomplete, so a double-tap can't send twice — the most common way a
 * phone form goes wrong.
 *
 * It gives under the finger. On a 52pt slab an opacity change is easy to miss,
 * and the press is often the last thing that happens before a network round
 * trip — so it's the one moment where the button has to say "yes, I got that"
 * on its own, before anything else can.
 *
 * That press behaviour used to live here and only here, which is a large part
 * of how the rest of the app ended up on `active:opacity`: using it meant
 * importing a component that renders a styled slab with a title. It now comes
 * from `Touchable` — `feel="slab"` is the same shallow scale this had — so
 * this is a shape and a label again, and every other pressable in the app gets
 * the same response for free.
 */
export function Button({
  title,
  busy,
  variant = "primary",
  ...props
}: PressableProps & { title: string; busy?: boolean; variant?: "primary" | "quiet" }) {
  const disabled = props.disabled || busy;
  const primary = variant === "primary";

  return (
    <Touchable
      feel="slab"
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      {...props}
      disabled={disabled}
      className={[
        "min-h-[52px] flex-row items-center justify-center rounded-12 px-5",
        primary ? "bg-brand" : "bg-transparent",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      {busy ? (
        <ActivityIndicator color={primary ? "#fff" : undefined} />
      ) : (
        <Text className={primary ? "text-lg font-semibold text-white" : "text-lg font-medium text-muted"}>
          {title}
        </Text>
      )}
    </Touchable>
  );
}
