import { useRef, type MouseEvent } from "react";

/**
 * A hover "thumb" that glides under the pointer across a segmented control —
 * the same feel as the sidebar's hover capsule. Spread `hoverProps` on the
 * container, put `<span ref={thumbRef}>` just before the selected thumb, and
 * give the container `position: relative`.
 *
 * axis "x"  → moves horizontally only (height comes from the thumb's CSS).
 * axis "xy" → tracks the full box (translate + width + height).
 */
export function useHoverGlide<C extends HTMLElement>(itemSelector: string, axis: "x" | "xy" = "xy") {
  const containerRef = useRef<C>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const current = useRef<HTMLElement | null>(null);

  const onMouseOver = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest?.(itemSelector) as HTMLElement | null;
    const th = thumbRef.current;
    if (!th || !item || item === current.current || !containerRef.current?.contains(item)) return;
    const firstEntry = current.current === null;
    // Snap into place on first entry so it doesn't streak across from nowhere.
    if (firstEntry) th.style.transition = "opacity .16s ease";
    th.style.transform =
      axis === "x"
        ? `translateX(${item.offsetLeft}px)`
        : `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    th.style.width = `${item.offsetWidth}px`;
    if (axis === "xy") th.style.height = `${item.offsetHeight}px`;
    th.style.opacity = "1";
    if (firstEntry) {
      void th.offsetHeight; // force reflow so the next move transitions
      th.style.transition = "";
    }
    current.current = item;
  };

  const onMouseLeave = () => {
    current.current = null;
    if (thumbRef.current) thumbRef.current.style.opacity = "0";
  };

  return { containerRef, thumbRef, hoverProps: { onMouseOver, onMouseLeave } };
}
