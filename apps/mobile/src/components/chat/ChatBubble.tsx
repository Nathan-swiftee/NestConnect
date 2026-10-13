import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { chatNameColour, clockTime, isJumboEmoji, type ChatBubble as Bubble } from "@ding/client";
import { chatTicks, mentionParts, type ChatMember, type Mentionable, type MessageStatus } from "@ding/schemas";
import { mediaSource } from "../../api-config";
import { haptics } from "../../haptics";
import { useTheme } from "../../theme";
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
}) {
  const { c } = useTheme();
  const deleted = !!m.deletedAt;
  const jumbo = !deleted && !m.replyTo && isJumboEmoji(m.body);
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
      <Text
        style={deleted ? { fontStyle: "italic", color: c.textMuted } : jumbo ? { fontSize: 40, lineHeight: 48 } : undefined}
        className={jumbo ? "" : "text-lg leading-snug text-fg"}
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
                <Text key={i}>{p.text}</Text>
              ),
            )}
      </Text>
      <View className="mt-0.5 flex-row items-center justify-end gap-1 self-end">
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
