import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

/**
 * The primary action. Disabled while a request is in flight *and* while the
 * form is incomplete, so a double-tap can't send twice — the most common way a
 * phone form goes wrong.
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      {...props}
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
        <Text className={primary ? "text-lg font-semibold text-white" : "text-lg font-medium text-muted"}>{title}</Text>
      )}
    </Pressable>
  );
}
