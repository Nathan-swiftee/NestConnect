import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationWithMessages, Message } from "@ding/schemas";
import { ReplyIcon } from "../icons";
import { useTheme, useThemeVars } from "../theme";

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
  onClose,
}: {
  message: Message | null;
  conv: ConversationWithMessages;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const themeVars = useThemeVars();

  if (!message) return null;

  // Reactions ride on WhatsApp's own reaction feature, so they only exist on a
  // WhatsApp thread. Offering them on an email would be a button that fails.
  const canReact = conv.channel === "whatsapp" || conv.channel === "whatsapp_group";
  // Quoting is the same: a WhatsApp reply threads, an email quote does not.
  const canQuote = canReact && !message.internal;
  // "by: user" is our side of the conversation — an agent's reaction, as opposed
  // to the customer's. That's as fine-grained as the model gets: WhatsApp allows
  // one reaction per participant, so the business has exactly one.
  const ours = message.reactions?.filter((r) => r.by === "user").map((r) => r.emoji) ?? [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={[themeVars, { backgroundColor: c.scrim }]}
        className="flex-1 justify-end"
      >
        <Pressable
          onPress={() => {}}
          style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 12 }}
          className="rounded-t-24 px-4 pt-4"
        >
          <Text numberOfLines={2} className="pb-3 text-sm text-muted">
            {message.body?.trim() || "Attachment"}
          </Text>

          {canReact ? (
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

          {!canReact && !canQuote ? (
            <Text className="pb-2 text-md text-muted">
              Reactions and quoted replies are a WhatsApp feature — this thread is email.
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
