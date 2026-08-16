import { useRef, type ComponentPropsWithoutRef, type MouseEvent } from "react";

/**
 * Pointer-tracking "glide" highlight — the sliding capsule that follows the
 * cursor across a menu's items, matching the sidebar nav's feel. Spread
 * `hoverProps` on the (positioned) container and render `glide` as its first
 * child; items are `<button>`s and get position:relative from CSS. The glide
 * lives inside the container, so it scrolls with the items and stays aligned.
 */
export function useHoverGlide() {
  const ref = useRef<HTMLSpanElement>(null);
  const cur = useRef<HTMLElement | null>(null);
  const onMouseOver = (e: MouseEvent<HTMLElement>) => {
    const item = (e.target as HTMLElement).closest("button") as HTMLElement | null;
    const g = ref.current;
    if (!g || !item || !e.currentTarget.contains(item) || item === cur.current) return;
    const first = cur.current === null;
    if (first) g.style.transition = "opacity .16s ease"; // snap into place, just fade in
    g.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    g.style.width = `${item.offsetWidth}px`;
    g.style.height = `${item.offsetHeight}px`;
    g.style.opacity = "1";
    if (first) {
      void g.offsetHeight; // reflow so subsequent moves transition
      g.style.transition = "";
    }
    cur.current = item;
  };
  const onMouseLeave = () => {
    cur.current = null;
    if (ref.current) ref.current.style.opacity = "0";
  };
  return {
    hoverProps: { onMouseOver, onMouseLeave },
    glide: <span className="menu__glide" ref={ref} aria-hidden="true" />,
  };
}

/** A floating menu with the pointer-glide highlight baked in. Drop-in for a
 *  `<div className="menu …" role="menu">` container. */
export function GlideMenu({ className = "", children, ...rest }: ComponentPropsWithoutRef<"div">) {
  const { hoverProps, glide } = useHoverGlide();
  return (
    <div className={className + " has-glide"} {...hoverProps} {...rest}>
      {glide}
      {children}
    </div>
  );
}
