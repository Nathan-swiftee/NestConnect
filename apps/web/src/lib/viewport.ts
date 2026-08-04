/**
 * Mobile viewport lock.
 *
 * On iOS the layout viewport stays full-height when the on-screen keyboard
 * opens; Safari then scrolls the *visual* viewport up to reveal the focused
 * input, which drags the (fixed/sticky) chat header off the top of the screen.
 * `position: sticky` can't help — it's pinned to the layout viewport, which is
 * exactly what iOS is shifting.
 *
 * The fix: pin the app shell's height to `visualViewport.height`. When the
 * keyboard opens the shell shrinks to the space above it, so iOS has nothing
 * left to scroll — the header stays put and the composer sits just above the
 * keyboard. `--app-h` is only consumed by the ≤820px (phone) CSS; desktop keeps
 * its `100dvh`.
 */
export function initViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const apply = () => {
    raf = 0;
    root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  apply();
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
}
