/**
 * Mobile app-shell viewport handling.
 *
 * The body is locked with `position: fixed` (see styles.css @media ≤820) so the
 * page itself can never be dragged/bounced — that keeps the chat header and list
 * header nailed in place. Because a locked body can't scroll to reveal a focused
 * input, we size the shell to `window.visualViewport.height` here, so the on-
 * screen keyboard shrinks the app and the composer rides just above it.
 *
 * `focusin`/`focusout` reset any stray window scroll iOS applies, which would
 * otherwise shift the fixed layer up.
 */
export function initViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const set = () => {
    const h = Math.round(vv?.height ?? window.innerHeight);
    root.style.setProperty("--app-height", `${h}px`);
  };
  set();
  vv?.addEventListener("resize", set);
  vv?.addEventListener("scroll", set);
  window.addEventListener("orientationchange", () => setTimeout(set, 200));
  // The body is position:fixed; keep the window pinned at 0 so iOS can't nudge it.
  const pin = () => window.scrollTo(0, 0);
  window.addEventListener("focusin", pin);
  window.addEventListener("focusout", pin);
}
