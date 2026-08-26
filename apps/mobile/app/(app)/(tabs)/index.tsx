import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { router } from "expo-router";
import {
  listTime,
  useConversations,
  useRefresh,
  useSearchConversations,
  useSession,
  useTeams,
  useViews,
} from "@ding/client";
import type { Conversation } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { ChannelDot } from "../../../src/components/ChannelDot";
import { ViewSwitcher } from "../../../src/components/ViewSwitcher";
import { PushGate, useDelayedPrompt } from "../../../src/components/PushGate";
import { EmptyState, QueryState } from "../../../src/components/States";
import { clearBadge, usePushRegistration } from "../../../src/push";
import { haptics } from "../../../src/haptics";
import { ChevronRight, PlusIcon, SearchIcon } from "../../../src/icons";
import { rowIn, spring, springTo } from "../../../src/motion";
import { useTheme } from "../../../src/theme";
import { useInsets } from "../../../src/insets";

/**
 * Narrowing applied on top of the chosen view, client-side — the web's set,
 * exactly. These are filters, not navigation: they narrow whatever view you're
 * in. The views themselves live in the switcher, reached from the title.
 *
 * Two of the six are conditional, for the same reason they are on the web: a
 * filter that can only ever return everything or nothing is noise. "Yours" only
 * means something in a shared inbox where several agents' conversations sit
 * together; in "Mine" it is the whole view, and in "Queue" it is empty by
 * definition. "Groups" appears only once there is a group to filter to.
 *
 * Closed is the odd one out and has to be. A resolved conversation is excluded
 * from every other filter — including All, which means "all the live ones",
 * because a shift's worth of resolved threads at the top of the inbox is how
 * you lose the one that still needs you.
 */
type FilterKey = "all" | "unread" | "mine" | "unassigned" | "groups" | "closed";

function matchesFilter(c: Conversation, f: FilterKey, myId?: string): boolean {
  const closed = c.status === "closed";
  if (f === "closed") return closed;
  if (closed) return false;
  if (f === "unread") return c.unreadCount > 0 || c.unread;
  if (f === "mine") return c.assigneeUserId === myId;
  if (f === "unassigned") return !c.assigneeUserId;
  if (f === "groups") return c.channel === "whatsapp_group";
  return true;
}

/**
 * One conversation in the list.
 *
 * Memoised because the parent re-renders on every keystroke in the search
 * field, and FlatList recycling doesn't help with that: the rows are already
 * mounted, they just get new props. `conv` only changes when that conversation
 * changes, and `onPress` is stable, so a search that matches nothing still
 * costs nothing to type.
 *
 * `teamName` arrives already resolved, as a string, for the same reason —
 * handing every row the teams array would give it a new prop identity on each
 * refetch and defeat the memo for a value that almost never changes.
 */
const Row = memo(function Row({
  conv,
  teamName,
  mine,
  onPress,
}: {
  conv: Conversation;
  /** The team this conversation is routed to, or undefined to omit it — inside
   *  a team's own inbox it's the same word on every row. */
  teamName?: string;
  /** Whether this one is assigned to the signed-in agent. A boolean rather than
   *  the user id, so the memo isn't defeated by a prop only one row cares
   *  about changing. */
  mine: boolean;
  onPress: (id: string) => void;
}) {
  const { c } = useTheme();
  const unread = conv.unreadCount > 0 || conv.unread;
  const overdue = !!conv.slaDueAt && new Date(conv.slaDueAt).getTime() < Date.now() && conv.status !== "closed";
  return (
    <Pressable
      onPress={() => onPress(conv.id)}
      accessibilityRole="button"
      accessibilityLabel={`${conv.contact.displayName}. ${conv.preview ?? ""}`}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
    >
      <Avatar name={conv.contact.displayName} color={conv.contact.avatarColor} size={52} />

      <View className="flex-1 gap-1">
        {/* Name, then the channel glyph, then the time — the web's order. The
            glyph sits with the name because it says what this thread *is*. */}
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className={`flex-shrink text-lg ${unread ? "font-semibold text-fg" : "font-medium text-fg"}`}>
            {conv.contact.displayName}
          </Text>
          <ChannelDot channel={conv.lastChannel ?? conv.channel} />
          {/* A spacer rather than `ml-auto` on the time, so the glyph keeps
              hugging the name. Auto margins cost us the action sheet's position
              on Android once; they're not worth a second look. */}
          <View className="flex-1" />
          <Text className={`text-xs ${unread ? "font-semibold text-brand" : "text-faint"}`}>
            {listTime(conv.lastActivityAt)}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className={`flex-1 text-md ${unread ? "text-fg" : "text-muted"}`}>
            {conv.preview || "No messages yet"}
          </Text>
          {conv.unreadCount > 0 ? (
            <View style={{ backgroundColor: c.brand }} className="min-w-[20px] items-center rounded-full px-1.5 py-0.5">
              <Text className="text-2xs font-bold text-white">{conv.unreadCount}</Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          {/* Ownership: a dot you can scan down the column, then the label —
              the web's `.convmeta__own`. The dot is what makes the assignee
              read as a *state* of the row rather than more description of it,
              and it's the difference between this and the team beside it. */}
          <View className="flex-row items-center gap-1.5">
            <View
              style={{ backgroundColor: mine ? c.brand : conv.assigneeUserId ? c.textMuted : c.textFaint }}
              className="h-1.5 w-1.5 flex-none rounded-full"
            />
            <Text
              style={{ color: mine ? c.brandStrong : c.textMuted }}
              className={`text-2xs ${mine ? "font-semibold" : "font-medium"}`}
            >
              {/* First name only. "Assigned to" is the same three words on every
                  row, and at this size the name is the only part carrying
                  anything — the web reached the same conclusion. */}
              {mine ? "Yours" : (conv.assigneeName?.split(" ")[0] ?? "Queue")}
            </Text>
          </View>
          {/* Where it was routed. Deliberately quieter and dotless: the team is
              context for the row, not a state of it. Same split the web makes
              — ownership gets colour and a marker, routing gets neither.
              Shrinks and truncates rather than pushing "Overdue" off the row. */}
          {teamName ? (
            <Text numberOfLines={1} className="min-w-0 shrink text-2xs text-faint">
              {teamName}
            </Text>
          ) : null}
          {conv.status === "snoozed" ? <Text className="text-2xs text-faint">· Snoozed</Text> : null}
          {overdue ? <Text style={{ color: c.danger }} className="text-2xs font-medium">Overdue</Text> : null}
          {conv.labels?.slice(0, 2).map((l) => (
            <View key={l.id} style={{ backgroundColor: l.color }} className="h-1.5 w-1.5 rounded-full" />
          ))}
        </View>
      </View>
    </Pressable>
  );
});

export default function Inbox() {
  const insets = useInsets();
  const { c } = useTheme();
  const [view, setView] = useState<string>("inbound");
  const [switcher, setSwitcher] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  // Keep typing responsive: the request follows the keystrokes rather than
  // blocking on them.
  const search = useDeferredValue(query.trim());
  const searching = search.length > 0;

  const session = useSession();
  const views = useViews();
  const teams = useTeams();
  const list = useConversations(view);
  // Scoped to the inbox the field is sitting in, as on the web.
  const found = useSearchConversations(search, searching, view);
  const { refresh, refreshing } = useRefresh();

  // Push: register on every start, and ask once the inbox has something on it.
  const push = usePushRegistration(!!session.data?.user);
  const [askedThisRun, setAskedThisRun] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const promptDue = useDelayedPrompt(!list.isLoading && !!session.data?.user);

  useEffect(() => {
    if (!push.supported || !promptDue || askedThisRun || push.granted || push.status === null) return;
    // Only ever put our own sheet up once per install; after that the answer
    // lives in OS settings, where nagging can't reach it anyway.
    void push.hasAsked().then((asked) => {
      if (!asked) setShowGate(true);
    });
  }, [promptDue, askedThisRun, push]);

  // The badge counts what's waiting in this list. Looking at the list is
  // reading it, so the icon shouldn't keep claiming otherwise.
  useEffect(() => {
    if (!list.isLoading) void clearBadge();
  }, [list.isLoading, view]);

  // The chosen view's own name and count, for the header. Looked up across every
  // section because the switcher can select a team, a channel or a label — not
  // just one of "my" views.
  const current = useMemo(() => {
    const all = [
      ...(views.data?.my ?? []),
      ...(views.data?.shared.teams ?? []),
      ...(views.data?.shared.inboxes ?? []),
      ...(views.data?.shared.labels ?? []),
    ];
    return all.find((v) => v.key === view);
  }, [views.data, view]);
  const viewTitle = current?.title ?? "Inbox";
  const viewCount = current?.count;

  // Stable, so <Row>'s memo isn't defeated by a new arrow on every render.
  // The row knows its own id, so the handler doesn't need to close over it.
  const openThread = useCallback(
    (id: string) => router.push({ pathname: "/(app)/thread/[id]", params: { id } }),
    [],
  );

  const active = searching ? found : list;
  const myId = session.data?.user?.id;
  const items = useMemo(
    () => (active.data ?? []).filter((conv) => (searching ? true : matchesFilter(conv, filter, myId))),
    [active.data, filter, searching, myId],
  );

  /**
   * The filter row, and the number on each chip.
   *
   * The counts are the point — without them the chips are guesses, and you tap
   * through all of them to find out which one has anything in it. They're
   * computed from the view's loaded rows rather than asked of the server, which
   * is honest as far as it goes: it's the same data the list is showing, so the
   * number always matches what tapping the chip produces.
   */
  const filters = useMemo(() => {
    const all = list.data ?? [];
    // Everything except Closed counts live conversations only, matching what
    // the filters actually return.
    const live = all.filter((x) => x.status !== "closed");
    const hasGroups = live.some((x) => x.channel === "whatsapp_group");
    const showMine = view.startsWith("team:") || view.startsWith("inbox:");
    const showUnassigned = view !== "mine" && view !== "grabs";

    const defs: { key: FilterKey; label: string; on: boolean }[] = [
      { key: "all", label: "All", on: true },
      { key: "unread", label: "Unread", on: true },
      { key: "mine", label: "Yours", on: showMine },
      { key: "unassigned", label: "Unassigned", on: showUnassigned },
      { key: "groups", label: "Groups", on: hasGroups },
      { key: "closed", label: "Closed", on: true },
    ];
    return defs
      .filter((d) => d.on)
      .map((d) => ({
        ...d,
        count: (d.key === "closed" ? all : live).filter((x) => matchesFilter(x, d.key, myId)).length,
      }));
  }, [list.data, view, myId]);

  // A filter that's just disappeared — the last group closed, or you switched to
  // a view where "Yours" is meaningless — would otherwise leave the list stuck
  // on a chip that's no longer on screen.
  useEffect(() => {
    if (!filters.some((f) => f.key === filter)) setFilter("all");
  }, [filters, filter]);

  /**
   * Which team each conversation was routed to.
   *
   * Suppressed inside a team's own inbox, where it would be the same word on
   * every row — the view title already says it. Everywhere else it's the
   * answer to "why is this in front of me", which on a shared inbox is the
   * thing you most want to know before opening anything.
   *
   * Resolved to a name here rather than in the row so each row gets a plain
   * string: the teams query returns a new array on every refetch, and passing
   * it down would re-render every row for a list that changes about once a
   * month.
   */
  const teamFor = useMemo(() => {
    if (view.startsWith("team:")) return () => undefined;
    const byId = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
    return (conv: Conversation) => (conv.assignedTeamId ? byId.get(conv.assignedTeamId) : undefined);
  }, [teams.data, view]);

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      {/* The title IS the inbox switcher — tap it to change view, the way Front
          does and the way the web's sidebar works. The chevron is the only cue
          that says so, so it stays visible rather than appearing on press. */}
      <View className="flex-row items-center justify-between px-4 pb-3 pt-3">
        <Pressable
          onPress={() => {
            haptics.select();
            setSwitcher(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${viewTitle}. Change inbox`}
          hitSlop={8}
          className="flex-1 flex-row items-center gap-1.5 active:opacity-60"
        >
          <View className="flex-shrink">
            <View className="flex-row items-center gap-1.5">
              <Text
                numberOfLines={1}
                accessibilityRole="header"
                className="text-2xl font-semibold tracking-tight text-fg"
              >
                {viewTitle}
              </Text>
              <View style={{ transform: [{ rotate: "90deg" }] }}>
                <ChevronRight size={16} color={c.textMuted} />
              </View>
            </View>
            <Text numberOfLines={1} className="pt-0.5 text-sm text-muted">
              {viewCount != null ? `${viewCount} open · ` : ""}
              {session.data?.user?.name ?? ""}
            </Text>
          </View>
        </Pressable>

        {/* Start one, rather than only ever answering one. Beside the title
            because that's where the inbox's own actions belong, and filled
            because it's the only thing on this screen that creates something
            rather than navigating to it. */}
        <Pressable
          onPress={() => {
            haptics.select();
            router.push("/(app)/compose");
          }}
          accessibilityRole="button"
          accessibilityLabel="New conversation"
          hitSlop={10}
          style={{ backgroundColor: c.brand }}
          className="h-10 w-10 flex-none items-center justify-center rounded-full active:opacity-80"
        >
          <PlusIcon size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Search carries its glyph inside the field, as on the web — the icon is
          what makes it read as search before you've typed anything. */}
      <View className="px-4 pb-3">
        <View
          style={{ backgroundColor: c.surface2 }}
          className="flex-row items-center gap-2 rounded-full px-3.5"
        >
          <SearchIcon size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations & messages"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-lg"
          />
        </View>
      </View>

      {searching ? null : (
        // Six chips with counts don't fit across a phone, and dropping some to
        // make them fit is how the row stopped matching the web in the first
        // place. It scrolls instead — the first two are the ones reached for
        // most, so nothing important starts off-screen.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          // Sized by its chips, not capped at a number. `max-h-11` was 44pt,
          // which fits a 28pt chip at the default font size and stops fitting
          // the moment the phone's text size is turned up — the row then clips
          // its own chips and reads as the list cutting into the filters.
          // `flex-none` so a long list below can't squeeze it either.
          className="flex-none pb-2.5"
        >
          {filters.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              count={f.count}
              active={f.key === filter}
              onPress={() => {
                haptics.select();
                setFilter(f.key);
              }}
              subtle
            />
          ))}
        </ScrollView>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        // Only the first screenful cascades in. Rows past it mount as you
        // scroll, and animating those means every flick brings a wave of
        // fading rows — which reads as the list struggling to keep up rather
        // than as polish.
        renderItem={({ item, index }) => {
          const row = (
            <Row
              conv={item}
              teamName={teamFor(item)}
              mine={!!myId && item.assigneeUserId === myId}
              onPress={openThread}
            />
          );
          return index < 8 ? <Animated.View entering={rowIn(index)}>{row}</Animated.View> : row;
        }}
        ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-[80px] h-px" />}
        // The same omission the thread had: without `flex: 1` the list is as
        // tall as its rows rather than as tall as the space left for it, so a
        // busy inbox lays out past the bottom of the screen instead of
        // scrolling inside itself.
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardDismissMode="on-drag"
        // A shared inbox is read by pulling. `useRefresh` also fetches any new
        // Gmail on demand, so the gesture means "check now", not just "refetch".
        refreshControl={
          searching ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.brand} />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (active.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage();
        }}
        ListFooterComponent={active.isFetchingNextPage ? <ActivityIndicator color={c.brand} className="py-4" /> : null}
        ListEmptyComponent={
          // Error before empty, always: a failed request has no items either,
          // and "Nothing here" over a dead connection tells someone their inbox
          // is clear when in fact nobody knows.
          <QueryState
            query={active}
            what={searching ? "search results" : "your inbox"}
            empty={
              searching ? (
                <EmptyState icon="search" title="No matches" body={`Nothing matching “${search}”.`} />
              ) : filter !== "all" ? (
                <EmptyState
                  title="Nothing matches that filter"
                  body="This view has conversations, but none of them are in this state."
                  action={{ label: "Show all", onPress: () => setFilter("all") }}
                />
              ) : view === "grabs" ? (
                <EmptyState title="Nothing up for grabs" body="Everything in the shared inboxes has someone on it." />
              ) : (
                <EmptyState
                  title="You're all clear"
                  body="Nothing needs you right now — pull down to check for new messages."
                />
              )
            }
          />
        }
      />

      <PushGate
        visible={showGate}
        onAllow={() => {
          setShowGate(false);
          setAskedThisRun(true);
          void push.requestPermission();
        }}
        onDismiss={() => {
          setShowGate(false);
          setAskedThisRun(true);
        }}
      />

      <ViewSwitcher
        visible={switcher}
        view={view}
        onSelect={setView}
        onOpenConversation={(id) => router.push({ pathname: "/(app)/thread/[id]", params: { id } })}
        onClose={() => setSwitcher(false)}
      />
    </View>
  );
}

function Chip({
  label,
  count,
  active,
  subtle,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  subtle?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  // Pressing gives under the finger and springs back. On a control this small
  // it's most of what tells you the tap registered — the colour change lands
  // afterwards, once the list has re-filtered.
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          press.value = springTo(0.94, spring.quick);
        }}
        onPressOut={() => {
          press.value = springTo(1, spring.base);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        // A chip is 26pt tall on purpose — it's a narrow row under the search
        // field, and a 44pt pill would dominate it. The slop makes the *target*
        // 44 without making the chip look like a button.
        hitSlop={{ top: 9, bottom: 9, left: 4, right: 4 }}
        style={{ backgroundColor: active ? c.brandTint : c.surface2 }}
        className={`flex-row items-center gap-1.5 rounded-full px-3.5 ${subtle ? "py-1.5" : "py-2"}`}
      >
        <Text
          style={{ color: active ? c.brandStrong : c.textMuted }}
          className={`${subtle ? "text-xs" : "text-sm"} ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </Text>
        {count ? (
          <Text style={{ color: active ? c.brandStrong : c.textFaint }} className="text-2xs font-semibold">
            {count}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
