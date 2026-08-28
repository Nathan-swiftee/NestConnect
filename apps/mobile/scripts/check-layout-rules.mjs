/**
 * Three rules, all learned the hard way, all invisible to a browser.
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
 * ── 3 ─────────────────────────────────────────────────────────────────────
 *
 *   An animated style must be alone on its element — no `className`, no second
 *   style object.
 *
 * `react-native-css-interop` registers every React Native primitive, and
 * `src/animated.ts` registers `Animated.View`, `Animated.Text` and
 * `Animated.ScrollView` on top. On a registered component, a `style` array
 * containing a `useAnimatedStyle` value arrives as that value *alone*: the rest
 * of the array is discarded, and a `className` on the same element goes with
 * it. It is a bug in the interop, not in the call sites — but until it is fixed
 * upstream, the call sites have to avoid the shape.
 *
 * One build shipped four visible defects from this, all at once: a swipe panel
 * taking 44pt of layout above every inbox row rather than sitting behind it, a
 * microphone with no disc, a reply arrow above the bubble instead of beside it,
 * and two sheet scrims with neither position nor colour. Every one of them
 * rendered correctly in a web export — same blind spot again, third symptom.
 *
 * `__tests__/interop-probe.test.tsx` is the measurement this rests on: the same
 * style array on a registered component and on one the interop has never heard
 * of, so the registration is the only difference between them.
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
    // `__tests__` is skipped because the interop probe's whole job is to render
    // the broken shapes and report what comes out of them.
    const skip = ["node_modules", ".expo", "ios", "android", "__tests__"];
    if (skip.includes(entry)) continue;
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

/**
 * Every JSX opening tag in a file, as source text.
 *
 * Not a regex, because attribute values contain `>` — arrow functions, generics
 * and comparisons all put one inside braces. This walks forward from `<Name`
 * tracking brace depth and string state, so the `>` it stops at is the tag's.
 */
function openingTags(src) {
  const tags = [];
  const start = /<([A-Z][A-Za-z0-9.]*)/g;
  let m;
  while ((m = start.exec(src))) {
    let depth = 0;
    let quote = "";
    let i = m.index + m[0].length;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    if (i >= src.length) continue;
    tags.push({
      name: m[1],
      tag: src.slice(m.index, i + 1),
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return tags;
}

/** The names bound to a `useAnimatedStyle(...)` in this file. */
function animatedStyleNames(src) {
  const names = new Set();
  const decl = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useAnimatedStyle\s*\(/g;
  let m;
  while ((m = decl.exec(src))) names.add(m[1]);
  return names;
}

/**
 * The `style={...}` expression from an opening tag, with comments stripped, or
 * "". The stripping matters: these style arrays are heavily annotated, and a
 * comment mentioning a "top edge" otherwise reads as a reference to an animated
 * style named `top`.
 */
function styleExpression(tag) {
  const at = tag.indexOf("style={");
  if (at === -1) return "";
  let depth = 0;
  for (let i = at + 6; i < tag.length; i += 1) {
    if (tag[i] === "{") depth += 1;
    else if (tag[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return tag
          .slice(at + 7, i)
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/\/\/[^\n]*/g, " ");
      }
    }
  }
  return "";
}

const problems = [];
let scanned = 0;
let spansSeen = 0;
let sheetsSeen = 0;
let animatedSeen = 0;

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

  // Rule 3 — an animated style sharing an element with anything else.
  if (src.includes("useAnimatedStyle")) {
    const animated = animatedStyleNames(src);
    if (animated.size) {
      animatedSeen += 1;
      for (const t of openingTags(src)) {
        const style = styleExpression(t.tag);
        if (!style) continue;
        // Not preceded by a dot, so `insets.top` doesn't read as the animated
        // style happening to be called `top`.
        const used = [...animated].filter((n) => new RegExp(`(?<![.\\w$])${n}\\b`).test(style));
        if (!used.length) continue;
        const alone = style.trim() === used[0] && !/\bclassName=/.test(t.tag);
        if (alone) continue;
        problems.push(
          `${relative(ROOT, file)}:${t.line} — <${t.name}> passes the animated style \`${used[0]}\` ` +
            `alongside something else. Everything but \`${used[0]}\` is discarded before it reaches ` +
            `the component. Fold it all into \`${used[0]}\` and leave the element with nothing else.`,
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
if (animatedSeen === 0) {
  console.error("\nCannot run: no useAnimatedStyle found. The scan is broken.\n");
  process.exit(2);
}

if (problems.length) {
  console.error(`\nNative rules: ${problems.length} problem(s) in ${scanned} files\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nSee docs/11-mobile-layout.md.\n");
  process.exit(1);
}
console.log(
  `\nNative rules: ${scanned} files — ${spansSeen} KeyboardAvoidingView(s), none holding a scroll ` +
    `region; scrollers in ${sheetsSeen} sheet(s) can shrink; every animated style is alone on its ` +
    `element across ${animatedSeen} animating file(s).\n`,
);
