import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { ChannelType, ConversationWithMessages } from "@ding/schemas";
import { useSendMessage, useTemplates, windowLeft } from "@ding/client";
import { useTheme } from "../theme";

/** Reply on the channel the customer last used, not the one the conversation
 *  was opened on — a thread can span WhatsApp and email, and the last inbound
 *  is the address they're actually watching. */
function defaultChannel(conv: ConversationWithMessages): ChannelType {
  const lastInbound = [...conv.messages].reverse().find((m) => m.direction === "in" && !m.internal);
  return (lastInbound?.channel ?? conv.lastChannel ?? conv.channel) as ChannelType;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_group: "Group",
  email: "Email",
};

/**
 * The reply box.
 *
 * Two modes, because they are two different acts: a reply goes to the customer,
 * a note goes to the team. They look different and the send button says which
 * one you're about to do, so the mistake that matters — a note reaching the
 * customer — is hard to make by accident.
 *
 * The 24-hour WhatsApp window is enforced here the way the web does it: once
 * it's closed only an approved template can go out, and the workspace's default
 * template takes the typed text as its variable so the composer still behaves
 * like a composer instead of becoming a dead end.
 */
export function Composer({ conv }: { conv: ConversationWithMessages }) {
  const { c } = useTheme();
  const send = useSendMessage();
  const { data: templates } = useTemplates();
  const inputRef = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = useMemo(() => defaultChannel(conv), [conv]);
  const isWhatsApp = channel === "whatsapp" || channel === "whatsapp_group";
  const windowOpen = conv.waWindow?.open ?? false;
  const windowClosed = isWhatsApp && !windowOpen;

  // Closed window: fall back to the workspace's default single-variable
  // template, so what the agent typed still goes out as the message body.
  const defaultTemplate = templates?.find((t) => t.isDefault && t.variableCount === 1) ?? null;
  const templateFallback = windowClosed && !internal && !!defaultTemplate;
  const locked = windowClosed && !internal && !defaultTemplate;

  const canSend = body.trim().length > 0 && !send.isPending && !locked;

  async function submit() {
    const text = body.trim();
    if (!text || locked) return;
    setError(null);
    // Clear optimistically — the message is already on screen via useSendMessage,
    // and leaving the text behind invites an accidental double-send.
    setBody("");
    try {
      await send.mutateAsync({
        id: conv.id,
        body: text,
        internal,
        ...(internal ? {} : { channel }),
        ...(templateFallback ? { template: { id: defaultTemplate!.id, params: [text] } } : {}),
      });
    } catch (err) {
      setBody(text);
      setError(err instanceof Error ? err.message : "Couldn't send — try again.");
    }
  }

  return (
    <View style={{ backgroundColor: c.surface, borderTopColor: c.border }} className="border-t px-3 pb-2 pt-2.5">
      <View className="flex-row items-center gap-2 pb-2">
        {(["reply", "note"] as const).map((mode) => {
          const active = (mode === "note") === internal;
          return (
            <Pressable
              key={mode}
              onPress={() => setInternal(mode === "note")}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                backgroundColor: active ? (mode === "note" ? c.amberTint : c.brandTint) : c.surface2,
              }}
              className="rounded-full px-3.5 py-1.5 active:opacity-70"
            >
              <Text
                style={{ color: active ? (mode === "note" ? c.amber : c.brandStrong) : c.textMuted }}
                className={`text-sm ${active ? "font-semibold" : "font-medium"}`}
              >
                {mode === "reply" ? CHANNEL_LABEL[channel] ?? "Reply" : "Note"}
              </Text>
            </Pressable>
          );
        })}

        <View className="flex-1" />

        {!internal && isWhatsApp ? (
          <Text style={{ color: windowOpen ? c.brandStrong : c.amber }} className="text-2xs font-medium">
            {windowOpen
              ? `Window open · ${windowLeft(new Date(conv.waWindow?.expiresAt ?? 0).getTime() - Date.now())} left`
              : templateFallback
                ? "Window closed · sends as a template"
                : "Window closed"}
          </Text>
        ) : null}
      </View>

      {error ? <Text className="pb-1.5 text-sm text-danger">{error}</Text> : null}

      <View className="flex-row items-end gap-2">
        <TextInput
          ref={inputRef}
          value={body}
          onChangeText={setBody}
          multiline
          editable={!locked}
          placeholder={
            locked
              ? "This WhatsApp window has closed — set a default template to reply"
              : internal
                ? "Note for the team…"
                : `Message ${conv.contact.displayName}…`
          }
          placeholderTextColor={c.textFaint}
          style={{ color: c.text, backgroundColor: c.surface2, maxHeight: 132 }}
          className="flex-1 rounded-20 px-4 py-2.5 text-lg"
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={internal ? "Add note" : "Send reply"}
          style={{ backgroundColor: canSend ? (internal ? c.amber : c.brand) : c.surface2 }}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-80"
        >
          {send.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: canSend ? "#fff" : c.textFaint }} className="text-lg font-semibold">
              ↑
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
