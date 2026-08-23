/**
 * The same preset the web app uses, so a utility means the same thing on both
 * platforms — with one substitution: the preset resolves colours to `var(--x)`,
 * which React Native has no concept of, so native reads the generated
 * `tokens.ts` instead. Both come from tokens.css, so there is still one source.
 */
const { light } = require("@ding/design/tokens");
const preset = require("@ding/design/tailwind-preset");

/** tokens.ts is camelCased for JS; Tailwind wants the CSS names back. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const colors = Object.fromEntries(Object.entries(light).map(([k, v]) => [kebab(k), v]));

module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      ...preset.theme.extend,
      colors: {
        transparent: "transparent",
        white: "#ffffff",
        black: "#000000",
        ...colors,
        surface: { DEFAULT: colors.surface, 2: colors["surface-2"] },
        fg: colors.text,
        muted: colors["text-muted"],
        faint: colors["text-faint"],
      },
    },
  },
  plugins: [],
};
