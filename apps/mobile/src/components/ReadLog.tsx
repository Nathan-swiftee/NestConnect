import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { seenAt } from "@ding/client";
import type { Message } from "@ding/schemas";
import { CheckDouble, ClockIcon, XIcon } from "../icons";
import { useTheme, useThemeVars } from "../theme";

type Recipient = NonNullable<NonNullable<Message["email"]>["recipients"]>[number];

/** How many of an email's recipients have opened it — the summary line that goes
 *  on the bubble. Returns null when there's nothing to report. */
export function readSummary(message: Message): { seen: number; total: number } | null {
  const recipients = message.email?.recipients;
  if (!recipients?.length) return null;
  return { seen: recipients.filter((r) => r.openedAt).length, total: recipients.length };
}

/**
 * Who opened this email, and when.
 *
 * Email has no delivery receipt worth the name, so this is built on per-recipient
 * tracking pixels: every To and Cc address gets its own copy carrying a unique
 * URL, and the first request for that URL is the open. That makes it honest
 * per-person rather than a single "read" for the whole send — which matters most
 * on the case people actually ask about, "did the person who needed to see it
 * see it, or only their colleague".
 *
 * It also makes the limits real, so they're stated rather than implied: a client
 * that blocks remote images never fires the pixel, and an open can only ever be
 * "at least once" — the timestamp is the *first* fetch.
 */
export function ReadLog({
  message,
  visible,
  onClose,
}: {
  message: Message | null;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();

  const recipients: Recipient[] = message?.email?.recipients ?? [];
  const seen = recipients.filter((r) => r.openedAt);

  return (
    <Modal visible={visible && !!message} transparent animationType="slide" accessibilityViewIsModal onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[themeVars, { backgroundColor: c.scrim }]}
        className="flex-1 justify-end"
      >
        <Pressable
          onPress={() => {}}
          // A sink, not a control: it exists so a tap on the sheet
          // doesn't reach the scrim behind it. Left accessible, a
          // screen reader announces the whole sheet as one button and
          // can skip everything inside it.
          accessible={false}
          style={{ backgroundColor: c.surface, maxHeight: "80%", paddingBottom: insets.bottom + 8 }}
          className="rounded-t-24"
        >
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <View className="flex-1">
              <Text accessibilityRole="header" className="text-xl font-semibold text-fg">
                Read receipts
              </Text>
              <Text className="text-sm text-muted">
                {seen.length} of {recipients.length} opened
              </Text>
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

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <View
              style={{ backgroundColor: c.surface2, borderColor: c.border }}
              className="mx-4 mt-3 rounded-16 border"
            >
              {recipients.map((r, i) => {
                const opened = !!r.openedAt;
                return (
                  <View
                    key={`${r.kind}-${r.address}`}
                    style={{ borderBottomColor: i === recipients.length - 1 ? "transparent" : c.border }}
                    className={`flex-row items-center gap-3 px-4 py-3 ${i === recipients.length - 1 ? "" : "border-b"}`}
                  >
                    {opened ? (
                      <CheckDouble size={13} color={c.email} />
                    ) : (
                      <ClockIcon size={14} color={c.textFaint} />
                    )}
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-md font-medium text-fg">
                        {r.address}
                      </Text>
                      <Text className="text-2xs text-faint">
                        {r.kind === "cc" ? "Cc · " : ""}
                        {opened ? `Opened ${seenAt(r.openedAt!)}` : "Not opened yet"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            <Text className="px-5 pt-3 text-2xs leading-snug text-faint">
              Tracked with a per-recipient pixel. A mail client that blocks remote images never
              loads it, so "not opened" can mean "opened privately" — and the time shown is the
              first open, not the last.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
