import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * One React Native `Modal` on screen at a time.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * On iOS a `Modal` is a presented `UIViewController`. UIKit allows a view
 * controller to present exactly one thing; asking it to present a second while
 * the first is still up is refused, with nothing but a console line to say so.
 * The second modal mounts, renders, lays out — and never reaches the screen, or
 * reaches it and takes no touches.
 *
 * Nothing in this app deliberately stacks modals. It happens anyway, because
 * every sheet holds itself mounted through its exit animation so it has
 * something to animate — see `Sheet` and `MessageActions`. A row that closes
 * one sheet and opens another does both in a single commit, so for the ~260ms
 * of that exit there are two modals mounted, and on iOS the arriving one is the
 * one that loses.
 *
 * That is the whole of "Forward does nothing" and "the items in More do
 * nothing" on iPhone: `onForward(); onClose();` and `onClose(); a.onPress();`
 * are both exactly this shape. On Android a modal is a window rather than a
 * presentation, both mount happily, and the same code has always worked —
 * which is why it read as an iOS-only bug rather than as a bug at all.
 *
 * ── What this does ────────────────────────────────────────────────────────
 *
 * Holds a single slot. A sheet that wants to be on screen asks for it; if
 * another sheet holds it, the asker waits. The holder keeps the slot for its
 * whole life *including* its exit animation, then releases, and the longest
 * waiter takes it. So the sequence on iOS becomes: the outgoing sheet fades,
 * unmounts, and only then does the incoming one mount — which is the order
 * UIKit requires and, as it happens, the order the platform's own sheets use.
 *
 * Android keeps today's behaviour exactly: the slot is bypassed, both sheets
 * mount at once, and nothing waits on anything. There is no restriction to work
 * around there, and a hand-off delay would be a regression for no reason.
 */

/**
 * The pause between one modal releasing the slot and the next mounting.
 *
 * Unmounting the `Modal` starts UIKit dismissing the view controller, and that
 * completes a beat after React has finished with it. Presenting inside that
 * beat is the same refusal this whole module exists to avoid, so the next sheet
 * waits a frame or two. It is invisible next to the outgoing sheet's own 220ms
 * fade, which has already finished by the time this runs.
 */
const HANDOFF_MS = 80;

/** iOS only. Everywhere else the slot is not a real constraint. */
const SERIALISED = Platform.OS === "ios";

let holder: symbol | null = null;
/** Longest-waiting first, so two sheets racing resolve in the order they asked. */
const waiting: Array<{ id: symbol; take: () => void }> = [];
let handoff: ReturnType<typeof setTimeout> | null = null;

function grant(): void {
  if (holder || !waiting.length) return;
  const next = waiting.shift()!;
  holder = next.id;
  next.take();
}

function request(id: symbol, take: () => void): void {
  if (holder === id || waiting.some((w) => w.id === id)) return;
  waiting.push({ id, take });
  grant();
}

function release(id: symbol): void {
  const queued = waiting.findIndex((w) => w.id === id);
  if (queued !== -1) waiting.splice(queued, 1);
  if (holder !== id) return;
  holder = null;
  if (handoff) clearTimeout(handoff);
  handoff = setTimeout(() => {
    handoff = null;
    grant();
  }, HANDOFF_MS);
}

/** Reset between tests. Module state outlives a render tree; a test's does not. */
export function __resetModalSlot(): void {
  holder = null;
  waiting.length = 0;
  if (handoff) clearTimeout(handoff);
  handoff = null;
}

export interface ModalSlot {
  /** Put the `Modal` on screen — it stays true through the exit animation. */
  mounted: boolean;
  /** Animate in (true) or out (false). False while mounted means "leaving". */
  presenting: boolean;
}

/**
 * Claim the slot for as long as this sheet is on screen.
 *
 * @param visible what the caller wants — the sheet's own `visible` prop.
 * @param exitMs how long its exit animation needs before it may unmount.
 */
export function useModalSlot(visible: boolean, exitMs: number): ModalSlot {
  // Identity for this component instance, stable across renders.
  const id = useRef<symbol>(undefined as unknown as symbol);
  if (!id.current) id.current = Symbol("modal");

  const [held, setHeld] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!SERIALISED) {
      setHeld(visible);
      return;
    }
    const me = id.current;
    if (visible) {
      request(me, () => setHeld(true));
      return;
    }
    // Not released here: the sheet still has to animate out, and it can only do
    // that while it is the one on screen. The unmount below releases it.
    setHeld(false);
  }, [visible]);

  // Mount as soon as the slot is ours; unmount once the exit has had its time.
  useEffect(() => {
    if (held) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = setTimeout(() => {
      setMounted(false);
      if (SERIALISED) release(id.current);
    }, exitMs);
    return () => clearTimeout(t);
  }, [held, mounted, exitMs]);

  // A screen torn down mid-sheet must not take the slot with it — every other
  // sheet in the app would then wait forever on a component that no longer
  // exists.
  useEffect(() => {
    const me = id.current;
    return () => {
      if (SERIALISED) release(me);
    };
  }, []);

  return { mounted, presenting: held };
}
