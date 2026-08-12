# 08 — Tailwind (web) + NativeWind (native) migration plan

**Goal:** one styling authoring model — Tailwind utility classes — across the
existing web app and a new Expo/React Native app (NativeWind), driven by a
single shared design-token config. Same vocabulary in both codebases so moving
between them is frictionless.

**Hard constraint:** the web design must not change. We spent a long time on it.
The migration is a refactor of *how* styles are authored, not *what* they render.

---

## 1. What "one authoring model" actually buys us (and what it doesn't)

Be clear-eyed so we build the right thing.

**Shared, genuinely:**
- **One token source** — colours, spacing, radii, type scale, shadows, motion —
  consumed by both Tailwind (web) and NativeWind (native).
- **One class vocabulary** — `px-4`, `rounded-full`, `text-muted`, `bg-surface`
  mean the same thing in both apps.
- **Shared non-view code** — types (`@ding/schemas`), formatters (`listTime`,
  `relativeTime`), API client and most hooks can move to a shared package and be
  imported by both.

**Not shared (important):**
- **Components.** Web is `<div>/<span>` + CSS cascade; native is `<View>/<Text>`
  with no cascade, no `:hover`, different flex defaults. NativeWind unifies the
  *class names*, not the component tree — you will not copy-paste a `Thread.tsx`
  into native.
- **Pixel-identical native rendering of web-only effects.** `backdrop-filter`
  glass, `@container` queries, `color-mix()`, CSS gradients and box-shadows do
  not map 1:1 to React Native. Native reproduces the *design* via the same
  tokens, with platform adapters (blur, gradient, elevation) — close, not a
  screenshot match. This only affects **native**; the **web stays identical**.

So: the web migration can be guaranteed visually lossless. The native app is a
fresh build that inherits our tokens and look, not a port.

---

## 2. Current state (measured)

| Surface | Size / notes |
|---|---|
| `apps/web/src/styles.css` | ~2,000 lines, hand-written, token-driven |
| Components | 19 files, ~8,400 LOC |
| Design tokens | `:root` custom properties: brand, text, surface, border, danger, amber, shadow (12), radius (12), spacing (10), type (7), glass (5), channel colours (wa/group/email), motion (`--ease`, `--blur`) |
| Theme | `data-theme="light|dark"` **plus** `prefers-color-scheme` as the default; `toggleTheme()` in `lib/theme.ts` |
| Tricky-to-port CSS | `color-mix()` ×104, `@keyframes` ×27, `@media` ×21, `env(safe-area-*)` ×17, gradients ×11, `backdrop-filter` ×7, `@container` ×1 |
| Build | Vite 5 + React 18 + TS; pnpm workspace (`apps/*`, `packages/*`); only `@ding/schemas` shared today |
| Tailwind | none yet — clean slate |

The token system is already the source of truth — that's what makes this
tractable. The migration mostly relocates those tokens and rewrites class usage.

---

## 3. Target architecture

```
packages/
  design/            ← NEW: single source of truth
    tokens.ts        ← every token as plain TS (colours resolved, no color-mix)
    tailwind-preset.js ← Tailwind theme built from tokens.ts
    css-vars.css     ← generated :root variables (web keeps working during migration)
  schemas/           ← existing shared types
  shared/            ← NEW (later): formatters, api client, hooks reused by native
apps/
  web/               ← Vite + Tailwind, extends @ding/design preset
  mobile/            ← NEW: Expo + NativeWind, extends the SAME preset
```

One `tailwind-preset.js`, two consumers. Change a token once, both apps move.

**Version choice:** Tailwind **v3.4** on web + **NativeWind v4** (built on
Tailwind v3) on native, sharing one JS config. This is the proven, simplest
"one config" path. Tailwind v4's CSS-first config complicates config sharing
with NativeWind — revisit only if NativeWind's v4 support is solid when we start
native. *(Verify NativeWind ↔ Tailwind version compatibility at kickoff.)*

---

## 4. How we guarantee the web design is unchanged

Four mechanisms, all cheap:

1. **Preflight off (initially).** `corePlugins: { preflight: false }`. Tailwind's
   base reset is the #1 cause of "everything shifted" — we keep our existing
   reset and just *layer* utilities on top. Adopt preflight later, deliberately,
   if at all.
2. **Tokens are identical values.** The Tailwind theme is generated from the same
   numbers as today's `:root`. `p-4` === `var(--sp-4)` === 16px. No re-guessing.
3. **Dark mode from a seeded attribute.** Set `darkMode: ['selector',
   '[data-theme="dark"]']` and, on boot, seed `data-theme` from the OS when the
   user hasn't chosen — so `dark:` variants and the current `prefers-color-scheme`
   default agree. (~5 lines in `lib/theme.ts`.)
4. **Screenshot-diff gate.** A Playwright harness captures every screen × state ×
   {light,dark} × {desktop,mobile} as a baseline *before* we touch a component,
   and re-diffs *after*. A component isn't "migrated" until its diff is clean.
   (We've been screenshotting all along — this just formalises it.)

Tailwind is **added alongside** the existing CSS, so we migrate one component at
a time and ship continuously — never a big-bang rewrite.

---

## 5. Handling the tricky CSS

| Feature | Plan |
|---|---|
| `color-mix()` ×104 | **Resolve to concrete values in `tokens.ts`.** Neither Tailwind v3 nor NativeWind supports `color-mix`. Precomputing removes a whole class of native breakage and makes tokens portable. Light/dark each get their resolved value. |
| `@keyframes` ×27 | Move into `theme.extend.keyframes` + `animation` in the preset. Web works; native supports a subset (Reanimated/`transition-*` for the rest). |
| `backdrop-filter` glass ×7 | Web: `backdrop-blur-*` utilities (Tailwind supports it) + token bg alpha. Native: `expo-blur` adapter component. |
| `@container` ×1 | `@tailwindcss/container-queries` plugin on web; native uses `onLayout`/`Dimensions`. Only one usage — trivial. |
| `env(safe-area-*)` ×17 | Web: arbitrary values `pt-[env(safe-area-inset-top)]` or keep as small CSS. Native: `react-native-safe-area-context`. |
| gradients ×11 | Web: `bg-gradient-*` / arbitrary. Native: `expo-linear-gradient`. |
| `:hover`, complex selectors | Web utilities/variants. Native has no hover — use pressed states; acceptable and already true of our mobile design. |

Anything genuinely awkward can stay as a few lines of component-scoped CSS
(web) — Tailwind doesn't forbid CSS, and "100% utilities" is not the goal;
"one shared token model + mostly utilities" is.

---

## 6. Phases

**Phase 0 — Shared token package `@ding/design`** *(foundation; unblocks both apps)*
- Extract every token into `tokens.ts` (resolve all `color-mix` to concrete
  light/dark values).
- Generate `css-vars.css` (identical to today's `:root`) and `tailwind-preset.js`.
- Web imports the generated `css-vars.css` in place of the inline `:root` block —
  **zero visual change**, verified by screenshot diff.
- *Deliverable:* one source of truth; nothing looks different.

**Phase 1 — Tailwind on web (wiring only)**
- Add Tailwind 3.4 + PostCSS; `preflight: false`; extend `@ding/design` preset;
  seed `data-theme` on boot.
- Build the screenshot baseline harness.
- No component rewrites yet. Verify the app is byte-for-byte unchanged.

**Phase 2 — Incremental component migration** *(the bulk)*
- Leaf-first order: `Avatar`, `icons`, pills/tags/buttons → `LabelPicker`,
  `ContextPanel`, `Sidebar`, `ConversationList` → `Composer`, `Settings`,
  `Thread` (biggest last).
- Per component: rewrite `className`s to utilities (use `clsx` + `cva` for
  variants), delete the now-dead CSS from `styles.css`, screenshot-diff clean,
  ship. `styles.css` shrinks steadily toward near-empty.

**Phase 3 — Web cleanup**
- `styles.css` reduced to a handful of globals/keyframes. Optionally adopt
  preflight in a controlled pass. Web migration done.

**Phase 4 — Expo app with NativeWind** *(can start right after Phase 0, in parallel with Phase 2)*
- Scaffold `apps/mobile` (Expo Router + NativeWind), extend the same preset.
- Extract `packages/shared` (formatters, api client, hooks) for reuse.
- Build native screens with the shared vocabulary + platform adapters (blur,
  gradient, safe-area, elevation). This is new product work, not a port.

The key payoff — "development is easier" — lands at the **end of Phase 0**: the
native app can begin immediately on shared tokens, without waiting for the web
migration to finish.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Preflight reset changes the look | Ship with `preflight: false`; keep existing reset |
| Dark mode has two sources (attr + media) | Seed `data-theme` from OS on boot; single source for `dark:` |
| `color-mix` unsupported downstream | Resolve to concrete values in `tokens.ts` (Phase 0) |
| Native can't match glass/gradient/shadow exactly | Accept approximation on native; tokens keep it on-brand. Web unaffected |
| Regressions during a long migration | Screenshot-diff gate per component; Tailwind coexists with CSS so we always ship green |
| Utility verbosity / conditional styles | `clsx` + `class-variance-authority` for variants and shared patterns |
| Scope creep (rewrite + redesign at once) | Rule: migration PRs change authoring only, never visuals. Redesigns are separate PRs |

---

## 8. Rough sizing (focused effort, incremental)

- Phase 0: ~2–3 days (token extraction + `color-mix` resolution + generators).
- Phase 1: ~1 day (wiring + baseline harness).
- Phase 2: the long pole — ~19 components / ~2,000 CSS lines, roughly 1.5–3 weeks
  depending on how much lands per day; fully incremental and shippable throughout.
- Phase 4 (native): its own multi-week build, gated only on Phase 0.

Numbers are directional, not commitments — the point is that value (shared
tokens, native unblocked) arrives in the first few days, and risk stays low
because nothing ships without a clean visual diff.

---

## 9. First concrete step

Create `packages/design` and move the `:root` tokens into `tokens.ts`, resolving
`color-mix()` to concrete light/dark values; generate `css-vars.css`; swap the
web's inline `:root` for the generated file; prove zero visual change with the
screenshot harness. That single step establishes the shared source of truth and
de-risks everything after it — and it changes nothing on screen.

---

## 10. Execution log & refined method

**Decision (Nathan):** full sweep — convert every component to utilities, done
properly (design pixel-identical, verified).

**The verification gate** (`apps/web/scripts/snap.mjs` + `diff.mjs`): a frozen
clock + reduced motion make app screenshots byte-deterministic (validated: a
no-change re-capture diffs to 0 px). Every migration step is pixel-diffed
against a golden baseline built from the current production output; a step isn't
done until its diff is 0. Verify against the **production build** (`vite
preview`), not the dev server — Tailwind's dev-mode JIT lags on freshly-added
classes.

**Refined method — a shared primitives layer.** The app's CSS is a well-factored
*semantic* system: shared classes (`.iconbtn`/`.railbtn` grouped resets,
`.brandmark`, `.switch`, `.pill`, `.tag`, `.av`, `.menu`) are reused across
components. Converting such a class inside one component would break the others.
So the proper Tailwind endgame is:
- Extract shared visual primitives into small Tailwind components under
  `apps/web/src/ui/` (`IconButton`, `Button`, `Switch`, `Pill`, `Tag`, `Avatar`,
  `Menu`, …), using `cva` for variants.
- Migrate page components to compose those primitives + layout utilities,
  deleting the corresponding CSS.
- Do the leaf/exclusive styling first; retire each shared primitive once all its
  call-sites use the new component.

**Progress**
- [x] Phase 0 — shared `@ding/design` tokens (`9ee5aa3`)
- [x] Phase 1 — Tailwind wired into web, Preflight off, dark via attribute (`2a09333`)
- [x] Verification gate built + validated (`fb30fac`)
- [x] `LabelPicker` → utilities (`3eac15c`) — first component
- [ ] Primitives layer: `IconButton`, `Button`, `Switch`, `Pill`, `Tag`, `Avatar`, `Menu`
- [ ] Page components: `IconRail`, `Sidebar`, `ConversationList`, `NotificationBell`,
      `Compose`, `TemplatePicker`, `TagEditor`, `Customers`, `ContextPanel`,
      `PersonalSettings`, `CommandPalette`, `CreateGroupModal`, `SetPassword`,
      `LoginScreen`, `Settings`, `Thread` (biggest last)
