import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAnalytics } from "@ding/client";
import type { AnalyticsRange } from "@ding/schemas";
import { Avatar } from "../../../src/components/Avatar";
import { channelColor, channelMeta } from "../../../src/icons";
import { useTheme } from "../../../src/theme";

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

/** Milliseconds → the shortest honest reading: "3m", "1h 12m", "—" when there
 *  is nothing to average. */
function duration(ms: number | null): string {
  if (ms == null) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/** A change against the previous window, as a signed percentage. Null when the
 *  previous window was empty — "+∞%" tells nobody anything. */
function delta(now: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/**
 * Insights on a phone — the headline numbers, not the web's full dashboard.
 *
 * A manager checking in from a phone wants to know whether today is going
 * wrong: how much came in, how fast it was answered, what's still open, and who
 * is carrying it. The web keeps the charts that reward study — the heatmap, the
 * daily series, the response-time distribution — because those need a screen
 * you can scan across, not scroll down.
 */
export default function Insights() {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const { data, isLoading } = useAnalytics({ range, channel: "all", teamId: "all", agentUserId: "all" });

  const k = data?.kpis;

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
    >
      <Text className="px-4 pb-2 text-2xl font-semibold tracking-tight text-fg">Insights</Text>

      <View className="flex-row gap-2 px-4 pb-3">
        {RANGES.map((r) => {
          const on = r.key === range;
          return (
            <Pressable
              key={r.key}
              onPress={() => setRange(r.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={{ backgroundColor: on ? c.brandTint : c.surface2 }}
              className="rounded-full px-3.5 py-1.5 active:opacity-70"
            >
              <Text
                style={{ color: on ? c.brandStrong : c.textMuted }}
                className={`text-sm ${on ? "font-semibold" : "font-medium"}`}
              >
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading || !data || !k ? (
        <ActivityIndicator color={c.brand} className="py-12" />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2 px-4">
            <Kpi label="Conversations" value={String(k.conversations)} change={delta(k.conversations, k.prev.conversations)} />
            <Kpi label="Messages" value={String(k.messages)} change={delta(k.messages, k.prev.messages)} />
            <Kpi
              label="Median first reply"
              value={duration(k.medianFirstResponseMs)}
              // Faster is better, so the sign is inverted before it's shown.
              change={
                k.avgFirstResponseMs != null && k.prev.avgFirstResponseMs
                  ? -(delta(k.avgFirstResponseMs, k.prev.avgFirstResponseMs) ?? 0)
                  : null
              }
            />
            <Kpi label="New customers" value={String(k.newContacts)} change={delta(k.newContacts, k.prev.newContacts)} />
          </View>

          <Section>Right now</Section>
          <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border">
            <StatRow label="Open" value={data.snapshot.open} />
            <StatRow label="Unassigned" value={data.snapshot.unassigned} warn={data.snapshot.unassigned > 0} />
            <StatRow label="Snoozed" value={data.snapshot.snoozed} />
            <StatRow label="Resolved" value={data.snapshot.closed} last />
          </View>

          {data.byChannel.length ? (
            <>
              <Section>By channel</Section>
              <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border">
                {data.byChannel.map((row, i) => {
                  const Glyph = channelMeta(row.channel).Glyph;
                  return (
                    <View
                      key={row.channel}
                      style={{ borderBottomColor: i === data.byChannel.length - 1 ? "transparent" : c.border }}
                      className={`flex-row items-center gap-2.5 px-4 py-3 ${i === data.byChannel.length - 1 ? "" : "border-b"}`}
                    >
                      <Glyph size={16} color={channelColor(row.channel, c)} />
                      <Text className="flex-1 text-md font-medium text-fg">{channelMeta(row.channel).label}</Text>
                      <Text className="text-md tabular-nums text-muted">{row.conversations}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {data.agents.length ? (
            <>
              <Section>Agents</Section>
              <View style={{ backgroundColor: c.surface, borderColor: c.border }} className="mx-4 rounded-16 border">
                {data.agents.slice(0, 8).map((a, i, arr) => (
                  <View
                    key={a.userId}
                    style={{ borderBottomColor: i === arr.length - 1 ? "transparent" : c.border }}
                    className={`flex-row items-center gap-3 px-4 py-2.5 ${i === arr.length - 1 ? "" : "border-b"}`}
                  >
                    <Avatar name={a.name} color={a.avatarColor} size={30} />
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-md font-medium text-fg">
                        {a.name}
                      </Text>
                      <Text className="text-2xs text-muted">
                        {a.replies} {a.replies === 1 ? "reply" : "replies"} · {duration(a.avgFirstResponseMs)} to first
                      </Text>
                    </View>
                    <Text className="text-md tabular-nums text-muted">{a.conversations}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text className="px-5 pt-4 text-2xs text-faint">
            Charts, the activity heatmap and per-label breakdowns are on the web.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function Section({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <Text
      style={{ color: c.textFaint }}
      className="px-5 pb-1.5 pt-6 text-2xs font-semibold uppercase tracking-wider"
    >
      {children}
    </Text>
  );
}

function Kpi({ label, value, change }: { label: string; value: string; change: number | null }) {
  const { c } = useTheme();
  const up = (change ?? 0) > 0;
  return (
    <View
      style={{ backgroundColor: c.surface, borderColor: c.border }}
      className="min-w-[46%] flex-1 rounded-16 border p-3.5"
    >
      <Text className="text-2xs font-medium text-muted">{label}</Text>
      <Text className="mt-0.5 text-2xl font-semibold tabular-nums text-fg">{value}</Text>
      {change != null ? (
        <Text style={{ color: up ? c.brandStrong : c.amber }} className="text-2xs font-medium">
          {up ? "▲" : "▼"} {Math.abs(change)}% vs previous
        </Text>
      ) : (
        <Text className="text-2xs text-faint">no prior period</Text>
      )}
    </View>
  );
}

function StatRow({ label, value, warn, last }: { label: string; value: number; warn?: boolean; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{ borderBottomColor: last ? "transparent" : c.border }}
      className={`flex-row items-center px-4 py-3 ${last ? "" : "border-b"}`}
    >
      <Text className="flex-1 text-md font-medium text-fg">{label}</Text>
      <Text
        style={{ color: warn ? c.amber : c.textMuted }}
        className="text-md font-semibold tabular-nums"
      >
        {value}
      </Text>
    </View>
  );
}
