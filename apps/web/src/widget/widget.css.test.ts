import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two things in the widget's stylesheet are silent when they are wrong.
 *
 * The home screen's header dissolves into the panel colour, and it has to name
 * that colour twice — once as `--panel` for everything that just paints it, and
 * once as `--panel-rgb` for the nine alphas the fade needs. Change one and not
 * the other and the fade lands on a colour a shade off the panel below it: a
 * seam, at exactly the place the fade exists to hide.
 *
 * And the nine stops are a curve. Typed by hand, they are nine chances to put a
 * digit in the wrong place — which shows up as a kink in a gradient, not as an
 * error. So the shape is asserted here rather than trusted.
 */
const css = readFileSync(fileURLToPath(new URL("./widget.css", import.meta.url)), "utf8");

describe("the panel colour, written twice", () => {
  const hexes = [...css.matchAll(/--panel:\s*#([0-9a-f]{6})\s*;/gi)].map((m) => m[1]);
  const channels = [...css.matchAll(/--panel-rgb:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)].map((m) =>
    m.slice(1, 4).map(Number),
  );

  it("declares both in both themes", () => {
    expect(hexes).toHaveLength(2);
    expect(channels).toHaveLength(2);
  });

  it("says the same colour each way", () => {
    hexes.forEach((hex, i) => {
      const rgb = [0, 2, 4].map((o) => parseInt(hex.slice(o, o + 2), 16));
      expect(channels[i]).toEqual(rgb);
    });
  });
});

describe("the header's fade", () => {
  /** The stops, as `[alpha, distance above the header's bottom edge]`. */
  const stops = [
    ...css.matchAll(/rgb\(var\(--panel-rgb\)\s*\/\s*([\d.]+)\)\s*calc\(100%\s*-\s*(\d+)px\)/g),
  ].map((m) => [Number(m[1]), Number(m[2])] as const);

  it("runs from nothing to the panel colour", () => {
    expect(stops.length).toBeGreaterThanOrEqual(9);
    expect(stops[0][0]).toBe(0);
    expect(stops.at(-1)![0]).toBe(1);
  });

  it("only ever goes one way", () => {
    for (let i = 1; i < stops.length; i++) {
      // More opaque as it descends, and every stop below the last one.
      expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
      expect(stops[i][1]).toBeLessThan(stops[i - 1][1]);
    }
  });

  it("is a smoothstep and not a straight line", () => {
    // A straight line is what this replaced: it changes alpha at a constant
    // rate and then stops changing, and the eye reads that corner as a band
    // even though there is no edge in the pixels. A smoothstep starts and ends
    // still, so there is no corner to catch.
    const top = stops[0][1];
    const bottom = stops.at(-1)![1];
    const smoothstep = (t: number) => t * t * (3 - 2 * t);
    let offCurve = 0;
    let offLine = 0;
    for (const [alpha, px] of stops) {
      const t = (top - px) / (top - bottom);
      offCurve = Math.max(offCurve, Math.abs(alpha - smoothstep(t)));
      offLine = Math.max(offLine, Math.abs(alpha - t));
    }
    expect(offCurve).toBeLessThan(0.01);
    expect(offLine).toBeGreaterThan(0.09);
  });

  it("ends above the header's own bottom edge, so it finishes under the first card", () => {
    // The last of the colour has to go behind something. The cards are pulled
    // up over the header by more than this, so the ramp completes inside the
    // first card rather than in the open where its end would read as a line.
    const overlap = Number(/margin-top:\s*-(\d+)px/.exec(css)![1]);
    expect(stops.at(-1)![1]).toBeGreaterThan(0);
    expect(stops.at(-1)![1]).toBeLessThan(overlap);
  });
});

/**
 * Three more things that are silent when they are wrong.
 *
 * A gesture that drags needs `touch-action: none` on the element it starts
 * from, or the browser claims the movement for scrolling and the drag simply
 * never happens — on phones only, which is where all three of these gestures
 * live and where nobody is looking at a console.
 *
 * An animation added without a matching rule in the reduced-motion block is
 * the same kind of failure: correct-looking everywhere except on the machines
 * of the people who asked for it to stop.
 */
describe("gestures the browser could take away", () => {
  it("lets the microphone button own the drag", () => {
    // Hold-to-talk with slide-to-cancel. Without this, sliding scrolls the
    // page and the note can never be cancelled.
    const mic = css.slice(css.indexOf(".nc__mic {"), css.indexOf(".nc__mic--live"));
    expect(mic).toMatch(/touch-action:\s*none/);
  });

  it("stops the microphone button being selected instead of held", () => {
    const mic = css.slice(css.indexOf(".nc__mic {"), css.indexOf(".nc__mic--live"));
    // A long press on a button otherwise raises the text-selection loupe on
    // iOS, over the top of the thing being held.
    expect(mic).toMatch(/user-select:\s*none/);
  });
});

describe("motion somebody asked us to stop", () => {
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

  /** Every class that carries its own `animation:` in the new sections. */
  const animated = [
    "nc__react",
    "nc__picker",
    "nc__pick",
    "nc__replying",
    "nc__micerror",
    "nc__rec",
    "nc__rec-dot",
  ];

  it.each(animated)("stills .%s", (name) => {
    expect(reduced).toContain(`.${name}`);
  });

  it("keeps the flash, without the pulse", () => {
    // The flash is not decoration — it is the answer to "which message did
    // that quote point at". Removing it entirely would leave the tap doing
    // nothing visible, so it steps instead of easing.
    expect(reduced).toMatch(/nc__msg--flash[\s\S]*?animation:\s*nc-flash/);
  });
});
