/**
 * Persisted desktop layout preferences.
 *
 * Two knobs the user controls and we remember across reloads:
 *   • the conversation-list width  → the `--list-w` CSS var on :root, consumed
 *     by `.list` (desktop only; the ≤820 phone layout ignores it and goes
 *     full-width). Driven directly on the DOM while dragging — no React state,
 *     so a resize is a var write per frame, not a re-render of the whole shell.
 *   • whether the inbox sidebar is collapsed → a boolean React reads at mount.
 *
 * Mirrors the `viewport.ts` approach: a tiny module that owns a CSS var on
 * `document.documentElement`, seeded from localStorage at startup.
 */

const LIST_KEY = "nc_list_w";
const SIDE_KEY = "nc_side_collapsed";

export const LIST_MIN = 300;
export const LIST_MAX = 560;
export const LIST_DEFAULT = 372;

/** In-memory mirror of the applied width, so a drag can read the live value
 *  without re-parsing the computed style each frame. */
let current = LIST_DEFAULT;

/** Clamp a width to the allowed range, always leaving room for the icon rail
 *  and the thread so the list can never crush the conversation open beside it. */
export function clampListWidth(px: number): number {
  const room = typeof window !== "undefined" ? window.innerWidth - 520 : LIST_MAX;
  const hi = Math.min(LIST_MAX, Math.max(LIST_MIN, room));
  return Math.round(Math.min(hi, Math.max(LIST_MIN, px)));
}

export function getListWidth(): number {
  return current;
}

/** Apply a width live (clamped) without touching localStorage — for dragging. */
export function applyListWidth(px: number): number {
  current = clampListWidth(px);
  document.documentElement.style.setProperty("--list-w", `${current}px`);
  return current;
}

/** Apply + persist — for the end of a drag, a keyboard nudge, or a reset. */
export function setListWidth(px: number): number {
  applyListWidth(px);
  try {
    localStorage.setItem(LIST_KEY, String(current));
  } catch {
    /* ignore quota / private-mode errors */
  }
  return current;
}

export function resetListWidth(): number {
  return setListWidth(LIST_DEFAULT);
}

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Seed `--list-w` from storage before first paint (called from main.tsx), and
 *  keep the width re-clamped if the window shrinks so the thread stays usable. */
export function initLayout(): void {
  let stored = NaN;
  try {
    stored = parseInt(localStorage.getItem(LIST_KEY) ?? "", 10);
  } catch {
    /* ignore */
  }
  applyListWidth(Number.isFinite(stored) ? stored : LIST_DEFAULT);
  window.addEventListener("resize", () => applyListWidth(current));
}
