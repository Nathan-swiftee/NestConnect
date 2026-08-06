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
