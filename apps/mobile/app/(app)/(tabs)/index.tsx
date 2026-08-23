import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  listTime,
  useConversations,
  useRefresh,
  useSearchConversations,
  useSession,
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
import { ChevronRight, SearchIcon } from "../../../src/icons";
import { useTheme } from "../../../src/theme";

/** Narrowing applied on top of the chosen view, client-side — the same three
 *  the web offers, and the ones you actually reach for mid-shift. These are
 *  filters, not navigation: they narrow whatever view you're in. The views
 *  themselves live in the switcher, reached from the title. */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "unassigned", label: "Unassigned" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function matchesFilter(c: Conversation, f: FilterKey): boolean {
  if (f === "unread") return c.unreadCount > 0 || c.unread;
  if (f === "unassigned") return !c.assigneeUserId;
  return true;
}

function Row({ conv, onPress }: { conv: Conversation; onPress: () => void }) {
  const { c } = useTheme();
  const unread = conv.unreadCount > 0 || conv.unread;
  const overdue = !!conv.slaDueAt && new Date(conv.slaDueAt).getTime() < Date.now() && conv.status !== "closed";
  return (
    <Pressable
      onPress={onPress}
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
          <Text className={`ml-auto text-xs ${unread ? "font-semibold text-brand" : "text-faint"}`}>
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
          <Text className="text-2xs text-faint">
            {conv.assigneeName ? `Assigned to ${conv.assigneeName}` : "Unassigned"}
          </Text>
          {conv.status === "snoozed" ? <Text className="text-2xs text-faint">· Snoozed</Text> : null}
          {overdue ? <Text style={{ color: c.danger }} className="text-2xs font-medium">Overdue</Text> : null}
          {conv.labels?.slice(0, 2).map((l) => (
            <View key={l.id} style={{ backgroundColor: l.color }} className="h-1.5 w-1.5 rounded-full" />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

export default function Inbox() {
  const insets = useSafeAreaInsets();
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
  const list = useConversations(view);
  const found = useSearchConversations(search, searching);
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

  const active = searching ? found : list;
  const items = useMemo(
    () => (active.data ?? []).filter((conv) => (searching ? true : matchesFilter(conv, filter))),
    [active.data, filter, searching],
  );

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      {/* The title IS the inbox switcher — tap it to change view, the way Front
          does and the way the web's sidebar works. The chevron is the only cue
          that says so, so it stays visible rather than appearing on press. */}
      <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
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
              <Text numberOfLines={1} className="text-2xl font-semibold tracking-tight text-fg">
                {viewTitle}
              </Text>
              <View style={{ transform: [{ rotate: "90deg" }] }}>
                <ChevronRight size={16} color={c.textMuted} />
              </View>
            </View>
            <Text numberOfLines={1} className="text-sm text-muted">
              {viewCount != null ? `${viewCount} open · ` : ""}
              {session.data?.user?.name ?? ""}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Search carries its glyph inside the field, as on the web — the icon is
          what makes it read as search before you've typed anything. */}
      <View className="px-4 pb-2">
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
        <View className="flex-row gap-2 px-4 pb-2">
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              active={f.key === filter}
              onPress={() => {
                haptics.select();
                setFilter(f.key);
              }}
              subtle
            />
          ))}
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Row conv={item} onPress={() => router.push({ pathname: "/(app)/thread/[id]", params: { id: item.id } })} />
        )}
        ItemSeparatorComponent={() => <View style={{ backgroundColor: c.border }} className="ml-[80px] h-px" />}
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{ backgroundColor: active ? c.brandTint : c.surface2 }}
      className={`flex-row items-center gap-1.5 rounded-full px-3.5 ${subtle ? "py-1.5" : "py-2"} active:opacity-70`}
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
  );
}
