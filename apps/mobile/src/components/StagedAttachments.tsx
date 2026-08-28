import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { formatBytes } from "@ding/client";
import type { Staged } from "../attachments";
import { AlertIcon, DocIcon, ImageIcon, PlayIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

/**
 * What's about to be sent alongside the message.
 *
 * An image shows itself; everything else gets its glyph and size. Each chip
 * carries its own state, because a failed upload has to stay visible and
 * retryable — silently dropping it is how someone sends "here you go" with
 * nothing attached.
 */
export function StagedAttachments({
  items,
  onRemove,
  onRetry,
}: {
  items: Staged[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const { c } = useTheme();
  if (!items.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
      className="mb-2"
    >
      {items.map((s) => {
        const failed = s.status === "failed";
        return (
          <View
            key={s.localId}
            style={{
              backgroundColor: c.surface2,
              borderColor: failed ? c.danger : c.border,
            }}
            className="w-[132px] overflow-hidden rounded-12 border"
          >
            {s.kind === "image" ? (
              <Image source={{ uri: s.uri }} style={{ width: 132, height: 76 }} resizeMode="cover" />
            ) : (
              <View style={{ height: 76 }} className="items-center justify-center">
                {s.kind === "video" ? (
                  <PlayIcon size={22} color={c.textMuted} />
                ) : s.kind === "audio" ? (
                  <ImageIcon size={22} color={c.textMuted} />
                ) : (
                  <DocIcon size={22} color={c.textMuted} />
                )}
              </View>
            )}

            <View className="px-2 py-1.5">
              <Text numberOfLines={1} className="text-2xs font-medium text-fg">
                {s.name}
              </Text>
              {failed ? (
                <Touchable feel="chip"
                  onPress={() => onRetry(s.localId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry uploading ${s.name}`}
                  className="flex-row items-center gap-1 pt-0.5"
                >
                  <AlertIcon size={11} color={c.danger} />
                  <Text style={{ color: c.danger }} className="text-2xs font-semibold">
                    Retry
                  </Text>
                </Touchable>
              ) : s.status === "uploading" ? (
                <View className="flex-row items-center gap-1 pt-0.5">
                  <ActivityIndicator size="small" color={c.textFaint} />
                  <Text className="text-2xs text-faint">Uploading…</Text>
                </View>
              ) : (
                <Text className="text-2xs text-faint">{s.size ? formatBytes(s.size) : "Ready"}</Text>
              )}
            </View>

            <Touchable feel="chip"
              onPress={() => onRemove(s.localId)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${s.name}`}
              hitSlop={8}
              style={{ backgroundColor: c.scrim }}
              className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full"
            >
              <XIcon size={12} color="#fff" />
            </Touchable>
          </View>
        );
      })}
    </ScrollView>
  );
}
