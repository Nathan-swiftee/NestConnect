// Tailwind only — no autoprefixer, so existing styles.css passes through
// unchanged (the app targets evergreen browsers and wasn't autoprefixed before).
module.exports = {
  plugins: {
    tailwindcss: {},
  },
};
