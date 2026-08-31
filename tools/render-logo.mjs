/**
 * Cut every size the apps and the browser need out of the delivered artwork.
 *
 *   node --experimental-strip-types tools/render-logo.mjs
 *
 * Three files arrive from design — the mark, the lockup, the app tile — and
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
  lockup: dataUrl("packages/design/brand/lockup.png"),
  icon: dataUrl("packages/design/brand/app-icon.png"),
};

/**
 * One output. `pad` is the fraction of the canvas left empty around the art,
 * `bg` fills behind it, `radius` rounds that fill, and `crop` picks a region of
 * the source in source pixels (used to lift the mark out of the lockup).
 */
const TARGETS = [
  // ── the phone ──────────────────────────────────────────────────────────
  // iOS and the Play Store both want 1024 and neither may be transparent; the
  // system applies its own mask, so this is square and unrounded.
  { out: "apps/mobile/assets/icon.png", src: "icon", size: 1024, pad: 0, trim: false },
  // Android adaptive foreground. Everything outside the middle 66% is liable to
  // be shaved off, so the mark takes about half the canvas and the rest is air.
  { out: "apps/mobile/assets/adaptive-icon.png", src: "mark", size: 1024, pad: 0.26, bg: null },
  // The mark on its own, for the sign-in screen and anywhere else in the app.
  { out: "apps/mobile/assets/logo-mark.png", src: "mark", size: 512, pad: 0.02, bg: null },

  // ── the browser ────────────────────────────────────────────────────────
  { out: "apps/web/public/logo-mark.png", src: "mark", size: 512, pad: 0.02, bg: null },
  { out: "apps/web/public/logo-lockup.png", src: "lockup", size: 1024, pad: 0.02, bg: null, wide: true },
  // A tab favicon is 16 or 32 real pixels, so it is trimmed hard — any margin
  // baked in here is margin the glyph doesn't get.
  { out: "apps/web/public/favicon-32.png", src: "mark", size: 32, pad: 0.02, bg: null },
  { out: "apps/web/public/favicon-64.png", src: "mark", size: 64, pad: 0.02, bg: null },
  // An iOS home screen composites onto white, so this one needs its own ground.
  { out: "apps/web/public/favicon-180.png", src: "icon", size: 180, pad: 0, trim: false },
];

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

  // Scale the whole source by whatever makes the *ink* fit the padded canvas,
  // then slide it so that ink lands centred. Transforming rather than cropping
  // keeps one composite step and no rounding between two of them.
  let inner;
  if (box) {
    const k = Math.min((W * (1 - t.pad * 2)) / box.w, (H * (1 - t.pad * 2)) / box.h);
    const dx = (W - box.w * k) / 2 - box.x * k;
    const dy = (H - box.h * k) / 2 - box.y * k;
    inner = `<img src="${src}" style="position:absolute;left:0;top:0;
      transform:translate(${dx}px, ${dy}px) scale(${k});transform-origin:0 0">`;
  } else {
    inner = `<img src="${src}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px">`;
  }

  const bg = t.bg === null ? "transparent" : (t.bg ?? BRAND.navy);
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
