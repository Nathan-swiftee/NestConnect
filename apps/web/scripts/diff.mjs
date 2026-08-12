// Pixel-diff two screenshot dirs. Usage: node diff.mjs <baselineDir> <afterDir>
// Exits non-zero if any view differs beyond a tiny anti-aliasing threshold.
import pixelmatch from "/home/user/Chat/node_modules/.pnpm/pixelmatch@5.3.0/node_modules/pixelmatch/index.js";
import { PNG } from "/home/user/Chat/node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs/lib/png.js";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const [, , baseDir, afterDir] = process.argv;
if (!baseDir || !afterDir) { console.error("usage: node diff.mjs <baselineDir> <afterDir>"); process.exit(1); }
const THRESH = 40; // allow a few dozen AA-fuzz pixels; real style changes are thousands

const names = readdirSync(baseDir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""));
let worst = 0, failed = 0;
for (const name of names) {
  const a = `${baseDir}/${name}.png`, c = `${afterDir}/${name}.png`;
  if (!existsSync(c)) { console.log(`  ?  ${name}: missing in after`); failed++; continue; }
  const ia = PNG.sync.read(readFileSync(a)), ic = PNG.sync.read(readFileSync(c));
  if (ia.width !== ic.width || ia.height !== ic.height) {
    console.log(`  ✗  ${name}: SIZE ${ia.width}x${ia.height} -> ${ic.width}x${ic.height}`); failed++; continue;
  }
  const diff = new PNG({ width: ia.width, height: ia.height });
  const n = pixelmatch(ia.data, ic.data, diff.data, ia.width, ia.height, { threshold: 0.1 });
  worst = Math.max(worst, n);
  if (n > THRESH) {
    writeFileSync(`${afterDir}/${name}.diff.png`, PNG.sync.write(diff));
    console.log(`  ✗  ${name}: ${n} px differ  (diff -> ${afterDir}/${name}.diff.png)`);
    failed++;
  } else {
    console.log(`  ✓  ${name}: ${n} px`);
  }
}
console.log(failed === 0 ? `\n✅ ALL MATCH (worst ${worst} px, threshold ${THRESH})` : `\n❌ ${failed} view(s) differ`);
process.exit(failed === 0 ? 0 : 1);
