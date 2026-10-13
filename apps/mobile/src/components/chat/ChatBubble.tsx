import { memo } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { chatNameColour, clockTime, isJumboEmoji, type ChatBubble as Bubble } from "@ding/client";
import { chatTicks, mentionParts, type ChatMember, type Mentionable, type MessageStatus } from "@ding/schemas";
import { mediaSource } from "../../api-config";
import { haptics } from "../../haptics";
import { useTheme } from "../../theme";
import { StarIcon } from "../../icons";
import { Attachments } from "../Attachments";
import { SharedCard } from "./Discuss";
import { Avatar } from "../Avatar";
import { SwipeToReply } from "../SwipeToReply";
import { Tail, tailCorner } from "../Tail";
import { Ticks } from "../Ticks";

/**
 * One message in a Team Chat thread: swipe it to reply, long-press it for the
 * rest. Mine on the right in the app's own tint, theirs on the left; in a group
 * the first of a run carries the sender's name (in their colour) and the last
 * carries their face and the tail — WhatsApp's grammar, which nobody has to
 * learn.
 */
export const ChatBubbleRow = memo(function ChatBubbleRow({
  m,
  first,
  last,
  mine,
  meId,
  group,
  members,
  people,
  canAct,
  onReply,
  onLongPress,
  onReact,
  onQuote,
  onRetry,
  starred = false,
}: {
  m: Bubble;
  first: boolean;
  last: boolean;
  mine: boolean;
  meId: string | undefined;
  group: boolean;
  members: ChatMember[];
  people: Mentionable[];
  canAct: boolean;
  onReply: (m: Bubble) => void;
  onLongPress: (m: Bubble) => void;
  onReact: (m: Bubble, emoji: string) => void;
  onQuote: (id: string) => void;
  onRetry: (m: Bubble) => void;
  starred?: boolean;
}) {
  const { c } = useTheme();
  const deleted = !!m.deletedAt;
  const files = deleted ? [] : (m.attachments ?? []);
  const jumbo = !deleted && !m.replyTo && !files.length && !m.shared && isJumboEmoji(m.body);
  const fill = mine ? c.brandTint : c.surface;
  const ticks = mine && !m.pending && !m.failed && !deleted ? chatTicks(m, members, m.author?.id ?? "") : null;
  const status: MessageStatus = m.pending ? "sending" : m.failed ? "failed" : (ticks ?? "sent");

  const bubble = (
    <Pressable
      onLongPress={() => {
        if (m.pending || m.failed || deleted) return;
        haptics.tap();
        onLongPress(m);
      }}
      delayLongPress={320}
      accessibilityRole="text"
      accessibilityHint="Long-press for reply, react and more"
      style={
        jumbo
          ? { maxWidth: "86%", paddingHorizontal: 2 }
          : {
              backgroundColor: fill,
              maxWidth: "86%",
              borderRadius: 14,
              paddingHorizontal: 10,
              paddingTop: 6,
              paddingBottom: 6,
              ...(last ? (mine ? { borderBottomRightRadius: tailCorner } : { borderBottomLeftRadius: tailCorner }) : {}),
            }
      }
    >
      {group && !mine && first && !jumbo ? (
        <Text style={{ color: chatNameColour(m.author?.id) }} className="mb-0.5 text-sm font-semibold">
          {m.author?.name ?? "Former teammate"}
        </Text>
      ) : null}
      {m.replyTo && !deleted ? (
        <Pressable
          onPress={() => onQuote(m.replyTo!.id)}
          accessibilityRole="button"
          accessibilityLabel={`Replying to ${m.replyTo.authorName}`}
          style={{ borderLeftColor: chatNameColour(m.replyTo.authorId), backgroundColor: mine ? "rgba(0,0,0,0.05)" : c.surface2 }}
          className="mb-1 rounded-8 border-l-4 px-2 py-1"
        >
          <Text style={{ color: chatNameColour(m.replyTo.authorId) }} className="text-sm font-semibold">
            {m.replyTo.authorId && m.replyTo.authorId === meId ? "You" : m.replyTo.authorName}
          </Text>
          <Text numberOfLines={2} className="text-sm text-muted">
            {m.replyTo.deleted ? "This message was deleted" : m.replyTo.body}
          </Text>
        </Pressable>
      ) : null}
      {m.shared && !deleted ? (
        <View style={{ width: 260, maxWidth: "100%" }} className="mb-1">
          <SharedCard shared={m.shared} onOpen={() => router.push({ pathname: "/(app)/thread/[id]", params: { id: m.shared!.conversationId } })} />
        </View>
      ) : null}
      {files.length ? <Attachments items={files} mine={mine} /> : null}
      {!deleted && !m.body ? null : (
      <Text
        style={deleted ? { fontStyle: "italic", color: c.textMuted } : jumbo ? { fontSize: 40, lineHeight: 48 } : undefined}
        className={jumbo ? "" : `text-lg leading-snug text-fg${files.length ? " mt-1" : ""}`}
      >
        {deleted
          ? mine
            ? "You deleted this message"
            : "This message was deleted"
          : mentionParts(m.body, people).map((p, i) =>
              p.mention ? (
                <Text key={i} style={{ color: "#1F7AEC", fontWeight: "600" }}>
                  {p.text}
                </Text>
              ) : (
                <Linked key={i} text={p.text} />
              ),
            )}
      </Text>
      )}
      {m.link && !deleted ? (
        <Pressable
          onPress={() => void Linking.openURL(m.link!.url)}
          accessibilityRole="link"
          accessibilityLabel={`${m.link.title}, open link`}
          style={{ borderLeftColor: c.wa, backgroundColor: mine ? "rgba(0,0,0,0.05)" : c.surface2, maxWidth: 280 }}
          className="mt-1.5 rounded-8 border-l-4 px-2.5 py-1.5"
        >
          {m.link.siteName ? (
            <Text style={{ color: c.wa }} className="text-2xs font-semibold lowercase">
              {m.link.siteName}
            </Text>
          ) : null}
          <Text numberOfLines={2} className="text-sm font-semibold text-fg">
            {m.link.title}
          </Text>
          {m.link.description ? (
            <Text numberOfLines={2} className="text-xs text-muted">
              {m.link.description}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      <View className="mt-0.5 flex-row items-center justify-end gap-1 self-end">
        {starred && !deleted ? (
          <View accessibilityLabel="Starred">
            <StarIcon size={11} color={c.textFaint} />
          </View>
        ) : null}
        {m.editedAt && !deleted ? <Text className="text-2xs italic text-faint">Edited</Text> : null}
        <Text className="text-2xs text-faint">{clockTime(m.createdAt)}</Text>
        {mine && !deleted ? <Ticks status={status} /> : null}
      </View>
      {last && !jumbo ? <Tail mine={mine} fill={fill} /> : null}
    </Pressable>
  );

  return (
    <View style={{ marginTop: first ? 8 : 2, marginBottom: m.reactions.length ? 14 : 0 }}>
      <SwipeToReply onReply={() => onReply(m)} mine={mine} enabled={canAct && !deleted && !m.pending && !m.failed}>
        <View className={`flex-row items-end ${mine ? "justify-end" : "justify-start"}`}>
          {group && !mine ? (
            <View style={{ width: 30, marginRight: 6 }}>
              {last && m.author ? (
                <Avatar name={m.author.name} color={m.author.avatarColor} size={28} photo={m.author.avatarUrl ? mediaSource(m.author.avatarUrl) : null} />
              ) : null}
            </View>
          ) : null}
          {bubble}
        </View>
      </SwipeToReply>
      {m.failed ? (
        <Pressable onPress={() => onRetry(m)} accessibilityRole="button" className="mt-1 self-end">
          <Text style={{ color: c.danger }} className="text-2xs font-semibold">
            Not sent · Tap to retry
          </Text>
        </Pressable>
      ) : null}
      {m.reactions.length ? (
        <View
          className={`flex-row gap-1 ${mine ? "self-end" : "self-start"}`}
          style={{ position: "absolute", bottom: -12, ...(mine ? { right: 10 } : { left: group ? 46 : 10 }) }}
        >
          {m.reactions.map((r) => {
            const minePicked = !!meId && r.userIds.includes(meId);
            return (
              <Pressable
                key={r.emoji}
                disabled={!canAct}
                onPress={() => onReact(m, r.emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${r.emoji} ${r.userIds.length}`}
                style={{ backgroundColor: c.surface, borderColor: minePicked ? c.wa : c.border }}
                className="h-6 flex-row items-center gap-0.5 rounded-full border px-1.5"
              >
                <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
                {r.userIds.length > 1 ? <Text className="text-2xs font-semibold text-muted">{r.userIds.length}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

/** Words, with any web links in them tappable. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(\bhttps?:\/\/[^\s<>"']+)/gi);
  if (parts.length === 1) return <Text>{text}</Text>;
  return (
    <Text>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        // "see https://x.com/a." — the full stop ends the sentence, not the link.
        const url = part.replace(/[.,;:!?)\]]+$/, "");
        return (
          <Text key={i}>
            <Text onPress={() => void Linking.openURL(url)} accessibilityRole="link" style={{ color: "#1F7AEC", textDecorationLine: "underline" }}>
              {url}
            </Text>
            {part.slice(url.length)}
          </Text>
        );
      })}
    </Text>
  );
}
