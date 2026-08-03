const SURFACE = { light: "#FFFFFF", dark: "#0E1512" } as const;

/** The theme actually in effect (explicit toggle wins over the OS setting). */
function effectiveTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Keep the mobile browser's top/bottom chrome the same colour as the app header
 *  and composer (both `--surface`) so it doesn't read as a grey toolbar. */
export function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", SURFACE[effectiveTheme()]);
}

/** Flip the app between light and dark, seeding from the OS preference. */
export function toggleTheme(): void {
  const root = document.documentElement;
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  syncThemeColor();
}
