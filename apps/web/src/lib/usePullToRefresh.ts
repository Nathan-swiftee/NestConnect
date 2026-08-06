import { useCallback, useRef, useState, type RefObject, type TouchEvent } from "react";

const MAX_PULL = 90;
const THRESHOLD = 58;

/**
 * Touch pull-to-refresh for a scrollable container. Only engages when the
 * container is scrolled to the top and the drag is downward, so it never fights
 * normal scrolling. Returns the live pull distance (for an indicator), whether
 * the pull has passed the trigger threshold, and the touch handlers to spread
 * onto the scroll element.
 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement>,
  onRefresh: () => void,
  refreshing: boolean,
) {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      const el = scrollRef.current;
      startY.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
    },
    [scrollRef],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      if (startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        if (pull !== 0) setPull(0);
        return;
      }
      // Rubber-band damping so the pull feels heavy near the max.
      setPull(Math.min(MAX_PULL, dy * 0.5));
    },
    [refreshing, pull],
  );

  const onTouchEnd = useCallback(() => {
    if (startY.current == null) return;
    if (pull >= THRESHOLD && !refreshing) onRefresh();
    setPull(0);
    startY.current = null;
  }, [pull, refreshing, onRefresh]);

  return {
    pull,
    armed: pull >= THRESHOLD,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
