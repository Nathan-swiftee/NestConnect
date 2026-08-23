import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellIcon } from "../icons";
import { useTheme, useThemeVars } from "../theme";

/**
 * The sentence that earns the permission prompt.
 *
 * iOS gives one chance at the system dialog for the life of the install: if
 * someone taps "Don't Allow" there, the only way back is Settings, which almost
 * nobody does. So this asks first, in our own words, and only shows the real
 * dialog to someone who has already said yes to the idea. Saying "not now" here
 * costs nothing and can be asked again later; saying no to iOS is close to
 * permanent.
 *
 * It appears after the inbox has loaded rather than on launch, so the question
 * is about work the person can already see.
 */
export function PushGate({
  visible,
  onAllow,
  onDismiss,
}: {
  visible: boolean;
  onAllow: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();
  const [busy, setBusy] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="fade" accessibilityViewIsModal onRequestClose={onDismiss}>
      <View style={[themeVars, { backgroundColor: c.scrim }]} className="flex-1 justify-end">
        <View
          style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 16 }}
          className="rounded-t-24 px-5 pt-6"
        >
          <View
            style={{ backgroundColor: c.brandTint }}
            className="h-12 w-12 items-center justify-center rounded-full"
          >
            <BellIcon size={24} color={c.brandStrong} />
          </View>

          <Text accessibilityRole="header" className="pt-4 text-xl font-semibold text-fg">
            Know when a customer replies
          </Text>
          <Text className="pt-2 text-md leading-snug text-muted">
            We'll notify you about conversations assigned to you, when someone @mentions you, and
            when something you snoozed comes due. Not every message in the workspace — you choose
            the rest in Settings.
          </Text>

          <Pressable
            onPress={async () => {
              setBusy(true);
              try {
                onAllow();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            accessibilityRole="button"
            style={{ backgroundColor: c.brand, opacity: busy ? 0.6 : 1 }}
            className="mt-5 items-center rounded-16 py-3.5 active:opacity-80"
          >
            <Text className="text-lg font-semibold text-white">Turn on notifications</Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            className="mt-1 items-center py-3 active:opacity-60"
          >
            <Text style={{ color: c.textMuted }} className="text-md font-medium">
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Hold the prompt back until the inbox has actually rendered something.
 *
 * `ready` is the caller's signal that there is work on screen. The short delay
 * after that is deliberate: asking in the same frame the list appears reads as
 * a launch interruption, which is the thing this whole arrangement exists to
 * avoid.
 */
export function useDelayedPrompt(ready: boolean, ms = 1200): boolean {
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setDue(true), ms);
    return () => clearTimeout(t);
  }, [ready, ms]);
  return due;
}
