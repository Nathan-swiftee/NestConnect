import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { CheckIcon } from "../icons";
import { rowIn } from "../motion";
import { Sheet } from "./Sheet";
import { useTheme } from "../theme";
import { haptics } from "../haptics";
import { Touchable } from "./Touchable";

export interface SheetAction {
  key: string;
  label: string;
  detail?: string;
  /** Marks the current value — a menu that doesn't say where you already are
   *  makes you guess. */
  selected?: boolean;
  destructive?: boolean;
  /** A caption above this row, starting a group. Once a sheet offers two kinds
   *  of thing — people and teams — an undivided list makes you read every row
   *  to find out which kind each one is. */
  section?: string;
  /**
   * Rendered at the row's leading edge — an avatar for a person, a team's own
   * glyph for a team.
   *
   * Not decoration. Assign is a sheet of two different kinds of thing, and as
   * plain text every row looks the same: you read each label to work out whether
   * "Sales team" is a person or a team. A face and a glyph settle that before
   * you've read anything, and the avatar is the same colour it is everywhere
   * else in the app, so a name you know is recognisable at a glance.
   */
  leading?: ReactNode;
  onPress: () => void;
}

/**
 * A bottom sheet of choices — assign, resolve, snooze.
 *
 * Bottom rather than centre because it's a phone: the list starts within reach
 * of a thumb and the title sits above it, rather than the other way round. The
 * scrim closes it, which is what a person expects and what makes it safe to
 * open something you didn't mean to.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const { c } = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text className="pb-1 text-lg font-semibold text-fg">{title}</Text>
      <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
        {actions.map((a, i) => (
          // The rows arrive just behind the panel, in order. It's a small thing
          // and it's the difference between a list that appears and a list that
          // is dealt out — and it reinforces the reading order at the moment
          // you're deciding which one to hit.
          <Animated.View key={a.key} entering={rowIn(i)}>
            {a.section ? (
              <Text className="pb-1 pt-4 text-2xs font-semibold uppercase tracking-wide text-faint">
                {a.section}
              </Text>
            ) : null}
            <Touchable feel="row"
              onPress={() => {
                // One place for every sheet action. Actions that finish
                // something add their own success buzz on top.
                haptics.select();
                onClose();
                a.onPress();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: !!a.selected }}
              style={{ borderBottomColor: c.border }}
              className="flex-row items-center gap-3 border-b py-3"
            >
              {/* Fixed width whether or not this row has one, so labels line up
                  down the sheet instead of stepping in and out. */}
              {a.leading ? (
                <View className="h-9 w-9 items-center justify-center">{a.leading}</View>
              ) : null}
              <View className="flex-1">
                <Text
                  style={{ color: a.destructive ? c.danger : c.text }}
                  className={`text-lg ${a.selected ? "font-semibold" : "font-medium"}`}
                >
                  {a.label}
                </Text>
                {a.detail ? <Text className="text-sm text-muted">{a.detail}</Text> : null}
              </View>
              {a.selected ? <CheckIcon size={19} color={c.brand} /> : null}
            </Touchable>
          </Animated.View>
        ))}
      </ScrollView>
    </Sheet>
  );
}
