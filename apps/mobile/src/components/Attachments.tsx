import { Image, Linking, Pressable, Text, View } from "react-native";
import type { Attachment } from "@ding/schemas";
import { formatBytes, formatDuration } from "@ding/client";
import { mediaSource } from "../api-config";
import { useTheme } from "../theme";

const MAX_W = 240;

/**
 * What a message carried, rendered inside its bubble.
 *
 * Images get a real thumbnail at their own aspect ratio; everything else gets a
 * row that says what it is and how big, and opens in whatever app the phone
 * uses for that type. Audio and video are deliberately links rather than
 * inline players for now — a player is a Phase 4 job (scrubbing, waveform,
 * background audio) and a half-built one is worse than an honest link.
 */
export function Attachments({ items }: { items: Attachment[] }) {
  const { c } = useTheme();
  if (!items.length) return null;
  return (
    <View className="gap-2 pt-1">
      {items.map((a) => {
        if (a.kind === "image") {
          const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
          return (
            <Pressable
              key={a.id}
              onPress={() => void Linking.openURL(mediaSource(a.url).uri)}
              accessibilityRole="imagebutton"
              accessibilityLabel={a.filename || "Image"}
              className="active:opacity-80"
            >
              <Image
                source={mediaSource(a.url)}
                style={{ width: MAX_W, height: MAX_W / ratio, borderRadius: 12, backgroundColor: c.surface2 }}
                resizeMode="cover"
              />
            </Pressable>
          );
        }
        const meta = a.durationMs ? formatDuration(a.durationMs) : formatBytes(a.size);
        const icon = a.kind === "audio" || a.kind === "voice" ? "♪" : a.kind === "video" ? "▷" : "📄";
        return (
          <Pressable
            key={a.id}
            onPress={() => void Linking.openURL(mediaSource(a.url).uri)}
            accessibilityRole="button"
            accessibilityLabel={`${a.filename || a.kind}, ${meta}`}
            style={{ backgroundColor: c.surface2, borderColor: c.border, maxWidth: MAX_W }}
            className="flex-row items-center gap-2.5 rounded-12 border px-3 py-2.5 active:opacity-70"
          >
            <Text className="text-lg">{icon}</Text>
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-fg">
                {a.filename || a.kind}
              </Text>
              <Text className="text-2xs text-faint">{meta}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
