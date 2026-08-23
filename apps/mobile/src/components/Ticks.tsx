import { Text } from "react-native";
import type { Message } from "@ding/schemas";
import { useTheme } from "../theme";

/**
 * The delivery state of one of our messages, in the vocabulary people already
 * know from WhatsApp: a clock while it's still ours, one tick once it's left,
 * two when it arrived, two in blue when it was read.
 *
 * `failed` is the one that has to break the pattern — it isn't a worse tick,
 * it's a different outcome, so it says so in words and in the danger colour.
 */
export function Ticks({ status }: { status: Message["status"] }) {
  const { c } = useTheme();
  if (status === "failed") {
    return <Text style={{ color: c.danger }} className="text-2xs font-medium">Failed</Text>;
  }
  if (status === "queued" || status === "sending") {
    return <Text style={{ color: c.textFaint }} className="text-2xs">🕘</Text>;
  }
  const read = status === "read";
  return (
    <Text
      style={{ color: read ? c.email : c.textFaint }}
      className="text-2xs"
      accessibilityLabel={read ? "Read" : status === "delivered" ? "Delivered" : "Sent"}
    >
      {status === "sent" ? "✓" : "✓✓"}
    </Text>
  );
}
