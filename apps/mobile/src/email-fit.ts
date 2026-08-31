/**
 * Fit the email to the phone, then report how tall it ended up.
 *
 * ## Fitting
 *
 * A designed email is a page built to a width — 600 points is the industry's
 * near-universal choice — and no phone is that wide. The CSS above does what it
 * can (`img{max-width:100%}`, `table{max-width:100%}`), but a newsletter pins
 * its width in places CSS cannot reach from outside: `<td width="600">`, inline
 * `style="width:600px"`, nested tables. Anything still too wide simply hung off
 * the right-hand edge and was clipped — a banner cut through the middle of a
 * word, sentences with no ends — and with `scrollEnabled` off there was not even
 * a sideways drag to reach the rest of it.
 *
 * So scale it down instead, which is what every mail client does: measure what
 * the content actually needs, and if that exceeds the viewport, shrink the whole
 * document by the ratio. Smaller but complete beats full-size and cut in half.
 *
 * `transform` is the right tool precisely because it does *not* affect layout.
 * Nothing reflows, so a design holds together instead of collapsing into a
 * column, and — the part that matters for the code below — `scrollHeight` keeps
 * reporting the natural height, which is what makes the arithmetic honest. It
 * also means changing the scale cannot feed back into the `ResizeObserver`
 * watching for it, which setting a width would have done, once per frame,
 * forever.
 *
 * ## Measuring
 *
 * One reading is never enough: images decide the height of most designed emails
 * and arrive after first paint, so a single measurement at load lands before the
 * pictures and clamps the message to the height of its text. The observer covers
 * reflow, the load listener covers late images, and the timers cover anything
 * that settles without announcing itself.
 */
export const MEASURE_JS = `
(function () {
  var lastH = 0;
  var lastScale = 1;
  var released = false;
  function widthOf(b, d) { return Math.max(b.scrollWidth, d.scrollWidth, 0); }
  function measure() {
    var b = document.body, d = document.documentElement;
    if (!b || !d) return;

    var vw = d.clientWidth || window.innerWidth || 0;
    if (!vw) return;
    var cw = widthOf(b, d);

    // Still too wide with the responsive rules on. Half-constraining is the
    // worst of both: the outer table obeys \`max-width:100%\` and squashes to the
    // phone while a \`<td width="600">\` inside it does not, so the design tears
    // — which is what the screenshot of this bug shows. Let go of the
    // constraint, let the page lay out at the width it was drawn for, and scale
    // it as one piece. Done once; re-adding it would oscillate.
    if (cw > vw + 1 && !released) {
      released = true;
      d.classList.remove('fit');
      cw = widthOf(b, d);
    }

    var scale = cw > vw + 1 ? vw / cw : 1;
    if (scale !== lastScale) {
      lastScale = scale;
      b.style.transformOrigin = 'top left';
      b.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    }

    // The body's own height, unaffected by the transform on it, times the
    // amount that transform shrinks it by.
    var natural = Math.max(b.scrollHeight, b.offsetHeight, 0) || d.scrollHeight;
    var h = Math.ceil(natural * scale);
    if (h && Math.abs(h - lastH) > 1) {
      lastH = h;
      window.ReactNativeWebView.postMessage(String(h));
    }
  }
  measure();
  window.addEventListener('load', measure);
  if (window.ResizeObserver && document.body) new ResizeObserver(measure).observe(document.body);
  [60, 250, 700, 1500].forEach(function (d) { setTimeout(measure, d); });
})();
true;
`;
