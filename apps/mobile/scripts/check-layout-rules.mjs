/**
 * Two layout rules, both learned the hard way, both invisible to a browser.
 *
 * ── 1 ─────────────────────────────────────────────────────────────────────
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
 * ── 2 ─────────────────────────────────────────────────────────────────────
 *
 *   A scroll region inside a `<Sheet>` must be able to shrink — `flexShrink: 1`,
 *   an explicit `maxHeight`, or a fixed-height wrapper.
 *
 * The exact opposite of rule 1, and for the exact same reason: Yoga's
 * `flexShrink` default is 0. The sheet panel is capped at 85% of the screen, so
 * a scroller with taller content overflows that cap and is clipped — and a
 * clipped ScrollView has a frame equal to its content, so it believes there is
 * nowhere to scroll to and every drag inside it does nothing. That is what "the
 * customer details pop-up scrolls sometimes and sometimes doesn't" was: short
 * contact fits, long contact silently frozen.
 *
 * Also invisible in a browser, because react-native-web's ScrollView shrinks
 * where Yoga's doesn't. Same blind spot, opposite symptom.
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

/** Every `<Scroller …>` opening tag in a chunk of source, with its line number
 *  and the opening tag of whatever encloses it. */
function scrollerTags(src, lineBase = 0) {
  const found = [];
  for (const name of SCROLLERS) {
    const open = new RegExp(`<${name.replace(".", "\\.")}(\\s|>)`, "g");
    let m;
    while ((m = open.exec(src))) {
      const tagEnd = src.indexOf(">", m.index);
      // The nearest element opened just above it. A scroller inside a wrapper
      // of fixed height is bounded by that wrapper and needn't shrink itself —
      // ForwardSheet's list, in a `<View className="h-[280px]">`, is the case
      // this exists for.
      const before = src.slice(Math.max(0, m.index - 500), m.index);
      const wrappers = before.match(/<[A-Z][A-Za-z.]*\s[^>]*>/g);
      found.push({
        name,
        tag: src.slice(m.index, tagEnd === -1 ? undefined : tagEnd + 1),
        wrapper: wrappers ? wrappers[wrappers.length - 1] : "",
        line: lineBase + src.slice(0, m.index).split("\n").length,
      });
    }
  }
  return found;
}

/** Does this element's own opening tag claim a bounded height? */
function claimsARegion(tag) {
  return (
    /style=\{\{[^}]*\bflex:\s*1\b/.test(tag) ||
    /className="[^"]*\bflex-1\b/.test(tag) ||
    /\bstyle=\{\s*styles?\.[A-Za-z]*[Ff]lex/.test(tag)
  );
}

/** Is this element's height already settled — by itself or by its wrapper? */
function heightIsBounded(tag) {
  return (
    /flexShrink:\s*[1-9]/.test(tag) ||
    /maxHeight/.test(tag) ||
    /\bheight:\s*\d/.test(tag) ||
    /className="[^"]*\b(shrink|max-h-|flex-1|h-\[|h-\d)/.test(tag)
  );
}

/** Can this scroller give back height it hasn't got, or does something else
 *  already decide how tall it is? */
function canShrink(s) {
  // A horizontal scroller is bounded by the panel's width, not its height.
  if (/\bhorizontal\b/.test(s.tag)) return true;
  return heightIsBounded(s.tag) || heightIsBounded(s.wrapper);
}

const problems = [];
let scanned = 0;
let spansSeen = 0;
let sheetsSeen = 0;

for (const file of sources(ROOT)) {
  const src = readFileSync(file, "utf8");
  scanned += 1;

  // Rule 1 — a KeyboardAvoidingView holding a region-claiming scroller.
  if (src.includes("KeyboardAvoidingView")) {
    for (const span of keyboardAvoidingSpans(src)) {
      spansSeen += 1;
      for (const s of scrollerTags(span.body)) {
        if (!claimsARegion(s.tag)) continue;
        problems.push(
          `${relative(ROOT, file)}:${span.line} — a <${s.name}> claiming flex:1 sits inside this ` +
            `KeyboardAvoidingView. Its height cannot depend on one; move the avoiding view down ` +
            `so it wraps only the composer.`,
        );
      }
    }
  }

  // Rule 2 — a sheet holding a scroller that can't shrink. File-level rather
  // than span-level: <Sheet> wraps everything below it in these components, and
  // a scroller in the same file is in it in every case we have.
  if (/<Sheet[\s>]/.test(src)) {
    sheetsSeen += 1;
    for (const s of scrollerTags(src)) {
      if (canShrink(s)) continue;
      problems.push(
        `${relative(ROOT, file)}:${s.line} — this <${s.name}> is inside a <Sheet> and cannot ` +
          `shrink, so it will overflow the panel's 85% cap and refuse to scroll. Give it ` +
          `style={{ flexShrink: 1 }}.`,
      );
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
if (sheetsSeen === 0) {
  console.error("\nCannot run: no <Sheet> found. Either it was renamed or the scan is broken.\n");
  process.exit(2);
}

if (problems.length) {
  console.error(`\nLayout rules: ${problems.length} problem(s) in ${scanned} files\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nSee docs/11-mobile-layout.md.\n");
  process.exit(1);
}
console.log(`\nLayout rules: ${spansSeen} KeyboardAvoidingView(s) across ${scanned} files, none holding a scroll region.\n`);
