import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import type { ConversationWithMessages, Message } from "@ding/schemas";
import { EyeIcon, ForwardIcon, ReplyIcon } from "../icons";
import { fadeTo, spring, springTo, timing } from "../motion";
import { useTheme, useThemeVars } from "../theme";
import { readSummary } from "./ReadLog";
import { useInsets } from "../insets";

/**
 * A heavier dim than the shared sheet scrim.
 *
 * A bottom sheet only has to push back what's directly behind it. This overlay
 * covers the whole screen and floats a copy of the held message, so at the
 * sheet's 30% the real bubble stays fully legible right next to its own preview
 * and the two read as a duplicate rather than as a lifted item over a
 * backgrounded thread. Same idea as an iOS context menu.
 */
const HOLD_SCRIM = { light: "rgba(24,24,22,.55)", dark: "rgba(0,0,0,.72)" } as const;

/** The same six the web offers, in the same order — a reaction should mean the
 *  same thing to an agent whichever screen they're on. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** One line describing a message with no text of its own, so the preview under
 *  the reaction row still says what you're acting on. */
function summarise(m: Message): string {
  const body = m.body?.trim();
  if (body) return body;
  const a = m.attachments?.[0];
  if (a) {
    switch (a.kind) {
      case "image": return "Photo";
      case "video": return "Video";
      case "voice": return "Voice message";
      case "audio": return "Audio";
      case "sticker": return "Sticker";
      default: return a.filename || "Document";
    }
  }
  if (m.messageType === "location") return "Location";
  if (m.messageType === "contact") return "Contact";
  return "Message";
}

/**
 * What you can do to one message — laid out the way WhatsApp lays it out.
 *
 * The reactions come down from the top and the actions come up from the bottom,
 * with the held message sitting between them. That split isn't decoration: the
 * two are different kinds of choice. Reacting is one tap on a thing you can see
 * at a glance, so it belongs where your eye already is; the actions are a list
 * you read, so they belong under your thumb. Stacking both into one bottom sheet
 * — which is what this was — buries the six emoji above a list and makes the
 * quick thing the slow one.
 *
 * Both halves ride one shared progress value so they arrive together rather than
 * as two animations that happen to overlap, and the whole thing is held mounted
 * through the exit so it can animate out (a Modal unmounts the frame `visible`
 * flips, which would kill it).
 */
export function MessageActions({
  message,
  conv,
  onReact,
  onReply,
  onForward,
  onReceipts,
  onClose,
}: {
  message: Message | null;
  conv: ConversationWithMessages;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onReceipts: () => void;
  onClose: () => void;
}) {
  const insets = useInsets();
  const { c, scheme } = useTheme();
  const themeVars = useThemeVars();

  // The message is held for the length of the exit so the sheet has something to
  // render on the way out; `message` itself goes null as soon as it's dismissed.
  const [shown, setShown] = useState<Message | null>(message);
  const open = useSharedValue(0);

  useEffect(() => {
    if (message) {
      setShown(message);
      open.value = springTo(1, spring.settle);
      return;
    }
    open.value = fadeTo(0, timing.base);
    const t = setTimeout(() => setShown(null), timing.base.duration + 40);
    return () => clearTimeout(t);
  }, [message, open]);

  const scrim = useAnimatedStyle(() => ({ opacity: open.value }));
  // The top half drops in a short distance — it's already near where you were
  // looking, so it needs to appear, not travel.
  const top = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [{ translateY: (1 - open.value) * -22 }],
  }));
  // Same drag-to-dismiss as every other sheet. This one owns its own Modal
  // rather than going through `Sheet` — it has a top half as well as a bottom
  // one — so it needs its own copy of the gesture and, critically, its own
  // gesture root: handlers get no touches inside a Modal without one.
  const drag = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetY(-8)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 700) {
        runOnJS(onClose)();
        return;
      }
      drag.value = springTo(0, spring.settle);
    });

  const bottom = useAnimatedStyle(() => ({
    transform: [{ translateY: `${(1 - open.value) * 100}%` }, { translateY: drag.value }],
  }));

  if (!shown) return null;

  const isWhatsApp = conv.channel === "whatsapp" || conv.channel === "whatsapp_group";
  // Quoting threads on WhatsApp and nowhere else — an email "quote" is just
  // pasted text, which the composer already does.
  const canQuote = isWhatsApp && !shown.internal;
  // Forwarding sends this content to another customer, so an internal note is
  // never forwardable (the server refuses it too) and neither is an email —
  // that forward is an addressed one, and it lives on the web.
  const canForward = isWhatsApp && !shown.internal;
  // Read receipts: only a sent email has tracked recipients to report on.
  const receipts = shown.direction === "out" && !shown.internal ? readSummary(shown) : null;
  // "by: user" is our side of the conversation — an agent's reaction, as opposed
  // to the customer's. That's as fine-grained as the model gets: WhatsApp allows
  // one reaction per participant, so the business has exactly one.
  const ours = shown.reactions?.filter((r) => r.by === "user").map((r) => r.emoji) ?? [];

  return (
    <Modal
      visible
      transparent
      animationType="none"
      accessibilityViewIsModal
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* A Modal renders outside the root that publishes the palette, so the
          scheme's variables are re-applied here.

          `justify-end` — not `mt-auto` on the sheet — is what pins the bottom
          half down, and the only in-flow child is that sheet. This is byte for
          byte the root `Sheet` uses, which is deliberate: `mt-auto` here put the
          sheet at the *top* on an Android device while laying out correctly in a
          browser. Tailwind does emit the rule, NativeWind does translate it, and
          Yoga does implement auto margins — so the cause is somewhere further
          down and isn't reproducible off-device. Rather than keep a construction
          that's only known to work on one of our two targets, this uses the one
          every other sheet in the app already proves on both. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={themeVars} className="flex-1 justify-end">
        <Animated.View style={[{ backgroundColor: HOLD_SCRIM[scheme] }, scrim]} className="absolute inset-0">
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" className="flex-1" />
        </Animated.View>

        {/* ---- top: react, and what you're reacting to ---- */}
        {/* Below the thread header, not on top of it — the header stays visible
            behind the dim, and a reaction pill overlapping the back button reads
            as a mistake. 56 is the header's height.
            Pinned rather than in flow because the root is now bottom-aligned for
            the sheet; anything left in flow would ride up with it. */}
        <Animated.View
          style={[top, { position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top + 56 + 12 }]}
          className="px-4"
          pointerEvents="box-none"
        >
          <View
            style={{ backgroundColor: c.elevated }}
            className="flex-row items-center justify-between gap-1 self-center rounded-full px-2 py-1.5"
          >
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
                  style={on ? { backgroundColor: c.brandTint } : undefined}
                  className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
                >
                  <Text className="text-2xl">{e}</Text>
                </Pressable>
              );
            })}
          </View>

          {!isWhatsApp ? (
            <Text className="mt-2 self-center text-2xs text-faint">
              Only your team sees this reaction — email has none to deliver.
            </Text>
          ) : null}
        </Animated.View>

        {/* ---- bottom: the list you read ---- */}
        <GestureDetector gesture={pan}>
        <Animated.View style={bottom}>
          <Pressable
            onPress={() => {}}
            // A sink, not a control: it exists so a tap on the sheet doesn't
            // reach the scrim behind it. Left inaccessible, a screen reader
            // announces the whole sheet as one button and skips its contents.
            accessible={false}
            style={{ backgroundColor: c.elevated, paddingBottom: insets.bottom + 12 }}
            className="rounded-t-24 px-4 pt-3"
          >
            <View style={{ backgroundColor: c.borderStrong }} className="mb-2.5 h-1 w-9 self-center rounded-full" />

            {/* What the actions below apply to. It belongs here rather than
                floating over the thread: the real bubble is still on screen
                behind the dim, and a second copy of it out in the middle
                overlaps the original and reads as a duplicate. As the sheet's
                header it's a label, which is what it actually is. */}
            <Text numberOfLines={2} className="pb-1 text-sm text-muted">
              {summarise(shown)}
            </Text>

            {canQuote ? (
              <Row icon={<ReplyIcon size={19} color={c.textMuted} />} label="Reply" onPress={() => { onReply(); onClose(); }} />
            ) : null}
            {canForward ? (
              <Row icon={<ForwardIcon size={19} color={c.textMuted} />} label="Forward" onPress={() => { onForward(); onClose(); }} />
            ) : null}
            {receipts ? (
              <Row
                icon={<EyeIcon size={19} color={c.textMuted} />}
                label="Read receipts"
                trailing={`${receipts.seen} of ${receipts.total}`}
                onPress={() => { onReceipts(); onClose(); }}
              />
            ) : null}
          </Pressable>
        </Animated.View>
        </GestureDetector>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** One action in the bottom list. A hairline above each keeps the rows apart
 *  without a divider under the last one. */
function Row({
  icon,
  label,
  trailing,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ borderTopColor: c.border }}
      className="flex-row items-center gap-3 border-t py-3.5 active:opacity-60"
    >
      {icon}
      {/* The label grows rather than the trailing text carrying `ml-auto` —
          same reason as the sheet above: auto margins have burned us on device
          once and nothing here needs them. */}
      <Text className="flex-1 text-lg font-medium text-fg">{label}</Text>
      {trailing ? <Text className="text-md text-muted">{trailing}</Text> : null}
    </Pressable>
  );
}
