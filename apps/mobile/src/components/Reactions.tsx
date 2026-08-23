import { Pressable, Text, View } from "react-native";
import type { Reaction } from "@ding/schemas";
import { useTheme } from "../theme";

/**
 * The reaction pill, as WhatsApp draws it.
 *
 * Three details make it read right, and all three are geometry rather than
 * decoration:
 *
 *  - It **overlaps** the bubble's bottom edge instead of sitting inside it. A
 *    pill drawn inside the bubble looks like part of the message; hanging off
 *    the edge is what says "someone added this afterwards".
 *  - It sits on the bubble's **outer** edge — left under an inbound bubble,
 *    right under an outbound one — inset a little from the corner, so it
 *    mirrors with the thread rather than drifting to a fixed side.
 *  - The fill is the neutral chip grey, and the ring is the *thread
 *    background*. So where the pill overlaps the bubble the ring separates the
 *    two, and where it hangs below, the ring vanishes into the background and
 *    the pill reads as cut out of the bubble's edge. A pill filled with the
 *    surface colour would disappear into an inbound bubble entirely, which is
 *    exactly what it did before.
 *
 * Ours is tappable to remove: sending the same emoji again clears it, which is
 * what the server does and what WhatsApp does.
 */
export function Reactions({
  reactions,
  mine,
  contactName,
  onRemove,
}: {
  reactions: Reaction[];
  /** Which side of the thread this bubble is on — the pill hangs off the outer
   *  bottom corner, so it mirrors. */
  mine: boolean;
  contactName: string;
  onRemove?: () => void;
}) {
  const { c } = useTheme();
  if (!reactions.length) return null;

  const ours = reactions.find((r) => r.by === "user");
  const label =
    reactions.map((r) => `${r.emoji} ${r.by === "user" ? "you" : contactName}`).join(", ") +
    (ours ? ". Tap to remove yours." : "");

  return (
    <View className={`flex-row ${mine ? "justify-end pr-2.5" : "justify-start pl-2.5"}`}>
      <Pressable
        onPress={ours ? onRemove : undefined}
        disabled={!ours || !onRemove}
        accessibilityRole={ours && onRemove ? "button" : "text"}
        accessibilityLabel={label}
        style={{
          backgroundColor: c.surface2,
          borderColor: c.bg,
          // Pull up into the bubble it belongs to. The bubble is drawn first, so
          // this lands on top of its bottom edge.
          marginTop: -9,
        }}
        className="flex-row items-center gap-0.5 rounded-full border-2 px-1.5 py-0.5 active:opacity-70"
      >
        {reactions.map((r, i) => (
          <Text key={`${r.emoji}-${i}`} className="text-xs leading-none">
            {r.emoji}
          </Text>
        ))}
      </Pressable>
    </View>
  );
}
