import { Pressable, Text, View } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import type { Reaction } from "@ding/schemas";
import { useTheme } from "../theme";

/**
 * The reaction pill, matched to the web's.
 *
 * These are the same product on two screens, so the pill is specified here in
 * the same terms as `.reacts` in the web stylesheet rather than reinterpreted:
 * elevated fill, a 1.5pt ring in the chip grey, a soft drop shadow, 19pt tall,
 * overlapping the bubble by 4 and inset 9 from its outer edge.
 *
 * The shadow is the part that was missing and the part that does the work. An
 * earlier version filled the pill with the chip grey and ringed it in the
 * thread background, trying to look *cut out* of the bubble's edge. That reads
 * as a hole rather than an object, and against an inbound bubble — chip grey on
 * near-white — it very nearly disappeared. Lifting it instead is what makes it
 * legible on both fills without needing a different treatment for each: it sits
 * on top of the bubble, so it only has to contrast with one thing, the shadow
 * under it.
 *
 * It hangs off the bubble's outer bottom corner and mirrors with the thread, so
 * a reaction always sits on the same side as the person who is speaking.
 *
 * Tappable to remove: sending the same emoji again clears it, which is what the
 * server does and what WhatsApp does.
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
    <View className={`flex-row ${mine ? "justify-end pr-[9px]" : "justify-start pl-[9px]"}`}>
      <Animated.View
        // Re-keyed on the emoji set, so adding or changing a reaction pops the
        // pill again rather than swapping the glyph in silently. The landing is
        // the feedback that the tap registered — the pill is too small and too
        // far from the finger for its appearance alone to read as a response.
        key={reactions.map((r) => r.emoji).join()}
        entering={ZoomIn.springify().damping(14).stiffness(320).mass(0.6).reduceMotion(ReduceMotion.System)}
      >
        <Pressable
          onPress={ours ? onRemove : undefined}
          disabled={!ours || !onRemove}
          accessibilityRole={ours && onRemove ? "button" : "text"}
          accessibilityLabel={label}
          style={{
            backgroundColor: c.elevated,
            borderColor: c.surface2,
            borderWidth: 1.5,
            // Overlap the bubble it belongs to. The bubble is drawn first, so
            // this lands on top of its bottom edge.
            marginTop: -4,
            height: 19,
            paddingHorizontal: 5,
            shadowColor: "#000",
            shadowOpacity: 0.16,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
          className="flex-row items-center gap-px rounded-full active:opacity-70"
        >
          {reactions.map((r, i) => (
            <Text key={`${r.emoji}-${i}`} className="text-xs leading-none">
              {r.emoji}
            </Text>
          ))}
        </Pressable>
      </Animated.View>
    </View>
  );
}
