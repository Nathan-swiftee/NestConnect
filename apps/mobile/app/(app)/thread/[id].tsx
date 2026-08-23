import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clockTime, useConversation, useRealtime } from "@ding/client";
import type { Message } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { useTheme } from "../../../src/theme";

/**
 * The thread, read-only for now.
 *
 * Phase 1's job is to prove the shell: sign in, see real data, and watch it
 * update live. The composer, media, reactions, quoted replies and the
 * assign/resolve/snooze actions are Phase 2 — this screen is the surface they
 * attach to, not a finished thread view.
 *
 * `useRealtime(id)` is what joins the conversation's room, which both streams
 * new messages into the cache and tells the push policy this thread is open, so
 * the phone doesn't buzz for a message already on screen.
 */
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const conv = useConversation(id);
  useRealtime(id);

  if (conv.isLoading) {
    return (
      <View style={{ backgroundColor: c.bg }} className="flex-1 items-center justify-center">
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }
  if (!conv.data) {
    return (
      <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1 items-center justify-center px-8">
        <Text className="text-lg font-medium text-fg">This conversation isn't available</Text>
        <Pressable onPress={() => router.back()} className="mt-4 active:opacity-60">
          <Text className="text-lg font-medium text-brand">Back to inbox</Text>
        </Pressable>
      </View>
    );
  }

  const { contact, messages } = conv.data;

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      <View style={{ borderBottomColor: c.border }} className="flex-row items-center gap-3 border-b px-3 pb-3 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to inbox"
          hitSlop={12}
          className="px-1 active:opacity-60"
        >
          <Text style={{ color: c.brand }} className="text-2xl">
            ‹
          </Text>
        </Pressable>
        <Avatar name={contact.displayName} color={contact.avatarColor} size={36} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-lg font-semibold leading-tight text-fg">
            {contact.displayName}
          </Text>
          <Text className="text-2xs leading-snug text-faint">
            {conv.data.assigneeName ? `Assigned to ${conv.data.assigneeName}` : "Unassigned"}
          </Text>
        </View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble message={item} />}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 6 }}
        ListEmptyComponent={<Text className="py-12 text-center text-md text-muted">No messages yet.</Text>}
      />
    </View>
  );
}

function Bubble({ message }: { message: Message }) {
  const { c } = useTheme();
  const mine = message.direction === "out";
  return (
    <View className={mine ? "items-end" : "items-start"}>
      <View
        style={{
          backgroundColor: message.internal ? c.amberTint : mine ? c.brandTint : c.surface,
          borderColor: c.border,
          maxWidth: "84%",
        }}
        className="rounded-16 border px-3.5 py-2.5"
      >
        {message.internal ? (
          <Text className="mb-1 text-2xs font-semibold uppercase tracking-wide text-amber">Internal note</Text>
        ) : null}
        <Text className="text-lg leading-snug text-fg">{message.body}</Text>
        <Text className="mt-1 text-right text-2xs text-faint">{clockTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}
