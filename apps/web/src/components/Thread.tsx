import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type JSX, type ReactNode } from "react";
import type { ChangeEvent as RChangeEvent, ClipboardEvent as RClipboardEvent, DragEvent as RDragEvent, PointerEvent as RPointerEvent } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import type { Message, Attachment, MessageStatus, ChannelType, WaWindow } from "@ding/schemas";
import { ClientEvent, ServerEvent } from "@ding/schemas";
import { useConversation, useMe, useSendMessage, useAssign, useSetStatus, useSnooze, useTeams, useMarkRead, useMarkUnread, useReact, useLoadOlderMessages, usePeople, useRetryMessage } from "../hooks";
import { api } from "../lib/api";
import { LabelPicker } from "./LabelPicker";
import { GlideMenu } from "./GlideMenu";
import { getSocket } from "../lib/socket";
import { relativeTime, lastActive, clockTime, initials, formatBytes, formatDuration, windowLeft, avatarBg } from "../lib/format";
import { Avatar } from "./Avatar";
import { useHoverGlide } from "../lib/useHoverGlide";
import { unlock } from "../lib/sound";
import { TemplatePicker } from "./TemplatePicker";
import {
  channelMeta,
  ClockIcon,
  ChevronDown,
  SnoozeIcon,
  TagIcon,
  DetailsIcon,
  MoreIcon,
  SendIcon,
  AttachIcon,
  EmojiIcon,
  LinkIcon,
  NoteIcon,
  ProfileIcon,
  RouteIcon,
  InboxIcon,
  MailIcon,
  CheckCircleIcon,
  ReopenIcon,
  BackIcon,
  BoltIcon,
  CheckSingle,
  CheckDouble,
  EyeIcon,
  AlertIcon,
  ReplyIcon,
  ForwardIcon,
  ImageIcon,
  PlayIcon,
  PauseIcon,
  DocIcon,
  DownloadIcon,
  XIcon,
  MicIcon,
  TrashIcon,
  RefreshIcon,
  EditIcon,
} from "../lib/icons";

interface Props {
  conversationId: string | null;
  showPanel: boolean;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
  onBack?: () => void;
  onClosed?: () => void;
  /** True only when this thread pane is actually the one on-screen. On mobile the
   *  list and the thread are separate panes (never both), and the thread stays
   *  MOUNTED behind the list — so this gates read receipts to when the agent can
   *  really see the message. Defaults to true (desktop always shows the thread). */
  active?: boolean;
}

/** Escape text so it can be safely interpolated into forwarded-email HTML. The
 *  server re-sanitizes the whole body before send; this just prevents a stray
 *  "<" or "&" in the original from mangling the composed markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMention(body: string): JSX.Element[] {
  return body.split(/(@[\w.+-]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="men">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Compact WhatsApp-style player for audio + voice notes. One <audio> element
 *  driven by state/refs: round play/pause, a seekable waveform (or progress
 *  bar), and an m:ss readout. */
function AudioPlayer({ att }: { att: Attachment }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const fallback = (att.durationMs ?? 0) / 1000;
  const [dur, setDur] = useState(fallback);
  const total = dur > 0 ? dur : fallback;
  const pct = total > 0 ? Math.min(1, cur / total) : 0;
  const wave = att.waveform && att.waveform.length ? att.waveform : null;

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  // elapsed once engaged; total duration while idle at the start
  const shown = playing || cur > 0 ? cur : total;

  return (
    <div className={"att voice" + (att.kind === "voice" ? " voice--note" : "")}>
      <button type="button" className="voice__btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="voice__body">
        <div
          className="voice__track"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          tabIndex={0}
          onClick={(e) => {
            const a = ref.current;
            if (!a || total <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            a.currentTime = ratio * total;
            setCur(a.currentTime);
          }}
          onKeyDown={(e) => {
            const a = ref.current;
            if (!a || total <= 0) return;
            if (e.key === "ArrowRight") { a.currentTime = Math.min(total, a.currentTime + 5); setCur(a.currentTime); }
            else if (e.key === "ArrowLeft") { a.currentTime = Math.max(0, a.currentTime - 5); setCur(a.currentTime); }
          }}
        >
          {wave ? (
            <div className="voice__wave" aria-hidden="true">
              {wave.map((v, i) => (
                <span
                  key={i}
                  className={"voice__wbar" + ((i + 0.5) / wave.length <= pct ? " on" : "")}
                  style={{ height: `${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="voice__bar" aria-hidden="true">
              <div className="voice__fill" style={{ width: `${pct * 100}%` }} />
            </div>
          )}
        </div>
        <div className="voice__time tnum">{formatDuration(shown * 1000)}</div>
      </div>
      <audio
        ref={ref}
        src={att.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCur(0); }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
      />
    </div>
  );
}

/** One attachment, rendered by kind. `onImage` opens the lightbox. */
function AttachmentView({ att, onImage }: { att: Attachment; onImage: (url: string) => void }) {
  if (att.kind === "audio" || att.kind === "voice") return <AudioPlayer att={att} />;

  if (att.kind === "video") {
    return <video className="att att-video" src={att.url} controls preload="metadata" />;
  }

  if (att.kind === "image" || att.kind === "sticker") {
    const sticker = att.kind === "sticker";
    return (
      <img
        className={"att att-img" + (sticker ? " att-img--sticker" : "")}
        src={att.url}
        alt={att.filename || (sticker ? "Sticker" : "Image")}
        loading="lazy"
        width={att.width || undefined}
        height={att.height || undefined}
        role="button"
        tabIndex={0}
        onClick={() => onImage(att.url)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onImage(att.url); }
        }}
      />
    );
  }

  // document / file
  const ext = att.filename.includes(".")
    ? att.filename.split(".").pop()!.toUpperCase()
    : (att.mime.split("/").pop() ?? "file").toUpperCase();
  return (
    <a className="att att-file" href={att.url} download={att.filename} title={att.filename}>
      <span className="att-file__ic"><DocIcon /></span>
      <span className="att-file__meta">
        <span className="att-file__name">{att.filename || "Download"}</span>
        <span className="att-file__sub tnum">{formatBytes(att.size)} · {ext}</span>
      </span>
      <span className="att-file__dl" aria-hidden="true"><DownloadIcon /></span>
    </a>
  );
}

const WA_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The WhatsApp 24-hour window derived from a thread's own messages. Used when
 *  the composer targets WhatsApp on a thread whose primary channel is *not*
 *  WhatsApp (a cross-channel reply) — the server-computed `conv.waWindow` already
 *  covers the WhatsApp-primary case. Open while the last WhatsApp inbound is
 *  under 24h old; closed (template required) when there's never been one. */
function computeWaWindow(messages: Message[]): WaWindow {
  const lastWaInbound = [...messages]
    .reverse()
    .find((m) => m.direction === "in" && (m.channel === "whatsapp" || m.channel === "whatsapp_group"));
  if (!lastWaInbound) return { open: false, expiresAt: null };
  const expires = new Date(lastWaInbound.createdAt).getTime() + WA_WINDOW_MS;
  return { open: Date.now() < expires, expiresAt: new Date(expires).toISOString() };
}

/** Pick whichever window expires later. The server value can go stale between
 *  refetches, so we merge it with one re-derived from the live message list —
 *  a new inbound is patched into the cache in realtime, which then resets the
 *  countdown here without needing a page refresh. */
function laterWindow(a: WaWindow | null, b: WaWindow | null): WaWindow | null {
  const ax = a?.expiresAt ? new Date(a.expiresAt).getTime() : 0;
  const bx = b?.expiresAt ? new Date(b.expiresAt).getTime() : 0;
  return bx > ax ? b : a;
}

/** Outbound delivery ticks: the full WhatsApp ladder
 *  Queued → Sent → Delivered → Read (blue), plus a red Failed indicator.
 *  Maps a message's status to a glyph, a tick class, and a human title. */
function StatusTick({ status }: { status: MessageStatus }) {
  let cls = "tick";
  let title: string;
  let icon: JSX.Element;
  switch (status) {
    // Both pre-sent states show WhatsApp's clock: "queued" (accepted, awaiting
    // dispatch) and "sending" (mid dispatch to Meta, not yet acked). Without the
    // "sending" case it fell through to the single-tick default, so a message
    // briefly showed 1 tick before it had actually been sent.
    case "queued":
    case "sending":
      cls += " pending";
      title = "Sending…";
      icon = <ClockIcon />;
      break;
    case "delivered":
      title = "Delivered";
      icon = <CheckDouble />;
      break;
    case "read":
      cls += " read";
      title = "Read";
      icon = <CheckDouble />;
      break;
    case "failed":
      cls += " failed";
      title = "Not delivered — tap to retry";
      icon = <AlertIcon />;
      break;
    case "sent":
    default:
      title = "Sent";
      icon = <CheckSingle />;
      break;
  }
  return (
    <span className={cls} role="img" aria-label={title} title={title}>
      {icon}
    </span>
  );
}

/** Renders a sanitized email HTML body inside a locked-down iframe. There is no
 *  `allow-scripts`, so nothing in the message can execute; a strict CSP blocks
 *  remote resources, and remote images stay hidden until the agent reveals them.
 *  `allow-same-origin` (without scripts) is only so the parent can read the
 *  content height to size the frame; `allow-popups` lets links open in a tab. */
function EmailHtml({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  // Remote images show by default; the bar below lets you hide them per message.
  const [showImages, setShowImages] = useState(true);
  const hasBlocked = html.includes("data-blocked-src");

  const srcDoc = useMemo(() => {
    const body = showImages ? html.replace(/data-blocked-src=/g, "src=") : html;
    const imgSrc = showImages ? "img-src data: https: http:" : "img-src data:";
    const csp = `default-src 'none'; ${imgSrc}; style-src 'unsafe-inline'; font-src data:; media-src data:`;
    return (
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank">` +
      // overscroll-behavior:none keeps a drag inside the frame from chaining out
      // to the page (iOS pull-to-refresh) even before the touch-forwarder attaches.
      `<style>html,body{margin:0;padding:0;overscroll-behavior:none}` +
      `body{padding:1px 2px;background:#fff;color:#1a1a1a;` +
      `font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
      `word-break:break-word;overflow-wrap:anywhere}` +
      `img{max-width:100%;height:auto}a{color:#0a7c66}` +
      `table{max-width:100%;border-collapse:collapse}` +
      `blockquote{margin:6px 0 6px 4px;padding-left:11px;border-left:3px solid #dcdcdc;color:#555}` +
      `pre{white-space:pre-wrap;word-break:break-word}` +
      `</style></head><body>${body}</body></html>`
    );
  }, [html, showImages]);

  // With allow-same-origin (and no scripts) the parent can read the rendered
  // height. Re-measure after load and a couple of beats for late reflow.
  const measure = () => {
    const d = ref.current?.contentDocument;
    if (d?.body) {
      const h = Math.max(d.body.scrollHeight, d.documentElement?.scrollHeight ?? 0);
      setHeight(Math.min(2000, Math.max(40, h + 6)));
    }
  };
  useEffect(() => {
    const timers = [60, 260, 700].map((d) => window.setTimeout(measure, d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [srcDoc]);

  // The sandboxed iframe is its own scrolling context, so a gesture that starts
  // over the email doesn't reach the thread's scroll container — it escapes to
  // the page (which scrolls, and on iOS triggers pull-to-refresh). Forward both
  // wheel (desktop) and touch-drag (iPad/touch) from inside the frame to the
  // thread's scroller so scrolling over the email scrolls the chat, and swallow
  // the default so the page can't scroll or reload.
  useEffect(() => {
    const iframe = ref.current;
    const scroller = iframe?.closest(".msgs") as HTMLElement | null;
    if (!iframe || !scroller) return;
    let doc: Document | null = null;
    let ty = 0;
    let tx = 0;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollTop += e.deltaY * unit;
      scroller.scrollLeft += e.deltaX * unit;
      e.preventDefault();
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // let two-finger pinch-zoom through
      ty = e.touches[0].clientY;
      tx = e.touches[0].clientX;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      scroller.scrollTop += ty - y;
      scroller.scrollLeft += tx - x;
      ty = y;
      tx = x;
      e.preventDefault(); // keep the gesture off the page (no scroll, no pull-to-refresh)
    };
    const attach = () => {
      doc?.removeEventListener("wheel", onWheel);
      doc?.removeEventListener("touchstart", onTouchStart);
      doc?.removeEventListener("touchmove", onTouchMove);
      doc = iframe.contentDocument;
      doc?.addEventListener("wheel", onWheel, { passive: false });
      doc?.addEventListener("touchstart", onTouchStart, { passive: false });
      doc?.addEventListener("touchmove", onTouchMove, { passive: false });
    };
    attach();
    iframe.addEventListener("load", attach);
    return () => {
      doc?.removeEventListener("wheel", onWheel);
      doc?.removeEventListener("touchstart", onTouchStart);
      doc?.removeEventListener("touchmove", onTouchMove);
      iframe.removeEventListener("load", attach);
    };
  }, [srcDoc]);

  return (
    <div className="emailhtml">
      {hasBlocked && (
        <button type="button" className="emailhtml__imgbar" onClick={() => setShowImages((s) => !s)}>
          <ImageIcon />
          <span className="emailhtml__imgtxt">
            {showImages ? "Remote images shown" : "Images hidden for your privacy"}
          </span>
          <span className="emailhtml__show">{showImages ? "Hide" : "Show images"}</span>
        </button>
      )}
      <iframe
        ref={ref}
        className="emailhtml__frame"
        title="Email message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        style={{ height }}
        onLoad={measure}
      />
    </div>
  );
}

/** Emoji offered in the quick-reaction bar (WhatsApp's default set). */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** A compact, curated set for the composer's emoji picker (no dependency). */
const COMPOSER_EMOJIS = [
  "😀","😄","😁","😅","😂","🙂","😉","😊","😍","😘","😎","🤩","🤗","🤔","😐","😴",
  "😌","🙃","😇","🥳","😢","😭","😤","😡","😱","🤯","🥺","😬","👍","👎","👏","🙏",
  "💪","🙌","👌","🤝","👋","🤙","💯","🔥","✨","🎉","🎊","❤️","🧡","💛","💚","💙",
  "💜","✅","❌","⚠️","⭐","💡","🚀","🎯","💰","📦","📅","⏰","💬","📞","📧","☕",
];

/** One-line label for a quoted message: media get an icon + kind, else the text. */
function quotedSnippet(q: Message): string {
  const body = (q.body ?? "").trim();
  if (body) return body;
  const a = q.attachments?.[0];
  if (a) {
    switch (a.kind) {
      case "image": return "📷 Photo";
      case "video": return "🎥 Video";
      case "voice": return "🎤 Voice message";
      case "audio": return "🎵 Audio";
      case "sticker": return "Sticker";
      default: return "📄 " + (a.filename || "Document");
    }
  }
  if (q.messageType === "location") return "📍 Location";
  if (q.messageType === "contact") return "👤 Contact";
  return "Message";
}

/** Forward an email on to other people. Collects recipient(s) + an optional
 *  note; the original email is quoted automatically. The send goes out as a
 *  fresh "Fwd:" email addressed to those people — not a reply to the customer —
 *  while still being logged in this conversation (Front-style). */
function ForwardModal({
  message,
  contactName,
  subject,
  onSubmit,
  onClose,
}: {
  message: Message;
  contactName: string;
  subject: string;
  onSubmit: (to: string, note: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  // Enabled once at least one entered address looks like an email.
  const valid = to
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .some((a) => a.includes("@"));
  const who = message.direction === "out" ? message.authorName || "You" : message.authorName || contactName;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSubmit(to, note);
  };
  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box modal--form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal__head">
          <h2>Forward email</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body">
          <label className="field">
            <span>To</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@example.com"
              type="text"
              inputMode="email"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Note <em className="field__opt">optional</em></span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a message above the forwarded email…"
              rows={3}
            />
          </label>
          <div className="fwdprev">
            <div className="fwdprev__subj">Fwd: {subject || "(no subject)"}</div>
            <div className="fwdprev__meta">From {who}</div>
            <div className="fwdprev__snip">{quotedSnippet(message)}</div>
          </div>
          <p className="fieldhint">
            This goes out as a new email to the people above — it won’t reply to the customer, but it stays
            logged in this conversation. Separate multiple addresses with commas.
          </p>
        </div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary fwd-go" disabled={!valid}>
            <ForwardIcon />
            Forward
          </button>
        </div>
      </form>
    </div>
  );
}

/** Per-message affordances threaded down from the Thread (react + reply). */
interface MsgActions {
  /** Display name to attribute the customer's reaction to. */
  contactName: string;
  /** Mobile long-press state — the reaction row is shown, centred above the msg. */
  held: boolean;
  /** Is this message's desktop actions (chevron) menu open? */
  menuOpen: boolean;
  /** Open the reaction row on this message (mobile long-press). */
  onHold: () => void;
  /** Toggle the desktop actions menu for this message. */
  onMenuToggle: () => void;
  /** Apply (or, with "", remove) the agent's reaction. */
  onReact: (emoji: string) => void;
  /** Start a quoted reply to this message. */
  onReply: () => void;
  /** Forward this email on to someone else (email messages only; absent otherwise). */
  onForward?: () => void;
  /** Open the read-receipts view for this sent email (email with recipients only). */
  onReceipts?: () => void;
  /** Scroll to a quoted message when its preview is tapped. */
  onJump: (messageId: string) => void;
}

/** Per-recipient read receipts under an outbound email bubble (Front-style): a
 *  compact "Seen by N of M" line plus one row per To/Cc recipient with their open
 *  time (or "Sent" while unopened). Each recipient got their own tracked copy. */
function ReadReceipts({
  recipients,
}: {
  recipients: { address: string; kind: "to" | "cc"; openedAt?: string | null }[];
}) {
  const seen = recipients.filter((r) => r.openedAt).length;
  const total = recipients.length;
  const summary =
    seen === 0
      ? "Not seen yet"
      : seen === total
        ? total === 1
          ? "Seen"
          : "Seen by everyone"
        : `Seen by ${seen} of ${total}`;
  return (
    <div className="rcpts">
      <div className={"rcpts__head" + (seen ? " rcpts__head--seen" : "")}>
        <EyeIcon />
        <span>{summary}</span>
      </div>
      <div className="rcpts__list">
        {recipients.map((r) => (
          <div key={r.kind + r.address} className={"rcpt" + (r.openedAt ? " rcpt--seen" : "")}>
            <span className="rcpt__ic">
              {r.openedAt ? <CheckDouble /> : <span className="rcpt__dot" aria-hidden="true" />}
            </span>
            <span className="rcpt__addr" title={r.address}>
              {r.address}
            </span>
            {r.kind === "cc" && <span className="rcpt__cc">Cc</span>}
            <span className="rcpt__time">{r.openedAt ? relativeTime(r.openedAt) : "Sent"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Read receipts for a sent email, opened from the message's ⌄ menu (kept out of
 *  the thread itself). Live: reflects opens as they arrive over the socket. */
function ReceiptsModal({
  recipients,
  subject,
  onClose,
}: {
  recipients: { address: string; kind: "to" | "cc"; openedAt?: string | null }[];
  subject: string;
  onClose: () => void;
}) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box rcptmodal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Read receipts</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">
          {subject && <div className="rcptmodal__subj">{subject}</div>}
          <ReadReceipts recipients={recipients} />
          <p className="fieldhint">
            A “Seen” is recorded when the recipient’s email app loads images. Some apps (e.g. Apple Mail)
            load them automatically, so treat this as a strong signal, not a guarantee.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A single customer/agent message bubble, with any media rendered above an
 *  optional caption. Carries a quoted-reply preview, an emoji-reaction chip, and
 *  a hover toolbar (reply + react). Text-only markup is otherwise unchanged. */
function MessageBubble({
  m,
  quoted,
  onImage,
  actions,
  convChannel,
  onRetry,
}: {
  m: Message;
  quoted?: Message;
  onImage: (url: string) => void;
  actions?: MsgActions;
  /** The conversation's own channel — a message on a different one (cross-channel
   *  reply) carries a small badge so the mixed thread stays legible. */
  convChannel: ChannelType;
  /** Re-attempt delivery of this message (shown only on a failed outbound send). */
  onRetry?: (messageId: string) => void;
}) {
  const out = m.direction === "out";

  // Touch gestures (mobile), WhatsApp-style: a long-press opens the reaction row,
  // a rightward swipe starts a reply. Both begin from one pointerdown — a
  // horizontal drag cancels the press and follows the finger (imperatively, via a
  // ref, so there's no per-frame React state), a vertical drag hands scrolling
  // back to the list. Mouse/pen (desktop) is ignored here; desktop uses hover.
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const gestureRef = useRef<{ x: number; y: number; lp: number; swiping: boolean; active: boolean } | null>(null);
  // Inbound swipes right, outbound swipes left — mirrored, like WhatsApp. `dir`
  // flips the translate direction; the reply arrow side is mirrored in CSS.
  const dir = out ? -1 : 1;
  const setSwipe = (px: number) => {
    if (bubbleRef.current) bubbleRef.current.style.transform = px ? `translateX(${dir * px}px)` : "";
    if (hintRef.current) {
      // Reply arrow fades and grows as the bubble slides, snapping to full size
      // right at the commit threshold (WhatsApp feel).
      const t = Math.min(px / 56, 1);
      hintRef.current.style.opacity = String(t);
      hintRef.current.style.transform = `translateY(-50%) scale(${(0.55 + t * 0.45).toFixed(3)})`;
      hintRef.current.classList.toggle("ready", px >= 52);
    }
  };
  const endGesture = (commit: boolean) => {
    const b = bubbleRef.current;
    if (b) {
      // Spring the bubble back to rest — this smooth slide-back is the feedback,
      // no ring flash.
      b.style.transition = "transform .2s var(--ease)";
      b.style.transform = "";
      window.setTimeout(() => { if (b) b.style.transition = ""; }, 220);
    }
    if (hintRef.current) {
      hintRef.current.style.opacity = "0";
      hintRef.current.style.transform = "";
      hintRef.current.classList.remove("ready");
    }
    if (commit && actions) {
      navigator.vibrate?.(12);
      actions.onReply();
    }
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!actions || e.pointerType !== "touch") return;
    const g = { x: e.clientX, y: e.clientY, swiping: false, active: true, lp: 0 };
    gestureRef.current = g;
    g.lp = window.setTimeout(() => {
      if (gestureRef.current === g && !g.swiping) {
        g.active = false;
        actions.onHold();
        navigator.vibrate?.(8);
      }
    }, 450);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || !g.active) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const along = dx * dir; // positive when swiping in the reply direction for this bubble
    if (!g.swiping) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { g.active = false; window.clearTimeout(g.lp); return; }
      if (along > 10 && along > Math.abs(dy)) { g.swiping = true; window.clearTimeout(g.lp); }
    }
    if (g.swiping) setSwipe(Math.max(0, Math.min(along, 92)));
  };
  const onPointerEnd = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    window.clearTimeout(g.lp);
    if (g.swiping) endGesture((e.clientX - g.x) * dir > 52);
    gestureRef.current = null;
  };
  const atts = m.attachments ?? [];
  const hasMedia = atts.length > 0;
  const hasCaption = !!m.body && m.body.trim().length > 0;
  const single = atts.length === 1 ? atts[0] : null;
  const stickerOnly = !!single && single.kind === "sticker" && !hasCaption;
  // a lone image/video with no caption carries the floating timestamp chip
  const overlay = !!single && !hasCaption && (single.kind === "image" || single.kind === "video");
  // other media with no caption gets the timestamp on its own row underneath
  const blockStamp = hasMedia && !hasCaption && !overlay;
  const fallback = m.messageType === "location" ? "Location shared" : m.messageType === "contact" ? "Contact shared" : "";
  const showText = hasCaption || !hasMedia;
  const bodyText = hasCaption ? m.body : hasMedia ? "" : m.body || fallback;

  const reactions = m.reactions ?? [];
  const mine = reactions.find((r) => r.by === "user")?.emoji;
  const reactTitle = reactions
    .map((r) => `${r.emoji} ${r.by === "user" ? "You" : actions?.contactName ?? "Customer"}`)
    .join(",  ") + (mine ? " · tap to remove yours" : "");
  // A rich email body renders in its own sandboxed frame (below any media).
  const isEmailHtml = !!m.bodyHtml;
  // An email message reads as an email — a white bubble, not the WhatsApp green.
  // Rich HTML emails already get the white .bubble--email card; this covers the
  // plain-text ones.
  const isMailMsg = (m.channel ?? convChannel) === "email";
  // A message sent/received on a channel other than the thread's own is badged.
  const crossMeta = m.channel && m.channel !== convChannel ? channelMeta(m.channel) : null;
  const CrossGlyph = crossMeta?.Glyph;
  // Outbound (non-internal) messages carry a "SENT BY {agent}" label in their
  // meta row — so a shared inbox shows who replied, on WhatsApp and email alike.
  // It needs the flow (block) stamp layout, not the compact absolute overlay,
  // to fit a variable-width name beside the time + ticks.
  const namedMeta = out && !m.internal && !!m.authorName;
  // The inline WhatsApp-style overlay (+ its reserved spacer) is only used when
  // the stamp isn't already a block row or an image chip.
  const inlineStamp = !(isEmailHtml || blockStamp || namedMeta || overlay);

  return (
    <div
      className={"msg " + (out ? "out" : "in") + (actions ? " msg--gesture" : "")}
      data-mid={m.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {!out && m.authorName && <div className="sender">{m.authorName}</div>}
      <div className="bubblewrap">
        <div
          ref={bubbleRef}
          className={
            "bubble" +
            (hasMedia ? " has-media" : "") +
            (stickerOnly ? " bubble--plain" : "") +
            (isEmailHtml ? " bubble--email" : "") +
            (isMailMsg && !isEmailHtml ? " bubble--mail" : "")
          }
        >
          {m.email &&
            (m.email.subject || m.email.cc?.length || m.email.bcc?.length || m.email.forwardedTo?.length) && (
              <div className="emailmeta">
                {m.email.forwardedTo?.length ? (
                  <div className="emailmeta__row emailmeta__fwd">
                    <span className="emailmeta__lbl">
                      <ForwardIcon />
                      Forwarded to
                    </span>
                    {m.email.forwardedTo.join(", ")}
                  </div>
                ) : null}
                {m.email.subject && <div className="emailmeta__subj">{m.email.subject}</div>}
                {m.email.cc?.length ? (
                  <div className="emailmeta__row">
                    <span className="emailmeta__lbl">Cc</span>
                    {m.email.cc.join(", ")}
                  </div>
                ) : null}
                {m.email.bcc?.length ? (
                  <div className="emailmeta__row">
                    <span className="emailmeta__lbl">Bcc</span>
                    {m.email.bcc.join(", ")}
                  </div>
                ) : null}
              </div>
            )}
          {quoted && (
            <button
              type="button"
              className="quoted"
              onClick={() => actions?.onJump(quoted.id)}
              title="View replied message"
            >
              <span className="quoted__accent" aria-hidden="true" />
              <span className="quoted__body">
                <span className="quoted__who">
                  {quoted.direction === "out" ? "You" : quoted.authorName || actions?.contactName || "Customer"}
                </span>
                <span className="quoted__txt">{quotedSnippet(quoted)}</span>
              </span>
            </button>
          )}
          {hasMedia && atts.map((a) => <AttachmentView key={a.id} att={a} onImage={onImage} />)}
          {isEmailHtml ? (
            <EmailHtml html={m.bodyHtml as string} />
          ) : (
            showText && (
              <span className="txt">
                {bodyText}
                {inlineStamp && <span className="stampspace" aria-hidden="true" />}
              </span>
            )
          )}
          <span
            className={"stamp" + (isEmailHtml || blockStamp || namedMeta ? " stamp--block" : overlay ? " stamp--over" : "")}
          >
            {namedMeta && (
              <span className="stamp__by" title={`Sent by ${m.authorName}`}>
                Sent by {m.authorName}
              </span>
            )}
            {crossMeta && CrossGlyph && (
              <span className="stamp__chan" style={{ color: crossMeta.color }} title={`Via ${crossMeta.label}`}>
                <CrossGlyph />
              </span>
            )}
            {clockTime(m.createdAt)}
            {out && !m.internal && <StatusTick status={m.status} />}
          </span>
        </div>

        {out && m.status === "failed" && (
          <div className="msgfail" role="alert">
            <AlertIcon />
            <span className="msgfail__txt">{m.failureReason || "Not delivered"}</span>
            {onRetry && (
              <button type="button" className="msgfail__retry" onClick={() => onRetry(m.id)}>
                Retry
              </button>
            )}
          </div>
        )}

        {actions && (
          <>
            {/* Desktop: chevron in the bubble's inner corner → actions menu (hover) */}
            <button
              type="button"
              className="msg__menubtn"
              aria-label="Message actions"
              aria-haspopup="menu"
              aria-expanded={actions.menuOpen}
              onClick={actions.onMenuToggle}
            >
              <ChevronDown />
            </button>
            {/* Desktop: a smiley on the outer side of the bubble; click it to open
                the reaction picker (WhatsApp-web). Hidden on touch (long-press there). */}
            <button
              type="button"
              className="msg__reactbtn"
              aria-label="React to message"
              onClick={actions.onHold}
            >
              <EmojiIcon />
            </button>
            {actions.menuOpen && (
              <div className="msg__menu" role="menu">
                {/* React lives in the menu too — it's the reliable path on touch,
                    where the long-press gesture can't reach an email bubble's
                    iframe. Opens the same quick-reaction row. */}
                <button type="button" className="msg__menuitem msg__menuitem--touch" role="menuitem" onClick={actions.onHold}>
                  <EmojiIcon />
                  <span>React</span>
                </button>
                <button type="button" className="msg__menuitem" role="menuitem" onClick={actions.onReply}>
                  <ReplyIcon />
                  <span>Reply</span>
                </button>
                {actions.onForward && (
                  <button type="button" className="msg__menuitem" role="menuitem" onClick={actions.onForward}>
                    <ForwardIcon />
                    <span>Forward</span>
                  </button>
                )}
                {actions.onReceipts && (
                  <button type="button" className="msg__menuitem" role="menuitem" onClick={actions.onReceipts}>
                    <EyeIcon />
                    <span>Read receipts</span>
                  </button>
                )}
              </div>
            )}
            {/* Quick-reaction row — desktop: above the near corner (hover); mobile: centred (held) */}
            <div className={"msg__react" + (actions.held ? " held" : "")} role="menu" aria-label="Pick a reaction">
              {QUICK_REACTIONS.map((e, i) => (
                <button
                  key={e}
                  type="button"
                  className={"msg__react-e" + (mine === e ? " sel" : "")}
                  style={{ animationDelay: `${i * 25}ms` }}
                  onClick={() => actions.onReact(mine === e ? "" : e)}
                  aria-label={mine === e ? `Remove ${e}` : `React ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
            {/* Swipe-to-reply hint, revealed behind the bubble as it slides (touch) */}
            <span className="msg__swipehint" aria-hidden="true" ref={hintRef}>
              <ReplyIcon />
            </span>
          </>
        )}
        {reactions.length > 0 && (
          <div
            className={"reacts" + (mine ? " reacts--mine" : "")}
            role={mine && actions ? "button" : undefined}
            tabIndex={mine && actions ? 0 : undefined}
            title={reactTitle}
            onClick={mine && actions ? () => actions.onReact("") : undefined}
            onKeyDown={
              mine && actions
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      actions.onReact("");
                    }
                  }
                : undefined
            }
          >
            {reactions.map((r, i) => (
              <span key={i} className="reacts__e">{r.emoji}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function dayLabel(iso?: string): string {
  if (!iso) return "Today";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Split messages into consecutive same-day groups so each day's sticky pill
 *  lives in its own section and gets pushed out by the next day's pill. */
function groupMessagesByDay(messages: Message[]): { key: string; label: string; items: Message[] }[] {
  const groups: { key: string; label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const key = new Date(m.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: dayLabel(m.createdAt), items: [m] });
  }
  return groups;
}

/* ─── Composer media staging ────────────────────────────────────────────
   Files picked / dropped / pasted and voice recordings are staged locally,
   uploaded straight away, then referenced by id on send. */
type StagedKind = "image" | "video" | "voice" | "document" | "audio";
type StagedStatus = "uploading" | "done" | "error";

type Staged = {
  localId: string;
  file: File | Blob;
  name: string;
  previewUrl?: string;
  kind: StagedKind;
  status: StagedStatus;
  attachment?: Attachment;
  durationMs?: number;
  waveform?: number[];
};

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "heif", "avif"];
const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "avi", "m4v"];
const AUDIO_EXT = ["mp3", "ogg", "oga", "wav", "m4a", "aac", "opus", "flac"];

/** Classify a picked/dropped/pasted file into a staged media kind. */
function kindOfFile(file: File | Blob, name: string): StagedKind {
  const mime = file.type || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return "document";
}

/** Intrinsic pixel size of an image blob (best-effort; resolves {} on failure). */
function imageSize(file: File | Blob): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    img.src = url;
  });
}

/** Best supported MediaRecorder mime for a voice note (WhatsApp prefers ogg/opus). */
function pickAudioMime(): string {
  const rec = typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined;
  if (!rec?.isTypeSupported) return "";
  for (const c of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]) {
    if (rec.isTypeSupported(c)) return c;
  }
  return "";
}

/** Decode a recorded blob → duration + ~40-bucket peak waveform (0..1). */
async function analyzeAudio(
  blob: Blob,
  fallbackMs: number,
): Promise<{ durationMs: number; waveform?: number[] }> {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return { durationMs: fallbackMs };
    const ctx = new Ctx();
    try {
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      const durationMs = Math.round(audio.duration * 1000) || fallbackMs;
      const data = audio.getChannelData(0);
      const buckets = 40;
      const size = Math.max(1, Math.floor(data.length / buckets));
      const peaks: number[] = [];
      let max = 0;
      for (let b = 0; b < buckets; b++) {
        let peak = 0;
        const start = b * size;
        for (let i = 0; i < size && start + i < data.length; i++) {
          const v = Math.abs(data[start + i]);
          if (v > peak) peak = v;
        }
        peaks.push(peak);
        if (peak > max) max = peak;
      }
      const waveform = max > 0 ? peaks.map((p) => Math.min(1, p / max)) : undefined;
      return { durationMs, waveform };
    } finally {
      void ctx.close();
    }
  } catch {
    return { durationMs: fallbackMs };
  }
}

/** One staged-attachment chip: image thumbnail, voice note, or file card. */
function StagedChip({
  s,
  onRemove,
  onRetry,
}: {
  s: Staged;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const uploading = s.status === "uploading";
  const err = s.status === "error";
  const size = s.attachment?.size ?? s.file.size;
  const spin = <span className="comp-att__spin" aria-hidden="true" />;

  let inner: JSX.Element;
  if (s.kind === "image" && s.previewUrl) {
    inner = (
      <div className="comp-att__thumb">
        <img src={s.previewUrl} alt={s.name} />
        {uploading && <span className="comp-att__load" aria-hidden="true">{spin}</span>}
      </div>
    );
  } else if (s.kind === "voice") {
    inner = (
      <div className="comp-att__voice">
        <span className="comp-att__ic">{uploading ? spin : <MicIcon />}</span>
        {s.waveform && s.waveform.length > 0 && (
          <span className="comp-att__wave" aria-hidden="true">
            {s.waveform.slice(0, 28).map((v, i) => (
              <span key={i} style={{ height: `${Math.round(Math.max(0.12, Math.min(1, v)) * 100)}%` }} />
            ))}
          </span>
        )}
        <span className="comp-att__dur tnum">{formatDuration(s.durationMs ?? 0)}</span>
      </div>
    );
  } else {
    inner = (
      <div className="comp-att__file">
        <span className="comp-att__ic">{uploading ? spin : <DocIcon />}</span>
        <span className="comp-att__meta">
          <span className="comp-att__name" title={s.name}>
            {s.name}
          </span>
          <span className="comp-att__sub tnum">{err ? "Upload failed" : formatBytes(size)}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={"comp-att comp-att--" + s.kind + (err ? " comp-att--error" : "")}>
      {inner}
      {err && (
        <button
          type="button"
          className="comp-att__err"
          onClick={onRetry}
          title="Upload failed — retry"
          aria-label="Retry upload"
        >
          <RefreshIcon />
        </button>
      )}
      <button
        type="button"
        className="comp-att__x"
        onClick={onRemove}
        title="Remove"
        aria-label={"Remove " + s.name}
      >
        <XIcon />
      </button>
    </div>
  );
}

export function Thread({ conversationId, showPanel, onTogglePanel, onToast, onBack, onClosed, active = true }: Props) {
  const { data: conv } = useConversation(conversationId);
  const { loadOlder, loading: loadingOlder } = useLoadOlderMessages(conversationId);
  const { data: me } = useMe();
  const { data: teams } = useTeams();
  const send = useSendMessage();
  const assign = useAssign();
  const setStatus = useSetStatus();
  const snooze = useSnooze();
  const { mutate: markRead } = useMarkRead();
  const { mutate: markUnread } = useMarkUnread();
  const { mutate: react } = useReact();
  const { mutate: retry } = useRetryMessage();
  const { data: people } = usePeople();

  const [text, setText] = useState("");
  // The message being quoted in a reply (shown as a cue above the composer), and
  // which message's quick-reaction bar is open. Both reset when the thread changes.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The email message currently being forwarded (drives the forward modal).
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  // The id of the sent email whose read receipts are open (resolved live from the
  // thread each render, so the modal updates as opens arrive over the socket).
  const [receiptsMsgId, setReceiptsMsgId] = useState<string | null>(null);
  // Rich-text HTML for an email reply (mirrors the Tiptap editor's content).
  const [html, setHtml] = useState("");
  // Composer emoji picker, and the email Cc/Bcc fields (revealed on demand).
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  // The editable email subject (the thread's subject; empty on a fresh email).
  const [subjectDraft, setSubjectDraft] = useState(conv?.subject ?? "");
  // Subject shows compact ("Subject: …" + pencil) until you tap to edit it.
  const [editingSubject, setEditingSubject] = useState(false);
  // Another agent typing on THIS conversation ("{who} is typing…"); null when idle.
  const [typingWho, setTypingWho] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [internal, setInternal] = useState(false);
  // @-mention autocomplete for internal notes: the active "@query" being typed
  // (with the '@' index in `text`), and the highlighted candidate.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionSel, setMentionSel] = useState(0);
  // The channel the composer is currently replying on. null → follow the
  // conversation's own channel; set (via the channel switcher) to reply on
  // another channel the customer is reachable on, within this one open thread.
  const [composeChannelState, setComposeChannelState] = useState<ChannelType | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  // Ticks so the WhatsApp 24-hour window countdown stays live without a reload.
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  // ─── Read receipts + typing indicator bookkeeping ───
  // Track the last-seen (conversation, message-count) so we can mark-read exactly
  // once on open and again only when a *new inbound* message lands while open.
  const seenRef = useRef<{ id: string | null; len: number }>({ id: null, len: 0 });
  const typingSentRef = useRef(false); // have we emitted typing:true since the last stop?
  const typingThrottleRef = useRef(0); // last time we emitted typing:true (ms epoch)
  const typingStopRef = useRef<number | null>(null); // idle timer that emits typing:false
  const typingClearRef = useRef<number | null>(null); // auto-clears the incoming indicator
  const waTypingRef = useRef(0); // last time we pinged WhatsApp's typing indicator (ms epoch)
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Latest typing-signal fn, so the editor's (once-created) onUpdate calls the
  // current one without a stale closure.
  const typingSignalRef = useRef<() => void>(() => {});
  // Maintained rich-text editor for email replies (replaces document.execCommand).
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }), // email bodies don't need headings
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Placeholder.configure({ placeholder: "Write a reply…" }),
    ],
    editorProps: {
      attributes: { class: "richedit", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
      setText(editor.getText());
      typingSignalRef.current();
    },
  });
  // Conversations we've already auto-opened the template picker for (cold WA starts).
  const autoTemplateRef = useRef<Set<string>>(new Set());
  const modeThumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: modeRef, thumbRef: modeHoverRef, hoverProps: modeHover } = useHoverGlide<HTMLDivElement>(".modebtn", "x");

  // ─── Composer media state ───
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const stagedRef = useRef<Staged[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  const recBaseRef = useRef(0); // ms accumulated across pause/resume segments
  const recCancelRef = useRef(false);
  const recSendRef = useRef(false); // send the clip the instant it finalizes

  // Scroll behaviour:
  //  • Opening a thread → jump to the OLDEST UNREAD message (top-aligned), so you
  //    start reading where you left off — not at a smooth-scrolled guess that
  //    lands mid-reflow as images / email frames size up. Instant, and corrected
  //    once after late reflow. Falls back to the newest when nothing's unread.
  //  • A new message in the already-open thread → smooth-scroll to the bottom.
  const openedRef = useRef<string | null>(null);
  const lastLenRef = useRef(0);
  useEffect(() => {
    if (!conv) return;
    const len = conv.messages.length;
    const opening = openedRef.current !== conversationId;
    if (!opening) {
      if (len > lastLenRef.current) endRef.current?.scrollIntoView({ behavior: "smooth" });
      lastLenRef.current = len;
      return;
    }
    openedRef.current = conversationId ?? null;
    lastLenRef.current = len;
    // Oldest unread = the first of the last `unreadCount` inbound messages.
    let targetId: string | null = null;
    let remaining = conv.unreadCount ?? 0;
    if (remaining > 0) {
      for (let i = len - 1; i >= 0; i--) {
        const m = conv.messages[i];
        if (m.direction === "in" && !m.internal && --remaining === 0) {
          targetId = m.id;
          break;
        }
      }
    }
    const jump = () => {
      const el = targetId && document.querySelector<HTMLElement>(`[data-mid="${targetId}"]`);
      if (el) el.scrollIntoView({ block: "start", behavior: "auto" });
      else endRef.current?.scrollIntoView({ behavior: "auto" });
    };
    const raf = requestAnimationFrame(jump);
    const correct = window.setTimeout(jump, 220); // re-settle after late reflow
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(correct);
    };
  }, [conv, conversationId]);

  // Close the image lightbox on Esc while it's open.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Re-tick the WhatsApp window countdown ~every 30s; cleared on unmount.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // A newly-opened conversation should show a fresh countdown immediately and
  // drop any pending reply-quote / open reaction bar from the previous thread.
  useEffect(() => {
    setNow(Date.now());
    setPicker(false);
    setReplyTo(null);
    setReactFor(null);
    setHtml("");
    setEmojiOpen(false);
    setShowCc(false);
    setCc("");
    setBcc("");
    setComposeChannelState(null);
    editor?.commands.clearContent();
  }, [conversationId, editor]);

  // Keep the editable email subject synced to the thread: it resets when
  // switching threads and reflects a subject set elsewhere. conv.subject only
  // changes on a send, so this never clobbers an in-progress edit.
  useEffect(() => {
    setSubjectDraft(conv?.subject ?? "");
  }, [conversationId, conv?.subject]);

  // Starting a *new* WhatsApp conversation lands on a cold, window-closed thread
  // where an approved template is the only way to open the conversation — so
  // present the template picker straight away (once per conversation).
  useEffect(() => {
    if (!conv) return;
    const isWa = conv.channel === "whatsapp" || conv.channel === "whatsapp_group";
    const coldStart = isWa && !!conv.waWindow && !conv.waWindow.open && conv.messages.length === 0;
    if (coldStart && !autoTemplateRef.current.has(conv.id)) {
      autoTemplateRef.current.add(conv.id);
      setPicker(true);
    }
  }, [conv?.id, conv?.channel, conv?.waWindow?.open, conv?.messages.length]);

  // Dismiss the composer emoji picker on outside click or Esc.
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".emojipop") && !t.closest(".tool--emoji")) setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEmojiOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  // Dismiss an open reaction row / actions menu on outside click or Esc.
  useEffect(() => {
    if (!reactFor && !menuFor) return;
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".msg__react") && !t.closest(".msg__reactbtn") && !t.closest(".msg__menubtn")) setReactFor(null);
      if (!t.closest(".msg__menu") && !t.closest(".msg__menubtn")) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setReactFor(null); setMenuFor(null); }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [reactFor, menuFor]);

  // Slide the mode thumb under the active tab (a channel, or Note). Positioned by
  // querying the active button — the compose channel isn't resolved until after
  // the loading guards below, so we can't thread a ref through per tab. Written to
  // the DOM directly (no state) so the slide starts on the click's own frame.
  useLayoutEffect(() => {
    const thumb = modeThumbRef.current;
    const btn = modeRef.current?.querySelector<HTMLElement>(".modebtn.active");
    if (btn && thumb) {
      thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
      thumb.style.width = `${btn.offsetWidth}px`;
    }
  }, [internal, composeChannelState, conversationId, conv?.status]);

  // Mirror staged items into a ref so teardown can revoke URLs without re-binding.
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // Release object URLs, the mic stream and timers when the thread unmounts.
  useEffect(() => {
    return () => {
      stagedRef.current.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current != null) window.clearInterval(recTimerRef.current);
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        recCancelRef.current = true;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
    };
  }, []);

  // Switching conversations abandons any half-composed media + recording, so an
  // attachment can never be sent to the wrong thread.
  useEffect(() => {
    stagedRef.current.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
    setStaged([]);
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      recCancelRef.current = true;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    if (recTimerRef.current != null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recSendRef.current = false;
    setRecording(false);
    setRecPaused(false);
  }, [conversationId]);

  // Track browser-tab focus: a read receipt should only go out when the agent can
  // actually see the message, so a backgrounded tab (or a phone with the screen
  // off) never marks a customer's message read behind their back.
  const [docVisible, setDocVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  // Read receipts fire only when the thread is genuinely on-screen: it's the
  // active pane (on mobile the thread stays mounted behind the list) AND the tab
  // is focused. Otherwise a new inbound arriving while you're back on the list
  // would send the customer blue ticks you never earned.
  const canMarkRead = active && docVisible;

  // Mark the conversation read on open, and again whenever a fresh inbound
  // message arrives WHILE THE THREAD IS ON-SCREEN — clearing the unread badge and
  // sending a WhatsApp read receipt. When it isn't on-screen the effect bails
  // BEFORE recording the new message count, so returning to the thread (or
  // refocusing the tab) still marks the messages that arrived while you were away.
  useEffect(() => {
    if (!conversationId || !conv || !canMarkRead) return;
    const len = conv.messages.length;
    const prev = seenRef.current;
    seenRef.current = { id: conversationId, len };
    if (prev.id !== conversationId) {
      markRead(conversationId);
    } else if (len > prev.len) {
      const newest = conv.messages[len - 1];
      if (newest && newest.direction === "in" && !newest.internal) markRead(conversationId);
    }
  }, [conversationId, conv, markRead, canMarkRead]);

  // Listen for another agent's typing on THIS conversation. Auto-clears after 4s
  // of silence and on an explicit typing:false; fully torn down on switch/unmount
  // so a stale indicator can never bleed across conversations.
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    const onTyping = (p: { conversationId: string; who: string; typing: boolean }) => {
      if (p.conversationId !== conversationId) return;
      if (typingClearRef.current != null) window.clearTimeout(typingClearRef.current);
      if (p.typing) {
        setTypingWho(p.who);
        typingClearRef.current = window.setTimeout(() => setTypingWho(null), 4000);
      } else {
        typingClearRef.current = null;
        setTypingWho(null);
      }
    };
    socket.on(ServerEvent.Typing, onTyping);
    return () => {
      socket.off(ServerEvent.Typing, onTyping);
      if (typingClearRef.current != null) {
        window.clearTimeout(typingClearRef.current);
        typingClearRef.current = null;
      }
      setTypingWho(null);
    };
  }, [conversationId]);

  // Stop broadcasting our own typing when leaving/switching a conversation.
  useEffect(() => {
    const id = conversationId;
    return () => {
      if (typingStopRef.current != null) {
        window.clearTimeout(typingStopRef.current);
        typingStopRef.current = null;
      }
      if (id && typingSentRef.current) {
        getSocket().emit(ClientEvent.Typing, { conversationId: id, typing: false });
      }
      typingSentRef.current = false;
      typingThrottleRef.current = 0;
    };
  }, [conversationId]);

  if (!conversationId) {
    return (
      <main className="thread">
        <div className="center-note">Select a conversation to get started.</div>
      </main>
    );
  }
  if (!conv) {
    return (
      <main className="thread">
        <div className="center-note">Loading…</div>
      </main>
    );
  }

  // Every channel this thread actually spans — the header badges each one, since
  // a conversation can move between WhatsApp and email. Newest-used first;
  // internal notes carry no channel, and a message with none rides the thread's own.
  const threadChannels: ChannelType[] = (() => {
    const seen = new Set<ChannelType>();
    const out: ChannelType[] = [];
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.internal) continue;
      const ch = (m.channel ?? conv.channel) as ChannelType;
      if (!seen.has(ch)) {
        seen.add(ch);
        out.push(ch);
      }
    }
    if (out.length === 0) out.push(conv.channel);
    return out;
  })();
  // ─── Reply channel (cross-channel thread) ───
  // The thread's own channel is its identity; the *composer* may target any
  // channel the customer is reachable on, within this one open thread. The
  // compose channel defaults to the conversation's own and is switched below
  // (never for a group — a group can't be answered on another channel).
  const convIsEmail = conv.channel === "email";
  const isGroup = conv.channel === "whatsapp_group";
  const composeChannel: ChannelType = (!isGroup && composeChannelState) || conv.channel;
  const isEmail = composeChannel === "email";
  // Channels this customer can be reached on within this thread (1:1 only).
  const switchable: ChannelType[] = [];
  if (!isGroup) {
    if (conv.contact.phone) switchable.push("whatsapp");
    if (conv.contact.email) switchable.push("email");
  }
  // The reply-target channels shown in the composer's mode switcher (before the
  // Note tab). A group can only be answered on its own channel; a 1:1 lists every
  // channel the customer is reachable on (falling back to the thread's own).
  const replyTargets: ChannelType[] = isGroup || switchable.length === 0 ? [conv.channel] : switchable;
  const isClosed = conv.status === "closed";
  const owned = !!conv.assigneeUserId;
  const assignedToMe = conv.assigneeUserId === me?.user.id;
  // Resolve who the conversation is actually assigned to (name + avatar colour),
  // so the header shows the real owner — not the viewer — when it's someone else's.
  const assigneeUser = conv.assigneeUserId
    ? people?.find((p) => p.user.id === conv.assigneeUserId)?.user
    : undefined;
  const assigneeName = assigneeUser?.name ?? conv.assigneeName ?? "a teammate";
  // The presence line under the contact name. WhatsApp's Cloud API doesn't hand
  // businesses a customer's real online/last-seen status, so instead of a fake
  // "online" we show an honest "last active", derived from when the contact
  // last messaged us (their most recent inbound, ignoring internal notes).
  const lastInboundAt = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.direction === "in" && !m.internal) return m.createdAt;
    }
    return null;
  })();
  const sub = convIsEmail
    ? (conv.contact.email ?? "")
    : lastInboundAt
      ? conv.channel === "whatsapp_group"
        ? `group · ${lastActive(lastInboundAt)}`
        : lastActive(lastInboundAt)
      : conv.channel === "whatsapp_group"
        ? "group"
        : (conv.contact.phone ?? "");

  const readyAtts = staged.filter((s) => s.status === "done" && s.attachment);
  const uploadingAtts = staged.some((s) => s.status === "uploading");
  const canSend = (text.trim().length > 0 || readyAtts.length > 0) && !uploadingAtts;
  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // ─── WhatsApp 24-hour window ───
  // Everything below tracks the *compose* channel, so a cross-channel reply is
  // gated correctly. `waWindow` is null on email (no restriction). On WhatsApp it
  // says whether you may still free-type; once closed, only a template gets through.
  const isWhatsApp = composeChannel === "whatsapp" || composeChannel === "whatsapp_group";
  // Email replies compose in a rich-text editor; notes + other channels stay plain.
  const isRich = isEmail && !internal;
  // Resolve a quoted reply's target message by id for in-bubble rendering.
  const msgById = new Map(conv.messages.map((m) => [m.id, m]));
  // The WhatsApp window that applies to the compose channel: the server-computed
  // one when replying on the thread's own WhatsApp channel; else derived from the
  // thread's WhatsApp inbounds (a cross-channel WhatsApp reply). Null off WhatsApp.
  const waWindow: WaWindow | null = !isWhatsApp
    ? null
    : composeChannel === conv.channel
      ? laterWindow(conv.waWindow, computeWaWindow(conv.messages))
      : computeWaWindow(conv.messages);
  const windowClosed = isWhatsApp && !!waWindow && !waWindow.open;
  const msLeft = waWindow?.expiresAt ? new Date(waWindow.expiresAt).getTime() - now : null;
  const showCountdown = isWhatsApp && waWindow?.open === true && msLeft != null;
  const closingSoon = msLeft != null && msLeft < 60 * 60 * 1000;
  // Free-form replies are blocked when the window is closed — but internal notes
  // bypass the window, so the composer only locks in Reply mode.
  const composeLocked = windowClosed && !internal;

  const clearStaged = () => {
    setStaged((cur) => {
      cur.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
      return [];
    });
  };

  // Emit typing:false now and disarm the idle timer (called on stop/send/blur).
  const stopTyping = () => {
    if (typingStopRef.current != null) {
      window.clearTimeout(typingStopRef.current);
      typingStopRef.current = null;
    }
    typingThrottleRef.current = 0;
    if (typingSentRef.current) {
      typingSentRef.current = false;
      getSocket().emit(ClientEvent.Typing, { conversationId: conv.id, typing: false, who: me?.user.name });
    }
  };
  // Broadcast that we're typing — throttled to ≤1 "true" every 2s — and (re)arm a
  // 2.5s idle timer that emits "false" once the agent stops.
  const signalTyping = () => {
    const t = Date.now();
    if (t - typingThrottleRef.current > 2000) {
      typingThrottleRef.current = t;
      typingSentRef.current = true;
      getSocket().emit(ClientEvent.Typing, { conversationId: conv.id, typing: true, who: me?.user.name });
    }
    // Also show the *customer* a "typing…" indicator on WhatsApp (each ping keeps
    // it alive ~25s, so throttle hard — and only while free-typing in the window).
    if (isWhatsApp && !internal && !composeLocked && t - waTypingRef.current > 9000) {
      waTypingRef.current = t;
      void api.sendTyping(conv.id).catch(() => {});
    }
    if (typingStopRef.current != null) window.clearTimeout(typingStopRef.current);
    typingStopRef.current = window.setTimeout(stopTyping, 2500);
  };
  // Keep the editor's onUpdate pointing at the current signalTyping closure.
  typingSignalRef.current = signalTyping;

  // Start (or switch) a quoted reply to a message: force Reply mode and focus
  // the composer. Notes can't quote a customer message out to WhatsApp.
  const startReply = (m: Message) => {
    setReplyTo(m);
    setReactFor(null);
    setMenuFor(null);
    setInternal(false);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // Open the forward modal for an email message.
  const startForward = (m: Message) => {
    setForwardMsg(m);
    setReactFor(null);
    setMenuFor(null);
  };

  // Forward `forwardMsg` on to `toRaw` (comma/space-separated addresses) with an
  // optional note. Sends a fresh "Fwd:" email — logged in this conversation, but
  // addressed to the new recipients, not the customer (Front-style).
  const submitForward = (toRaw: string, note: string) => {
    const m = forwardMsg;
    if (!m) return;
    const toList = toRaw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!toList.length) return;
    const subject = m.email?.subject ?? conv.subject ?? "";
    const who = m.direction === "out" ? m.authorName || "You" : m.authorName || conv.contact.displayName;
    const when = new Date(m.createdAt).toLocaleString();
    const origHtml = m.bodyHtml?.trim() || escapeHtml(m.body).replace(/\n/g, "<br>");
    const noteHtml = note.trim() ? `<p>${escapeHtml(note.trim()).replace(/\n/g, "<br>")}</p>` : "";
    const forwardHtml =
      `${noteHtml}<p>---------- Forwarded message ----------<br>` +
      `From: ${escapeHtml(who)}<br>` +
      (subject ? `Subject: ${escapeHtml(subject)}<br>` : "") +
      `Date: ${escapeHtml(when)}</p><blockquote>${origHtml}</blockquote>`;
    send.mutate(
      { id: conv.id, body: note.trim(), bodyHtml: forwardHtml, forwardTo: toList },
      { onError: () => onToast("Couldn’t forward the email. Please try again.") },
    );
    setForwardMsg(null);
  };

  // Apply or remove the agent's reaction to a message; the bar closes after.
  const applyReaction = (messageId: string, emoji: string) => {
    react({ conversationId: conv.id, messageId, emoji });
    setReactFor(null);
  };

  // Re-attempt a failed send; a genuinely un-retryable one (e.g. channel still
  // not connected) surfaces as a toast rather than silently doing nothing.
  const retrySend = (messageId: string) => {
    retry(
      { conversationId: conv.id, messageId },
      { onError: () => onToast("Couldn’t retry — check the channel is connected in Settings.") },
    );
  };

  // Scroll to a quoted message and flash it so the reply's target is obvious.
  const jumpToMessage = (messageId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("msg--flash");
    void el.offsetWidth; // restart the animation if it's still mid-flash
    el.classList.add("msg--flash");
    window.setTimeout(() => el.classList.remove("msg--flash"), 1200);
  };

  // Toggle a link on the current selection via the editor (replaces execCommand).
  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Link URL");
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().setLink({ href }).run();
  };

  // Insert an emoji at the caret of whichever composer input is active.
  const insertEmoji = (emoji: string) => {
    if (isRich && editor) {
      editor.chain().focus().insertContent(emoji).run();
    } else {
      const ta = taRef.current;
      if (ta) {
        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? text.length;
        const next = text.slice(0, start) + emoji + text.slice(end);
        setText(next);
        requestAnimationFrame(() => {
          ta.focus();
          const pos = start + emoji.length;
          ta.setSelectionRange(pos, pos);
        });
      } else {
        setText(text + emoji);
      }
    }
    setEmojiOpen(false);
  };

  // ─── @-mention autocomplete (internal notes) ───
  // Teammates matching the current @query — empty unless a note @token is open.
  const mentionList = mention
    ? (people ?? [])
        .map((m) => m.user)
        .filter((u) => {
          const q = mention.query.toLowerCase();
          if (!q) return true;
          return u.name.toLowerCase().includes(q) || u.email.split("@")[0].toLowerCase().includes(q);
        })
        .slice(0, 6)
    : [];

  // On each note keystroke, detect an "@query" ending at the caret and open the
  // picker. Only in note mode — customers can't be @-mentioned.
  const onNoteInput = (value: string, caret: number) => {
    setText(value);
    signalTyping();
    const m = internal ? /(?:^|\s)@([\w.+-]*)$/.exec(value.slice(0, caret)) : null;
    if (m) {
      setMention({ query: m[1], start: caret - m[1].length - 1 });
      setMentionSel(0);
    } else {
      setMention(null);
    }
  };

  // Replace the open "@query" with the teammate's handle (@email-local-part —
  // the token the server matches to route the note to their @Mentions inbox).
  const insertMention = (u: { name: string; email: string }) => {
    if (!mention) return;
    const handle = "@" + u.email.split("@")[0].toLowerCase() + " ";
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    setText(before + handle + after);
    setMention(null);
    const caret = (before + handle).length;
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
  };

  const handleSend = () => {
    if (!canSend || composeLocked) return;
    const body = text.trim();
    const wasInternal = internal;
    // A quote only rides on a real (non-note) reply.
    const quotedMsgId = !internal ? replyTo?.id : undefined;
    // A rich email reply carries the editor's HTML; the server sanitizes it.
    const bodyHtml = isRich && body ? html || undefined : undefined;
    // Optional Cc/Bcc on an email reply (comma/space separated addresses).
    const parseAddrs = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const ccList = isEmail && !internal ? parseAddrs(cc) : [];
    const bccList = isEmail && !internal ? parseAddrs(bcc) : [];
    // The email thread's subject (verbatim topic; the server adds "Re:" on a reply).
    const subject = isEmail && !internal ? subjectDraft.trim() : undefined;
    unlock();
    const attachmentIds = readyAtts.map((s) => s.attachment!.id);
    send.mutate(
      {
        id: conv.id,
        body,
        internal,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        quotedMsgId,
        bodyHtml,
        subject,
        cc: ccList.length ? ccList : undefined,
        bcc: bccList.length ? bccList : undefined,
        // Only send an override when replying off the conversation's own channel.
        channel: !internal && composeChannel !== conv.channel ? composeChannel : undefined,
      },
      {
        onError: (err) => {
          const status = (err as { status?: number }).status;
          // A closed-window race: the window shut between load and send.
          if (isWhatsApp && !wasInternal && status && status >= 400 && status < 500) {
            onToast("The 24-hour window has closed — send a template to reply.");
          } else {
            onToast("Couldn’t send your message. Please try again.");
          }
        },
      },
    );
    stopTyping();
    setText("");
    setHtml("");
    editor?.commands.clearContent();
    clearStaged();
    setInternal(false);
    setMention(null);
    setReplyTo(null);
    setCc("");
    setBcc("");
    setShowCc(false);
  };

  const uploadStaged = async (item: Staged) => {
    try {
      const meta: {
        filename: string;
        kind?: string;
        durationMs?: number;
        width?: number;
        height?: number;
        waveform?: number[];
      } = { filename: item.name };
      if (item.kind === "image") {
        const { width, height } = await imageSize(item.file);
        meta.kind = "image";
        if (width) meta.width = width;
        if (height) meta.height = height;
      } else if (item.kind === "voice") {
        meta.kind = "voice";
        if (item.durationMs != null) meta.durationMs = item.durationMs;
        if (item.waveform) meta.waveform = item.waveform;
      }
      const attachment = await api.uploadMedia(item.file, meta);
      setStaged((cur) =>
        cur.map<Staged>((x) => (x.localId === item.localId ? { ...x, status: "done", attachment } : x)),
      );
    } catch {
      setStaged((cur) =>
        cur.map<Staged>((x) => (x.localId === item.localId ? { ...x, status: "error" } : x)),
      );
      onToast("Couldn’t upload " + item.name);
    }
  };

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const name = file.name || "file";
      const kind = kindOfFile(file, name);
      const item: Staged = {
        localId: crypto.randomUUID(),
        file,
        name,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        kind,
        status: "uploading",
      };
      setStaged((cur) => [...cur, item]);
      void uploadStaged(item);
    }
  };

  const removeStaged = (localId: string) => {
    setStaged((cur) => {
      const item = cur.find((x) => x.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return cur.filter((x) => x.localId !== localId);
    });
  };

  const retryStaged = (localId: string) => {
    const item = stagedRef.current.find((x) => x.localId === localId);
    if (!item) return;
    setStaged((cur) => cur.map<Staged>((x) => (x.localId === localId ? { ...x, status: "uploading" } : x)));
    void uploadStaged({ ...item, status: "uploading" });
  };

  const teardownRec = () => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    if (recTimerRef.current != null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
  };

  // Tick the elapsed readout from the accumulated base + the running segment, so
  // pausing freezes the clock and resuming continues from where it stopped.
  const startRecTimer = () => {
    if (recTimerRef.current != null) window.clearInterval(recTimerRef.current);
    recTimerRef.current = window.setInterval(() => {
      setRecSecs(Math.floor((recBaseRef.current + (Date.now() - recStartRef.current)) / 1000));
    }, 250);
  };

  // Fold the running segment into the accumulator — call right before pausing or
  // stopping so the final duration is correct even after several pauses.
  const finalizeElapsed = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "recording") recBaseRef.current += Date.now() - recStartRef.current;
  };

  // Upload a freshly recorded clip and send it immediately — WhatsApp-style
  // record → send, with no intermediate "staged in the composer" step. Empty
  // body; rides the current compose channel.
  const sendVoiceNote = async (
    blob: Blob,
    name: string,
    durationMs: number,
    waveform: number[] | undefined,
  ) => {
    try {
      const attachment = await api.uploadMedia(blob, { filename: name, kind: "voice", durationMs, waveform });
      unlock();
      send.mutate(
        {
          id: conv.id,
          body: "",
          internal: false,
          attachmentIds: [attachment.id],
          channel: composeChannel !== conv.channel ? composeChannel : undefined,
        },
        { onError: () => onToast("Couldn’t send your voice message. Please try again.") },
      );
    } catch {
      onToast("Couldn’t send your voice message. Please try again.");
    }
  };

  const finishRecording = async () => {
    const rec = mediaRecorderRef.current;
    const mime = rec?.mimeType || "audio/webm";
    const chunks = recChunksRef.current;
    const elapsedMs = recBaseRef.current;
    const shouldSend = recSendRef.current;
    mediaRecorderRef.current = null;
    recChunksRef.current = [];
    recSendRef.current = false;
    teardownRec();
    if (recCancelRef.current || chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mime });
    const { durationMs, waveform } = await analyzeAudio(blob, elapsedMs);
    const ext = mime.includes("ogg") ? "ogg" : "webm";
    const name = "voice-message." + ext;
    // Record → send: skip staging and fire it straight off.
    if (shouldSend) {
      void sendVoiceNote(blob, name, durationMs, waveform);
      return;
    }
    const item: Staged = {
      localId: crypto.randomUUID(),
      file: blob,
      name,
      kind: "voice",
      status: "uploading",
      durationMs,
      waveform,
    };
    setStaged((cur) => [...cur, item]);
    void uploadStaged(item);
  };

  const startRecording = async () => {
    if (recording || mediaRecorderRef.current) return;
    if (!canRecord) {
      onToast("Recording isn’t supported here");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onToast("Microphone permission denied");
      return;
    }
    recStreamRef.current = stream;
    recCancelRef.current = false;
    recSendRef.current = false;
    recChunksRef.current = [];
    recBaseRef.current = 0;
    const mime = pickAudioMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      void finishRecording();
    };
    rec.start();
    recStartRef.current = Date.now();
    setRecSecs(0);
    setRecPaused(false);
    setRecording(true);
    startRecTimer();
  };

  // Pause/resume the recording (MediaRecorder buffers across the gap). Guarded
  // in case a browser doesn't support pause — the UI state only flips on success.
  const togglePause = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    try {
      if (rec.state === "recording") {
        rec.pause();
        // Segment ended: fold its elapsed into the accumulator, then freeze the clock.
        recBaseRef.current += Date.now() - recStartRef.current;
        if (recTimerRef.current != null) {
          window.clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        setRecPaused(true);
      } else if (rec.state === "paused") {
        rec.resume();
        recStartRef.current = Date.now();
        startRecTimer();
        setRecPaused(false);
      }
    } catch {
      onToast("Pause isn’t supported here");
    }
  };

  // Stop and send the clip in one action (the paper-plane in the recording bar).
  const sendRecording = () => {
    const rec = mediaRecorderRef.current;
    recSendRef.current = true;
    finalizeElapsed();
    setRecording(false);
    setRecPaused(false);
    if (rec && rec.state !== "inactive") rec.stop();
    else teardownRec();
  };

  const cancelRecording = () => {
    recCancelRef.current = true;
    recSendRef.current = false;
    const rec = mediaRecorderRef.current;
    setRecording(false);
    setRecPaused(false);
    if (rec && rec.state !== "inactive") rec.stop();
    else teardownRec();
  };

  const onComposerDragOver = (e: RDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  };
  const onComposerDragEnter = (e: RDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onComposerDragLeave = (e: RDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onComposerDrop = (e: RDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (composeLocked) return; // window closed — free-form attachments blocked
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  };
  const onTextareaPaste = (e: RClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onFileInputChange = (e: RChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = "";
  };

  const take = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: me?.user.id ?? null, assignedTeamId: conv.assignedTeamId } });
    setMenu(false);
    onToast("Assigned to you");
  };
  const routeTeam = (teamId: string, name: string) => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null, assignedTeamId: teamId } });
    setMenu(false);
    onToast(`Routed to ${name}`);
  };
  const unassign = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null } });
    setMenu(false);
    onToast("Sent back to queue");
  };
  const closeConversation = () => {
    setMenu(false);
    setStatus.mutate(
      { id: conv.id, status: "closed" },
      { onSuccess: () => { onToast("Conversation closed"); onClosed?.(); } },
    );
  };
  const reopenConversation = () => {
    setStatus.mutate({ id: conv.id, status: "open" }, { onSuccess: () => onToast("Conversation reopened") });
  };
  const doSnooze = (until: string, label: string) => {
    setSnoozeMenu(false);
    snooze.mutate(
      { id: conv.id, until },
      { onSuccess: () => { onToast(`Snoozed · ${label}`); onClosed?.(); } },
    );
  };
  const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  const tomorrow9am = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  const snoozeOpts = [
    { label: "10 minutes", short: "10 min", until: () => inMin(10) },
    { label: "30 minutes", short: "30 min", until: () => inMin(30) },
    { label: "1 hour", short: "1 hour", until: () => inMin(60) },
    { label: "Tomorrow, 9 AM", short: "tomorrow 9 AM", until: tomorrow9am },
  ];

  // The composer context line: note privacy, email/group target, or — on
  // WhatsApp — the live 24-hour window state (open countdown / closing / closed).
  let ctxNode: ReactNode;
  if (internal) {
    ctxNode = "Only your team can see this";
  } else if (isEmail) {
    ctxNode = `Email · ${conv.contact.displayName}`;
  } else if (isWhatsApp && showCountdown && msLeft != null) {
    ctxNode = (
      <span className={"wawin" + (closingSoon ? " soon" : "")}>
        <span className="wawin__dot" />
        {closingSoon ? "Window closing" : "Window open"} · {windowLeft(msLeft)} left
      </span>
    );
  } else if (isWhatsApp && windowClosed) {
    ctxNode = (
      <span className="wawin wawin--closed">
        <span className="wawin__dot" />
        24-hour window closed
      </span>
    );
  } else {
    ctxNode = conv.channel === "whatsapp_group"
      ? `Group · ${conv.contact.displayName}`
      : `WhatsApp · ${conv.contact.displayName}`;
  }

  return (
    <main className="thread" aria-label="Conversation">
      <header className="thread__head">
        {onBack && (
          <button className="thread__back" title="Back" onClick={onBack} aria-label="Back to conversations">
            <BackIcon />
          </button>
        )}
        <div className="thread__id">
          <Avatar name={conv.contact.displayName} email={conv.contact.email} color={conv.contact.avatarColor} className="av" size={40} fontSize={14} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="min-w-0 flex-initial m-0 text-lg font-bold whitespace-nowrap overflow-hidden text-ellipsis max-[820px]:text-md">{conv.contact.displayName}</h2>
              {/* Channel pill sits inline to the right of the name (fills the
                  header's empty space); the presence line drops below it. */}
              <span className="inline-flex items-center gap-[5px] text-2xs font-[650] py-[3px] px-2 rounded-full bg-surface-2 text-muted flex-none" aria-label={threadChannels.map((ch) => channelMeta(ch).label).join(" + ")}>
                {threadChannels.map((ch) => {
                  const m = channelMeta(ch);
                  const G = m.Glyph;
                  return (
                    <span key={ch} className="inline-grid place-items-center [&>svg]:w-[13px] [&>svg]:h-[13px]" style={{ color: m.color }} title={m.label}>
                      <G />
                    </span>
                  );
                })}
              </span>
            </div>
            {conv.subject && conv.subject !== conv.contact.displayName && (
              <div className="text-xs text-fg font-semibold whitespace-nowrap overflow-hidden text-ellipsis max-w-[420px]">{conv.subject}</div>
            )}
            {sub && (
              <div className="flex items-center gap-2 text-xs text-muted mt-px min-w-0">
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{sub}</span>
              </div>
            )}
          </div>
        </div>
        <div className="thread__actions">
          {isClosed ? (
            <button className="resolvebtn reopened" onClick={reopenConversation} title="Reopen conversation">
              <ReopenIcon />
              <span className="lbl">Reopen</span>
            </button>
          ) : (
            <button className="resolvebtn" onClick={closeConversation} title="Close (resolve) conversation">
              <CheckCircleIcon />
              <span className="lbl">Resolve</span>
            </button>
          )}
          <button
            className="assignbtn"
            onClick={() => { setMenu((v) => !v); setSnoozeMenu(false); }}
            title={!owned ? "Take this conversation" : assignedToMe ? "Assigned to you" : `Assigned to ${assigneeName}`}
          >
            {owned ? (
              <>
                <span
                  className="mini"
                  style={{
                    background: assignedToMe
                      ? avatarBg(me?.user.name ?? "", me?.user.avatarColor)
                      : avatarBg(assigneeName, assigneeUser?.avatarColor),
                  }}
                >
                  {assignedToMe ? (me ? initials(me.user.name) : "") : initials(assigneeName)}
                </span>
                <span className="lbl">
                  {assignedToMe ? "Assigned to you" : `Assigned to ${assigneeName.split(" ")[0]}`}
                </span>
              </>
            ) : (
              <>
                <span className="assignbtn__ic">
                  <ProfileIcon />
                </span>
                <span className="lbl">Take conversation</span>
              </>
            )}
            <ChevronDown />
          </button>
          <div className="snoozewrap">
            <button
              className={"iconbtn hide-sm" + (snoozeMenu ? " on" : "")}
              title="Snooze"
              onClick={() => { setSnoozeMenu((v) => !v); setMenu(false); }}
            >
              <SnoozeIcon />
            </button>
            {snoozeMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setSnoozeMenu(false)} />
                <GlideMenu className="menu snoozemenu" role="menu">
                  <div className="menu__hd">Snooze until</div>
                  {snoozeOpts.map((o) => (
                    <button key={o.short} onClick={() => doSnooze(o.until(), o.short)}>
                      <SnoozeIcon /> {o.label}
                    </button>
                  ))}
                </GlideMenu>
              </>
            )}
          </div>
          <div className="labelwrap">
            <button
              className={"iconbtn hide-sm" + (labelMenu ? " on" : "")}
              title="Labels"
              aria-label="Labels"
              aria-haspopup="menu"
              aria-expanded={labelMenu}
              onClick={() => { setLabelMenu((v) => !v); setSnoozeMenu(false); setMenu(false); }}
            >
              <TagIcon />
            </button>
            {labelMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setLabelMenu(false)} />
                <div className="menu labelmenu" role="menu">
                  <div className="menu__hd">Labels</div>
                  <LabelPicker conversationId={conv.id} current={conv.labels} />
                </div>
              </>
            )}
          </div>
          <button className={"iconbtn hide-sm" + (showPanel ? " on" : "")} title="Details" onClick={onTogglePanel}>
            <DetailsIcon />
          </button>
          {/* Phone-only overflow: the header keeps just Resolve + Assign; Snooze,
              Labels and Details live here so the contact name always has room. */}
          <div className="morewrap show-sm">
            <button
              className={"iconbtn" + (moreMenu ? " on" : "")}
              title="More"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={moreMenu}
              onClick={() => { setMoreMenu((v) => !v); setMenu(false); setSnoozeMenu(false); setLabelMenu(false); }}
            >
              <MoreIcon />
            </button>
            {moreMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setMoreMenu(false)} />
                <GlideMenu className="menu moremenu" role="menu">
                  <button onClick={() => { setMoreMenu(false); setSnoozeMenu(true); }}>
                    <SnoozeIcon /> Snooze…
                  </button>
                  <button onClick={() => { setMoreMenu(false); setLabelMenu(true); }}>
                    <TagIcon /> Add label…
                  </button>
                  <button onClick={() => { setMoreMenu(false); onTogglePanel(); }}>
                    <DetailsIcon /> {showPanel ? "Hide details" : "Details"}
                  </button>
                </GlideMenu>
              </>
            )}
          </div>
        </div>
      </header>

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(false)} />
          <GlideMenu className="menu" role="menu">
            {conv.assigneeUserId !== me?.user.id && (
              <button onClick={take}>
                <ProfileIcon /> Assign to me
              </button>
            )}
            {(teams ?? [])
              .filter((t) => t.id !== conv.assignedTeamId)
              .map((t) => (
                <button key={t.id} onClick={() => routeTeam(t.id, t.name)}>
                  <RouteIcon /> Route to {t.name}
                </button>
              ))}
            {conv.assigneeUserId && (
              <button onClick={unassign}>
                <InboxIcon /> Send back to queue
              </button>
            )}
            <div className="sep" />
            {conv.unread ? (
              <button onClick={() => { setMenu(false); markRead(conv.id); }}>
                <MailIcon /> Mark as read
              </button>
            ) : (
              <button
                onClick={() => {
                  setMenu(false);
                  markUnread(conv.id);
                  onToast("Marked as unread");
                  onClosed?.();
                }}
              >
                <MailIcon /> Mark as unread
              </button>
            )}
            {isClosed ? (
              <button onClick={reopenConversation}>
                <ReopenIcon /> Reopen conversation
              </button>
            ) : (
              <button onClick={closeConversation}>
                <CheckCircleIcon /> Close conversation
              </button>
            )}
          </GlideMenu>
        </>
      )}

      <div className={"msgs" + (isClosed ? " is-closed" : "")}>
        {conv.hasMoreMessages && (
          <div className="loadolder">
            <button className="loadolder__btn" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {groupMessagesByDay(conv.messages).map((group) => (
          <section className="daygroup" key={group.key}>
            <div className="daysep">{group.label}</div>
            {group.items.map((m) =>
              m.internal ? (
                <div
                  key={m.id}
                  className={"note" + (m.authorUserId === me?.user.id ? " note--out" : " note--in")}
                >
                  <div className="note__bubble">
                    <div className="note__head">
                      <span className="note__ic" aria-hidden="true">
                        <NoteIcon />
                      </span>
                      <b className="note__who">{m.authorName ?? "Teammate"}</b>
                      <span className="note__tag">Internal</span>
                      <span className="note__t">{relativeTime(m.createdAt)}</span>
                    </div>
                    <div className="note__body">{renderMention(m.body)}</div>
                  </div>
                </div>
              ) : (
                <MessageBubble
                  key={m.id}
                  m={m}
                  convChannel={conv.channel}
                  quoted={m.quotedMsgId ? msgById.get(m.quotedMsgId) : undefined}
                  onImage={setLightbox}
                  onRetry={retrySend}
                  actions={{
                    // React + reply on every channel. On WhatsApp the reaction is
                    // delivered to the customer; on email it's an internal agent
                    // annotation (the API stores it and skips provider dispatch).
                    contactName: conv.contact.displayName,
                    held: reactFor === m.id,
                    menuOpen: menuFor === m.id,
                    onHold: () => { setMenuFor(null); setReactFor(m.id); },
                    onMenuToggle: () => { setReactFor(null); setMenuFor((cur) => (cur === m.id ? null : m.id)); },
                    onReact: (emoji) => applyReaction(m.id, emoji),
                    onReply: () => startReply(m),
                    // Forward is an email action — offered only on email messages.
                    onForward:
                      (m.channel ?? conv.channel) === "email" ? () => startForward(m) : undefined,
                    // Read receipts — only on a sent email that has tracked recipients.
                    onReceipts:
                      m.direction === "out" && !m.internal && m.email?.recipients?.length
                        ? () => { setMenuFor(null); setReceiptsMsgId(m.id); }
                        : undefined,
                    onJump: jumpToMessage,
                  }}
                />
              ),
            )}
          </section>
        ))}
        {conv.messages.length === 0 && (
          <div className="thread-empty">No messages yet — start the conversation.</div>
        )}
        {typingWho && (
          <div className="typing" role="status" aria-live="polite">
            <span className="typing__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="typing__who">{typingWho} is typing…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {isClosed ? (
        <div className="closedbar">
          <div className="closedbar__txt">
            <CheckCircleIcon />
            <span>This conversation is closed.</span>
          </div>
          <button className="closedbar__btn" onClick={reopenConversation}>
            <ReopenIcon /> Reopen to reply
          </button>
        </div>
      ) : (
        <div
          className="composer"
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
        >
          <div className="compbar">
            {/* One 3-way switcher: reply on each reachable channel, or add a Note. */}
            <div className="compmode" role="tablist" ref={modeRef} {...modeHover}>
              <span className="seg-hover" ref={modeHoverRef} />
              <span className="seg-thumb" ref={modeThumbRef} />
              {replyTargets.map((ch) => {
                const meta = channelMeta(ch);
                const ChG = meta.Glyph;
                const active = !internal && composeChannel === ch;
                return (
                  <button
                    key={ch}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={replyTargets.length > 1 ? meta.label : "Reply"}
                    className={"modebtn" + (active ? " active" : "")}
                    onClick={() => {
                      setInternal(false);
                      setComposeChannelState(ch === conv.channel ? null : ch);
                    }}
                    title={replyTargets.length > 1 ? `Reply via ${meta.label}` : undefined}
                  >
                    <span className="modebtn__ic" style={active ? { color: meta.color } : undefined}>
                      <ChG />
                    </span>
                    <span className="modebtn__lbl">{replyTargets.length > 1 ? meta.label : "Reply"}</span>
                  </button>
                );
              })}
              <button
                type="button"
                role="tab"
                aria-selected={internal}
                aria-label="Note"
                className={"modebtn modenote" + (internal ? " active" : "")}
                onClick={() => setInternal(true)}
                title="Internal note"
              >
                <span className="modebtn__ic">
                  <NoteIcon />
                </span>
                <span className="modebtn__lbl">Note</span>
              </button>
            </div>
            <span className="compctx">{ctxNode}</span>
          </div>
          {isEmail && !internal && (
            <div className="emailhdr">
              <div className="emailhdr__row">
                <span className="emailhdr__lbl">Subject</span>
                {editingSubject ? (
                  <input
                    className="emailhdr__in"
                    value={subjectDraft}
                    onChange={(e) => setSubjectDraft(e.target.value)}
                    placeholder="Add a subject"
                    aria-label="Email subject"
                    autoFocus
                    onBlur={() => setEditingSubject(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        setEditingSubject(false);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="emailhdr__subjbtn"
                    onClick={() => setEditingSubject(true)}
                    title="Edit subject"
                  >
                    <span className={"emailhdr__subj" + (subjectDraft.trim() ? "" : " placeholder")}>
                      {subjectDraft.trim() || "Add a subject"}
                    </span>
                    <EditIcon />
                  </button>
                )}
                <button
                  type="button"
                  className={"emailhdr__cc" + (showCc ? " on" : "")}
                  onClick={() => setShowCc((v) => !v)}
                >
                  Cc/Bcc
                </button>
              </div>
              {showCc && (
                <>
                  <div className="emailhdr__row">
                    <span className="emailhdr__lbl">Cc</span>
                    <input
                      className="emailhdr__in"
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                      placeholder="name@example.com, …"
                      inputMode="email"
                    />
                  </div>
                  <div className="emailhdr__row">
                    <span className="emailhdr__lbl">Bcc</span>
                    <input
                      className="emailhdr__in"
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
                      placeholder="name@example.com, …"
                      inputMode="email"
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {replyTo && !internal && (
            <div className="reply-cue">
              <span className="reply-cue__accent" aria-hidden="true" />
              <div className="reply-cue__body">
                <span className="reply-cue__who">
                  <ReplyIcon />
                  Replying to {replyTo.direction === "out" ? "yourself" : replyTo.authorName || conv.contact.displayName}
                </span>
                <span className="reply-cue__txt">{quotedSnippet(replyTo)}</span>
              </div>
              <button
                type="button"
                className="reply-cue__x"
                onClick={() => setReplyTo(null)}
                title="Cancel reply"
                aria-label="Cancel reply"
              >
                <XIcon />
              </button>
            </div>
          )}
          {staged.length > 0 && (
            <div className="comp-atts">
              {staged.map((s) => (
                <StagedChip
                  key={s.localId}
                  s={s}
                  onRemove={() => removeStaged(s.localId)}
                  onRetry={() => retryStaged(s.localId)}
                />
              ))}
            </div>
          )}
          {isRich && !composeLocked && !recording && (
            <div className="richbar" role="toolbar" aria-label="Formatting">
              <button type="button" className={"richbar__b" + (editor?.isActive("bold") ? " on" : "")} title="Bold" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}>
                <b>B</b>
              </button>
              <button type="button" className={"richbar__b" + (editor?.isActive("italic") ? " on" : "")} title="Italic" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}>
                <i>I</i>
              </button>
              <button type="button" className={"richbar__b" + (editor?.isActive("underline") ? " on" : "")} title="Underline" aria-label="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
                <u>U</u>
              </button>
              <span className="richbar__sep" aria-hidden="true" />
              <button type="button" className={"richbar__b" + (editor?.isActive("bulletList") ? " on" : "")} title="Bulleted list" aria-label="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
                •&nbsp;—
              </button>
              <button type="button" className={"richbar__b" + (editor?.isActive("orderedList") ? " on" : "")} title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
                1.&nbsp;—
              </button>
              <span className="richbar__sep" aria-hidden="true" />
              <button type="button" className={"richbar__b richbar__b--ico" + (editor?.isActive("link") ? " on" : "")} title="Insert link" aria-label="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={toggleLink}>
                <LinkIcon />
              </button>
            </div>
          )}
          {composeLocked ? (
            <div className="wa-closed" role="note">
              <div className="wa-closed__txt">
                <ClockIcon />
                <span>
                  The 24-hour window has closed. Send an approved template to re-open the
                  conversation.
                </span>
              </div>
              <button type="button" className="wa-closed__btn" onClick={() => setPicker(true)}>
                <BoltIcon /> Choose a template
              </button>
            </div>
          ) : recording ? (
            <div className="comp-rec" role="group" aria-label="Recording voice message">
              <button
                type="button"
                className="comp-rec__del"
                onClick={cancelRecording}
                title="Delete"
                aria-label="Delete recording"
              >
                <TrashIcon />
              </button>
              <span className={"comp-rec__dot" + (recPaused ? " paused" : "")} aria-hidden="true" />
              <span className="comp-rec__time tnum">{formatDuration(recSecs * 1000)}</span>
              <span className="comp-rec__hint">{recPaused ? "Paused" : "Recording…"}</span>
              <button
                type="button"
                className="comp-rec__pause"
                onClick={togglePause}
                title={recPaused ? "Resume" : "Pause"}
                aria-label={recPaused ? "Resume recording" : "Pause recording"}
              >
                {recPaused ? <MicIcon /> : <PauseIcon />}
              </button>
              <button
                type="button"
                className="send comp-rec__send"
                onClick={sendRecording}
                title="Send"
                aria-label="Send voice message"
              >
                <SendIcon />
              </button>
            </div>
          ) : (
            <div className={"compinput" + (isRich ? " compinput--rich" : "")}>
              {emojiOpen && (
                <div className="emojipop" role="menu" aria-label="Insert emoji">
                  {COMPOSER_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="emojipop__e"
                      onClick={() => insertEmoji(e)}
                      aria-label={`Insert ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              {internal && mention && mentionList.length > 0 && (
                <div className="mentionpop" role="listbox" aria-label="Mention a teammate">
                  {mentionList.map((u, i) => (
                    <button
                      key={u.email}
                      type="button"
                      role="option"
                      aria-selected={i === mentionSel}
                      className={"mentionpop__row" + (i === mentionSel ? " sel" : "")}
                      onMouseEnter={() => setMentionSel(i)}
                      // Keep focus on the textarea so the caret restore lands.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(u);
                      }}
                    >
                      <Avatar name={u.name} email={u.email} color={u.avatarColor} className="mentionpop__av" />
                      <span className="mentionpop__meta">
                        <b>{u.name}</b>
                        <small>@{u.email.split("@")[0].toLowerCase()}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={"tool tool--emoji" + (emojiOpen ? " on" : "")}
                title="Emoji"
                aria-label="Emoji"
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <EmojiIcon />
              </button>
              {isRich ? (
                <EditorContent
                  editor={editor}
                  className="richedit-host"
                  aria-label={`Reply to ${conv.contact.displayName}`}
                  onBlur={stopTyping}
                  onKeyDown={(e) => {
                    // Enter adds a line; ⌘/Ctrl+Enter sends (email convention).
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
              ) : (
                <textarea
                  ref={taRef}
                  value={text}
                  rows={1}
                  onChange={(e) => onNoteInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onBlur={stopTyping}
                  onPaste={onTextareaPaste}
                  onKeyDown={(e) => {
                    // While the @-mention picker is open, the arrow/enter/tab keys
                    // drive it instead of the textarea (or sending).
                    if (mention && mentionList.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionSel((i) => (i + 1) % mentionList.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionSel((i) => (i - 1 + mentionList.length) % mentionList.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        insertMention(mentionList[mentionSel]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    internal ? "Write an internal note… use @name to mention" : `Message ${conv.contact.displayName}…`
                  }
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={onFileInputChange}
              />
              {isWhatsApp && !internal && (
                <button
                  className="tool"
                  title="Send a template"
                  onClick={() => setPicker(true)}
                  aria-label="Templates"
                >
                  <BoltIcon />
                </button>
              )}
              <button
                className="tool"
                title="Attach"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
              >
                <AttachIcon />
              </button>
              {/* One trailing button, WhatsApp-style: a mic while there's nothing
                  to send (voice-capable WhatsApp threads only), which becomes the
                  send paper-plane the moment there's text or an attachment. */}
              {isWhatsApp && canRecord && !internal && !canSend ? (
                <button
                  key="mic"
                  className="send send--mic"
                  onClick={startRecording}
                  title="Record voice message"
                  aria-label="Record voice message"
                >
                  <MicIcon />
                </button>
              ) : (
                <button
                  key="send"
                  className="send"
                  onClick={handleSend}
                  disabled={!canSend}
                  title="Send"
                  aria-label="Send"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          )}
          {dragging && !composeLocked && (
            <div className="comp-drop" aria-hidden="true">
              <span>
                <AttachIcon /> Drop to attach
              </span>
            </div>
          )}
        </div>
      )}

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightbox(null)}
        >
          <img className="lightbox__img" src={lightbox} alt="" />
          <button className="lightbox__close" onClick={() => setLightbox(null)} aria-label="Close preview">
            <XIcon />
          </button>
        </div>
      )}

      {picker && (
        <TemplatePicker
          conversationId={conv.id}
          channel={composeChannel}
          onClose={() => setPicker(false)}
          onToast={onToast}
        />
      )}

      {forwardMsg && (
        <ForwardModal
          message={forwardMsg}
          contactName={conv.contact.displayName}
          subject={forwardMsg.email?.subject ?? conv.subject ?? ""}
          onSubmit={submitForward}
          onClose={() => setForwardMsg(null)}
        />
      )}

      {(() => {
        // Resolve the message live from the thread so opens arriving over the
        // socket update the modal while it's open.
        const rm = receiptsMsgId ? conv.messages.find((m) => m.id === receiptsMsgId) : undefined;
        if (!rm?.email?.recipients?.length) return null;
        return (
          <ReceiptsModal
            recipients={rm.email.recipients}
            subject={rm.email.subject ?? conv.subject ?? ""}
            onClose={() => setReceiptsMsgId(null)}
          />
        );
      })()}
    </main>
  );
}
