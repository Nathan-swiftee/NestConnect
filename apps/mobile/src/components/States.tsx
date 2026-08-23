import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AlertIcon, InboxIcon, ReopenIcon, SearchIcon } from "../icons";
import { useTheme } from "../theme";
import { haptics } from "../haptics";

/** A list that is still loading. Centred and quiet — a skeleton here would be
 *  pretending to know what's coming. */
export function Loading({ label }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? "Loading"} className="items-center py-12">
      <ActivityIndicator color={c.brand} />
      {label ? <Text className="mt-3 text-md text-muted">{label}</Text> : null}
    </View>
  );
}

/**
 * Nothing to show — and the reason why.
 *
 * An empty state that only says "Nothing here" makes the person wonder whether
 * the app is broken. Saying *why* it's empty, in the words of the thing they
 * were looking at, turns it into an answer: a filter that matched nothing reads
 * differently from an inbox that is genuinely clear, and only one of them is
 * good news.
 */
export function EmptyState({
  icon = "inbox",
  title,
  body,
  action,
}: {
  icon?: "inbox" | "search";
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  const Glyph = icon === "search" ? SearchIcon : InboxIcon;
  return (
    <View className="items-center px-8 py-16">
      <View
        style={{ backgroundColor: c.surface2 }}
        className="mb-3 h-14 w-14 items-center justify-center rounded-full"
      >
        <Glyph size={26} color={c.textFaint} />
      </View>
      <Text className="text-lg font-medium text-fg">{title}</Text>
      {body ? <Text className="mt-1 text-center text-md text-muted">{body}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          style={{ backgroundColor: c.surface2 }}
          className="mt-4 rounded-full px-4 py-2 active:opacity-60"
        >
          <Text style={{ color: c.brand }} className="text-md font-medium">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The request failed.
 *
 * Kept deliberately separate from {@link EmptyState}, because conflating them is
 * the bug: a list that renders "Nothing here" when the network is down tells
 * the person their inbox is clear when in fact nobody knows. Say it didn't
 * load, say what the server said if it said anything useful, and give them the
 * one thing they'd want — try again.
 */
export function ErrorState({
  error,
  onRetry,
  what = "this",
}: {
  error?: unknown;
  onRetry?: () => void;
  /** What failed, in the person's words: "your inbox", "this customer". */
  what?: string;
}) {
  const { c } = useTheme();
  // A network failure has no useful message, and "Failed to fetch" is worse
  // than nothing. Only surface what the server actually said.
  const detail =
    error instanceof Error && (error as { status?: number }).status ? error.message : undefined;
  return (
    <View className="items-center px-8 py-16">
      <View
        style={{ backgroundColor: c.amberTint }}
        className="mb-3 h-14 w-14 items-center justify-center rounded-full"
      >
        <AlertIcon size={26} color={c.amber} />
      </View>
      <Text className="text-lg font-medium text-fg">Couldn't load {what}</Text>
      <Text className="mt-1 text-center text-md text-muted">
        {detail ?? "Check your connection and try again."}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onRetry();
          }}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{ backgroundColor: c.surface2 }}
          className="mt-4 flex-row items-center gap-2 rounded-full px-4 py-2 active:opacity-60"
        >
          <ReopenIcon size={15} color={c.brand} />
          <Text style={{ color: c.brand }} className="text-md font-medium">
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The three states of a query, in the order they matter.
 *
 * Error before empty, always: a failed request has no data, so a component that
 * checks "is it empty" first reports an outage as good news.
 */
export function QueryState({
  query,
  what,
  empty,
  loadingLabel,
}: {
  query: { isLoading: boolean; isError: boolean; error?: unknown; refetch?: () => unknown };
  what: string;
  empty: React.ReactNode;
  loadingLabel?: string;
}) {
  if (query.isLoading) return <Loading label={loadingLabel} />;
  if (query.isError) {
    return <ErrorState error={query.error} what={what} onRetry={query.refetch ? () => query.refetch?.() : undefined} />;
  }
  return <>{empty}</>;
}
