import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, LayoutAnimation, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { ChannelType, ConversationWithMessages, Message } from "@ding/schemas";
import { api, useSendMessage, useTemplates, windowLeft } from "@ding/client";
import { useStagedAttachments } from "../attachments";
import { enqueue } from "../send-queue";
import { StagedAttachments } from "./StagedAttachments";
import { AttachSheet } from "./AttachSheet";
import { VoiceRecorder, type RecordedVoice } from "./VoiceRecorder";
import { useTheme } from "../theme";
import { haptics } from "../haptics";
import {
  AttachIcon,
  BoltIcon,
  ClockIcon,
  EmojiIcon,
  ReplyIcon,
  XIcon,
  MicIcon,
  NoteIcon,
  SendIcon,
  channelMeta,
} from "../icons";

/** The composer's own emoji row — the same curated set the web uses, so the two
 *  offer the same shortcuts. Deliberately not a picker dependency. */
const COMPOSER_EMOJIS = ["👍", "🙏", "😀", "😅", "🎉", "❤️", "✅", "👀", "🔥", "😬", "🤝", "📎"];

/**
 * The reply box — the mobile reading of the web's `.composer`.
 *
 * Structure is deliberately the web's, not a fresh idea:
 *
 *  - a `compmode` segmented control with one tab per channel the customer is
 *    reachable on, each carrying its own channel glyph, then a Note tab;
 *  - a context line that says where this is going and, on WhatsApp, how long
 *    the 24-hour window has left;
 *  - an input row with the same tools in the same order — emoji, template,
 *    attach — and one trailing button that is a mic until there's something to
 *    send, then becomes the send arrow.
 *
 * Reply and Note stay visibly different because they are two different acts: one
 * goes to the customer, the other to the team. The mistake that matters — a note
 * reaching the customer — should be hard to make by accident.
 */
export function Composer({
  conv,
  replyTo,
  onClearReply,
}: {
  conv: ConversationWithMessages;
  /** The message this reply quotes, chosen by long-pressing a bubble. */
  replyTo?: Message | null;
  onClearReply?: () => void;
}) {
  const { c } = useTheme();
  const send = useSendMessage();
  const { data: templates } = useTemplates();
  const inputRef = useRef<TextInput>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedChannel, setPickedChannel] = useState<ChannelType | null>(null);
  const [attachSheet, setAttachSheet] = useState(false);
  const [recording, setRecording] = useState(false);
  const files = useStagedAttachments();

  // Which channels this customer is reachable on inside this thread. Mirrors the
  // web: a group can only be answered in the group; a 1:1 lists every channel we
  // hold an address for, falling back to the thread's own.
  const isGroup = conv.channel === "whatsapp_group";
  const replyTargets = useMemo<ChannelType[]>(() => {
    if (isGroup) return [conv.channel];
    const out: ChannelType[] = [];
    if (conv.contact.phone) out.push("whatsapp");
    if (conv.contact.email) out.push("email");
    return out.length ? out : [conv.channel];
  }, [isGroup, conv.channel, conv.contact.phone, conv.contact.email]);

  // Default to the channel the customer last used, not the one the thread was
  // opened on — that's the address they're actually watching.
  const lastUsed = useMemo(() => {
    const m = [...conv.messages].reverse().find((x) => x.direction === "in" && !x.internal);
    return (m?.channel ?? conv.lastChannel ?? conv.channel) as ChannelType;
  }, [conv.messages, conv.lastChannel, conv.channel]);
  const defaultChannel = !isGroup && replyTargets.includes(lastUsed) ? lastUsed : conv.channel;
  const channel = (!isGroup && pickedChannel) || defaultChannel;

  const isWhatsApp = channel === "whatsapp" || channel === "whatsapp_group";
  const isEmail = channel === "email";
  const windowOpen = conv.waWindow?.open ?? false;
  const windowClosed = isWhatsApp && !windowOpen;
  const msLeft = conv.waWindow?.expiresAt ? new Date(conv.waWindow.expiresAt).getTime() - Date.now() : null;
  const closingSoon = msLeft != null && msLeft < 60 * 60 * 1000;

  // Closed window: fall back to the workspace's default single-variable
  // template, so what the agent typed still goes out as the message body.
  const defaultTemplate = templates?.find((t) => t.isDefault && t.variableCount === 1) ?? null;
  const templateFallback = windowClosed && !internal && !!defaultTemplate;
  const locked = windowClosed && !internal && !defaultTemplate;

  // An attachment on its own is a message — "here's the invoice" needs no words.
  const hasContent = body.trim().length > 0 || files.readyIds.length > 0;
  const canSend = hasContent && !send.isPending && !locked && !files.uploading;
  // The mic stands in for send while there's nothing to send — WhatsApp's own
  // arrangement. Only on a voice-capable WhatsApp reply, and only once wired.
  const showMic = isWhatsApp && !internal && !hasContent;

  async function submit() {
    const text = body.trim();
    if ((!text && !files.readyIds.length) || locked) {
      // Refused rather than ignored: outside the WhatsApp window there *is* a
      // reason, and a dead button with no feedback reads as a broken one.
      if (locked) haptics.warning();
      return;
    }
    setError(null);
    setEmojiOpen(false);
    // Clear optimistically — the message is already on screen via useSendMessage,
    // and leaving the text behind invites an accidental double-send.
    setBody("");
    try {
      await send.mutateAsync({
        id: conv.id,
        body: text,
        internal,
        ...(internal ? {} : { channel }),
        ...(templateFallback ? { template: { id: defaultTemplate!.id, params: [text || "(attachment)"] } } : {}),
        // A note goes to the team, so it can't quote a customer message out.
        ...(replyTo && !internal ? { quotedMsgId: replyTo.id } : {}),
        ...(files.readyIds.length ? { attachmentIds: files.readyIds } : {}),
      });
      haptics.success();
      files.clear();
      onClearReply?.();
    } catch (err) {
      // A 4xx means the server looked at it and refused — the agent needs to see
      // that and change something, so the text goes back in the box. Anything
      // else is the network, and a reply written on the Tube should not be lost
      // because the tunnel was long: it goes on the durable queue instead, and
      // leaves the box empty because it is genuinely going to be sent.
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        haptics.error();
        setBody(text);
        setError(err instanceof Error ? err.message : "Couldn't send — try again.");
        return;
      }
      // Queued, not lost — which is a success from where the agent is sitting,
      // so it feels like one.
      haptics.success();
      await enqueue({
        conversationId: conv.id,
        body: text,
        internal,
        ...(internal ? {} : { channel }),
        ...(templateFallback ? { template: { id: defaultTemplate!.id, params: [text || "(attachment)"] } } : {}),
        ...(replyTo && !internal ? { quotedMsgId: replyTo.id } : {}),
        ...(files.readyIds.length ? { attachmentIds: files.readyIds } : {}),
      });
      files.clear();
      onClearReply?.();
    }
  }

  /** A finished voice note: stage it, wait for the upload, then send it on its
   *  own. Unlike a picked file it isn't left in the tray — you recorded it to
   *  say something now, not to attach it to a sentence you haven't written. */
  async function sendVoice(v: RecordedVoice) {
    setRecording(false);
    setError(null);
    try {
      const attachment = await api.uploadMedia(
        { uri: v.uri, name: `voice-${Date.now()}.m4a`, type: "audio/m4a" },
        { kind: "voice", durationMs: v.durationMs, filename: `voice-${Date.now()}.m4a` },
      );
      await send.mutateAsync({
        id: conv.id,
        body: "",
        internal: false,
        channel,
        attachmentIds: [attachment.id],
        ...(replyTo ? { quotedMsgId: replyTo.id } : {}),
      });
      haptics.success();
      onClearReply?.();
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : "Couldn't send the voice note.");
    }
  }

  /** The context line: who this reaches, or the live window state. */
  function ctx() {
    if (internal) return { text: "Only your team can see this", tone: c.textMuted, dot: false };
    if (isEmail) return { text: `Email · ${conv.contact.displayName}`, tone: c.textMuted, dot: false };
    if (isWhatsApp && windowOpen && msLeft != null)
      return {
        text: `${closingSoon ? "Window closing" : "Window open"} · ${windowLeft(msLeft)} left`,
        tone: closingSoon ? c.amber : c.brandStrong,
        dot: true,
      };
    if (isWhatsApp && windowClosed)
      return { text: "24-hour window closed", tone: c.amber, dot: true };
    return {
      text: `${isGroup ? "Group" : "WhatsApp"} · ${conv.contact.displayName}`,
      tone: c.textMuted,
      dot: false,
    };
  }
  const ctxLine = ctx();

  /**
   * One tab of the mode switcher.
   *
   * Only the selected tab spells out its name. Three labelled tabs plus the
   * window countdown do not fit across a phone — something has to give, and a
   * label you can't read is worth less than a glyph you can. The glyphs are the
   * channels' own marks, so an unlabelled tab still says which channel it is,
   * and the label appears the moment you select it.
   */
  function ModeTab({
    active,
    label,
    tint,
    children,
    onPress,
  }: {
    active: boolean;
    label: string;
    tint: string;
    children: React.ReactNode;
    onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        hitSlop={{ top: 9, bottom: 9, left: 2, right: 2 }}
        // The thumb: the active tab carries the raised surface, the rest are
        // bare. Same read as the web's sliding seg-thumb without animating a
        // measured offset on every layout.
        style={{ backgroundColor: active ? c.surface : "transparent" }}
        className={`flex-row items-center gap-1.5 rounded-full py-1.5 ${active ? "px-3" : "px-2.5"} ${active ? "" : "active:opacity-60"}`}
      >
        {children}
        {active ? (
          <Text style={{ color: tint }} className="text-sm font-semibold">
            {label}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={{ backgroundColor: c.surface, borderTopColor: c.border }} className="border-t px-3 pb-2 pt-2.5">
      {/* compbar: the mode switcher, then the context line. */}
      <View className="flex-row items-center gap-2 pb-2">
        <View style={{ backgroundColor: c.surface2 }} className="flex-row items-center rounded-full p-0.5">
          {replyTargets.map((ch) => {
            const meta = channelMeta(ch);
            const Glyph = meta.Glyph;
            const active = !internal && channel === ch;
            const tint = c[meta.colorKey];
            return (
              <ModeTab
                key={ch}
                active={active}
                tint={tint}
                label={replyTargets.length > 1 ? meta.label.replace("WhatsApp group", "Group") : "Reply"}
                onPress={() => {
                  setInternal(false);
                  setPickedChannel(ch);
                }}
              >
                <Glyph size={15} color={active ? tint : c.textFaint} />
              </ModeTab>
            );
          })}
          <ModeTab
            active={internal}
            tint={c.amber}
            label="Note"
            onPress={() => {
              setInternal(true);
              setEmojiOpen(false);
            }}
          >
            <NoteIcon size={15} color={internal ? c.amber : c.textFaint} />
          </ModeTab>
        </View>

        <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">
          {ctxLine.dot ? (
            <View
              style={{ backgroundColor: ctxLine.tone }}
              className="h-1.5 w-1.5 flex-none rounded-full"
            />
          ) : null}
          {/* Truncating this line loses the number, which is the only part that
              matters — so it shrinks to fit rather than being cut off. */}
          <Text
            style={{ color: ctxLine.tone }}
            className="shrink text-2xs font-medium"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {ctxLine.text}
          </Text>
        </View>
      </View>

      {/* Window shut with a default template standing in: say what will actually
          be sent, rather than silently rewriting the agent's message. */}
      {templateFallback ? (
        <View
          style={{ backgroundColor: c.amberTint }}
          className="mb-2 flex-row items-center gap-2 rounded-12 px-3 py-2"
        >
          <ClockIcon size={15} color={c.amber} />
          <Text style={{ color: c.amber }} className="flex-1 text-2xs" numberOfLines={2}>
            Window closed — sending as{" "}
            <Text className="font-semibold">{defaultTemplate!.name}</Text>
          </Text>
        </View>
      ) : null}

      {locked ? (
        <View
          style={{ backgroundColor: c.amberTint }}
          className="mb-2 flex-row items-center gap-2 rounded-12 px-3 py-2.5"
        >
          <ClockIcon size={16} color={c.amber} />
          <Text style={{ color: c.amber }} className="flex-1 text-2xs">
            The 24-hour window has closed. Send an approved template to re-open the conversation.
          </Text>
        </View>
      ) : null}

      {/* What you're quoting, with a way out of it. Without this the quote is
          invisible until after you've sent, which is the wrong moment to find
          out you were replying to the wrong message. */}
      {replyTo && !internal ? (
        <View
          style={{ backgroundColor: c.surface2, borderLeftColor: c.brand }}
          className="mb-2 flex-row items-center gap-2 rounded-8 border-l-2 px-2.5 py-1.5"
        >
          <ReplyIcon size={14} color={c.brandStrong} />
          <View className="flex-1">
            <Text style={{ color: c.brandStrong }} className="text-2xs font-semibold">
              Replying to {replyTo.direction === "out" ? "yourself" : conv.contact.displayName}
            </Text>
            <Text numberOfLines={1} className="text-2xs text-muted">
              {replyTo.body?.trim() || "Attachment"}
            </Text>
          </View>
          <Pressable
            onPress={onClearReply}
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            hitSlop={10}
            className="p-1 active:opacity-60"
          >
            <XIcon size={13} color={c.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {error ? <Text className="pb-1.5 text-sm text-danger">{error}</Text> : null}

      {emojiOpen ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: c.surface2 }}
          contentContainerStyle={{ paddingHorizontal: 6 }}
          className="mb-2 rounded-16 py-1.5"
        >
          {COMPOSER_EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => {
                setBody((b) => b + e);
                inputRef.current?.focus();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${e}`}
              className="px-2 py-1 active:opacity-60"
            >
              <Text className="text-xl">{e}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* While recording there is nothing else to do, so the recorder takes the
          input row's place rather than floating over it. */}
      {recording ? (
        <VoiceRecorder onSend={(v) => void sendVoice(v)} onCancel={() => setRecording(false)} />
      ) : (
      <>
      <StagedAttachments items={files.staged} onRemove={files.remove} onRetry={files.retry} />

      {/* compinput: tools left, field centre, one trailing action. */}
      <View
        style={{ backgroundColor: c.surface2 }}
        className="flex-row items-end gap-1 rounded-24 px-1.5 py-1"
      >
        <Pressable
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setEmojiOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel="Emoji"
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        >
          <EmojiIcon size={21} color={emojiOpen ? c.brandStrong : c.textMuted} />
        </Pressable>

        <TextInput
          ref={inputRef}
          value={body}
          onChangeText={setBody}
          multiline
          editable={!locked}
          // Not "Message {name}…": with emoji, template, attach and send in the
          // row there isn't width for it, and it wrapped to a second line. The
          // header names the customer two lines above, so the name here was
          // costing a line to repeat something already on screen.
          placeholder={
            locked
              ? "Set a default template to reply"
              : internal
                ? "Note for the team…"
                : "Message…"
          }
          placeholderTextColor={c.textFaint}
          style={{ color: c.text, maxHeight: 132 }}
          className="flex-1 px-1 py-2 text-lg"
        />

        {isWhatsApp && !internal ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Templates"
            hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          >
            <BoltIcon size={19} color={c.textMuted} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => setAttachSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Attach files"
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        >
          <AttachIcon size={20} color={c.textMuted} />
        </Pressable>

        <Pressable
          onPress={showMic ? () => setRecording(true) : submit}
          disabled={!showMic && !canSend}
          accessibilityRole="button"
          accessibilityLabel={showMic ? "Record voice message" : internal ? "Add note" : "Send reply"}
          hitSlop={4}
          // Keep the send button the same shape and colour whether or not it can
          // fire — a disabled white disc on the grey field reads as a hole. It
          // dims instead, which says "not yet" without disappearing.
          style={{
            backgroundColor: internal ? c.amber : c.brand,
            opacity: showMic || canSend ? 1 : 0.35,
          }}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
        >
          {send.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : showMic ? (
            <MicIcon size={19} color="#fff" />
          ) : (
            <SendIcon size={19} color="#fff" />
          )}
        </Pressable>
      </View>
      </>
      )}

      <AttachSheet
        visible={attachSheet}
        onClose={() => setAttachSheet(false)}
        onCamera={() => void files.takePhoto()}
        onPhotos={() => void files.pickImages()}
        onFiles={() => void files.pickFiles()}
      />
    </View>
  );
}
