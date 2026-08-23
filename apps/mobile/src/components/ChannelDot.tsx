import { View } from "react-native";
import type { ChannelType } from "@ding/schemas";
import { channelColor, channelMeta } from "../icons";
import { useTheme } from "../theme";

/**
 * The channel mark on a conversation row — the same bare, coloured glyph the web
 * shows beside the customer's name.
 *
 * No capsule and no avatar-corner badge on purpose: the web tried the badge and
 * dropped it, because the glyph's own colour already identifies the channel and
 * the disc behind it was decoration. Green bubble = WhatsApp, purple figures =
 * group, blue envelope = email.
 */
export function ChannelDot({ channel, size = 13 }: { channel: ChannelType; size?: number }) {
  const { c } = useTheme();
  const Glyph = channelMeta(channel).Glyph;
  return (
    <View accessibilityLabel={channelMeta(channel).label} className="flex-none self-center">
      <Glyph size={size} color={channelColor(channel, c)} />
    </View>
  );
}
