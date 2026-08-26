/**
 * The one layout rule worth enforcing mechanically.
 *
 *   A `KeyboardAvoidingView` must not contain a scroll region that claims a
 *   bounded height (`style={{ flex: 1 }}` or `className="flex-1"`).
 *
 * That is the exact shape the thread screen shipped in four times, each time
 * producing a different wrong answer on a Galaxy: the header under the clock,
 * the composer under the navigation bar, then the composer at the top of the
 * screen with no messages visible at all. Whatever `KeyboardAvoidingView` does
 * with the style it is handed, a sibling's height cannot depend on it. Give it
 * the composer and nothing else. docs/11-mobile-layout.md has the whole account.
 *
 * Why a static check and not a measuring one: a measuring harness was written
 * first, against a web export at 390x844, and the broken commit passed it —
 * with numbers identical to the fixed commit's, to the pixel. react-native-web
 * gives ScrollView a shrink that Yoga does not, so it lays this bug out
 * correctly and reports nothing. A browser cannot see this class of bug. The
 * source can.
 *
 * Deliberately narrow. It has to separate four real call sites correctly:
 *
 *   thread/[id].tsx (broken)  KAV root, ScrollView style={{flex:1}} inside  → flagged
 *   thread/[id].tsx (fixed)   KAV wraps the composer, no scroller inside    → clean
 *   sign-in.tsx               KAV root, but its ScrollView sizes to content
 *                             (contentContainerStyle flexGrow, no flex:1)   → clean
 *   compose.tsx               <KeyboardAvoidingView /> as a bottom spacer    → clean
 *
 * A scroller that sizes to its content is fine inside one — that's sign-in, and
 * it has never misbehaved. It's claiming a *region* that goes wrong.
 *
 *   pnpm --filter @ding/mobile check:layout
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCROLLERS = ["ScrollView", "FlatList", "SectionList", "Animated.ScrollView", "Animated.FlatList"];

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".expo" || entry === "ios" || entry === "android") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * The source span of one `<KeyboardAvoidingView …>…</KeyboardAvoidingView>`.
 *
 * Tag counting rather than a parse: this file should not need a Babel dependency
 * to answer one question, and nesting two of them would be its own bug.
 */
function keyboardAvoidingSpans(src) {
  const spans = [];
  const open = /<KeyboardAvoidingView(\s|>|\/)/g;
  let m;
  while ((m = open.exec(src))) {
    const tagEnd = src.indexOf(">", m.index);
    if (tagEnd === -1) continue;
    if (src[tagEnd - 1] === "/") continue; // self-closing: a spacer, holds nothing
    const close = src.indexOf("</KeyboardAvoidingView>", tagEnd);
    if (close === -1) continue;
    spans.push({ line: src.slice(0, m.index).split("\n").length, body: src.slice(tagEnd + 1, close) });
  }
  return spans;
}

/** Does this element's own opening tag claim a bounded height? */
function claimsARegion(tag) {
  return (
    /style=\{\{[^}]*\bflex:\s*1\b/.test(tag) ||
    /className="[^"]*\bflex-1\b/.test(tag) ||
    /\bstyle=\{\s*styles?\.[A-Za-z]*[Ff]lex/.test(tag)
  );
}

const problems = [];
let scanned = 0;
let spansSeen = 0;

for (const file of sources(ROOT)) {
  const src = readFileSync(file, "utf8");
  scanned += 1;
  if (!src.includes("KeyboardAvoidingView")) continue;
  for (const span of keyboardAvoidingSpans(src)) {
    spansSeen += 1;
    for (const name of SCROLLERS) {
      const open = new RegExp(`<${name.replace(".", "\\.")}(\\s|>)`, "g");
      let m;
      while ((m = open.exec(span.body))) {
        const tagEnd = span.body.indexOf(">", m.index);
        const tag = span.body.slice(m.index, tagEnd === -1 ? undefined : tagEnd + 1);
        if (!claimsARegion(tag)) continue;
        problems.push(
          `${relative(ROOT, file)}:${span.line} — a <${name}> claiming flex:1 sits inside this ` +
            `KeyboardAvoidingView. Its height cannot depend on one; move the avoiding view down ` +
            `so it wraps only the composer.`,
        );
      }
    }
  }
}

// A rule that matched nothing because the scan found nothing is not a pass.
if (scanned === 0) {
  console.error("\nCannot run: no .tsx files found under apps/mobile.\n");
  process.exit(2);
}
if (spansSeen === 0) {
  console.error(
    "\nCannot run: no KeyboardAvoidingView with children found. Either the app stopped using it " +
      "(then delete this check) or the scan is broken.\n",
  );
  process.exit(2);
}

if (problems.length) {
  console.error(`\nLayout rules: ${problems.length} problem(s) in ${scanned} files\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nSee docs/11-mobile-layout.md.\n");
  process.exit(1);
}
console.log(`\nLayout rules: ${spansSeen} KeyboardAvoidingView(s) across ${scanned} files, none holding a scroll region.\n`);
