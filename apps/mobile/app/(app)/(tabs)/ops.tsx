import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { relativeTime, useOpsLibrary, useOpsStatus, useTeams } from "@ding/client";
import type { OpsFilter, OpsSopCard } from "@ding/schemas";
import { opsCardMatches, sortOpsCards } from "@ding/schemas";
import { OpsChip, OpsTile, SopFlags, teamsLabel } from "../../../src/components/OpsParts";
import { haptics } from "../../../src/haptics";
import { FilterChip } from "../../../src/components/FilterChip";
import { TabHeader } from "../../../src/components/TabHeader";
import { EmptyState, QueryState } from "../../../src/components/States";
import { TAB_BAR_H } from "../../../src/components/TabBar";
import { Touchable } from "../../../src/components/Touchable";
import { SearchIcon } from "../../../src/icons";
import { useInsets } from "../../../src/insets";
import { useTheme } from "../../../src/theme";

/**
 * Business Ops on the phone: the library of the workspace's SOPs for your
 * teams. Search, browse by collection, filter to must-reads, and open one to
 * read it, tick through it or confirm it. Writing SOPs stays on the web — it's
 * a long form with pictures and files, not a one-handed job.
 *
 * Only shown while the module is switched on (see the tabs layout).
 */
export default function Ops() {
  const insets = useInsets();
  const { c } = useTheme();
  const status = useOpsStatus();
  const canEdit = !!status.data?.canEdit;
  const teams = useTeams().data ?? [];
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const lib = useOpsLibrary(q, !!status.data?.enabled);
  const [filter, setFilter] = useState<OpsFilter>("all");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const all = lib.data?.sops ?? [];
  const collections = (lib.data?.collections ?? []).filter((col) => col.sopCount > 0 || canEdit);
  const shown = useMemo(() => sortOpsCards(all.filter((s) => opsCardMatches(s, filter, collectionId))), [all, filter, collectionId]);
  const waiting = status.data?.pendingAcks ?? 0;

  const filters: Array<{ key: OpsFilter; label: string; count?: number }> = [
    { key: "all", label: "All" },
    { key: "must_read", label: "Must read", count: waiting || undefined },
    ...(canEdit
      ? ([
          { key: "review", label: "Due for review" },
          { key: "drafts", label: "Drafts" },
        ] as const)
      : []),
  ];

  const open = (s: OpsSopCard) => router.push({ pathname: "/(app)/ops/[id]", params: { id: s.id } });

  return (
    <View style={{ backgroundColor: c.bg, paddingTop: insets.top }} className="flex-1">
      <TabHeader title="Business Ops" subtitle="How we do things — always the latest version" />

      <View className="px-4 pb-2">
        <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center gap-2 rounded-full px-3.5">
          <SearchIcon size={17} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search SOPs, steps and details"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search SOPs"
            style={{ color: c.text }}
            className="flex-1 py-2.5 text-lg"
          />
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={shown}
        keyExtractor={(s) => s.id}
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 + TAB_BAR_H, paddingHorizontal: 16, gap: 10 }}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            {waiting > 0 && filter !== "must_read" ? (
              <Touchable
                feel="row"
                onPress={() => {
                  setFilter("must_read");
                  setCollectionId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${waiting} must-read${waiting === 1 ? "" : "s"} waiting for you`}
                style={{ backgroundColor: c.amberTint, borderColor: c.amber }}
                className="flex-row items-center gap-3 rounded-16 border px-3.5 py-3"
              >
                <View style={{ backgroundColor: c.amber }} className="h-8 w-8 items-center justify-center rounded-full">
                  <Text className="text-md font-bold text-white">{waiting}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-md font-semibold text-fg">
                    {waiting === 1 ? "A must-read is waiting for you" : `${waiting} must-reads are waiting for you`}
                  </Text>
                  <Text className="text-sm text-muted">Read it through and confirm.</Text>
                </View>
              </Touchable>
            ) : null}

            {collections.length > 0 && !q ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }}>
                <View style={{ width: 8 }} />
                {collections.map((col) => {
                  const on = collectionId === col.id;
                  return (
                    <Touchable
                      key={col.id}
                      feel="chip"
                      onPress={() => setCollectionId(on ? null : col.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${col.name}, ${col.sopCount} SOP${col.sopCount === 1 ? "" : "s"}`}
                      style={{ backgroundColor: c.surface2, borderColor: on ? col.color : c.border }}
                      className="flex-row items-center gap-2.5 rounded-16 border py-2 pl-2 pr-3.5"
                    >
                      <OpsTile icon={col.icon} color={col.color} size={32} />
                      <View>
                        <Text className="text-md font-semibold text-fg">{col.name}</Text>
                        <Text className="text-2xs text-muted">{`${col.sopCount} SOP${col.sopCount === 1 ? "" : "s"}`}</Text>
                      </View>
                    </Touchable>
                  );
                })}
                <View style={{ width: 8 }} />
              </ScrollView>
            ) : null}

            {/* The same pills as the Inbox and Chat. */}
            <View className="flex-row flex-wrap gap-2">
              {filters.map((f) => (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  count={f.count}
                  active={filter === f.key}
                  onPress={() => {
                    haptics.select();
                    setFilter(f.key);
                  }}
                />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => <Card sop={item} teams={teamsLabel(item, teams)} onPress={() => open(item)} />}
        ListEmptyComponent={
          <QueryState
            query={lib}
            what="the SOP library"
            empty={
              q ? (
                <EmptyState icon="search" title="No matches" body={`Nothing matching “${q}”.`} />
              ) : all.length === 0 ? (
                <EmptyState
                  title="Nothing here yet"
                  body={
                    canEdit
                      ? "Write your first SOP on the web — it shows up here for every team it's for."
                      : "When an SOP is published for one of your teams, it shows up here."
                  }
                />
              ) : (
                <EmptyState title={filter === "must_read" ? "No must-reads" : "Nothing in this view"} />
              )
            }
          />
        }
      />
    </View>
  );
}

function Card({ sop, teams, onPress }: { sop: OpsSopCard; teams: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Touchable
      feel="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sop.title}${sop.needsMyAck ? ", please confirm" : ""}`}
      style={{ backgroundColor: c.surface, borderColor: c.border, borderTopColor: sop.color, borderTopWidth: 3 }}
      className="gap-2 overflow-hidden rounded-16 border p-3.5"
    >
      <View className="flex-row items-start gap-3">
        <OpsTile icon={sop.icon} color={sop.color} size={44} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={2} className="text-lg font-semibold leading-snug text-fg">
            {sop.title}
          </Text>
          {sop.summary ? (
            <Text numberOfLines={2} className="mt-0.5 text-sm text-muted">
              {sop.summary}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <SopFlags sop={sop} />
        <OpsChip label={teams} />
      </View>
      <View style={{ borderTopColor: c.border }} className="flex-row items-center gap-3 border-t pt-2">
        <Text className="text-2xs text-muted">{`${sop.stepCount} step${sop.stepCount === 1 ? "" : "s"}`}</Text>
        {sop.version > 0 ? <Text className="text-2xs text-muted">{`v${sop.version}`}</Text> : null}
        <Text style={{ color: c.textFaint }} className="ml-auto text-2xs">
          {`Updated ${relativeTime(sop.updatedAt)}`}
        </Text>
      </View>
    </Touchable>
  );
}
