import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
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
  useReact,
  useRealtime,
  useRetryMessage,
  useSession,
  useSetStatus,
  useSnooze,
} from "@ding/client";
import type { ChannelType, ConversationWithMessages, Message } from "@ding/schemas";
import { ActionSheet, type SheetAction } from "../../../src/components/ActionSheet";
import { Attachments } from "../../../src/components/Attachments";
import { Avatar } from "../../../src/components/Avatar";
import { Composer } from "../../../src/components/Composer";
import { useSendQueue } from "../../../src/send-queue";
import { DetailsPanel } from "../../../src/components/DetailsPanel";
import { QueuedBubble } from "../../../src/components/QueuedBubble";
import { MessageActions } from "../../../src/components/MessageActions";
import { ReadLog, readSummary } from "../../../src/components/ReadLog";
import { Reactions } from "../../../src/components/Reactions";
import { SwipeToReply } from "../../../src/components/SwipeToReply";
import { ErrorState, Loading } from "../../../src/components/States";
import { Tail, tailCorner } from "../../../src/components/Tail";
import { EmailBody } from "../../../src/components/EmailBody";
import { Ticks } from "../../../src/components/Ticks";
import { useToast } from "../../../src/components/Toast";
import { BackIcon, DetailsIcon, EyeIcon, MoreIcon, channelColor, channelMeta } from "../../../src/icons";
import { haptics } from "../../../src/haptics";
import { enter } from "../../../src/motion";
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
  // `said` is what the confirmation reads afterwards. "Snoozed until 10 minutes"
  // is not a sentence, so the preposition belongs to the preset rather than to
  // the toast that reports it.
  { label: "10 minutes", said: "Snoozed for 10 minutes", until: () => inMin(10) },
  { label: "30 minutes", said: "Snoozed for 30 minutes", until: () => inMin(30) },
  { label: "1 hour", said: "Snoozed for an hour", until: () => inMin(60) },
  { label: "Tomorrow, 9 AM", said: "Snoozed until tomorrow, 9 AM", until: tomorrow9am },
  { label: "Next week", said: "Snoozed until next week", until: () => inMin(60 * 24 * 7) },
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
  const react = useReact();
  const queue = useSendQueue();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | "assign" | "snooze" | "more" | "details">(null);
  // The message a long-press opened the action sheet for, and the one the
  // composer is quoting. Separate: acting on a message doesn't quote it.
  const [acting, setActing] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [readLog, setReadLog] = useState<Message | null>(null);
  const scroller = useRef<ScrollView>(null);
  const marked = useRef(false);

  useRealtime(id);

  const data = conv.data;

  /**
   * Everything below exists to keep <Bubble> from re-rendering when nothing
   * about its message changed.
   *
   * The thread is a plain ScrollView, so every loaded message is mounted — 300
   * of them after a few taps of "load earlier". Before this, opening the
   * details sheet re-rendered all 300, because each bubble took a fresh arrow
   * function for every callback and the whole conversation object besides.
   * Measured on a 6x-throttled CPU that was a 2.5-second frozen frame: not a
   * slow list, a hung app.
   *
   * So: the derivations are memoised, the handlers take the message as an
   * argument instead of closing over it, and the mutations they need are read
   * through a ref rather than listed as dependencies — a react-query mutation
   * object is new on every render and would defeat the memo from the inside.
   */
  const days = useMemo(() => (data ? groupMessagesByDay(data.messages) : []), [data]);
  const byId = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of data?.messages ?? []) m.set(msg.id, msg);
    return m;
  }, [data]);

  const live = useRef({ id, react, retry });
  live.current = { id, react, retry };

  const onLongPress = useCallback((m: Message) => {
    haptics.tap();
    setActing(m);
  }, []);
  const onReply = useCallback((m: Message) => setReplyTo(m), []);
  const onOpenReadLog = useCallback((m: Message) => setReadLog(m), []);
  // Sending the same emoji again is how the server clears it.
  const onRemoveReaction = useCallback((m: Message) => {
    const { id: convId, react: r } = live.current;
    r.mutate({
      conversationId: convId,
      messageId: m.id,
      emoji: m.reactions?.find((x) => x.by === "user")?.emoji ?? "",
    });
  }, []);
  const onRetry = useCallback((m: Message) => {
    const { id: convId, retry: rt } = live.current;
    rt.mutate({ conversationId: convId, messageId: m.id });
  }, []);

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
        <Loading />
      </View>
    );
  }
  // A failed load and a conversation that genuinely isn't there are different
  // things, and only one of them is worth trying again.
  if (conv.isError) {
    return (
      <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1 justify-center">
        <ErrorState error={conv.error} what="this conversation" onRetry={() => void conv.refetch()} />
        <Pressable onPress={() => router.back()} accessibilityRole="button" className="items-center py-2 active:opacity-60">
          <Text style={{ color: c.brand }} className="text-md font-medium">
            Back to inbox
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1 items-center justify-center px-8">
        <Text className="text-lg font-medium text-fg">This conversation isn't available</Text>
        <Text className="mt-1 text-center text-md text-muted">
          It may have been merged into another thread, or you no longer have access to it.
        </Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" className="mt-4 active:opacity-60">
          <Text style={{ color: c.brand }} className="text-lg font-medium">
            Back to inbox
          </Text>
        </Pressable>
      </View>
    );
  }

  const me = session.data?.user;
  const closed = data.status === "closed";

  /**
   * Every action below reports itself and offers a way back.
   *
   * These all happen inside a sheet, and when the sheet closes the thread looks
   * identical — the only change is a word in the subtitle. Without a toast the
   * honest reading of the screen is "nothing happened", and the natural next
   * move is to do it again. The undo matters as much: assigning to the wrong
   * person is one mis-tap in a list of names, and this is the only moment the
   * previous assignee is still known without a round trip.
   */
  const restoreAssignee = () => {
    const previous = data.assigneeUserId ?? null;
    return () => assign.mutate({ id: data.id, input: { assigneeUserId: previous } });
  };
  const doAssign = (assigneeUserId: string | null, said: string) => {
    const undo = restoreAssignee();
    haptics.success();
    assign.mutate({ id: data.id, input: { assigneeUserId } });
    toast({ text: said, undo });
  };

  const assignActions: SheetAction[] = [
    {
      key: "me",
      label: "Assign to me",
      selected: data.assigneeUserId === me?.id,
      onPress: () => doAssign(me?.id ?? null, "Assigned to you"),
    },
    ...(people ?? [])
      .filter((m) => m.user.id !== me?.id)
      .map((m) => ({
        key: m.user.id,
        label: m.user.name,
        detail: m.user.available ? undefined : "Not accepting work",
        selected: data.assigneeUserId === m.user.id,
        onPress: () => doAssign(m.user.id, `Assigned to ${m.user.name}`),
      })),
    {
      key: "queue",
      label: "Back to the queue",
      detail: "Unassign, leave it for the team",
      selected: !data.assigneeUserId,
      onPress: () => doAssign(null, "Back in the queue"),
    },
  ];

  const snoozeActions: SheetAction[] = SNOOZE.map((s) => ({
    key: s.label,
    label: s.label,
    onPress: () => {
      haptics.success();
      snooze.mutate({ id: data.id, until: s.until() });
      // Un-snoozing is reopening: there is no "previous snooze" to restore, and
      // the thing the agent wants back is the conversation in the inbox.
      toast({ text: s.said, undo: () => setStatus.mutate({ id: data.id, status: "open" }) });
    },
  }));

  const moreActions: SheetAction[] = [
    {
      key: "status",
      label: closed ? "Reopen conversation" : "Resolve conversation",
      detail: closed ? "Move it back into the inbox" : "Close it — a new message reopens it",
      onPress: () => {
        haptics.success();
        setStatus.mutate({ id: data.id, status: closed ? "open" : "closed" });
        toast({
          text: closed ? "Reopened" : "Resolved",
          undo: () => setStatus.mutate({ id: data.id, status: closed ? "closed" : "open" }),
        });
      },
    },
    { key: "snooze", label: "Snooze…", detail: "Hide it until later", onPress: () => setSheet("snooze") },
    { key: "assign", label: "Assign…", onPress: () => setSheet("assign") },
  ];

  return (
    // One behaviour for both platforms, from the keyboard-controller rather than
    // React Native's own view. RN's version does nothing on Android without a
    // behaviour, and the obvious behaviours don't work there either now that
    // edge-to-edge is mandatory: the window no longer resizes when the keyboard
    // opens, so a bottom-anchored composer ends up underneath it and you can't
    // see what you're typing. This reads the real keyboard frame and pads by it.
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={0}
      style={{ backgroundColor: c.bg, paddingTop: insets.top }}
      className="flex-1"
    >
      <Header conv={data} onDetails={() => setSheet("details")} onMore={() => setSheet("more")} />

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 2 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        keyboardDismissMode="interactive"
      >
        <LoadOlder conv={data} />
        {days.map((group) => (
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
                // Primitives and one resolved message rather than the whole
                // conversation: `conv` is a new object on every refetch, and
                // passing it would re-render every bubble for a change to one.
                channel={data.channel}
                contactName={data.contact.displayName}
                quoted={m.quotedMsgId ? byId.get(m.quotedMsgId) : undefined}
                meId={me?.id}
                // Same speaker as the one above? Then it's part of a run, and
                // loses the name and most of the gap above it.
                continues={!!group.items[i - 1] && speakerKey(group.items[i - 1], data.channel) === speakerKey(m, data.channel)}
                onLongPress={onLongPress}
                onReply={onReply}
                onOpenReadLog={onOpenReadLog}
                onRemoveReaction={onRemoveReaction}
                onRetry={onRetry}
              />
            ))}
          </View>
        ))}

        {/* Written but not yet accepted by the server — shown in place so a
            reply composed offline doesn't look like it vanished. */}
        {queue.forConversation(id).map((q) => (
          <QueuedBubble
            key={q.id}
            item={q}
            onRetry={() => void queue.retry(q.id)}
            onDiscard={() => void queue.discard(q.id)}
          />
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
        <Composer conv={data} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      )}
      <BottomInset />

      <ActionSheet visible={sheet === "assign"} title="Assign this conversation" actions={assignActions} onClose={() => setSheet(null)} />
      <ActionSheet visible={sheet === "snooze"} title="Snooze until…" actions={snoozeActions} onClose={() => setSheet(null)} />
      <DetailsPanel
        conv={data}
        visible={sheet === "details"}
        onClose={() => setSheet(null)}
        onOpenConversation={(id) => router.replace({ pathname: "/(app)/thread/[id]", params: { id } })}
      />
      <ReadLog message={readLog} visible={!!readLog} onClose={() => setReadLog(null)} />
      <MessageActions
        message={acting}
        conv={data}
        onReact={(emoji) => {
          haptics.select();
          react.mutate({ conversationId: data.id, messageId: acting!.id, emoji });
        }}
        onReply={() => setReplyTo(acting)}
        onReceipts={() => setReadLog(acting)}
        onClose={() => setActing(null)}
      />
      <ActionSheet visible={sheet === "more"} title={data.contact.displayName} actions={moreActions} onClose={() => setSheet(null)} />
    </KeyboardAvoidingView>
  );
}

/**
 * The strip of colour behind the home indicator / nav bar, which collapses as
 * the keyboard rises.
 *
 * It has to move because the keyboard covers that area: the avoiding view above
 * already pads by the full keyboard height, and a fixed inset underneath would
 * add a second gap the keyboard is already occupying. Driven off the same
 * animated progress the keyboard itself is on, so the two travel together
 * instead of one snapping after the other.
 */
function BottomInset() {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { progress } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: insets.bottom * (1 - progress.value) }));
  return <Animated.View style={[{ backgroundColor: c.surface }, style]} />;
}

function Header({
  conv,
  onDetails,
  onMore,
}: {
  conv: ConversationWithMessages;
  onDetails: () => void;
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
      <Pressable onPress={onDetails} accessibilityRole="button" accessibilityLabel="Conversation details" hitSlop={12} className="px-1.5 active:opacity-60">
        <DetailsIcon size={20} color={c.textMuted} />
      </Pressable>
      <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel="More actions" hitSlop={12} className="px-1.5 active:opacity-60">
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
    <Pressable
      disabled={loading}
      onPress={() => void loadOlder()}
      accessibilityRole="button"
      accessibilityState={{ busy: loading }}
      className="items-center py-2 active:opacity-60"
    >
      <Text style={{ color: c.brand }} className="text-sm font-medium">
        {loading ? "Loading…" : "Load earlier messages"}
      </Text>
    </Pressable>
  );
}

/**
 * One message.
 *
 * Memoised, and every prop is either a primitive or an object whose identity
 * only changes when the thing it describes changes: a message, the one message
 * it quotes, and handlers that take the message as an argument rather than
 * capturing it. That is the whole reason the signature looks like this instead
 * of taking `conv` and a set of closures — see the block above the render loop.
 */
const Bubble = memo(function Bubble({
  message,
  channel,
  contactName,
  quoted,
  meId,
  continues,
  onRetry,
  onLongPress,
  onReply,
  onRemoveReaction,
  onOpenReadLog,
}: {
  message: Message;
  channel: ChannelType;
  contactName: string;
  /** The message this one quotes, already resolved by the parent. */
  quoted?: Message;
  meId?: string;
  continues: boolean;
  onRetry: (m: Message) => void;
  onLongPress: (m: Message) => void;
  onReply: (m: Message) => void;
  onRemoveReaction: (m: Message) => void;
  onOpenReadLog: (m: Message) => void;
}) {
  const { c } = useTheme();
  const mine = message.direction === "out";

  if (message.internal) {
    const byMe = message.authorUserId === meId;
    return (
      <Animated.View
        testID={`msg-${message.id}`}
        entering={enter.row}
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
      </Animated.View>
    );
  }

  // Swipe-to-reply only where a reply means something: WhatsApp threads a
  // quoted reply, email does not, and an internal note has no customer to
  // quote out to.
  const canSwipe =
    !message.internal && (channel === "whatsapp" || channel === "whatsapp_group");

  // Only an outbound email has tracked recipients.
  const read = mine && !message.internal ? readSummary(message) : null;

  const on = message.channel ?? channel;
  const isEmail = on === "email";
  const fill = mine ? c.brandTint : c.surface;
  const line = mine ? c.brandTint : c.border;
  /**
   * A tail marks speech, so only conversation gets one — and only where a turn
   * starts, which is what makes a run of five messages read as one person
   * talking rather than five separate cards.
   *
   * Email is deliberately excluded. An email isn't an utterance, it's a
   * document: it has a subject, recipients and a signature, and drawing it as a
   * speech bubble makes a mixed thread lie about which of the two you're
   * looking at. It gets width instead, since that's what its content needs.
   */
  const tailed = !continues && !isEmail;

  return (
    <SwipeToReply onReply={() => onReply(message)} mine={mine} enabled={canSwipe}>
    <Animated.View
      testID={`msg-${message.id}`}
      entering={enter.row}
      className={mine ? "items-end" : "items-start"}
      style={{ marginTop: continues ? 2 : 10 }}
    >
      <Pressable
        onLongPress={() => onLongPress(message)}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityLabel={`Message: ${message.body || "attachment"}. Long press for actions.`}
        style={{
          backgroundColor: fill,
          borderColor: line,
          maxWidth: isEmail ? "94%" : "86%",
          // The tailed corner squares off. A tail growing out of a 16pt curve
          // leaves a visible sliver of background between the two shapes; at 5pt
          // they read as one outline.
          ...(tailed ? (mine ? { borderTopRightRadius: tailCorner } : { borderTopLeftRadius: tailCorner }) : null),
        }}
        className="rounded-16 border px-3.5 py-2.5"
      >
        {tailed ? <Tail mine={mine} fill={fill} stroke={line} /> : null}

        {/* In a group, who spoke matters as much as what they said. */}
        {!continues && !mine && channel === "whatsapp_group" ? (
          <Text style={{ color: c.group }} className="pb-0.5 text-2xs font-semibold">
            {message.authorName ?? contactName}
          </Text>
        ) : null}

        {quoted ? (
          <View style={{ borderLeftColor: mine ? c.brandStrong : c.borderStrong, backgroundColor: c.surface2 }} className="mb-1.5 rounded-8 border-l-2 px-2.5 py-1.5">
            <Text numberOfLines={1} className="text-2xs font-medium text-muted">
              {quoted.direction === "out" ? "You" : contactName}
            </Text>
            <Text numberOfLines={2} className="text-sm text-muted">
              {quoted.body || "Attachment"}
            </Text>
          </View>
        ) : null}

        {/* Email carries structure worth keeping — headings, lists, links, a
            subject, and usually the whole thread quoted underneath. Rendering
            it as one run of plain text throws all of that away and produces a
            wall nobody reads. */}
        {isEmail ? (
          <EmailBody message={message} mine={mine} />
        ) : message.body ? (
          <Text className="text-lg leading-snug text-fg">{message.body}</Text>
        ) : null}
        <Attachments items={message.attachments ?? []} />

        <View className="flex-row items-center justify-end gap-1.5 pt-1">
          {/* A sent email says how many recipients opened it, and opens the
              per-person log. Email has no real delivery receipt, so this is the
              only honest answer to "did they see it". */}
          {read ? (
            <Pressable
              onPress={() => onOpenReadLog(message)}
              accessibilityRole="button"
              accessibilityLabel={`Read receipts: ${read.seen} of ${read.total} opened`}
              hitSlop={6}
              className="flex-row items-center gap-1 active:opacity-60"
            >
              <EyeIcon size={13} color={read.seen ? c.email : c.textFaint} />
              <Text
                style={{ color: read.seen ? c.email : c.textFaint }}
                className="text-2xs font-medium"
              >
                {read.seen}/{read.total}
              </Text>
            </Pressable>
          ) : null}
          <Text className="text-2xs text-faint">{clockTime(message.createdAt)}</Text>
          {/* One status marker, never two. Where an email has tracked
              recipients the open count above is strictly the better answer —
              it's measured rather than inferred — and a second double-tick
              beside it would be the same claim told two ways. */}
          {mine && !read ? <Ticks status={message.status} /> : null}
        </View>
      </Pressable>

      <Reactions
        reactions={message.reactions ?? []}
        mine={mine}
        contactName={contactName}
        onRemove={() => onRemoveReaction(message)}
      />

      {mine && message.status === "failed" ? (
        <Pressable onPress={() => onRetry(message)} accessibilityRole="button" className="px-1 pt-1 active:opacity-60">
          <Text style={{ color: c.brand }} className="text-2xs font-medium">
            Retry{message.failureReason ? ` · ${message.failureReason}` : ""}
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
    </SwipeToReply>
  );
});
