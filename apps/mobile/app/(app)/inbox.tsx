import { useDeferredValue, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  listTime,
  useConversations,
  useLogout,
  useRefresh,
  useSearchConversations,
  useSession,
  useViews,
} from "@ding/client";
import type { Conversation } from "@ding/schemas";
import { Avatar } from "../../src/components/Avatar";
import { ChannelDot } from "../../src/components/ChannelDot";
import { useTheme } from "../../src/theme";

/**
 * The views a phone opens on, and the order they're in.
 *
 * These keys are the server's, not new ones — the web sidebar offers the same
 * set plus mentions, labels and per-team inboxes. A phone gets the three an
 * agent actually works a shift from: everything waiting on me, the unclaimed
 * queue, and mine alone. `inbound` leads because it's the one that answers
 * "what needs me right now".
 */
const VIEWS = [
  { key: "inbound", label: "Inbound" },
  { key: "grabs", label: "Queue" },
  { key: "mine", label: "Mine" },
  { key: "snoozed", label: "Later" },
] as const;

/** Narrowing applied on top of the chosen view, client-side — the same three
 *  the web offers, and the ones you actually reach for mid-shift. */
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
      <View>
        <Avatar name={conv.contact.displayName} color={conv.contact.avatarColor} size={52} />
        <View className="absolute -bottom-0.5 -right-0.5">
          <ChannelDot channel={conv.lastChannel ?? conv.channel} />
        </View>
      </View>

      <View className="flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text numberOfLines={1} className={`flex-1 text-lg ${unread ? "font-semibold text-fg" : "font-medium text-fg"}`}>
            {conv.contact.displayName}
          </Text>
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
  const logout = useLogout();

  const counts = useMemo(() => {
    const all = [...(views.data?.my ?? []), ...(views.data?.shared.teams ?? []), ...(views.data?.shared.inboxes ?? [])];
    return Object.fromEntries(all.map((v) => [v.key, v.count]));
  }, [views.data]);

  const active = searching ? found : list;
  const items = useMemo(
    () => (active.data ?? []).filter((conv) => (searching ? true : matchesFilter(conv, filter))),
    [active.data, filter, searching],
  );

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-2">
        <View>
          <Text className="text-2xl font-semibold tracking-tight text-fg">Inbox</Text>
          <Text className="text-sm text-muted">{session.data?.user?.name ?? ""}</Text>
        </View>
        <Pressable
          onPress={() => logout.mutate()}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          className="rounded-full px-3 py-2 active:opacity-60"
        >
          <Text className="text-md font-medium text-muted">Sign out</Text>
        </Pressable>
      </View>

      <View className="px-4 pb-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations & messages"
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ color: c.text, backgroundColor: c.surface2 }}
          className="rounded-full px-4 py-2.5 text-lg"
        />
      </View>

      {searching ? null : (
        <>
          <View className="flex-row gap-2 px-4 pb-2">
            {VIEWS.map((v) => {
              const on = v.key === view;
              return (
                <Chip key={v.key} label={v.label} count={counts[v.key]} active={on} onPress={() => setView(v.key)} />
              );
            })}
          </View>
          <View className="flex-row gap-2 px-4 pb-2">
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} active={f.key === filter} onPress={() => setFilter(f.key)} subtle />
            ))}
          </View>
        </>
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
          active.isLoading ? (
            <ActivityIndicator color={c.brand} className="py-12" />
          ) : (
            <View className="items-center px-8 py-16">
              <Text className="text-lg font-medium text-fg">
                {searching ? "No matches" : "Nothing here"}
              </Text>
              <Text className="mt-1 text-center text-md text-muted">
                {searching
                  ? `Nothing matching “${search}”.`
                  : filter !== "all"
                    ? "Nothing in this view matches that filter."
                    : view === "grabs"
                      ? "Nothing is waiting to be picked up."
                      : "Nothing needs you right now — pull down to check for new messages."}
              </Text>
            </View>
          )
        }
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
