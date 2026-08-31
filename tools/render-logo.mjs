/**
 * Draw every raster the logo needs, from the one place the logo is defined.
 *
 * App stores and browsers want PNGs at fixed sizes, and a PNG is the one thing
 * `@ding/design/logo` cannot be. The alternative to this script is exporting
 * them by hand from a drawing tool, which is how the app ended up with a mark on
 * the phone that no longer matched the one on the web. Here the pixels are a
 * build product of the geometry: change the numbers, run this, and every icon
 * moves together or none of them do.
 *
 *   node tools/render-logo.mjs
 *
 * Chromium is already on the machine for Playwright, so this borrows it as an
 * SVG rasteriser rather than adding an image library to the dependency tree for
 * a job that runs about once a year.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND,
  MARK_ARCH,
  MARK_NODES,
  MARK_NODE_R,
  MARK_STEM,
  MARK_STROKE,
} from "../packages/design/logo.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The mark alone, on nothing. `scale` shrinks it within its own 100 box, which
 *  is how the adaptive icon keeps clear of the circle Android crops it to. */
function mark(color = BRAND.green, scale = 1) {
  const t = scale === 1 ? "" : ` transform="translate(${50 - 50 * scale} ${50 - 50 * scale}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g${t}>
    <g fill="none" stroke="${color}" stroke-width="${MARK_STROKE}" stroke-linecap="round">
      <path d="${MARK_STEM}"/><path d="${MARK_ARCH}"/>
    </g>
    ${MARK_NODES.map((n) => `<circle cx="${n.cx}" cy="${n.cy}" r="${MARK_NODE_R}" fill="${color}"/>`).join("")}
  </g></svg>`;
}

/** The mark standing on the brand's navy — the app icon and the touch icon,
 *  both of which are composited onto something unknown and so cannot be
 *  transparent. */
function tile(scale = 0.62, radius = 0) {
  return `<div style="width:100%;height:100%;background:${BRAND.navy};border-radius:${radius}%;
    display:flex;align-items:center;justify-content:center">${mark(BRAND.green, scale)}</div>`;
}

const TARGETS = [
  // iOS wants a square with no transparency and no rounding of its own — the
  // system applies the mask. Android's legacy icon uses the same file.
  { out: "apps/mobile/assets/icon.png", size: 1024, html: () => tile(0.62) },
  // Android adaptive: foreground only, transparent, and everything outside the
  // middle 66% is liable to be cropped away by whichever mask the launcher uses.
  { out: "apps/mobile/assets/adaptive-icon.png", size: 1024, html: () => mark(BRAND.green, 0.58) },
  // The splash sits on the app's own background colour, so it is the bare mark.
  { out: "apps/mobile/assets/splash-icon.png", size: 512, html: () => mark(BRAND.green, 0.8) },
  // Browsers: one small favicon for the tab, one 180 for an iOS home screen —
  // which composites onto white, hence the tile.
  { out: "apps/web/public/favicon-32.png", size: 32, html: () => mark(BRAND.green, 0.92) },
  { out: "apps/web/public/favicon-180.png", size: 180, html: () => tile(0.62, 22) },
];

// The image the session already has, rather than one Playwright would download:
// `PLAYWRIGHT_BROWSERS_PATH` points at it, and this is the binary inside.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();
for (const t of TARGETS) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;background:transparent}
     svg{width:100%;height:100%;display:block}</style>${t.html()}`,
  );
  const file = resolve(root, t.out);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true });
  console.log(`${t.out}  ${t.size}px`);
}
await browser.close();

// The tab icon a modern browser prefers, and the only one that stays sharp at
// every size it is asked for.
const svgOut = resolve(root, "apps/web/public/favicon.svg");
writeFileSync(svgOut, `${mark(BRAND.green, 0.92)}\n`);
console.log("apps/web/public/favicon.svg");
