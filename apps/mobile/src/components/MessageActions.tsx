import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationWithMessages, Message } from "@ding/schemas";
import { EyeIcon, ReplyIcon } from "../icons";
import { useTheme, useThemeVars } from "../theme";
import { readSummary } from "./ReadLog";

/** The same six the web offers, in the same order — a reaction should mean the
 *  same thing to an agent whichever screen they're on. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * What you can do to one message: react to it, or quote it in your reply.
 *
 * Opened by long-pressing a bubble, which is the gesture people already use for
 * this in every messaging app. A row of taps rather than a picker: six emoji is
 * the whole vocabulary WhatsApp exposes, so a search field would be pretending
 * there are more.
 */
export function MessageActions({
  message,
  conv,
  onReact,
  onReply,
  onReceipts,
  onClose,
}: {
  message: Message | null;
  conv: ConversationWithMessages;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onReceipts: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();

  if (!message) return null;

  const isWhatsApp = conv.channel === "whatsapp" || conv.channel === "whatsapp_group";
  // Quoting threads on WhatsApp and nowhere else — an email "quote" is just
  // pasted text, which the composer already does.
  const canQuote = isWhatsApp && !message.internal;
  // Read receipts: only a sent email has tracked recipients to report on.
  const receipts = message.direction === "out" && !message.internal ? readSummary(message) : null;
  // "by: user" is our side of the conversation — an agent's reaction, as opposed
  // to the customer's. That's as fine-grained as the model gets: WhatsApp allows
  // one reaction per participant, so the business has exactly one.
  const ours = message.reactions?.filter((r) => r.by === "user").map((r) => r.emoji) ?? [];

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal onRequestClose={onClose}>
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
          style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 12 }}
          className="rounded-t-24 px-4 pt-4"
        >
          <Text numberOfLines={2} className="pb-3 text-sm text-muted">
            {message.body?.trim() || "Attachment"}
          </Text>

          {/* Reactions are offered on every channel, as the web does. On
              WhatsApp the emoji is delivered to the customer; anywhere else the
              server stores it and skips dispatch, so it's a private annotation
              for the team — which the line below says out loud, because an
              agent reacting to an email needs to know the customer won't see
              it. */}
          <View className="flex-row justify-between pb-1">
            {QUICK_REACTIONS.map((e) => {
              // A reaction already left is a toggle — sending the same emoji
              // again clears it, which is what the server does.
              const on = ours.includes(e);
              return (
                <Pressable
                  key={e}
                  onPress={() => {
                    onReact(e);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={on ? `Remove ${e} reaction` : `React with ${e}`}
                  accessibilityState={{ selected: on }}
                  style={{ backgroundColor: on ? c.brandTint : c.surface2 }}
                  className="h-12 w-12 items-center justify-center rounded-full active:opacity-60"
                >
                  <Text className="text-2xl">{e}</Text>
                </Pressable>
              );
            })}
          </View>

          {!isWhatsApp ? (
            <Text className="pb-1 pt-1.5 text-2xs text-faint">
              Only your team sees this — email has no reactions to deliver.
            </Text>
          ) : null}

          {canQuote ? (
            <Pressable
              onPress={() => {
                onReply();
                onClose();
              }}
              accessibilityRole="button"
              style={{ borderTopColor: c.border }}
              className="mt-3 flex-row items-center gap-3 border-t py-3.5 active:opacity-60"
            >
              <ReplyIcon size={19} color={c.textMuted} />
              <Text className="text-lg font-medium text-fg">Reply to this message</Text>
            </Pressable>
          ) : null}

          {receipts ? (
            <Pressable
              onPress={() => {
                onReceipts();
                onClose();
              }}
              accessibilityRole="button"
              style={{ borderTopColor: c.border }}
              className="mt-3 flex-row items-center gap-3 border-t py-3.5 active:opacity-60"
            >
              <EyeIcon size={19} color={c.textMuted} />
              <Text className="text-lg font-medium text-fg">Read receipts</Text>
              <Text className="ml-auto text-md text-muted">
                {receipts.seen} of {receipts.total}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
