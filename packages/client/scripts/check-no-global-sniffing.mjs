/**
 * The shared client must not guess which runtime it is in.
 *
 * It runs in two: a browser and React Native. They differ in ways that matter —
 * `FormData` takes completely different things, storage is different, the DOM
 * is absent — and the temptation is always to test a global and branch.
 *
 * That was tried, once, on `typeof document`, to pick the right `FormData`
 * dialect. `document` turns out to be defined in this app's *native* runtime,
 * so every upload on a real phone took the browser branch, handed React
 * Native's FormData a Blob it cannot serialise, and the native networking layer
 * rejected the whole request: "Unsupported form data part". Attachments and
 * voice notes were both dead, and the check had passed everywhere it was run,
 * because the web export is a browser and the browser branch was right there.
 *
 * The lesson isn't "that particular global was a bad choice". It's that the
 * shared layer is the wrong place to ask the question at all. Which runtime
 * this is, is a fact each app knows for certain — the mobile app has
 * `Platform.OS`, the web app is a browser by construction — so the apps convert
 * to the right shape and the client honours what it is handed. See
 * `apps/mobile/src/upload.ts`.
 *
 *   pnpm --filter @ding/client check:no-sniffing
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

/** Each pattern is a way of asking "am I in a browser?" from shared code. */
const BANNED = [
  { re: /\btypeof\s+document\b/, why: "tests for a DOM" },
  { re: /\btypeof\s+window\b/, why: "tests for a browser global" },
  { re: /\btypeof\s+navigator\b/, why: "tests for a browser global" },
  { re: /\bnavigator\s*\.\s*product\b/, why: "the classic 'is this React Native' sniff" },
  { re: /\bglobalThis\s*\.\s*(document|window|navigator)\b/, why: "tests for a browser global" },
  { re: /\bprocess\s*\.\s*env\s*\.\s*EXPO/, why: "reads a build flag that only one app has" },
];

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Strip comments, so the note explaining the ban doesn't trip it. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const problems = [];
const files = sources(SRC);
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const stripped = code(src);
  for (const { re, why } of BANNED) {
    if (!re.test(stripped)) continue;
    // Report against the original so the line number is the one you'd open.
    const line = src.split("\n").findIndex((l) => re.test(code(l))) + 1;
    problems.push(
      `${relative(SRC, file)}:${line || "?"} — ${re.source} ${why}. The shared client ` +
        `cannot know which runtime it is in; let the app decide and pass the answer down.`,
    );
  }
}

// A scan that found nothing because it looked nowhere is not a pass.
if (files.length === 0) {
  console.error("\nCannot run: no sources found under packages/client/src.\n");
  process.exit(2);
}

if (problems.length) {
  console.error(`\nShared client: ${problems.length} runtime sniff(s) in ${files.length} files\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`\nShared client: ${files.length} files, no runtime sniffing.\n`);
