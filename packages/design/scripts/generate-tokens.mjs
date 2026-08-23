#!/usr/bin/env node
/**
 * tokens.css → tokens.ts
 *
 * The web reads the CSS custom properties directly. React Native has no
 * cascade, no `var()` and no `color-mix()`, so it needs the same values as
 * plain JavaScript — and the moment those are hand-written they are a second
 * source of truth that drifts within a release.
 *
 * So they are generated. Editing a token in tokens.css and re-running this is
 * the only way tokens.ts changes; the file it writes says as much at the top.
 *
 *   node scripts/generate-tokens.mjs [--check]
 *
 * `--check` regenerates in memory and fails if the committed file is stale,
 * which is what CI runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CSS = join(here, "..", "tokens.css");
const OUT = join(here, "..", "tokens.ts");

// Strip comments up front. They are prose, and this file's prose contains both
// `;` and `:` — split the declarations first and a comment silently becomes a
// bogus token name, swallowing the real declaration that follows it.
const css = readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `--name:value` pair inside the blocks whose selector matches. */
function declarations(selectorTest) {
  const out = {};
  // Match `<selector>{...}` at the top level. Blocks here never nest braces
  // except inside @media, which is handled by matching the inner :root.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].trim();
    if (!selectorTest(selector)) continue;
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i === -1) continue;
      const name = decl.slice(0, i).trim();
      if (!name.startsWith("--")) continue;
      out[name.slice(2)] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

// `:root{...}` blocks carry the base values and every non-themed scale. The
// explicit [data-theme] stamps carry the two palettes; the prefers-color-scheme
// block is ignored because it duplicates the dark stamp exactly.
const base = declarations((s) => s === ":root");
const lightOverrides = declarations((s) => s === ':root[data-theme="light"]');
const darkOverrides = declarations((s) => s === ':root[data-theme="dark"]');

const light = { ...base, ...lightOverrides };
const dark = { ...base, ...darkOverrides };

/* ---- value resolution ---- */

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/**
 * Resolve one declared value to something React Native understands: follow
 * `var()` references, and flatten the `color-mix(... , transparent)` form we
 * use for the neutral interaction tints into plain rgba.
 */
function resolve(value, scope, seen = new Set()) {
  let v = value.trim();

  const varRef = v.match(/^var\(--([\w-]+)\)$/);
  if (varRef) {
    const name = varRef[1];
    if (seen.has(name)) throw new Error(`Circular token reference at --${name}`);
    seen.add(name);
    return resolve(scope[name] ?? "", scope, seen);
  }

  // color-mix(in srgb, <colour> <pct>%, transparent) — an alpha of <colour>.
  // That is the only shape tokens.css uses, and the only one worth supporting:
  // a real mix would need a colour library for values nobody has asked for.
  const mix = v.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/);
  if (mix) {
    const inner = resolve(mix[1], scope, new Set(seen));
    const alpha = Number(mix[2]) / 100;
    if (!/^#[0-9a-f]{3,8}$/i.test(inner)) {
      throw new Error(`Can't take an alpha of non-hex colour "${inner}"`);
    }
    const [r, g, b] = hexToRgb(inner);
    return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(4))})`;
  }

  // Normalise hand-written rgba() to a canonical form. React Native's colour
  // parser is stricter than a browser's and rejects a bare `.35` alpha, which
  // is how these are written in the stylesheet.
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]*\.?[\d]+)\s*)?\)$/);
  if (rgba) {
    const [r, g, b] = rgba.slice(1, 4).map(Number);
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return v;
}

const isColour = (v) => /^(#|rgba?\()/.test(v) || v.startsWith("color-mix(") || v.startsWith("var(--");
const px = (v) => Number(v.replace(/px$/, ""));
const ms = (v) => Number(v.replace(/ms$/, ""));

/** `surface-2` → `surface2`, `brand-strong` → `brandStrong`. */
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Pull one prefixed group out of a scope, e.g. `r-` → { r2: 2, ... }. */
function group(scope, prefix, transform, numericPrefix = "") {
  const out = {};
  for (const [name, value] of Object.entries(scope)) {
    if (!name.startsWith(prefix)) continue;
    let key = camel(name.slice(prefix.length)) || camel(prefix.replace(/-$/, ""));
    // A key that starts with a digit can only be reached as tokens.radius["12"].
    // Prefixing makes the scales read the way they're written: radius.r12, space.sp4.
    if (/^\d/.test(key)) key = numericPrefix + key;
    out[key] = transform(resolve(value, scope));
  }
  return out;
}

/* ---- colour palettes ---- */

// Anything in the light scope that resolves to a colour is part of the palette.
// Both palettes must carry the same keys or a themed component would be
// undefined on one of them — asserted below.
const COLOUR_SKIP = new Set(["sans", "mono"]);
const palette = (scope) => {
  const out = {};
  for (const [name, raw] of Object.entries(scope)) {
    if (COLOUR_SKIP.has(name) || name.startsWith("shadow")) continue;
    if (!isColour(raw)) continue;
    out[camel(name)] = resolve(raw, scope);
  }
  return out;
};

const lightColours = palette(light);
const darkColours = palette(dark);

const missing = Object.keys(lightColours).filter((k) => !(k in darkColours));
const extra = Object.keys(darkColours).filter((k) => !(k in lightColours));
if (missing.length || extra.length) {
  throw new Error(`Palettes disagree — light-only: [${missing}], dark-only: [${extra}]`);
}

/* ---- scales (theme-independent) ---- */

const radius = group(base, "r-", (v) => (v === "9999px" ? 9999 : px(v)), "r");
const space = group(base, "sp-", px, "sp");
const fontSize = group(base, "fs-", px, "fs");
const fontWeight = group(base, "fw-", (v) => v);
const lineHeight = group(base, "lh-", Number);
// Tracking is authored in `em`; native wants px, so it is applied as
// `fontSize * letterSpacing` at the call site. Keep the em number here.
const letterSpacing = group(base, "ls-", (v) => Number(v.replace(/em$/, "")));
const duration = group(base, "t-", ms);

/* ---- emit ---- */

const lit = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
const obj = (o, indent = "  ") =>
  Object.entries(o)
    .map(([k, v]) => `${indent}${/^[a-z][\w]*$/i.test(k) ? k : JSON.stringify(k)}: ${lit(v)},`)
    .join("\n");

const out = `// GENERATED FILE — DO NOT EDIT.
//
// Written by scripts/generate-tokens.mjs from tokens.css, which is the single
// source of truth for both platforms. Change a value there and re-run
// \`pnpm --filter @ding/design build\`; editing this file is undone by the next
// generate, and CI fails when the two disagree.
//
// The web reads tokens.css directly through \`var()\`. React Native has no
// cascade, so it reads these — the same numbers, resolved: \`var()\` references
// followed, and \`color-mix(…, transparent)\` flattened to rgba.

/** The light palette. \`dark\` has exactly the same keys. */
export const light = {
${obj(lightColours)}
} as const;

export const dark = {
${obj(darkColours)}
} as const;

/** One theme's colours. Index with \`colors[scheme]\`. \`as const\` above gives
 *  each value a literal type, which is useful for autocomplete but would make
 *  \`dark\` incompatible with \`light\` — so the shared shape widens to string. */
export type ThemeColors = { readonly [K in keyof typeof light]: string };
export const colors: Record<"light" | "dark", ThemeColors> = { light, dark };

/** Corner radii, in px. \`full\` is the pill. */
export const radius = {
${obj(radius)}
} as const;

/** The spacing step scale, in px. */
export const space = {
${obj(space)}
} as const;

/** Type scale, in px. */
export const fontSize = {
${obj(fontSize)}
} as const;

/** Three weights, plus 700 for numerals that must punch. */
export const fontWeight = {
${obj(fontWeight)}
} as const;

/** Unitless line-height multipliers — multiply by the font size for native. */
export const lineHeight = {
${obj(lineHeight)}
} as const;

/** Tracking in em. Native wants px: \`fontSize * letterSpacing.tight\`. */
export const letterSpacing = {
${obj(letterSpacing)}
} as const;

/** Motion durations, in ms. */
export const duration = {
${obj(duration)}
} as const;

/** The font stacks, as authored for CSS. Native resolves its own system font,
 *  so this is here for completeness rather than for use in a style object. */
export const fontFamily = {
  sans: ${lit(base.sans ?? "")},
  mono: ${lit(base.mono ?? "")},
} as const;
`;

if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== out) {
    console.error("tokens.ts is stale — run `pnpm --filter @ding/design build` and commit the result.");
    process.exit(1);
  }
  console.log("tokens.ts is up to date.");
} else {
  writeFileSync(OUT, out);
  const n = Object.keys(lightColours).length;
  console.log(`tokens.ts written — ${n} colours × 2 themes, plus the radius/space/type/motion scales.`);
}
