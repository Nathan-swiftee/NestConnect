import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import {
  clockTime,
  groupMessagesByDay,
  speakerKey,
  useAssign,
  useConversation,
  useForwardMessage,
  useLoadOlderMessages,
  useMarkRead,
  usePeople,
  useReact,
  useRealtime,
  useRetryMessage,
  useSession,
  useSetStatus,
  useSnooze,
  useTeams,
} from "@ding/client";
import type { ChannelType, ConversationWithMessages, Message } from "@ding/schemas";
import { ActionSheet, type SheetAction } from "../../../src/components/ActionSheet";
import { Attachments } from "../../../src/components/Attachments";
import { Avatar } from "../../../src/components/Avatar";
import { Composer } from "../../../src/components/Composer";
import { useSendQueue } from "../../../src/send-queue";
import { DetailsPanel } from "../../../src/components/DetailsPanel";
import { LabelSheet } from "../../../src/components/LabelSheet";
import { QueuedBubble } from "../../../src/components/QueuedBubble";
import { MessageActions } from "../../../src/components/MessageActions";
import { ForwardSheet } from "../../../src/components/ForwardSheet";
import { ReadLog, readSummary } from "../../../src/components/ReadLog";
import { Reactions } from "../../../src/components/Reactions";
import { SwipeToReply } from "../../../src/components/SwipeToReply";
import { ErrorState, Loading } from "../../../src/components/States";
import { Tail, tailCorner } from "../../../src/components/Tail";
import { EmailBody } from "../../../src/components/EmailBody";
import { Ticks } from "../../../src/components/Ticks";
import { useToast } from "../../../src/components/Toast";
import {
  BackIcon,
  CheckCircleIcon,
  DetailsIcon,
  EyeIcon,
  ForwardIcon,
  InboxIcon,
  MoreIcon,
  ProfileIcon,
  ReopenIcon,
  SnoozeIcon,
  TagIcon,
  TeamGlyph,
  channelColor,
  channelMeta,
} from "../../../src/icons";
import { haptics } from "../../../src/haptics";
import { enter } from "../../../src/motion";
import { elevation, useTheme } from "../../../src/theme";
import { useInsets } from "../../../src/insets";

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

/**
 * A note body with its @handles picked out.
 *
 * Same split as the web's, on the same character class, so a note written on a
 * laptop and read on a phone highlights the same words. The point isn't
 * decoration: a note is often addressed to one person in a team of six, and the
 * handle is the only thing that says which.
 */
function NoteBody({ body, color }: { body: string; color: string }) {
  return (
    <Text className="text-lg leading-snug text-fg">
      {body.split(/(@[\w.+-]+)/g).map((part, i) =>
        part.startsWith("@") ? (
          <Text key={i} style={{ color }} className="font-semibold">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** What the ⋯ menu's Labels row says underneath itself: the labels already on
 *  this conversation, so the common case (checking, not changing) needs no tap
 *  at all. */
function labelSummary(conv: ConversationWithMessages): string {
  const names = (conv.labels ?? []).map((l) => l.name);
  if (!names.length) return "None yet";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useInsets();
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
  const forward = useForwardMessage();
  const queue = useSendQueue();
  const teams = useTeams();
  const toast = useToast();
  const teamName = (id: string | null) =>
    (id ? teams.data?.find((t) => t.id === id)?.name : undefined) ?? "the team";
  const [sheet, setSheet] = useState<null | "assign" | "snooze" | "more" | "details" | "labels">(
    null,
  );
  // The message a long-press opened the action sheet for, and the one the
  // composer is quoting. Separate: acting on a message doesn't quote it.
  const [acting, setActing] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [readLog, setReadLog] = useState<Message | null>(null);
  // The message being forwarded on to other chats (drives the picker sheet).
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const scroller = useRef<ScrollView>(null);
  const marked = useRef(false);
  /**
   * What the scroller looked like just before older messages were prepended.
   *
   * Loading history makes the content taller *above* the reader, so leaving the
   * offset alone slides everything they were reading downward. Recording the
   * height and offset first lets the new offset be computed from the growth:
   * the message under their eye stays under their eye, which is the whole point
   * of the button they just pressed.
   */
  const anchor = useRef<{ height: number; y: number } | null>(null);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const viewportH = useRef(0);
  /** Id of the newest message, so a *prepend* can be told from an *append*. */
  const lastMsgId = useRef<string | null>(null);

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

  /**
   * Which messages should print their subject.
   *
   * A subject on every email is what a mail client shows in a *list*, where each
   * row is a different thread. Inside one thread it's the same line over and
   * over — four bubbles deep it stops being information and starts being the
   * reason you can't see the messages. The header already carries the thread's
   * current subject persistently.
   *
   * So a bubble prints its subject only when it says something new: the first
   * email in the thread, and any message where the subject changed. That turns
   * the line into an event — "this is where it was renamed" — which is worth the
   * space. Computed over the flat list, because a rename can happen across a day
   * boundary and the per-day grouping would miss it.
   */
  const showsSubject = useMemo(() => {
    const out = new Set<string>();
    let last: string | null = null;
    for (const m of data?.messages ?? []) {
      const s = m.email?.subject?.trim();
      if (!s) continue;
      if (s !== last) out.add(m.id);
      last = s;
    }
    return out;
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

  /**
   * The thread as one flat list of children, plus the indices of the day
   * separators within it.
   *
   * Flat because `stickyHeaderIndices` only understands direct children of the
   * ScrollView; a per-day wrapper hides the separator from it. Built here rather
   * than inline so the index bookkeeping lives next to the thing it indexes —
   * getting it wrong sticks a message to the top instead of a date.
   */
  // Read from the session rather than the `me` derived further down: this memo
  // is a hook, so it must run before the loading/error early returns, and `me`
  // is only in scope after them.
  const myId = session.data?.user?.id;
  const { threadRows, stickyDays } = useMemo(() => {
    const rows: React.ReactNode[] = [];
    const sticky: number[] = [];
    if (!data) return { threadRows: rows, stickyDays: sticky };
    rows.push(
      <LoadOlder
        key="older"
        conv={data}
        onBeforeLoad={() => {
          anchor.current = { height: contentH.current, y: scrollY.current };
        }}
      />,
    );
    days.forEach((group, gi) => {
      sticky.push(rows.length);
      rows.push(
        // Transparent around an opaque pill, so the thread passes either side of
        // it as it scrolls under — WhatsApp's floating date, not a full-width bar.
        <View key={`day-${group.key}`} className="items-center pb-1 pt-1.5">
          <View
            style={{
              backgroundColor: c.surface2,
              // A lift, because this pill is sticky: while its day is on screen
              // it sits *over* the messages scrolling under it, and flat against
              // a bubble it reads as part of that bubble rather than as chrome
              // floating above the thread.
              shadowColor: "#000",
              shadowOpacity: 0.14,
              shadowRadius: 5,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            }}
            className="rounded-full px-3 py-1"
          >
            <Text className="text-2xs font-medium text-muted">{group.label}</Text>
          </View>
        </View>,
      );
      group.items.forEach((m, i) => {
        const prev = group.items[i - 1];
        const next = group.items[i + 1];
        const who = (x: Message) => speakerKey(x, data.channel);
        rows.push(
          <Bubble
            key={m.id}
            message={m}
            // Primitives and one resolved message rather than the whole
            // conversation: `conv` is a new object on every refetch, and passing
            // it would re-render every bubble for a change to one.
            channel={data.channel}
            contactName={data.contact.displayName}
            quoted={m.quotedMsgId ? byId.get(m.quotedMsgId) : undefined}
            meId={myId}
            // Same speaker above? Part of a run: loses the name and most of the
            // gap above it. Same speaker below? Not the last of the run, so the
            // tail belongs to whichever bubble is.
            continues={!!prev && who(prev) === who(m)}
            endsRun={!next || who(next) !== who(m)}
            showSubject={showsSubject.has(m.id)}
            firstOfDay={i === 0}
            // Only when another day follows: the last message in the thread
            // wants the composer's own gap, not a divider's.
            lastOfDay={!next && gi < days.length - 1}
            onLongPress={onLongPress}
            onReply={onReply}
            onOpenReadLog={onOpenReadLog}
            onRemoveReaction={onRemoveReaction}
            onRetry={onRetry}
          />,
        );
      });
    });
    return { threadRows: rows, stickyDays: sticky };
  }, [
    data,
    days,
    byId,
    myId,
    c.surface2,
    onLongPress,
    onReply,
    onOpenReadLog,
    onRemoveReaction,
    onRetry,
  ]);

  // Send `forwarding` on to the picked customers. The server reports each target
  // separately — a closed 24-hour window on one chat is the normal partial
  // failure — so the toast names what didn't go rather than claiming it all did.
  const submitForward = (contactIds: string[]) => {
    const m = forwarding;
    if (!m) return;
    forward.mutate(
      { conversationId: id, messageId: m.id, contactIds },
      {
        onSuccess: (results) => {
          setForwarding(null);
          const sent = results.filter((r) => r.ok);
          const failed = results.filter((r) => !r.ok);
          // Only a clean sweep gets the success buzz; a partial forward is not
          // a thing to congratulate someone for.
          if (failed.length) haptics.warning();
          else haptics.success();
          if (!failed.length) {
            toast({ text: sent.length === 1 ? `Forwarded to ${sent[0].name}` : `Forwarded to ${sent.length} chats` });
          } else if (!sent.length) {
            toast({
              text: failed.length === 1 ? `${failed[0].name}: ${failed[0].error}` : "Couldn't forward to any of those chats",
              tone: "error",
            });
          } else {
            toast({
              text: `Forwarded to ${sent.length} — ${failed.map((f) => f.name).join(", ")} didn't go`,
              tone: "info",
            });
          }
        },
        onError: () => toast({ text: "Couldn't forward that message. Please try again.", tone: "error" }),
      },
    );
  };

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
  /**
   * Both halves of an assignment restored together.
   *
   * Person and team are separate fields, and routing to a team clears the
   * person — so an undo that only put the person back would leave the
   * conversation on the new team with its old owner, a state nobody chose.
   */
  const restoreAssignment = () => {
    const assigneeUserId = data.assigneeUserId ?? null;
    const assignedTeamId = data.assignedTeamId ?? null;
    return () => assign.mutate({ id: data.id, input: { assigneeUserId, assignedTeamId } });
  };
  const doAssign = (input: { assigneeUserId?: string | null; assignedTeamId?: string | null }, said: string) => {
    const undo = restoreAssignment();
    haptics.success();
    assign.mutate({ id: data.id, input });
    toast({ text: said, undo });
  };

  /**
   * Who can take this, and where it can be sent.
   *
   * Two different acts, so two groups. Assigning names a person who now owns
   * it; routing hands it to a team's queue for whoever picks it up. They were
   * one undivided list of names before, with no way to do the second at all —
   * which meant a conversation could only ever move sideways between
   * individuals, never back to a team that should own it.
   *
   * People are ordered by the team the conversation is already on: if it sits
   * with Support, Support's members are the ones you're realistically handing
   * it to, and they shouldn't be interleaved with everyone else.
   */
  const currentTeam = data.assignedTeamId ?? null;
  const inTeam = (m: { teamIds: string[] }) => !!currentTeam && m.teamIds.includes(currentTeam);
  const others = (people ?? []).filter((m) => m.user.id !== me?.id);
  const ranked = [...others].sort((a, b) => Number(inTeam(b)) - Number(inTeam(a)));

  const assignActions: SheetAction[] = [
    {
      key: "me",
      section: "Assign to a person",
      label: "Assign to me",
      leading: me ? <Avatar name={me.name} color={me.avatarColor} size={34} /> : undefined,
      selected: data.assigneeUserId === me?.id,
      onPress: () => doAssign({ assigneeUserId: me?.id ?? null }, "Assigned to you"),
    },
    ...ranked.map((m) => ({
      key: m.user.id,
      label: m.user.name,
      leading: <Avatar name={m.user.name} color={m.user.avatarColor} size={34} />,
      detail: !m.user.available
        ? "Not accepting work"
        : inTeam(m)
          ? teamName(currentTeam)
          : undefined,
      selected: data.assigneeUserId === m.user.id,
      onPress: () => doAssign({ assigneeUserId: m.user.id }, `Assigned to ${m.user.name}`),
    })),
    ...(teams.data ?? []).map((t, i) => ({
      key: `team:${t.id}`,
      // Only the first row carries the caption; the rest continue the group.
      section: i === 0 ? "Route to a team" : undefined,
      label: t.name,
      leading: <TeamGlyph icon={t.icon} size={21} color={c.textMuted} />,
      detail: t.id === currentTeam ? "Already here" : "Unassigns, leaves it for the team",
      selected: t.id === currentTeam && !data.assigneeUserId,
      // Routing clears the person on purpose: it means "nobody in particular
      // owns this, the team does", which is what puts it up for grabs.
      onPress: () => doAssign({ assigneeUserId: null, assignedTeamId: t.id }, `Routed to ${t.name}`),
    })),
    {
      key: "queue",
      section: "Or",
      label: "Back to the queue",
      leading: <InboxIcon size={21} color={c.textMuted} />,
      detail: currentTeam ? `Unassign, leave it with ${teamName(currentTeam)}` : "Unassign, leave it for the team",
      selected: !data.assigneeUserId,
      onPress: () => doAssign({ assigneeUserId: null }, "Back in the queue"),
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

  // Every row carries a glyph. A list where one item has an icon and the rest
  // don't reads as three plain rows and one mistake — the eye goes to the odd
  // one out rather than down the list.
  const moreActions: SheetAction[] = [
    {
      key: "status",
      label: closed ? "Reopen conversation" : "Resolve conversation",
      leading: closed
        ? <ReopenIcon size={20} color={c.textMuted} />
        : <CheckCircleIcon size={20} color={c.textMuted} />,
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
    {
      key: "snooze",
      label: "Snooze…",
      leading: <SnoozeIcon size={20} color={c.textMuted} />,
      detail: "Hide it until later",
      onPress: () => setSheet("snooze"),
    },
    {
      key: "assign",
      label: "Assign…",
      leading: <ProfileIcon size={20} color={c.textMuted} />,
      detail: data.assigneeName ? `With ${data.assigneeName}` : "Nobody yet",
      onPress: () => setSheet("assign"),
    },
    {
      key: "labels",
      label: "Labels…",
      leading: <TagIcon size={20} color={c.textMuted} />,
      detail: labelSummary(data),
      onPress: () => setSheet("labels"),
    },
  ];

  return (
    // A plain View owns the screen, and the avoiding view wraps the composer
    // and nothing else.
    //
    // Every arrangement that put this screen's sizing through
    // KeyboardAvoidingView has come back wrong in a different way: the padding
    // it was given disappeared, then the flex it was given disappeared, then
    // the message list flexed into it and came out zero tall. Whatever it does
    // with a style prop, it is not a thing to hang a layout on.
    //
    // So it doesn't hold one any more. A View fills the screen, the header pads
    // itself for the status bar, the list flexes into the space between — all
    // plain components that can be relied on — and the avoiding view is left
    // with its one real job: adding padding under the composer equal to the
    // keyboard, which is exactly what `behavior="padding"` means. It sizes to
    // its own content there, which is correct rather than something to work
    // around.
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header
        conv={data}
        insetTop={insets.top}
        onDetails={() => setSheet("details")}
        onMore={() => setSheet("more")}
      />

      {/* Flat children, not a View per day, because `stickyHeaderIndices` only
          sticks DIRECT children of the ScrollView. Wrapping each day made its
          separator scroll away with its group — the web keeps it pinned
          (`position:sticky`) so you always know what day you're reading, and a
          phone needs that more than a desktop does, not less.

          No container gap: spacing is per-bubble so a run can close up. A
          uniform gap would space every pair identically and there'd be no
          visible grouping at all. */}
      <ScrollView
        ref={scroller}
        // `flex: 1`, or the thread sizes itself to its messages instead of to
        // the space between the header and the composer. Both ends of that go
        // wrong: one message and the scroll view is short, so the composer sits
        // halfway up the screen; a full thread and it grows past the bottom,
        // taking the composer off the screen with it. The container style is
        // the padding inside the scroll, which is a different thing and was
        // the only one set.
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          const prev = contentH.current;
          contentH.current = h;
          // Older messages were just prepended: hold the reader's place by
          // moving down exactly as much as the content grew above them.
          if (anchor.current) {
            const { height, y } = anchor.current;
            anchor.current = null;
            scroller.current?.scrollTo({ y: y + (h - height), animated: false });
            return;
          }
          const newest = data?.messages[data.messages.length - 1]?.id ?? null;
          const appended = newest !== lastMsgId.current;
          lastMsgId.current = newest;
          // Follow the bottom for a new message, and stay glued to it while
          // content reflows if that's where the reader already was — an image
          // finishing loading shouldn't leave the newest bubble half off the
          // screen. Reading further up, nothing moves.
          const wasAtBottom = prev === 0 || scrollY.current + viewportH.current >= prev - 120;
          if (appended || wasAtBottom) {
            scroller.current?.scrollToEnd({ animated: prev !== 0 && appended });
          }
        }}
        keyboardDismissMode="interactive"
        stickyHeaderIndices={stickyDays}
      >
        {threadRows}

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

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
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
      </KeyboardAvoidingView>

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
        onForward={() => setForwarding(acting)}
        onReceipts={() => setReadLog(acting)}
        onClose={() => setActing(null)}
      />
      <ForwardSheet
        message={forwarding}
        busy={forward.isPending}
        onSubmit={submitForward}
        onClose={() => setForwarding(null)}
      />
      <ActionSheet visible={sheet === "more"} title={data.contact.displayName} actions={moreActions} onClose={() => setSheet(null)} />
      <LabelSheet conv={data} visible={sheet === "labels"} onClose={() => setSheet(null)} />
    </View>
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
  const insets = useInsets();
  const { c } = useTheme();
  const { progress } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: insets.bottom * (1 - progress.value) }));
  return <Animated.View style={[{ backgroundColor: c.surface }, style]} />;
}

function Header({
  conv,
  insetTop,
  onDetails,
  onMore,
}: {
  conv: ConversationWithMessages;
  /** Status-bar height. The header owns the top safe area because it's the
   *  topmost thing on the screen and a plain View can be relied on to apply
   *  padding it's given. */
  insetTop: number;
  onDetails: () => void;
  onMore: () => void;
}) {
  const { c } = useTheme();
  const ChannelGlyph = channelMeta(conv.channel).Glyph;
  return (
    <View
      style={{ borderBottomColor: c.border, backgroundColor: c.surface, paddingTop: insetTop }}
      className="flex-row items-center gap-2.5 border-b px-2 pb-2 pt-2"
    >
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
        {/* An email thread is identified by its subject, not by who it's with —
            "Re: invoice 4471" is the thread; the customer may have five. Shown
            above the assignee line, and only when it says something the name
            doesn't already (a thread with no subject falls back to the contact's
            name server-side, and repeating it twice is noise). */}
        {conv.subject && conv.subject !== conv.contact.displayName ? (
          <Text numberOfLines={1} className="text-2xs font-semibold leading-snug text-fg">
            {conv.subject}
          </Text>
        ) : null}
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
function LoadOlder({
  conv,
  onBeforeLoad,
}: {
  conv: ConversationWithMessages;
  /** Called before the fetch, to record where the reader is. */
  onBeforeLoad: () => void;
}) {
  const { c } = useTheme();
  const { loadOlder, loading } = useLoadOlderMessages(conv.id);
  if (!conv.hasMoreMessages) return null;
  return (
    <Pressable
      disabled={loading}
      onPress={() => {
        onBeforeLoad();
        void loadOlder();
      }}
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
  endsRun,
  showSubject,
  firstOfDay,
  lastOfDay,
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
  /** Last of a run — i.e. not followed by the same speaker. Carries the tail. */
  endsRun: boolean;
  /** Email only: whether this message's subject is news (the thread's first, or
   *  a rename) rather than the same line as the message above it. */
  showSubject?: boolean;
  /** Directly under a date divider, and directly above one. Between them these
   *  put the divider's air on the side it belongs to; see `gapTop` below. */
  firstOfDay?: boolean;
  lastOfDay?: boolean;
  onRetry: (m: Message) => void;
  onLongPress: (m: Message) => void;
  onReply: (m: Message) => void;
  onRemoveReaction: (m: Message) => void;
  onOpenReadLog: (m: Message) => void;
}) {
  const { c } = useTheme();
  const mine = message.direction === "out";

  /**
   * The air around a bubble, including the air a date divider needs.
   *
   * A divider says "everything from here is a new day", so it belongs to what
   * follows it — it should sit close under nothing and close *over* the first
   * message of its day. It was the other way round: 12pt above, 22pt below,
   * which read as the date trailing the conversation it had just ended rather
   * than heading the one it was starting.
   *
   * The correction is here rather than on the divider's own padding because the
   * divider is sticky: padding travels with it, so putting 20pt on top of the
   * pill would leave a 20pt hole under the header for as long as that day is on
   * screen. A margin on the message before it scrolls away like everything else.
   */
  const gapTop = firstOfDay ? 0 : continues ? 2 : 10;
  const gapBottom = lastOfDay ? 16 : 0;
  /** Height of the bubble alone — not the row, which also carries the gap above
   *  and any reaction chip below. The swipe-to-reply arrow lines up with this. */
  const [bubbleH, setBubbleH] = useState(0);

  if (message.internal) {
    const byMe = message.authorUserId === meId;
    return (
      <Animated.View
        testID={`msg-${message.id}`}
        entering={enter.row}
        className={byMe ? "items-end" : "items-start"}
        style={{ marginTop: gapTop, marginBottom: gapBottom }}
      >
        <View style={{ backgroundColor: c.amberTint, borderColor: c.amber, maxWidth: "86%" }} className="rounded-16 border px-3.5 py-2.5">
          {!continues ? (
            <Text style={{ color: c.amber }} className="pb-1 text-2xs font-semibold uppercase tracking-wide">
              Internal note · {message.authorName ?? "Teammate"}
            </Text>
          ) : null}
          <NoteBody body={message.body} color={c.amber} />
          <Attachments items={message.attachments ?? []} mine />
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
  /**
   * Who is talking, split the way the web splits it.
   *
   * Inbound gets a name above the run — in a group that's essential, and in a
   * 1:1 it's what makes an imported or forwarded message attributable. Outbound
   * gets its author in the stamp row instead (`sentBy` below): a shared inbox
   * has several agents replying into one thread, and without a name every reply
   * reads as "the business" — you can't tell your own from a colleague's, which
   * is the first thing you need to know before answering a customer.
   *
   * Two different placements because they're two different questions. Inbound is
   * "who is this?", which you need before reading. Outbound is "who handled
   * this?", which is metadata and belongs next to the time.
   */
  const senderName = !mine ? (message.authorName ?? (channel === "whatsapp_group" ? contactName : null)) : null;
  const sentBy = mine && !message.internal ? (message.authorName ?? null) : null;
  /**
   * Email is drawn as paper, not as speech.
   *
   * The web makes the same split: an email bubble drops the outbound green tint
   * and becomes a lifted card in both directions, because an email you sent and
   * an email you received are the same kind of object — a document with a
   * subject and recipients — and tinting one of them green makes a mixed thread
   * lie about which of the two you're reading.
   *
   * `elevated` rather than the web's literal `#fff`: the web is showing the
   * sender's own HTML, which is authored for a white page, so it pins the card
   * white even in dark mode. This app re-renders the email in its own type
   * through {@link EmailBody}, so the card follows the theme — pinning it white
   * would leave dark text on a dark ground everywhere except the card.
   */
  const fill = isEmail ? c.elevated : mine ? c.brandTint : c.surface;
  const line = isEmail ? c.border : mine ? c.brandTint : c.border;
  /**
   * A tail marks speech, so only conversation gets one — and only where a turn
   * *ends*, which is what makes a run of five messages read as one person
   * talking rather than five separate cards. Last of the run, bottom outer
   * corner: the same rule and the same corner as the web, because the two
   * clients showing one thread differently is worse than either choice.
   *
   * Email is deliberately excluded. An email isn't an utterance, it's a
   * document: it has a subject, recipients and a signature, and drawing it as a
   * speech bubble makes a mixed thread lie about which of the two you're
   * looking at. It gets width instead, since that's what its content needs.
   */
  const tailed = endsRun && !isEmail;

  return (
    <SwipeToReply
      onReply={() => onReply(message)}
      mine={mine}
      enabled={canSwipe}
      anchorCenter={bubbleH ? gapTop + bubbleH / 2 : 0}
    >
    <Animated.View
      testID={`msg-${message.id}`}
      entering={enter.row}
      className={mine ? "items-end" : "items-start"}
      style={{ marginTop: gapTop, marginBottom: gapBottom }}
    >
      <Pressable
        onLayout={(e) => setBubbleH(e.nativeEvent.layout.height)}
        onLongPress={() => onLongPress(message)}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityLabel={`Message: ${message.body || "attachment"}. Long press for actions.`}
        style={{
          backgroundColor: fill,
          borderColor: line,
          maxWidth: isEmail ? "94%" : "86%",
          // The lift that makes the email card read as paper laid on the thread
          // rather than another bubble in it. In light mode the surfaces are the
          // same white, so this shadow is the whole of the distinction.
          ...(isEmail ? elevation.card : null),
          // The tailed corner squares off. A tail growing out of a 16pt curve
          // leaves a visible sliver of background between the two shapes; at 5pt
          // they read as one outline.
          ...(tailed
            ? mine
              ? { borderBottomRightRadius: tailCorner }
              : { borderBottomLeftRadius: tailCorner }
            : null),
        }}
        className="rounded-16 border px-3.5 py-2.5"
      >
        {tailed ? <Tail mine={mine} fill={fill} stroke={line} /> : null}

        {/* Who is talking, above the first bubble of each run.
            
            Outbound needs this as much as inbound: a shared inbox has several
            agents replying into the same thread, and without a name every reply
            reads as "the business" — you can't tell your own message from a
            colleague's, which is exactly what you need to know before you answer
            a customer. The customer's own name is redundant in a 1:1 (the header
            already says who they are), so it's shown only in a group, where
            several people speak from that side. */}
        {!continues && senderName ? (
          <Text style={{ color: c.group }} className="pb-0.5 text-2xs font-semibold">
            {senderName}
          </Text>
        ) : null}

        {/* WhatsApp's "Forwarded" tell, above the content it qualifies: these
            aren't the sender's own words. Kept at the weight of the timestamp so
            it reads as chrome rather than as part of the message. */}
        {message.forwarded ? (
          <View className="flex-row items-center gap-1 pb-1">
            <ForwardIcon size={12} color={c.textFaint} />
            <Text style={{ color: c.textFaint }} className="text-2xs italic">
              Forwarded
            </Text>
          </View>
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
          <EmailBody message={message} showSubject={showSubject} />
        ) : message.body ? (
          <Text className="text-lg leading-snug text-fg">{message.body}</Text>
        ) : null}
        <Attachments items={message.attachments ?? []} mine={mine} />

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
          {/* "Sent by Nathan A ·" — the same place and the same wording the web
              uses, so a thread read on a phone attributes replies identically to
              one read at a desk. Capped so a long name can't push the time and
              ticks off the end of a narrow bubble. */}
          {sentBy ? (
            <Text numberOfLines={1} className="max-w-[140px] text-2xs text-faint">
              Sent by {sentBy} ·
            </Text>
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
