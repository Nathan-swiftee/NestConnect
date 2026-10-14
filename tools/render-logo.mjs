/**
 * Cut every size the apps and the browser need out of the delivered artwork.
 *
 *   node --experimental-strip-types tools/render-logo.mjs            # web + in-app
 *   node --experimental-strip-types tools/render-logo.mjs --native   # + app icons
 *
 * The app icons are part of the app's build fingerprint (Expo's
 * `runtimeVersion: fingerprint`): change them and every installed build stops
 * receiving over-the-air updates until new store builds are out. So they're
 * only rewritten when asked for, as a step of its own beside a store release.
 *
 * Files arrive from design — the mark (green, and mint for a green tile) and the
 * lockup — and
 * about eight are needed: a 1024 app icon, an Android foreground that survives
 * being cropped to a circle, a favicon, an Apple touch icon, and copies for each
 * app to bundle. Doing that by hand is how this repo ended up with *two*
 * different logos, a web one and a phone one, neither knowing about the other.
 * Here every output is a build product of `packages/design/brand`, so they move
 * together or not at all.
 *
 * Two things it does that a plain resize wouldn't:
 *
 *  - **Trims to the ink.** The sources carry generous, unequal margins — the
 *    mark sits in 1254 points of canvas but is only 910 wide. Scaling that
 *    untrimmed gives a favicon of mostly nothing. Every crop is computed from
 *    the alpha channel rather than guessed.
 *  - **Pads on purpose.** Android crops an adaptive icon to whatever mask the
 *    launcher fancies, so the mark is placed inside the safe middle rather than
 *    filled to the edges and clipped into a different shape on every phone.
 *
 * Chromium is already on the machine for Playwright, so it does the raster work
 * rather than adding an image library for a job that runs about once a year.
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND } from "../packages/design/logo.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataUrl = (rel) =>
  `data:image/png;base64,${readFileSync(resolve(root, rel)).toString("base64")}`;

const SRC = {
  mark: dataUrl("packages/design/brand/mark.png"),
  markLight: dataUrl("packages/design/brand/mark-light.png"),
};
const NATIVE = process.argv.includes("--native");

/**
 * The delivered app tile (the mint mark on green), measured off the artwork
 * rather than chosen: the mark spans 63% of the tile's width, centred. Every
 * icon meant to look like that tile is built from these numbers, so "the same
 * logo, the same size" holds across platforms.
 */
const TILE = { ink: 0.63, centre: { x: 0.5, y: 0.5 } };

/**
 * How much of an Android adaptive icon you actually see. The drawable is 108dp
 * but the launcher masks it down to the middle 72 — everything outside that is
 * parallax and mask margin. Sizing the mark against the canvas instead of
 * against this window is how a logo ends up correct in the file and oversized on
 * the home screen.
 */
const ADAPTIVE_VISIBLE = 72 / 108;

/** Place `ink` of the tile inside the visible window of an adaptive icon. */
const inAdaptiveWindow = ({ ink, centre }) => ({
  ink: ink * ADAPTIVE_VISIBLE,
  centre: {
    x: (1 - ADAPTIVE_VISIBLE) / 2 + centre.x * ADAPTIVE_VISIBLE,
    y: (1 - ADAPTIVE_VISIBLE) / 2 + centre.y * ADAPTIVE_VISIBLE,
  },
});

/**
 * One output. `ink` is the fraction of the canvas width the artwork spans and
 * `centre` where its middle lands (both default to filling and centring);
 * `bg` fills behind it; `trim: false` skips the alpha crop and scales the whole
 * source, for a target that is already composed.
 */
const TARGETS = [
  // ── the phone: app icons (native — only with --native) ─────────────────
  // iOS and the Play Store both want 1024 and neither may be transparent; the
  // system applies its own mask, so this is square and unrounded.
  { out: "apps/mobile/assets/icon.png", src: "markLight", size: 1024, bg: BRAND.green, native: true, ...TILE },
  // Android adaptive foreground, sized against the window the launcher actually
  // shows; app.json's adaptive background is BRAND.green.
  { out: "apps/mobile/assets/adaptive-icon.png", src: "markLight", size: 1024, bg: null, native: true, ...inAdaptiveWindow(TILE) },

  // ── the phone: in the app (bundled JS assets, ship over the air) ───────
  // (The app's sign-in shows the delivered lockup, apps/mobile/assets/logo-lockup.png.)

  // ── the browser ────────────────────────────────────────────────────────
  // The green mark, for the narrow rail. The full logo (logo-lockup.png) is the
  // delivered lockup file itself, copied as is.
  { out: "apps/web/public/logo-mark.png", src: "mark", size: 512, ink: 0.96, bg: null },
  // A tab favicon is 16 or 32 real pixels, so it is trimmed hard — any margin
  // baked in here is margin the glyph doesn't get. Green on a transparent tab.
  { out: "apps/web/public/favicon-32.png", src: "mark", size: 32, ink: 0.96, bg: null },
  { out: "apps/web/public/favicon-64.png", src: "mark", size: 64, ink: 0.96, bg: null },
  // An iOS home screen composites onto white, so this one is the app tile.
  { out: "apps/web/public/favicon-180.png", src: "markLight", size: 180, bg: BRAND.green, ...TILE },
].filter((t) => NATIVE || !t.native);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();

/** The bounding box of everything not transparent, in source pixels. */
async function inkBox(src) {
  return page.evaluate(async (s) => {
    const img = new Image();
    img.src = s;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 16) continue;
      const px = (i / 4) % c.width;
      const py = (i / 4 / c.width) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return maxX < 0
      ? { x: 0, y: 0, w: img.width, h: img.height }
      : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }, src);
}

for (const t of TARGETS) {
  const src = SRC[t.src];
  const box = t.trim === false ? null : await inkBox(src);
  const W = t.size;
  const H = t.wide && box ? Math.round((W * box.h) / box.w) : W;

  // Scale the whole source so its *ink* spans `ink` of the canvas width, then
  // slide it so that ink's middle lands on `centre`. Transforming rather than
  // cropping keeps one composite step and no rounding between two of them.
  //
  // Width alone sets the scale, and the height follows. Fitting to whichever
  // axis is tighter — the obvious alternative — silently makes a wide mark and a
  // tall one different sizes on the same home screen.
  let inner;
  if (box) {
    const k = (W * (t.ink ?? 1)) / box.w;
    const cx = (t.centre?.x ?? 0.5) * W;
    const cy = (t.centre?.y ?? 0.5) * H;
    const dx = cx - (box.x + box.w / 2) * k;
    const dy = cy - (box.y + box.h / 2) * k;
    inner = `<img src="${src}" style="position:absolute;left:0;top:0;
      transform:translate(${dx}px, ${dy}px) scale(${k});transform-origin:0 0">`;
  } else {
    inner = `<img src="${src}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px">`;
  }

  const bg = t.bg === null ? "transparent" : (t.bg ?? BRAND.green);
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(
    `<style>html,body{margin:0;width:${W}px;height:${H}px}
     #s{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${bg}}
     img{image-rendering:auto}</style><div id="s">${inner}</div>`,
  );
  const file = resolve(root, t.out);
  mkdirSync(dirname(file), { recursive: true });
  await page.locator("#s").screenshot({ path: file, omitBackground: t.bg === null });
  console.log(`${t.out}  ${W}×${H}`);
}

await browser.close();
