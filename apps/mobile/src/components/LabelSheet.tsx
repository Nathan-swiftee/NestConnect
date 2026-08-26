import { Pressable, ScrollView, Text, View } from "react-native";
import { useLabels, useSetConversationLabels } from "@ding/client";
import type { ConversationWithMessages } from "@ding/schemas";
import { CheckIcon, XIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";

/**
 * The conversation's labels, off the thread's ⋯ menu.
 *
 * These were under the customer's face in the details sheet, which put them
 * beside the customer's tags and made the two look like the same idea. They
 * aren't: a tag says what kind of *customer* this is and follows them across
 * every thread; a label says what *this thread* is about and dies with it. The
 * ⋯ menu is where the rest of the this-conversation verbs already live —
 * resolve, snooze, assign — so it's where this belongs too.
 *
 * Applied immediately on tap. There's no Save because there's nothing to
 * batch: each label is its own decision and each is instantly reversible.
 */
export function LabelSheet({
  conv,
  visible,
  onClose,
}: {
  conv: ConversationWithMessages;
  visible: boolean;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { data: catalog } = useLabels();
  const setLabels = useSetConversationLabels();
  const applied = new Set((conv.labels ?? []).map((l) => l.id));

  function toggle(id: string) {
    const next = applied.has(id) ? [...applied].filter((x) => x !== id) : [...applied, id];
    setLabels.mutate({ id: conv.id, labelIds: next });
  }

  return (
    <Sheet visible={visible} onClose={onClose} padded={false}>
      <View className="flex-row items-center justify-between px-4 pb-3 pt-1">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
            Labels
          </Text>
          <Text className="text-2xs text-muted">What this conversation is about</Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ backgroundColor: c.surface2 }}
          className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
        >
          <XIcon size={16} color={c.textMuted} />
        </Pressable>
      </View>

      {/* `flexShrink: 1` — see Sheet.tsx. A workspace with thirty labels is
          exactly the case that stops scrolling without it. */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {catalog?.length ? (
          <View className="flex-row flex-wrap gap-2 px-4">
            {catalog.map((l) => {
              const on = applied.has(l.id);
              return (
                <Pressable
                  key={l.id}
                  onPress={() => toggle(l.id)}
                  disabled={setLabels.isPending}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={l.name}
                  style={{
                    backgroundColor: on ? (l.color ?? c.brand) + "22" : c.surface2,
                    borderColor: on ? (l.color ?? c.brand) : "transparent",
                  }}
                  className="flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-60"
                >
                  <View
                    style={{ backgroundColor: l.color ?? c.textFaint }}
                    className="h-2 w-2 rounded-full"
                  />
                  <Text
                    style={{ color: on ? c.text : c.textMuted }}
                    className={`text-sm ${on ? "font-semibold" : "font-medium"}`}
                  >
                    {l.name}
                  </Text>
                  {on ? <CheckIcon size={13} color={l.color ?? c.brand} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text className="px-5 pb-2 text-md text-muted">
            No labels yet — they're created in Settings on the web.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
