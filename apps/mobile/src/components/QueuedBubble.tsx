import { Pressable, Text, View } from "react-native";
import { clockTime } from "@ding/client";
import type { QueuedSend } from "../send-queue";
import { AlertIcon, ClockIcon } from "../icons";
import { useTheme } from "../theme";

/**
 * A message that's been written but hasn't reached the server yet.
 *
 * It looks like the outbound bubble it will become, dimmed, with a clock where
 * the ticks go — the same vocabulary the status ladder already uses for
 * "queued". The point is that an agent who wrote a reply in a lift can see it
 * still exists, rather than wondering whether to type it again.
 *
 * A rejected one says why and offers the two things worth offering: try it
 * again, or throw it away. Leaving it stuck with no exit is what makes people
 * distrust an offline queue.
 */
export function QueuedBubble({
  item,
  onRetry,
  onDiscard,
}: {
  item: QueuedSend;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { c } = useTheme();
  const dead = !!item.deadLetter;

  // Always right-aligned: both an outbound reply and your own note sit on your
  // side of the thread.
  return (
    <View className="items-end" style={{ marginTop: 10 }}>
      <View
        style={{
          backgroundColor: item.internal ? c.amberTint : c.brandTint,
          borderColor: dead ? c.danger : item.internal ? c.amber : c.brandTint,
          maxWidth: "86%",
          opacity: dead ? 1 : 0.68,
        }}
        className="rounded-16 border px-3.5 py-2.5"
      >
        {item.internal ? (
          <Text style={{ color: c.amber }} className="pb-1 text-2xs font-semibold uppercase tracking-wide">
            Internal note
          </Text>
        ) : null}

        {item.body ? <Text className="text-lg leading-snug text-fg">{item.body}</Text> : null}
        {item.attachmentIds?.length ? (
          <Text className="pt-0.5 text-sm text-muted">
            {item.attachmentIds.length} attachment{item.attachmentIds.length > 1 ? "s" : ""}
          </Text>
        ) : null}

        <View className="flex-row items-center justify-end gap-1.5 pt-1">
          <Text className="text-2xs text-faint">{clockTime(item.createdAt)}</Text>
          {dead ? <AlertIcon size={12} color={c.danger} /> : <ClockIcon size={12} color={c.textFaint} />}
        </View>
      </View>

      {dead ? (
        <View className="flex-row items-center gap-3 px-1 pt-1">
          <Text style={{ color: c.danger }} className="text-2xs">
            {item.deadLetter}
          </Text>
          <Pressable onPress={onRetry} accessibilityRole="button" className="active:opacity-60">
            <Text style={{ color: c.brandStrong }} className="text-2xs font-semibold">
              Retry
            </Text>
          </Pressable>
          <Pressable onPress={onDiscard} accessibilityRole="button" className="active:opacity-60">
            <Text style={{ color: c.textMuted }} className="text-2xs font-semibold">
              Discard
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text className="px-1 pt-1 text-2xs text-faint">
          Waiting for a connection{item.attempts > 1 ? ` · ${item.attempts} attempts` : ""}
        </Text>
      )}
    </View>
  );
}
