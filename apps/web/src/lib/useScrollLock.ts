import { useEffect, type RefObject } from "react";

/**
 * Lock scrolling of everything behind an open overlay (command palette, modal),
 * while still letting the overlay's own scroll region work.
 *
 * The app scrolls through inner containers (`.convs`, `.msgs`, …) rather than the
 * document, and an overlay rendered on top can still let a wheel/touch over its
 * backdrop reach those — so the page drifts behind the popup, and on touch it
 * rubber-bands instead of scrolling the list. We intercept wheel/touchmove at the
 * document (non-passive, so preventDefault sticks) and cancel any that doesn't
 * originate inside the overlay box; scrolls inside it fall through untouched.
 */
export function useScrollLock(boxRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onScrollAttempt = (e: WheelEvent | TouchEvent) => {
      const box = boxRef.current;
      const target = e.target as Node | null;
      if (box && target && box.contains(target)) return; // the overlay handles its own scroll
      e.preventDefault();
    };
    document.addEventListener("wheel", onScrollAttempt, { passive: false });
    document.addEventListener("touchmove", onScrollAttempt, { passive: false });
    return () => {
      document.removeEventListener("wheel", onScrollAttempt);
      document.removeEventListener("touchmove", onScrollAttempt);
    };
  }, [boxRef]);
}
