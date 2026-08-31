import { MEASURE_JS } from "../src/email-fit";

/**
 * The script that fits an email to the phone, run against a stub of the page it
 * measures.
 *
 * This is a string of JavaScript injected into a WebView, which puts it outside
 * everything else that checks this app: TypeScript does not see it, the linter
 * does not see it, and no rendering test can reach inside a WebView to find out
 * what it did. A typo in it fails silently — the email simply stays the wrong
 * size, which is exactly the bug it was written to fix and looks identical to
 * not having shipped at all.
 *
 * So the stub reproduces the three numbers the script actually reads — the
 * viewport width, the content width, and the content height — and the two
 * things it can do about them: drop the responsive class, and scale the body.
 */

interface Page {
  vw: number;
  /** Content width while the responsive rules apply. */
  constrained: number;
  /** Content width once `fit` is dropped and the page lays out naturally. */
  natural: number;
  height: number;
}

function run(page: Page) {
  let released = false;
  const style: Record<string, string> = {};
  const posted: string[] = [];

  const body = {
    style,
    get scrollWidth() {
      return released ? page.natural : page.constrained;
    },
    get scrollHeight() {
      return page.height;
    },
    get offsetHeight() {
      return page.height;
    },
  };
  const documentElement = {
    clientWidth: page.vw,
    get scrollWidth() {
      return released ? page.natural : page.constrained;
    },
    get scrollHeight() {
      return page.height;
    },
    classList: {
      remove: (name: string) => {
        if (name === "fit") released = true;
      },
    },
  };

  const doc = { body, documentElement };
  const win = {
    innerWidth: page.vw,
    addEventListener: () => {},
    ReactNativeWebView: { postMessage: (m: string) => posted.push(m) },
  };

  // The script is an IIFE that measures once on the spot; the timers and
  // listeners it registers are for later reflows and are inert here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", "document", "setTimeout", MEASURE_JS)(win, doc, () => 0);

  return { released, transform: style.transform ?? "", height: Number(posted.at(-1)) };
}

test("an email that already fits is left alone", () => {
  const r = run({ vw: 354, constrained: 340, natural: 340, height: 800 });

  expect(r.released).toBe(false);
  expect(r.transform).toBe("");
  expect(r.height).toBe(800);
});

test("a page built to a fixed width is laid out at that width and scaled whole", () => {
  // The shape of the reported bug: the outer table obeys `max-width:100%` and
  // squashes towards the phone while something inside it is pinned to 600, so
  // the page tears. Releasing the constraint has to come first — scaling the
  // half-squashed 420 would leave the design still broken, just smaller.
  const r = run({ vw: 354, constrained: 420, natural: 600, height: 1000 });

  expect(r.released).toBe(true);
  expect(r.transform).toBe(`scale(${354 / 600})`);
  // Reported at its on-screen size, not its layout size — the frame around it
  // is set from this number, and 1000 would leave 400 points of white.
  expect(r.height).toBe(Math.ceil(1000 * (354 / 600)));
});

test("nothing is scaled to nothing when the viewport is not measurable yet", () => {
  // First paint inside a WebView can report zero before layout runs. Dividing
  // by that, or scaling to it, would collapse the message permanently.
  const r = run({ vw: 0, constrained: 600, natural: 600, height: 1000 });

  expect(r.transform).toBe("");
  expect(r.height).toBeNaN(); // nothing posted at all
});

test("the height still tracks a page that needed no scaling", () => {
  const r = run({ vw: 354, constrained: 200, natural: 200, height: 44 });

  expect(r.transform).toBe("");
  expect(r.height).toBe(44);
});
