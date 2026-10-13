import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { relativeTime, seenAt, useConversationEvents } from "@ding/client";
import type { ConversationEvent } from "@ding/schemas";
import { mediaSource } from "../api-config";
import { Avatar } from "./Avatar";
import { HistoryIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";

/**
 * The conversation log: everything that happened to this conversation besides
 * its messages — routed, assigned, moved, closed, snoozed, labelled… — newest
 * first, with who did it. Read-only, and only fetched while it's open.
 *
 * Reached from "Conversation log" at the bottom of Details. It's its own sheet
 * rather than a section in Details because it can run long, and because iOS
 * shows one modal at a time — Details closes, then this opens (see modal-slot).
 * See docs/conversation-log.md.
 */
export function ConversationLogSheet({
  conversationId,
  visible,
  onClose,
}: {
  conversationId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { data: events, isLoading, isError } = useConversationEvents(conversationId, visible);

  return (
    <Sheet visible={visible} onClose={onClose} padded={false}>
      <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
        <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
          Conversation log
        </Text>
        <Touchable feel="chip" borderless
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full"
        >
          <XIcon size={16} color={c.textMuted} />
        </Touchable>
      </View>

      {/* `flexShrink: 1` is what makes this scroll at all — see Sheet.tsx. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {isLoading ? (
          <ActivityIndicator color={c.brand} className="py-6" />
        ) : isError ? (
          <Text className="py-6 text-center text-md text-muted">Couldn't load the log. Try again in a moment.</Text>
        ) : !events?.length ? (
          <View className="items-center gap-2 px-6 py-6">
            <HistoryIcon size={22} color={c.textFaint} />
            <Text className="text-center text-md text-muted">
              Nothing logged yet. Assignments, status changes, labels and the like show up here as they happen.
            </Text>
          </View>
        ) : (
          events.map((e, i) => <Entry key={e.id} e={e} last={i === events.length - 1} />)
        )}
      </ScrollView>
    </Sheet>
  );
}

function Entry({ e, last }: { e: ConversationEvent; last: boolean }) {
  const { c } = useTheme();
  const rel = relativeTime(e.at);
  return (
    <View className="flex-row items-start gap-3" accessible accessibilityLabel={`${e.text}. ${e.detail ?? ""} ${seenAt(e.at)}`}>
      {/* The avatar or dot, with the line down to the next entry. */}
      <View className="items-center" style={{ width: 26, alignSelf: "stretch" }}>
        <View style={{ height: 26 }} className="items-center justify-center">
          {e.actor.kind === "agent" ? (
            <Avatar name={e.actor.name} color={e.actor.avatarColor} photo={e.actor.avatarUrl ? mediaSource(e.actor.avatarUrl) : null} size={26} />
          ) : (
            <View
              style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: e.actor.kind === "customer" ? c.brandStrong : c.textFaint }}
            />
          )}
        </View>
        {!last ? <View style={{ flex: 1, width: 1, backgroundColor: c.border, marginVertical: 4 }} /> : null}
      </View>
      <View className="flex-1" style={{ paddingTop: 3, paddingBottom: last ? 0 : 14 }}>
        <Text className="text-md text-fg">{e.text}</Text>
        {e.until ? <Text className="mt-0.5 text-sm text-muted">Until {seenAt(e.until)}</Text> : null}
        {e.detail ? <Text className="mt-0.5 text-sm text-muted">{e.detail}</Text> : null}
      </View>
      <Text style={{ paddingTop: 5 }} className="text-2xs text-faint">
        {rel === "now" ? "now" : `${rel} ago`}
      </Text>
    </View>
  );
}
