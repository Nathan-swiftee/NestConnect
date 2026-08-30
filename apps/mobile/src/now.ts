import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * A clock that ticks, for the things on screen that count down.
 *
 * An SLA countdown and a snooze timer are the only numbers in this app that go
 * stale by sitting still: everything else changes when the server says so and
 * arrives through a query. These change because time passed, and nothing
 * re-renders on that.
 *
 * The web has this wrong and it is worth saying why, because the obvious fix is
 * to copy it. `ConversationList` calls `slaCountdown(c.slaDueAt)` straight in
 * its render — a value with *seconds* in it, recomputed only when the list
 * happens to re-render for some other reason. So the web shows a seconds-precise
 * countdown that is usually wrong by however long it has been since the last
 * render. Precision it doesn't have is worse than a coarser number it does.
 *
 * So: an explicit tick, at a rate the caller picks to match what it displays.
 * A list showing "45m" asks for 30s; a header showing "12m 04s" asks for 1s.
 * Never a rate finer than the smallest unit on screen — that is just re-renders
 * nobody can see.
 *
 * ## Why it stops in the background
 *
 * A phone is not a browser tab. An interval left running while the app is away
 * wakes the JS thread on a schedule to recompute text nobody is looking at, and
 * that is a battery complaint with a slow fuse. This stops on the way out and
 * catches up on the way back — `setNow` fires immediately on resume, so the
 * first frame after you return is already correct rather than showing whatever
 * the number was when you left.
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      // Immediately, not on the first interval: coming back from the background
      // after ten minutes should not show a ten-minute-old countdown for another
      // `everyMs` before correcting itself.
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), everyMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [everyMs]);

  return now;
}
