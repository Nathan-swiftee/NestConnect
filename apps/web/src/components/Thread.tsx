import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { ChangeEvent as RChangeEvent, ClipboardEvent as RClipboardEvent, DragEvent as RDragEvent } from "react";
import type { Message, Attachment } from "@ding/schemas";
import { useConversation, useMe, useSendMessage, useAssign, useSetStatus, useSnooze, useTeams } from "../hooks";
import { api } from "../lib/api";
import { relativeTime, clockTime, initials, formatBytes, formatDuration, windowLeft } from "../lib/format";
import { useHoverGlide } from "../lib/useHoverGlide";
import { playSent, unlock } from "../lib/sound";
import { TemplatePicker } from "./TemplatePicker";
import {
  channelMeta,
  ClockIcon,
  ChevronDown,
  SnoozeIcon,
  TagIcon,
  DetailsIcon,
  SendIcon,
  AttachIcon,
  EmojiIcon,
  NoteIcon,
  ProfileIcon,
  RouteIcon,
  InboxIcon,
  CheckCircleIcon,
  ReopenIcon,
  BackIcon,
  BoltIcon,
  CheckSingle,
  CheckDouble,
  PlayIcon,
  PauseIcon,
  DocIcon,
  DownloadIcon,
  XIcon,
  MicIcon,
  StopIcon,
  TrashIcon,
  RefreshIcon,
} from "../lib/icons";

interface Props {
  conversationId: string | null;
  showPanel: boolean;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
  onBack?: () => void;
  onClosed?: () => void;
}

function renderMention(body: string): JSX.Element[] {
  return body.split(/(@\w+)/g).map((part, i) =>
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

/** A single customer/agent message bubble, with any media rendered above an
 *  optional caption. Text-only messages keep their original markup exactly. */
function MessageBubble({ m, onImage }: { m: Message; onImage: (url: string) => void }) {
  const out = m.direction === "out";
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

  return (
    <div className={"msg " + (out ? "out" : "in")}>
      {!out && m.authorName && <div className="sender">{m.authorName}</div>}
      <div className={"bubble" + (hasMedia ? " has-media" : "") + (stickerOnly ? " bubble--plain" : "")}>
        {hasMedia && atts.map((a) => <AttachmentView key={a.id} att={a} onImage={onImage} />)}
        {showText && (
          <span className="txt">
            {bodyText}
            <span className="stampspace" aria-hidden="true" />
          </span>
        )}
        <span className={"stamp" + (overlay ? " stamp--over" : blockStamp ? " stamp--block" : "")}>
          {clockTime(m.createdAt)}
          {out && (
            <span className={"tick" + (m.status === "read" ? " read" : "")}>
              {m.status === "read" || m.status === "delivered" ? <CheckDouble /> : <CheckSingle />}
            </span>
          )}
        </span>
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

export function Thread({ conversationId, showPanel, onTogglePanel, onToast, onBack, onClosed }: Props) {
  const { data: conv } = useConversation(conversationId);
  const { data: me } = useMe();
  const { data: teams } = useTeams();
  const send = useSendMessage();
  const assign = useAssign();
  const setStatus = useSetStatus();
  const snooze = useSnooze();

  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  const [internal, setInternal] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  // Ticks so the WhatsApp 24-hour window countdown stays live without a reload.
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const replyBtnRef = useRef<HTMLButtonElement>(null);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const modeThumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: modeRef, thumbRef: modeHoverRef, hoverProps: modeHover } = useHoverGlide<HTMLDivElement>(".modebtn", "x");

  // ─── Composer media state ───
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const stagedRef = useRef<Staged[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  const recCancelRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages.length, conversationId]);

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

  // A newly-opened conversation should show a fresh countdown immediately.
  useEffect(() => {
    setNow(Date.now());
    setPicker(false);
  }, [conversationId]);

  // Slide the Reply|Note thumb under the active tab. Written to the DOM directly
  // (no state → no extra render) so the slide starts on the same frame as the click.
  useLayoutEffect(() => {
    const btn = internal ? noteBtnRef.current : replyBtnRef.current;
    const thumb = modeThumbRef.current;
    if (btn && thumb) {
      thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
      thumb.style.width = `${btn.offsetWidth}px`;
    }
  }, [internal, conversationId, conv?.status]);

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
    setRecording(false);
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

  const cm = channelMeta(conv.channel);
  const Glyph = cm.Glyph;
  const isEmail = conv.channel === "email";
  const isClosed = conv.status === "closed";
  const owned = !!conv.assigneeUserId;
  const sub = isEmail
    ? (conv.contact.email ?? "")
    : conv.channel === "whatsapp_group"
      ? "group · active now"
      : "online · last seen just now";

  const readyAtts = staged.filter((s) => s.status === "done" && s.attachment);
  const uploadingAtts = staged.some((s) => s.status === "uploading");
  const canSend = (text.trim().length > 0 || readyAtts.length > 0) && !uploadingAtts;
  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // ─── WhatsApp 24-hour window ───
  // `waWindow` is null on email (no restriction). On WhatsApp it says whether
  // you may still free-type; once closed, only an approved template gets through.
  const isWhatsApp = conv.channel === "whatsapp" || conv.channel === "whatsapp_group";
  const waWindow = conv.waWindow;
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

  const handleSend = () => {
    if (!canSend || composeLocked) return;
    const body = text.trim();
    const wasInternal = internal;
    unlock();
    const attachmentIds = readyAtts.map((s) => s.attachment!.id);
    send.mutate(
      {
        id: conv.id,
        body,
        internal,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
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
    if (!internal) playSent();
    setText("");
    clearStaged();
    setInternal(false);
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

  const finishRecording = async () => {
    const rec = mediaRecorderRef.current;
    const mime = rec?.mimeType || "audio/webm";
    const chunks = recChunksRef.current;
    const elapsedMs = Date.now() - recStartRef.current;
    mediaRecorderRef.current = null;
    recChunksRef.current = [];
    teardownRec();
    if (recCancelRef.current || chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mime });
    const { durationMs, waveform } = await analyzeAudio(blob, elapsedMs);
    const ext = mime.includes("ogg") ? "ogg" : "webm";
    const item: Staged = {
      localId: crypto.randomUUID(),
      file: blob,
      name: "voice-message." + ext,
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
    recChunksRef.current = [];
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
    setRecording(true);
    recTimerRef.current = window.setInterval(() => {
      setRecSecs(Math.floor((Date.now() - recStartRef.current) / 1000));
    }, 250);
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    setRecording(false);
    if (rec && rec.state !== "inactive") rec.stop();
    else teardownRec();
  };

  const cancelRecording = () => {
    recCancelRef.current = true;
    const rec = mediaRecorderRef.current;
    setRecording(false);
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
          <div className="av" style={{ background: conv.contact.avatarColor, width: 40, height: 40, fontSize: 14 }}>
            {initials(conv.contact.displayName)}
          </div>
          <div className="who">
            <h2>{conv.contact.displayName}</h2>
            {conv.subject && conv.subject !== conv.contact.displayName && (
              <div className="who-subject">{conv.subject}</div>
            )}
            <div className="who-sub">
              <span className="pill" title={cm.label} aria-label={cm.label}>
                <span className="pill-ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
              </span>
              <span className="who-presence">{sub}</span>
            </div>
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
          <button className="assignbtn" onClick={() => { setMenu((v) => !v); setSnoozeMenu(false); }}>
            {owned ? (
              <>
                <span className="mini" style={{ background: me?.user.avatarColor }}>
                  {me ? initials(me.user.name) : ""}
                </span>
                <span className="lbl">Assigned to you</span>
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
              className={"iconbtn" + (snoozeMenu ? " on" : "")}
              title="Snooze"
              onClick={() => { setSnoozeMenu((v) => !v); setMenu(false); }}
            >
              <SnoozeIcon />
            </button>
            {snoozeMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setSnoozeMenu(false)} />
                <div className="menu snoozemenu" role="menu">
                  <div className="menu__hd">Snooze until</div>
                  {snoozeOpts.map((o) => (
                    <button key={o.short} onClick={() => doSnooze(o.until(), o.short)}>
                      <SnoozeIcon /> {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="iconbtn hide-sm" title="Add label" onClick={() => onToast("Add label")}>
            <TagIcon />
          </button>
          <button className={"iconbtn" + (showPanel ? " on" : "")} title="Details" onClick={onTogglePanel}>
            <DetailsIcon />
          </button>
        </div>
      </header>

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(false)} />
          <div className="menu" role="menu">
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
            {isClosed ? (
              <button onClick={reopenConversation}>
                <ReopenIcon /> Reopen conversation
              </button>
            ) : (
              <button onClick={closeConversation}>
                <CheckCircleIcon /> Close conversation
              </button>
            )}
          </div>
        </>
      )}

      <div className={"msgs" + (isClosed ? " is-closed" : "")}>
        {groupMessagesByDay(conv.messages).map((group) => (
          <section className="daygroup" key={group.key}>
            <div className="daysep">{group.label}</div>
            {group.items.map((m) =>
              m.internal ? (
                <div key={m.id} className="note">
                  <div className="ic">
                    <NoteIcon />
                  </div>
                  <div className="body">
                    <div className="h">
                      Internal note<span className="t">{relativeTime(m.createdAt)}</span>
                    </div>
                    <div>{renderMention(m.body)}</div>
                  </div>
                </div>
              ) : (
                <MessageBubble key={m.id} m={m} onImage={setLightbox} />
              ),
            )}
          </section>
        ))}
        {conv.messages.length === 0 && (
          <div className="thread-empty">No messages yet — start the conversation.</div>
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
            <div className="compmode" role="tablist" ref={modeRef} {...modeHover}>
              <span className="seg-hover" ref={modeHoverRef} />
              <span className="seg-thumb" ref={modeThumbRef} />
              <button
                type="button"
                role="tab"
                ref={replyBtnRef}
                aria-selected={!internal}
                className={"modebtn" + (!internal ? " active" : "")}
                onClick={() => setInternal(false)}
              >
                <span className="modebtn__ic" style={!internal ? { color: cm.color } : undefined}>
                  <Glyph />
                </span>
                Reply
              </button>
              <button
                type="button"
                role="tab"
                ref={noteBtnRef}
                aria-selected={internal}
                className={"modebtn modenote" + (internal ? " active" : "")}
                onClick={() => setInternal(true)}
              >
                <span className="modebtn__ic">
                  <NoteIcon />
                </span>
                Note
              </button>
            </div>
            <span className="compctx">{ctxNode}</span>
          </div>
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
                className="comp-rec__cancel"
                onClick={cancelRecording}
                title="Cancel"
                aria-label="Cancel recording"
              >
                <TrashIcon />
              </button>
              <span className="comp-rec__dot" aria-hidden="true" />
              <span className="comp-rec__time tnum">{formatDuration(recSecs * 1000)}</span>
              <span className="comp-rec__hint">Recording…</span>
              <button
                type="button"
                className="comp-rec__stop"
                onClick={stopRecording}
                title="Stop and attach"
                aria-label="Stop and attach recording"
              >
                <StopIcon />
              </button>
            </div>
          ) : (
            <div className="compinput">
              <button className="tool" title="Emoji" aria-label="Emoji">
                <EmojiIcon />
              </button>
              <textarea
                value={text}
                rows={1}
                onChange={(e) => setText(e.target.value)}
                onPaste={onTextareaPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  internal ? "Write an internal note… use @name to mention" : `Message ${conv.contact.displayName}…`
                }
              />
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
              {canRecord && (
                <button
                  className="tool"
                  title="Record voice message"
                  aria-label="Record voice message"
                  onClick={startRecording}
                >
                  <MicIcon />
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
              <button className="send" onClick={handleSend} disabled={!canSend} title="Send" aria-label="Send">
                <SendIcon />
              </button>
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
        <TemplatePicker conversationId={conv.id} onClose={() => setPicker(false)} onToast={onToast} />
      )}
    </main>
  );
}
