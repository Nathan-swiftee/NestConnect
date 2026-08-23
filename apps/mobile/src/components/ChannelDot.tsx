import { Text, View } from "react-native";
import type { ChannelType } from "@ding/schemas";
import { useTheme } from "../theme";

/** One glyph per channel. Kept to text rather than an icon set: it's legible at
 *  11px, needs no asset pipeline, and matches what the web badge shows. */
const GLYPH: Record<string, string> = { whatsapp: "✆", whatsapp_group: "⚇", email: "✉" };

/**
 * The small channel badge that sits on the corner of a conversation avatar —
 * how you tell a WhatsApp thread from an email at a glance in a mixed inbox.
 */
export function ChannelDot({ channel, size = 19 }: { channel: ChannelType; size?: number }) {
  const { c } = useTheme();
  const bg = channel === "email" ? c.email : channel === "whatsapp_group" ? c.group : c.wa;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: 2,
        borderColor: c.surface,
      }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.5, lineHeight: size * 0.66, color: "#fff" }}>{GLYPH[channel] ?? "•"}</Text>
    </View>
  );
}
