/**
 * @ding/design — Tailwind preset (shared by the web app and the Expo/NativeWind
 * app). It maps Tailwind's scales onto our design tokens so a utility means the
 * same thing everywhere: `bg-surface`, `text-muted`, `rounded-12`, `shadow-pop`.
 *
 * Colours resolve to the CSS custom properties defined in tokens.css, so
 * light/dark theming keeps working through the existing variable overrides —
 * no duplicate palettes on web. (Opacity modifiers like `bg-surface/50` are not
 * supported on these var()-backed colours; use the dedicated alpha tokens —
 * glass, brand-ring, the *-tint colours — instead.)
 *
 * Spacing is intentionally left as Tailwind's default scale, whose values equal
 * our --sp-* steps (p-4 = 16px = --sp-4), so the whole scale is available.
 */
const v = (name) => `var(--${name})`;

module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        transparent: "transparent",
        current: "currentColor",
        white: "#ffffff",
        black: "#000000",
        bg: v("bg"),
        surface: { DEFAULT: v("surface"), 2: v("surface-2") },
        elevated: v("elevated"),
        // text/foreground — named `fg` so it never collides with the text-* utilities
        fg: { DEFAULT: v("text"), muted: v("text-muted"), faint: v("text-faint") },
        // borders — `line` reads well as `border-line` / `border-line-strong`
        line: { DEFAULT: v("border"), strong: v("border-strong") },
        brand: { DEFAULT: v("brand"), strong: v("brand-strong"), tint: v("brand-tint"), ring: v("brand-ring") },
        amber: { DEFAULT: v("amber"), tint: v("amber-tint") },
        danger: { DEFAULT: v("danger"), tint: v("danger-tint") },
        wa: v("wa"),
        email: v("email"),
        group: v("group"),
        glass: { DEFAULT: v("glass"), 2: v("glass-2"), brd: v("glass-brd"), line: v("glass-line"), hi: v("glass-hi") },
      },
      borderRadius: {
        none: "0px",
        DEFAULT: "12px", // --r
        sm: "8px", // --r-sm
        md: "12px",
        lg: "16px", // --r-lg
        full: "9999px",
        2: "2px", 4: "4px", 6: "6px", 8: "8px", 12: "12px", 16: "16px", 20: "20px", 24: "24px",
      },
      fontSize: {
        // plain sizes (no line-height tuple) so text-* utilities only set font-size,
        // matching how the --fs-* tokens are used today
        "2xs": "11px", xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "18px", "2xl": "24px",
      },
      boxShadow: {
        DEFAULT: v("shadow"),
        lg: v("shadow-lg"),
        pop: v("shadow-pop"),
        none: "none",
      },
      fontFamily: {
        sans: v("sans"),
        mono: v("mono"),
      },
      transitionTimingFunction: {
        DEFAULT: v("ease"),
        ease: v("ease"),
      },
    },
  },
};
