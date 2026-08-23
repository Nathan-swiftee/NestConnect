import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  clockTime,
  groupMessagesByDay,
  speakerKey,
  useAssign,
  useConversation,
  useLoadOlderMessages,
  useMarkRead,
  usePeople,
  useRealtime,
  useRetryMessage,
  useSession,
  useSetStatus,
  useSnooze,
} from "@ding/client";
import type { ConversationWithMessages, Message } from "@ding/schemas";
import { ActionSheet, type SheetAction } from "../../../src/components/ActionSheet";
import { Attachments } from "../../../src/components/Attachments";
import { Avatar } from "../../../src/components/Avatar";
import { Composer } from "../../../src/components/Composer";
import { Ticks } from "../../../src/components/Ticks";
import { BackIcon, MoreIcon, ProfileIcon, channelColor, channelMeta } from "../../../src/icons";
import { useTheme } from "../../../src/theme";

/** Snooze presets. The same five the web offers, so "snooze till tomorrow"
 *  means the same thing whichever one an agent reaches for. */
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const tomorrow9am = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};
const SNOOZE = [
  { label: "10 minutes", until: () => inMin(10) },
  { label: "30 minutes", until: () => inMin(30) },
  { label: "1 hour", until: () => inMin(60) },
  { label: "Tomorrow, 9 AM", until: tomorrow9am },
  { label: "Next week", until: () => inMin(60 * 24 * 7) },
];

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const conv = useConversation(id);
  const session = useSession();
  const { data: people } = usePeople();
  const assign = useAssign();
  const setStatus = useSetStatus();
  const snooze = useSnooze();
  const markRead = useMarkRead();
  const retry = useRetryMessage();
  const [sheet, setSheet] = useState<null | "assign" | "snooze" | "more">(null);
  const scroller = useRef<ScrollView>(null);
  const marked = useRef(false);

  useRealtime(id);

  // Opening a thread is reading it — clear the badge and send the WhatsApp read
  // receipt, once per visit rather than on every re-render.
  useEffect(() => {
    if (!id || marked.current || !conv.data) return;
    marked.current = true;
    markRead.mutate(id);
  }, [id, conv.data, markRead]);

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
          <Text style={{ color: c.brand }} className="text-lg font-medium">
            Back to inbox
          </Text>
        </Pressable>
      </View>
    );
  }

  const data = conv.data;
  const me = session.data?.user;
  const closed = data.status === "closed";

  const assignActions: SheetAction[] = [
    {
      key: "me",
      label: "Assign to me",
      selected: data.assigneeUserId === me?.id,
      onPress: () => assign.mutate({ id: data.id, input: { assigneeUserId: me?.id ?? null } }),
    },
    ...(people ?? [])
      .filter((m) => m.user.id !== me?.id)
      .map((m) => ({
        key: m.user.id,
        label: m.user.name,
        detail: m.user.available ? undefined : "Not accepting work",
        selected: data.assigneeUserId === m.user.id,
        onPress: () => assign.mutate({ id: data.id, input: { assigneeUserId: m.user.id } }),
      })),
    {
      key: "queue",
      label: "Back to the queue",
      detail: "Unassign, leave it for the team",
      selected: !data.assigneeUserId,
      onPress: () => assign.mutate({ id: data.id, input: { assigneeUserId: null } }),
    },
  ];

  const snoozeActions: SheetAction[] = SNOOZE.map((s) => ({
    key: s.label,
    label: s.label,
    onPress: () => snooze.mutate({ id: data.id, until: s.until() }),
  }));

  const moreActions: SheetAction[] = [
    {
      key: "status",
      label: closed ? "Reopen conversation" : "Resolve conversation",
      detail: closed ? "Move it back into the inbox" : "Close it — a new message reopens it",
      onPress: () => setStatus.mutate({ id: data.id, status: closed ? "open" : "closed" }),
    },
    { key: "snooze", label: "Snooze…", detail: "Hide it until later", onPress: () => setSheet("snooze") },
    { key: "assign", label: "Assign…", onPress: () => setSheet("assign") },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={{ backgroundColor: c.bg, paddingTop: insets.top }}
      className="flex-1"
    >
      <Header conv={data} onAssign={() => setSheet("assign")} onMore={() => setSheet("more")} />

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 2 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        keyboardDismissMode="interactive"
      >
        <LoadOlder conv={data} />
        {groupMessagesByDay(data.messages).map((group) => (
          // No gap here on purpose: spacing is per-bubble, so a run can close
          // up. A container gap would apply the same distance to every pair and
          // there would be no visible grouping at all.
          <View key={group.key}>
            <View className="items-center py-2">
              <View style={{ backgroundColor: c.surface2 }} className="rounded-full px-3 py-1">
                <Text className="text-2xs font-medium text-muted">{group.label}</Text>
              </View>
            </View>
            {group.items.map((m, i) => (
              <Bubble
                key={m.id}
                message={m}
                conv={data}
                meId={me?.id}
                // Same speaker as the one above? Then it's part of a run, and
                // loses the name and most of the gap above it.
                continues={!!group.items[i - 1] && speakerKey(group.items[i - 1], data.channel) === speakerKey(m, data.channel)}
                onRetry={() => retry.mutate({ conversationId: data.id, messageId: m.id })}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {closed ? (
        <View style={{ backgroundColor: c.surface, borderTopColor: c.border }} className="border-t px-4 py-3">
          <Text className="text-center text-md text-muted">
            This conversation is resolved.{" "}
            <Text
              onPress={() => setStatus.mutate({ id: data.id, status: "open" })}
              style={{ color: c.brand }}
              className="font-medium"
            >
              Reopen
            </Text>{" "}
            to reply.
          </Text>
        </View>
      ) : (
        <Composer conv={data} />
      )}
      <View style={{ height: insets.bottom, backgroundColor: c.surface }} />

      <ActionSheet visible={sheet === "assign"} title="Assign this conversation" actions={assignActions} onClose={() => setSheet(null)} />
      <ActionSheet visible={sheet === "snooze"} title="Snooze until…" actions={snoozeActions} onClose={() => setSheet(null)} />
      <ActionSheet visible={sheet === "more"} title={data.contact.displayName} actions={moreActions} onClose={() => setSheet(null)} />
    </KeyboardAvoidingView>
  );
}

function Header({
  conv,
  onAssign,
  onMore,
}: {
  conv: ConversationWithMessages;
  onAssign: () => void;
  onMore: () => void;
}) {
  const { c } = useTheme();
  const ChannelGlyph = channelMeta(conv.channel).Glyph;
  return (
    <View style={{ borderBottomColor: c.border, backgroundColor: c.surface }} className="flex-row items-center gap-2.5 border-b px-2 py-2">
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to inbox" hitSlop={12} className="px-1 active:opacity-60">
        <BackIcon size={24} color={c.brand} />
      </Pressable>
      <Avatar name={conv.contact.displayName} color={conv.contact.avatarColor} size={38} />
      <View className="flex-1">
        {/* Name and channel sit on one line, as on the web: the glyph is the
            thread's identity, so it belongs beside the name, not below it. */}
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="flex-shrink text-lg font-semibold leading-tight text-fg">
            {conv.contact.displayName}
          </Text>
          <ChannelGlyph size={13} color={channelColor(conv.channel, c)} />
        </View>
        <Text numberOfLines={1} className="text-2xs leading-snug text-faint">
          {conv.status === "snoozed" ? "Snoozed · " : conv.status === "closed" ? "Resolved · " : ""}
          {conv.assigneeName ? `Assigned to ${conv.assigneeName}` : "Unassigned"}
        </Text>
      </View>
      <Pressable onPress={onAssign} accessibilityRole="button" accessibilityLabel="Assign" hitSlop={8} className="px-1.5 active:opacity-60">
        <ProfileIcon size={20} color={c.textMuted} />
      </Pressable>
      <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel="More actions" hitSlop={8} className="px-1.5 active:opacity-60">
        <MoreIcon size={20} color={c.textMuted} />
      </Pressable>
    </View>
  );
}

/** Scroll-up history. The thread loads its tail; earlier messages come on
 *  request rather than pulling a year of email onto a phone unasked. */
function LoadOlder({ conv }: { conv: ConversationWithMessages }) {
  const { c } = useTheme();
  const { loadOlder, loading } = useLoadOlderMessages(conv.id);
  if (!conv.hasMoreMessages) return null;
  return (
    <Pressable disabled={loading} onPress={() => void loadOlder()} className="items-center py-2 active:opacity-60">
      <Text style={{ color: c.brand }} className="text-sm font-medium">
        {loading ? "Loading…" : "Load earlier messages"}
      </Text>
    </Pressable>
  );
}

function Bubble({
  message,
  conv,
  meId,
  continues,
  onRetry,
}: {
  message: Message;
  conv: ConversationWithMessages;
  meId?: string;
  continues: boolean;
  onRetry: () => void;
}) {
  const { c } = useTheme();
  const mine = message.direction === "out";
  const quoted = message.quotedMsgId
    ? conv.messages.find((m) => m.id === message.quotedMsgId)
    : undefined;

  if (message.internal) {
    const byMe = message.authorUserId === meId;
    return (
      <View
        testID={`msg-${message.id}`}
        className={byMe ? "items-end" : "items-start"}
        style={{ marginTop: continues ? 2 : 10 }}
      >
        <View style={{ backgroundColor: c.amberTint, borderColor: c.amber, maxWidth: "86%" }} className="rounded-16 border px-3.5 py-2.5">
          {!continues ? (
            <Text style={{ color: c.amber }} className="pb-1 text-2xs font-semibold uppercase tracking-wide">
              Internal note · {message.authorName ?? "Teammate"}
            </Text>
          ) : null}
          <Text className="text-lg leading-snug text-fg">{message.body}</Text>
          <Attachments items={message.attachments ?? []} />
          <Text className="pt-1 text-right text-2xs text-faint">{clockTime(message.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      testID={`msg-${message.id}`}
      className={mine ? "items-end" : "items-start"}
      style={{ marginTop: continues ? 2 : 10 }}
    >
      <View
        style={{
          backgroundColor: mine ? c.brandTint : c.surface,
          borderColor: mine ? c.brandTint : c.border,
          maxWidth: "86%",
        }}
        className="rounded-16 border px-3.5 py-2.5"
      >
        {/* In a group, who spoke matters as much as what they said. */}
        {!continues && !mine && conv.channel === "whatsapp_group" ? (
          <Text style={{ color: c.group }} className="pb-0.5 text-2xs font-semibold">
            {message.authorName ?? conv.contact.displayName}
          </Text>
        ) : null}

        {quoted ? (
          <View style={{ borderLeftColor: mine ? c.brandStrong : c.borderStrong, backgroundColor: c.surface2 }} className="mb-1.5 rounded-8 border-l-2 px-2.5 py-1.5">
            <Text numberOfLines={1} className="text-2xs font-medium text-muted">
              {quoted.direction === "out" ? "You" : conv.contact.displayName}
            </Text>
            <Text numberOfLines={2} className="text-sm text-muted">
              {quoted.body || "Attachment"}
            </Text>
          </View>
        ) : null}

        {message.body ? <Text className="text-lg leading-snug text-fg">{message.body}</Text> : null}
        <Attachments items={message.attachments ?? []} />

        {message.reactions?.length ? (
          <View className="flex-row gap-1 pt-1.5">
            {message.reactions.map((r, i) => (
              <View key={`${r.emoji}-${i}`} style={{ backgroundColor: c.surface2 }} className="rounded-full px-1.5 py-0.5">
                <Text className="text-sm">{r.emoji}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View className="flex-row items-center justify-end gap-1.5 pt-1">
          <Text className="text-2xs text-faint">{clockTime(message.createdAt)}</Text>
          {mine ? <Ticks status={message.status} /> : null}
        </View>
      </View>

      {mine && message.status === "failed" ? (
        <Pressable onPress={onRetry} accessibilityRole="button" className="px-1 pt-1 active:opacity-60">
          <Text style={{ color: c.brand }} className="text-2xs font-medium">
            Retry{message.failureReason ? ` · ${message.failureReason}` : ""}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
