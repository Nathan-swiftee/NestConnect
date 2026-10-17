import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { chatReactors } from "@ding/client";
import type { ChatReaction } from "@ding/schemas";
import { mediaSource } from "../../api-config";
import { haptics } from "../../haptics";
import { useTheme } from "../../theme";
import { Avatar } from "../Avatar";
import { Sheet } from "../Sheet";
import { Touchable } from "../Touchable";

/**
 * Who reacted to a message — what WhatsApp opens when a reaction is tapped:
 * "All" and a tab per emoji, a row per person, yours first, and tapping yours
 * takes it back.
 */
export function ReactionsSheet({
  reactions,
  initial,
  people,
  meId,
  canRemove,
  onRemove,
  onClose,
}: {
  /** The message's reactions, live; null when closed. */
  reactions: ChatReaction[] | null;
  /** The emoji that was tapped, to open on its tab. */
  initial: string | null;
  people: Array<{ id: string; name: string; avatarColor?: string | null; avatarUrl?: string | null }>;
  meId: string | undefined;
  canRemove: boolean;
  onRemove: (emoji: string) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [picked, setPicked] = useState<{ for: string | null; tab: string | null } | null>(null);
  const list = reactions ?? [];
  // The tab tapped in this sheet, or the emoji it was opened on — "All" once
  // that emoji has gone (the last one was taken back).
  const wanted = picked && picked.for === initial ? picked.tab : initial;
  const tab = wanted && list.some((r) => r.emoji === wanted) ? wanted : null;
  const all = chatReactors(list, people, meId);
  const rows = tab ? all.filter((r) => r.emoji === tab) : all;
  const tabs: Array<{ key: string | null; label: string }> = [
    { key: null, label: `All ${all.length}` },
    ...list.map((r) => ({ key: r.emoji, label: `${r.emoji} ${r.userIds.length}` })),
  ];

  return (
    <Sheet visible={!!reactions && reactions.length > 0} onClose={onClose} closeLabel="Close reactions">
      <View style={{ flexShrink: 1 }}>
        <Text className="pb-2 text-lg font-semibold text-fg">Reactions</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} className="pb-2" style={{ flexGrow: 0 }}>
          {tabs.map((t) => {
            const on = t.key === tab;
            return (
              <Touchable
                key={t.key ?? "all"}
                feel="chip"
                onPress={() => setPicked({ for: initial, tab: t.key })}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={{ backgroundColor: on ? c.brandTint : c.surface2 }}
                className="rounded-full px-3 py-1.5"
              >
                <Text className={`text-sm font-semibold ${on ? "text-fg" : "text-muted"}`}>{t.label}</Text>
              </Touchable>
            );
          })}
        </ScrollView>
        <ScrollView style={{ flexShrink: 1, maxHeight: 380 }}>
          {rows.map((r) => {
            const removable = r.mine && canRemove;
            const row = (
              <>
                <Avatar name={r.name} size={36} photo={r.avatarUrl ? mediaSource(r.avatarUrl) : null} />
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-md font-semibold text-fg">
                    {r.mine ? "You" : r.name}
                  </Text>
                  {removable ? <Text className="text-2xs text-muted">Tap to remove</Text> : null}
                </View>
                <Text style={{ fontSize: 22 }}>{r.emoji}</Text>
              </>
            );
            return removable ? (
              <Touchable
                key={`${r.userId}:${r.emoji}`}
                feel="row"
                onPress={() => {
                  haptics.tap();
                  onRemove(r.emoji);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove your ${r.emoji} reaction`}
                className="flex-row items-center gap-3 py-2"
              >
                {row}
              </Touchable>
            ) : (
              <View key={`${r.userId}:${r.emoji}`} accessibilityLabel={`${r.name} reacted ${r.emoji}`} className="flex-row items-center gap-3 py-2">
                {row}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Sheet>
  );
}
