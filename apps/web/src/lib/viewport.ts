/**
 * The single mobile-viewport strategy.
 *
 * iOS keeps the *layout* viewport full-height when the on-screen keyboard opens
 * and instead shifts the *visual* viewport: its height shrinks to the space
 * above the keyboard and, when Safari scrolls to reveal the focused field, its
 * top edge is pushed down inside the layout viewport (`offsetTop` > 0). A shell
 * living in normal document flow can't follow that shift, so the header scrolls
 * off the top of the screen — the "fly up" bug. `position: sticky` can't help
 * either: it's pinned to the layout viewport, which is exactly what iOS moves.
 *
 * The fix is to publish the visual viewport's geometry as two CSS variables and
 * let the ≤820px CSS pin the OUTER app shell to it:
 *
 *   --app-h   = visualViewport.height     → the shell's height
 *   --app-top = visualViewport.offsetTop  → the shell's top (position: fixed)
 *
 * A `position: fixed` shell at `top: var(--app-top); height: var(--app-h)`
 * exactly overlays the visible region, so when the keyboard opens the shell
 * shrinks to sit above it and stays glued there — iOS has nothing left to
 * scroll. This is the ONLY thing that controls mobile positioning; the header /
 * message list / composer then fall out of the normal flex column inside the
 * shell. Desktop never reads these vars and keeps its `100dvh`.
 */
export function initViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const apply = () => {
    raf = 0;
    root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
    root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  apply();
  // resize → keyboard show/hide + URL-bar expand/collapse; scroll → visual
  // viewport panned within the layout viewport (offsetTop changes);
  // orientationchange → landscape/portrait swap. One handler, one shell.
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", schedule);
}
