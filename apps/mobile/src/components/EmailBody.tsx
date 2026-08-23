import { useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { ReduceMotion } from "react-native-reanimated";
import type { Message } from "@ding/schemas";
import { ChevronDown } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { type Block, estimateLines, parseEmail } from "../email-html";

/**
 * An email, rendered as an email rather than as a very long chat message.
 *
 * Three things separate the two, and all three are here:
 *
 *  - **A header.** Subject, Cc, "Forwarded to" — the fields that decide what a
 *    message *is*. On a chat bubble they'd be clutter; on an email they're how
 *    you know whether this is the thread you thought it was.
 *  - **Structure.** Paragraphs, headings, lists and links, instead of one
 *    undifferentiated run of text. Marketing email in particular is unreadable
 *    without it.
 *  - **A length limit.** Chat messages are a sentence; emails are a page, and a
 *    page of one message pushes the rest of the thread off the screen. Long
 *    bodies collapse to a readable preview with a way to open them.
 *
 * The quoted thread is separate from that limit and collapsed on its own,
 * because it's a different kind of hidden: the preview is hiding the rest of
 * *this* message, the quote block is hiding messages you have already read —
 * they're above it in this very thread.
 */

/** Past this many lines a body is long enough to be worth collapsing. Set just
 *  above a typical short reply, so the common case is never truncated. */
const PREVIEW_LINES = 12;

export function EmailBody({
  message,
  /** Outbound bubbles are tinted, so links and rules need the other contrast. */
  mine,
}: {
  message: Message;
  mine: boolean;
}) {
  const { c } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);

  const parsed = useMemo(
    () => parseEmail(message.bodyHtml, message.body ?? ""),
    [message.bodyHtml, message.body],
  );

  const longEnoughToCollapse = estimateLines(parsed.body) > PREVIEW_LINES;
  const shown = expanded || !longEnoughToCollapse ? parsed.body : preview(parsed.body, PREVIEW_LINES);

  const meta = message.email;
  const hasMeta = !!meta && !!(meta.subject || meta.cc?.length || meta.bcc?.length || meta.forwardedTo?.length);

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(24).stiffness(220).reduceMotion(ReduceMotion.System)}
    >
      {hasMeta ? (
        <View style={{ borderBottomColor: mine ? c.brandRing : c.border }} className="mb-2 gap-0.5 border-b pb-2">
          {meta!.forwardedTo?.length ? (
            <MetaRow label="Forwarded to" value={meta!.forwardedTo.join(", ")} />
          ) : null}
          {meta!.subject ? (
            <Text numberOfLines={2} className="text-md font-semibold leading-snug text-fg">
              {meta!.subject}
            </Text>
          ) : null}
          {meta!.cc?.length ? <MetaRow label="Cc" value={meta!.cc.join(", ")} /> : null}
          {meta!.bcc?.length ? <MetaRow label="Bcc" value={meta!.bcc.join(", ")} /> : null}
        </View>
      ) : null}

      <View className="gap-2">
        {shown.map((b, i) => (
          <BlockView key={i} block={b} mine={mine} />
        ))}
      </View>

      {longEnoughToCollapse ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            setExpanded((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          className="mt-1.5 flex-row items-center gap-1 self-start active:opacity-60"
        >
          <Text style={{ color: mine ? c.brandStrong : c.brand }} className="text-sm font-semibold">
            {expanded ? "Show less" : "Read more"}
          </Text>
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <ChevronDown size={13} color={mine ? c.brandStrong : c.brand} />
          </View>
        </Pressable>
      ) : null}

      {parsed.quoted.length ? (
        <View className="mt-2">
          <Pressable
            onPress={() => {
              haptics.tap();
              setShowQuoted((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityLabel={showQuoted ? "Hide quoted thread" : "Show quoted thread"}
            accessibilityState={{ expanded: showQuoted }}
            hitSlop={8}
            // The "•••" affordance every mail client uses for this. It reads as
            // "there is more here" without claiming to be a button for anything
            // in particular, which is right — what's under it is old news.
            style={{ backgroundColor: c.surface2 }}
            className="self-start rounded-full px-2.5 py-1 active:opacity-60"
          >
            <Text style={{ color: c.textMuted }} className="text-xs font-bold leading-none">
              •••
            </Text>
          </Pressable>
          {showQuoted ? (
            <View
              style={{ borderLeftColor: c.borderStrong }}
              className="mt-2 gap-2 border-l-2 pl-2.5"
            >
              {parsed.quoted.map((b, i) => (
                <BlockView key={i} block={b} mine={mine} quiet />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-1.5">
      <Text className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</Text>
      <Text numberOfLines={1} className="flex-1 text-2xs text-muted">
        {value}
      </Text>
    </View>
  );
}

function BlockView({ block, mine, quiet }: { block: Block; mine: boolean; quiet?: boolean }) {
  const { c } = useTheme();
  const link = mine ? c.brandStrong : c.brand;

  const body = (
    <Text
      className={
        block.kind === "h"
          ? "text-lg font-semibold leading-snug text-fg"
          : quiet || block.kind === "quote"
            ? "text-md leading-snug text-muted"
            : "text-lg leading-snug text-fg"
      }
    >
      {block.spans.map((s, i) =>
        s.href ? (
          <Text
            key={i}
            onPress={() => void Linking.openURL(s.href!).catch(() => {})}
            accessibilityRole="link"
            style={{ color: link, textDecorationLine: "underline" }}
          >
            {s.text}
          </Text>
        ) : (
          <Text
            key={i}
            style={{
              fontWeight: s.bold ? "600" : undefined,
              fontStyle: s.italic ? "italic" : undefined,
            }}
          >
            {s.text}
          </Text>
        ),
      )}
    </Text>
  );

  // A list item keeps its marker outside the text so wrapped lines align under
  // the first word rather than under the bullet.
  if (block.kind === "li") {
    return (
      <View className="flex-row gap-2 pl-1">
        <Text style={{ color: c.textFaint }} className="text-lg leading-snug">
          •
        </Text>
        <View className="flex-1">{body}</View>
      </View>
    );
  }
  return body;
}

/** Cut the body down to roughly `lines`, keeping whole blocks where possible and
 *  trimming the last one mid-sentence rather than dropping it entirely. */
function preview(blocks: Block[], lines: number): Block[] {
  const out: Block[] = [];
  let used = 0;
  for (const b of blocks) {
    const cost = estimateLines([b]);
    if (used + cost <= lines) {
      out.push(b);
      used += cost;
      continue;
    }
    const room = lines - used;
    if (room > 1) {
      const budget = room * 38;
      let taken = 0;
      const spans = [];
      for (const s of b.spans) {
        if (taken >= budget) break;
        spans.push({ ...s, text: s.text.slice(0, budget - taken) });
        taken += s.text.length;
      }
      if (spans.length) out.push({ ...b, spans: [...spans, { text: "…" }] });
    }
    break;
  }
  return out.length ? out : blocks.slice(0, 1);
}
