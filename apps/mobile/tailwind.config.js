/**
 * The same preset the web app uses, so a utility means the same thing on both
 * platforms.
 *
 * Colours go through CSS variables here, exactly as they do on the web. React
 * Native has no cascade of its own, but NativeWind implements one: `vars()`
 * applied to a view sets variables for everything under it, and the root layout
 * sets the palette for the phone's current scheme. That indirection is the whole
 * point — a class like `text-fg` has to mean near-black in light and near-white
 * in dark, and a config that bakes in one palette can only ever mean one of
 * them.
 *
 * The variable names are the kebab-case token keys, matching tokens.css.
 */
const { light } = require("@ding/design/tokens");
const preset = require("@ding/design/tailwind-preset");

/** tokens.ts is camelCased for JS; the CSS variables use the CSS names. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Every token key, as `var(--key)`. `light` and `dark` share their keys, so
 *  either one enumerates the full set. */
const v = Object.fromEntries(Object.keys(light).map((k) => [kebab(k), `var(--${kebab(k)})`]));

module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      ...preset.theme.extend,
      colors: {
        transparent: "transparent",
        white: "#ffffff",
        black: "#000000",
        ...v,
        surface: { DEFAULT: v.surface, 2: v["surface-2"] },
        fg: v.text,
        muted: v["text-muted"],
        faint: v["text-faint"],
      },
    },
  },
  plugins: [],
};
