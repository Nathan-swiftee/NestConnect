import { useRef, useState, type JSX } from "react";
import type { Attachment } from "@ding/schemas";
import { formatBytes, formatDuration } from "../../lib/format";
import { DocIcon, DownloadIcon, MicIcon, PauseIcon, PlayIcon, RefreshIcon, XIcon } from "../../lib/icons";

/*
 * Media in a thread or a chat: the voice/audio player, an attachment by kind,
 * and the composer's staging (classify, measure, record, show the chip). Moved
 * out of Thread.tsx unchanged so Team Chat draws and uploads media the same way
 * the inbox does.
 */

export function AudioPlayer({ att }: { att: Attachment }) {
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
export function AttachmentView({ att, onImage }: { att: Attachment; onImage: (url: string) => void }) {
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

/* ─── Composer media staging ────────────────────────────────────────────
   Files picked / dropped / pasted and voice recordings are staged locally,
   uploaded straight away, then referenced by id on send. */
export type StagedKind = "image" | "video" | "voice" | "document" | "audio";
export type StagedStatus = "uploading" | "done" | "error";

export type Staged = {
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
export function kindOfFile(file: File | Blob, name: string): StagedKind {
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
export function imageSize(file: File | Blob): Promise<{ width?: number; height?: number }> {
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
export function pickAudioMime(): string {
  const rec = typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined;
  if (!rec?.isTypeSupported) return "";
  for (const c of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]) {
    if (rec.isTypeSupported(c)) return c;
  }
  return "";
}

/** Decode a recorded blob → duration + ~40-bucket peak waveform (0..1). */
export async function analyzeAudio(
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
export function StagedChip({
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

