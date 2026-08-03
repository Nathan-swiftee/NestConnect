/**
 * Pin the app to the *visual* viewport so the on-screen keyboard shrinks the
 * layout (keeping the composer stuck just above it, mobile-app style) instead
 * of overlapping and cutting it off. Falls back to 100dvh via the CSS default.
 */
export function initViewport(): void {
  const vv = window.visualViewport;
  const set = () => {
    const h = Math.round(vv?.height ?? window.innerHeight);
    document.documentElement.style.setProperty("--app-height", `${h}px`);
  };
  set();
  vv?.addEventListener("resize", set);
  vv?.addEventListener("scroll", set);
  window.addEventListener("orientationchange", () => setTimeout(set, 150));
}
