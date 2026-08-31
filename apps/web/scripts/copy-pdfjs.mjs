/**
 * Put pdf.js where the app can load it from our own origin.
 *
 *   node scripts/copy-pdfjs.mjs
 *
 * The phone renders a PDF attachment inside a WebView, and a WebView has no PDF
 * renderer of its own on Android — Chromium's is deliberately not exposed there.
 * So the viewer needs pdf.js, and pdf.js has to come from somewhere the phone
 * can reach.
 *
 * Not a CDN. The app already depends on this API being up — it is where the
 * messages come from — so serving pdf.js from the same origin adds no new point
 * of failure, where a CDN would add one that fails silently and only for
 * attachments. The API already serves `apps/web/dist`, and Vite copies
 * `public/` into it, so dropping the two files here is all it takes.
 *
 * Copied at build time rather than committed: the version then lives in
 * package.json like every other dependency, and `pnpm up` moves it. The build
 * fails loudly if the files are missing, which is the behaviour you want —
 * silently shipping a viewer with no renderer is the failure mode worth
 * spending a build step to avoid.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "public", "pdfjs");

// Resolved through node rather than a hand-written path into node_modules: pnpm
// hoists differently from npm, and a guessed path breaks on one of them.
const build = dirname(require.resolve("pdfjs-dist/build/pdf.min.mjs"));
const version = require("pdfjs-dist/package.json").version;

mkdirSync(out, { recursive: true });
for (const name of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  const from = join(build, name);
  // statSync throws if it isn't there, which is exactly the loud failure we want.
  const { size } = statSync(from);
  copyFileSync(from, join(out, name));
  console.log(`pdfjs ${version}  ${name}  ${Math.round(size / 1024)} KB`);
}
