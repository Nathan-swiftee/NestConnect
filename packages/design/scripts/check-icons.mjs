/**
 * Guard rails for the icon set.
 *
 * Two things went wrong while drawing it that no amount of staring at the
 * source would catch, so they get checked mechanically instead:
 *
 *  1. A lowercase `m` after a previous sub-path is a *relative* moveto, so it
 *     lands wherever the last sub-path happened to end. Five glyphs were
 *     silently displaced this way — `search` lost its handle entirely.
 *  2. A path can drift outside the 24-grid, or shrink well inside it, and the
 *     icon then reads a different size to its neighbours even though every
 *     `<svg>` is the same box.
 *
 * Bounding boxes come from a real SVG engine (`getBBox`) rather than a
 * hand-rolled path parser, because arcs are where a parser would be wrong.
 *
 *   node --experimental-strip-types packages/design/scripts/check-icons.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { icons, tickIcons, channelIcons, teamIcons, logo } = await import(
  resolve(here, "../icons.ts")
);

/** The drawable margin on the 24-grid: ~20 live, so anything outside 1.5..22.5 is a slip. */
const PAD = 1.5;
/** An icon narrower *and* shorter than this reads small next to the others. */
const MIN_EXTENT = 12;
/**
 * Glyphs that are compact on purpose. A chevron is a directional tick, not a
 * full-height mark, and a diagonal cross reaches √2 further than its bounding
 * box suggests — at `plus`'s extent an ✕ would tower over it.
 */
const COMPACT = new Set(["x", "chevronDown", "chevronUp", "chevronRight"]);

const sets = {
  icons,
  ticks: tickIcons,
  channels: channelIcons,
  teams: teamIcons,
  logo: { logo: { d: logo.bubble, fill: logo.dot } },
};

const problems = [];
const note = (set, name, msg) => problems.push(`${set}.${name}: ${msg}`);

// ── 1. relative moveto after the first sub-path ──────────────────────────────
// A leading `m` is treated as absolute by every renderer, so only later ones
// are suspect. Channel marks are third-party brand paths and are exempt.
for (const [set, entries] of Object.entries(sets)) {
  if (set === "channels") continue;
  for (const [name, spec] of Object.entries(entries)) {
    for (const key of ["d", "fill"]) {
      const d = spec[key];
      if (!d) continue;
      const at = d.indexOf("m", 1);
      if (at > 0) note(set, name, `relative moveto in \`${key}\` at index ${at} — use \`M\``);
    }
  }
}

// ── 2. geometry, measured by an actual SVG engine ────────────────────────────
const playwright = await import("/home/user/Chat/node_modules/playwright-core/index.js");
const browser = await playwright.default.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.setContent("<svg id='s' xmlns='http://www.w3.org/2000/svg'></svg>");

const boxes = await page.evaluate((payload) => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("s");
  const out = {};
  for (const [key, d] of payload) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
    const b = p.getBBox();
    out[key] = { x: b.x, y: b.y, w: b.width, h: b.height };
    p.remove();
  }
  return out;
}, Object.entries(sets).flatMap(([set, entries]) =>
  Object.entries(entries).flatMap(([name, spec]) =>
    ["d", "fill"].filter((k) => spec[k]).map((k) => [`${set}|${name}|${k}`, spec[k]]),
  ),
));
await browser.close();

// The union of a glyph's stroked path and its filled path is the glyph.
const merged = {};
for (const [key, b] of Object.entries(boxes)) {
  const [set, name] = key.split("|");
  const id = `${set}|${name}`;
  const cur = merged[id];
  merged[id] = cur
    ? {
        x: Math.min(cur.x, b.x),
        y: Math.min(cur.y, b.y),
        w: Math.max(cur.x + cur.w, b.x + b.w) - Math.min(cur.x, b.x),
        h: Math.max(cur.y + cur.h, b.y + b.h) - Math.min(cur.y, b.y),
      }
    : b;
}

for (const [id, b] of Object.entries(merged)) {
  const [set, name] = id.split("|");
  // Non-square viewBoxes (the ticks) get their own bounds.
  const vb = (sets[set][name].viewBox ?? "0 0 24 24").split(" ").map(Number);
  const [vx, vy, vw, vh] = vb;
  // The tick glyphs are drawn in boxes cut to fit them, so the 24-grid's
  // breathing room doesn't apply — they only have to stay inside.
  const pad = vw === 24 && vh === 24 ? PAD : 0;
  const r = (n) => Math.round(n * 10) / 10;
  if (b.x < vx + pad - 0.05 || b.y < vy + pad - 0.05 || b.x + b.w > vx + vw - pad + 0.05 || b.y + b.h > vy + vh - pad + 0.05)
    note(set, name, `outside the ${vw}×${vh} box: ${r(b.x)},${r(b.y)} ${r(b.w)}×${r(b.h)}`);
  if (!COMPACT.has(name) && b.w < MIN_EXTENT && b.h < MIN_EXTENT)
    note(set, name, `reads small: ${r(b.w)}×${r(b.h)}, both under ${MIN_EXTENT}`);
}

const total = Object.keys(merged).length;
if (problems.length) {
  console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${total} glyphs:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${total} glyphs: no relative movetos, all inside their box, none undersized.`);
