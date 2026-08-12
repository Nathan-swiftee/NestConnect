const preset = require("@ding/design/tailwind-preset");

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Dark mode keys off the same attribute the app already toggles. (When the
  // first dark: utilities land, theme.ts will also seed this attribute from the
  // OS so it matches the current prefers-color-scheme default.)
  darkMode: ["selector", '[data-theme="dark"]'],
  // Keep the app's existing reset — Tailwind's Preflight would change the look.
  // Utilities layer on top of styles.css during the incremental migration.
  corePlugins: { preflight: false },
  theme: {},
  plugins: [],
};
