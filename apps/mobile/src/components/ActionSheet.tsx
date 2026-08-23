import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

export interface SheetAction {
  key: string;
  label: string;
  detail?: string;
  /** Marks the current value — a menu that doesn't say where you already are
   *  makes you guess. */
  selected?: boolean;
  destructive?: boolean;
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
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ backgroundColor: c.scrim }}
        className="flex-1 justify-end"
      >
        {/* Stop taps inside the sheet from reaching the scrim behind it. */}
        <Pressable
          onPress={() => {}}
          style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 12 }}
          className="rounded-t-24 px-4 pt-3"
        >
          <View style={{ backgroundColor: c.borderStrong }} className="mx-auto mb-3 h-1 w-9 rounded-full" />
          <Text className="pb-1 text-lg font-semibold text-fg">{title}</Text>
          <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
            {actions.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => {
                  onClose();
                  a.onPress();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: !!a.selected }}
                style={{ borderBottomColor: c.border }}
                className="flex-row items-center gap-3 border-b py-3.5 active:opacity-60"
              >
                <View className="flex-1">
                  <Text
                    style={{ color: a.destructive ? c.danger : c.text }}
                    className={`text-lg ${a.selected ? "font-semibold" : "font-medium"}`}
                  >
                    {a.label}
                  </Text>
                  {a.detail ? <Text className="text-sm text-muted">{a.detail}</Text> : null}
                </View>
                {a.selected ? (
                  <Text style={{ color: c.brand }} className="text-lg font-semibold">
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
