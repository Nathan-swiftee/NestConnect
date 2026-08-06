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
