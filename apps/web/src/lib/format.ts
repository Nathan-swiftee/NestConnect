export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/** WhatsApp-style clock time shown on each message bubble, e.g. "10:53" / "9:05". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h}:${m < 10 ? "0" : ""}${m}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? "");
  return (first + second).toUpperCase();
}

/** Saturated fallback palette for avatars (white initials read on all of them). */
const AVATAR_BG = [
  "#5B8DEF", "#0FA47A", "#E68A00", "#A06CF2", "#E0544D",
  "#1FBE5B", "#6366F1", "#EC4899", "#0EA5E9", "#14B8A6",
];

/** True when a colour is too light for the white avatar initials to read on. */
function tooLightForWhite(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (!c || c === "transparent" || c === "white" || c === "#fff" || c === "#ffffff") return true;
  const hex = c.replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
  if (full.length !== 6) return false; // unknown format (rgb()/named) — assume usable
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.82;
}

/**
 * A stable avatar background. Uses the stored colour when it's dark enough for
 * the white initials; otherwise derives a saturated one from the name — so a
 * contact synced without a colour is never a blank white circle.
 */
export function avatarBg(seed: string, provided?: string | null): string {
  if (provided && !tooLightForWhite(provided)) return provided;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

/** Compact "time from now" for a future timestamp (e.g. snooze wake): 9m, 2h, 1d. */
export function timeUntil(iso: string, nowMs: number = Date.now()): string {
  const m = Math.round((new Date(iso).getTime() - nowMs) / 60000);
  if (m <= 0) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Bytes → human-readable size for file cards, e.g. "812 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Milliseconds → "m:ss" clock for audio / voice players (e.g. 0:07, 1:32). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Time left in a WhatsApp 24-hour window as "23h 12m" (or "42m" under an hour). */
export function windowLeft(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Countdown string for an SLA due timestamp; "overdue" once passed. */
export function slaCountdown(dueIso: string, nowMs: number = Date.now()): string {
  const left = new Date(dueIso).getTime() - nowMs;
  if (left <= 0) return "overdue";
  const totalSec = Math.floor(left / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (h > 0 ? `${h}h ` : "") + `${m}m ` + `${s < 10 ? "0" : ""}${s}s`;
}
