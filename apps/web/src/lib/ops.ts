/**
 * Business Ops on the web: what only a browser keeps — the SOPs you opened
 * last, per person, on this device. Purely a convenience: storage can be
 * blocked or wiped, and the library works the same without it.
 */
const KEY = "nest.ops.recent";
const MAX = 6;

function key(userId: string): string {
  return `${KEY}.${userId}`;
}

export function readRecentOps(userId: string | undefined): string[] {
  if (!userId) return [];
  try {
    const raw = window.localStorage.getItem(key(userId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** The SOP just opened goes to the front; the list stays short. */
export function pushRecentOps(userId: string | undefined, id: string): string[] {
  const next = [id, ...readRecentOps(userId).filter((x) => x !== id)].slice(0, MAX);
  if (userId) {
    try {
      window.localStorage.setItem(key(userId), JSON.stringify(next));
    } catch {
      /* storage blocked: nothing to remember, nothing lost */
    }
  }
  return next;
}

/** A colour at low strength, for an SOP's tinted tile. */
export function tint(hex: string, alpha = 0.14): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "var(--surface-2)";
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
