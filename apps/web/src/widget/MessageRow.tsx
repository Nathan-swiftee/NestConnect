import { useCallback, useEffect, useRef, useState } from "react";
import type { NestChatMessage, NestChatQuote } from "@ding/schemas";

/** How far a bubble has to travel before letting go replies. Short — this is a
 *  flick, not a drag, and every messenger that gets it right trips at about a
 *  thumb's width. */
const REPLY_PX = 56;

/** Past this the bubble stops following the finger one-for-one and starts
 *  resisting. Without it a hard swipe throws the bubble across the panel,
 *  which reads as a bug rather than as a gesture with a limit. */
const RUBBER_PX = 72;

/** The emoji offered. Six, because a row that needs scrolling is a menu. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/**
 * One message, and everything you can do to it.
 *
 * Three gestures share one row and they must not fight:
 *
 *  - a *horizontal drag* replies. Claimed only once the movement is clearly
 *    sideways, so a thumb travelling down the thread scrolls rather than
 *    arming a reply on every bubble it passes.
 *  - a *long press* opens the reactions. Cancelled the moment the finger
 *    moves, because a press that turned into a drag was a drag.
 *  - a *tap on a quote* jumps to what it answers.
 *
 * On a desktop there is no thumb, so the reply is a button that fades in on
 * hover — the same action, reached the way a mouse reaches things. Both end in
 * the same callback; there is no second code path for "desktop reply".
 */
export function MessageRow({
  message,
  children,
  onReply,
  onReact,
  onJumpToQuote,
  highlighted,
  canAct,
}: {
  message: NestChatMessage;
  children: React.ReactNode;
  onReply: (m: NestChatMessage) => void;
  onReact: (m: NestChatMessage, emoji: string) => void;
  onJumpToQuote: (quote: NestChatQuote) => void;
  /** Flashing because a reply above was tapped. */
  highlighted: boolean;
  /** False once the chat is closed: still readable, nothing left to do to it. */
  canAct: boolean;
}): JSX.Element {
  const [dx, setDx] = useState(0);
  const [picking, setPicking] = useState(false);
  const gesture = useRef<{ x: number; y: number; claimed: boolean } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mine = message.from === "visitor";
  const armed = dx >= REPLY_PX;

  const endPress = () => clearTimeout(press.current);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canAct || e.pointerType === "mouse") return;
    gesture.current = { x: e.clientX, y: e.clientY, claimed: false };
    // Long press → reactions. Half a second is the figure every phone keyboard
    // uses for its own long press, so it matches what the hand already expects.
    press.current = setTimeout(() => {
      if (gesture.current && !gesture.current.claimed) {
        setPicking(true);
        // The one place a buzz is right: the menu appears under a finger that
        // has not moved, and without it nothing tells the hand it worked.
        navigator.vibrate?.(8);
      }
    }, 500);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const moved = e.clientX - g.x;
    const drift = Math.abs(e.clientY - g.y);

    // Sideways, and more sideways than down. Until both are true this is a
    // scroll and the row must not take it.
    if (!g.claimed) {
      if (drift > 12 && drift > Math.abs(moved)) {
        gesture.current = null;
        endPress();
        return;
      }
      if (moved > 10 && Math.abs(moved) > drift) g.claimed = true;
      else return;
    }
    endPress();
    setDx(resist(Math.max(0, moved)));
  };

  const onPointerUp = () => {
    endPress();
    const claimed = gesture.current?.claimed;
    gesture.current = null;
    if (claimed && dx >= REPLY_PX) {
      navigator.vibrate?.(10);
      onReply(message);
    }
    // Always back to zero, so the bubble springs home whether or not it fired.
    setDx(0);
  };

  // Dismissing the emoji row by touching anywhere else, which is what every
  // menu on a phone does and what a finger reaches for first.
  useEffect(() => {
    if (!picking) return;
    const close = () => setPicking(false);
    // Deferred a frame: the press that opened it is still travelling, and
    // binding synchronously closes the menu with the same gesture.
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [picking]);

  const react = useCallback(
    (emoji: string) => {
      setPicking(false);
      onReact(message, emoji);
    },
    [message, onReact],
  );

  const mineReaction = message.reactions.find((r) => r.by === "visitor")?.emoji;

  return (
    <div
      className={`nc__msg nc__msg--${message.from}${highlighted ? " nc__msg--flash" : ""}`}
      data-message-id={message.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Behind the bubble, revealed by the swipe rather than moved with it —
          it belongs to the track, not to the message. */}
      {dx > 0 ? (
        <span className={`nc__swipe-hint${armed ? " nc__swipe-hint--armed" : ""}`} aria-hidden="true">
          <ReplyIcon />
        </span>
      ) : null}

      <div
        className="nc__slide"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          // Only while the finger is off it. Animating during the drag is what
          // makes a bubble feel like it is lagging behind the thumb.
          transition: dx ? "none" : "transform .22s cubic-bezier(.22,1,.36,1)",
        }}
      >
        {message.quote ? (
          <button
            type="button"
            className={`nc__quote${mine ? " nc__quote--mine" : ""}`}
            onClick={() => onJumpToQuote(message.quote!)}
          >
            <span className="nc__quote-who">
              {message.quote.from === "visitor" ? "You" : message.quote.authorName || "Them"}
            </span>
            <span className="nc__quote-text">{describeQuote(message.quote)}</span>
          </button>
        ) : null}

        {children}

        {message.reactions.length ? (
          <div className={`nc__reacts${mine ? " nc__reacts--mine" : ""}`}>
            {collapse(message.reactions).map(({ emoji, count, ours }) => (
              <button
                type="button"
                key={emoji}
                className={`nc__react${ours ? " nc__react--ours" : ""}`}
                // Tapping your own takes it off. The same tap that put it
                // there, which is the only removal anybody goes looking for.
                onClick={() => canAct && onReact(message, ours ? "" : emoji)}
                disabled={!canAct}
              >
                {emoji}
                {count > 1 ? <b>{count}</b> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {canAct ? (
        <button
          type="button"
          className="nc__reply-btn"
          onClick={() => onReply(message)}
          aria-label="Reply to this message"
          // Hidden from the tab order rather than from assistive tech: it
          // duplicates the swipe, and a keyboard user meets it once per
          // message otherwise.
          tabIndex={-1}
        >
          <ReplyIcon />
        </button>
      ) : null}

      {picking ? (
        <div className={`nc__picker${mine ? " nc__picker--mine" : ""}`} role="menu">
          {QUICK_REACTIONS.map((emoji, i) => (
            <button
              type="button"
              key={emoji}
              role="menuitem"
              className={mineReaction === emoji ? "nc__pick nc__pick--ours" : "nc__pick"}
              // Staggered so the row arrives as a row rather than as six
              // things appearing at once.
              style={{ animationDelay: `${i * 22}ms` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => react(mineReaction === emoji ? "" : emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Follow the finger, then resist. Past the threshold each further pixel is
 *  worth less, so a hard swipe eases into a stop instead of flying. */
function resist(px: number): number {
  if (px <= RUBBER_PX) return px;
  return RUBBER_PX + (px - RUBBER_PX) * 0.25;
}

/** One pill per emoji, with a count — not one pill per person. */
export function collapse(
  reactions: NestChatMessage["reactions"],
): { emoji: string; count: number; ours: boolean }[] {
  const out: { emoji: string; count: number; ours: boolean }[] = [];
  for (const r of reactions) {
    const seen = out.find((o) => o.emoji === r.emoji);
    if (seen) {
      seen.count++;
      seen.ours ||= r.by === "visitor";
    } else {
      out.push({ emoji: r.emoji, count: 1, ours: r.by === "visitor" });
    }
  }
  return out;
}

/** What a quote says when the message it quotes had no words. */
export function describeQuote(quote: NestChatQuote): string {
  if (quote.preview) return quote.preview;
  switch (quote.kind) {
    case "voice":
      return "Voice message";
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return "Attachment";
  }
}

function ReplyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z"
        fill="currentColor"
      />
    </svg>
  );
}
