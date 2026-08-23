import { Text, View } from "react-native";
import type { Message } from "@ding/schemas";
import { useTheme } from "../theme";
import { AlertIcon, CheckDouble, CheckSingle, ClockIcon } from "../icons";

/**
 * The delivery state of one of our messages, in the vocabulary people already
 * know from WhatsApp: a clock while it's still ours, one tick once it's left,
 * two when it arrived, two in blue when it was read.
 *
 * Same glyphs as the web (CheckSingle / CheckDouble), so a tick means the same
 * thing and looks the same on both. `failed` breaks the pattern on purpose — it
 * isn't a worse tick, it's a different outcome, so it says so in words.
 */
export function Ticks({ status }: { status: Message["status"] }) {
  const { c } = useTheme();

  if (status === "failed") {
    return (
      <View className="flex-row items-center gap-1">
        <AlertIcon size={12} color={c.danger} />
        <Text style={{ color: c.danger }} className="text-2xs font-medium">
          Failed
        </Text>
      </View>
    );
  }

  if (status === "queued" || status === "sending") {
    return <ClockIcon size={12} color={c.textFaint} />;
  }

  const read = status === "read";
  const label = read ? "Read" : status === "delivered" ? "Delivered" : "Sent";
  const color = read ? c.email : c.textFaint;

  return (
    <View accessibilityLabel={label}>
      {status === "sent" ? <CheckSingle size={11} color={color} /> : <CheckDouble size={11} color={color} />}
    </View>
  );
}
