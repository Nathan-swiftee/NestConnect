/** Flip the app between light and dark, seeding from the OS preference. */
export function toggleTheme(): void {
  const root = document.documentElement;
  let cur = root.getAttribute("data-theme");
  if (!cur) cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
}
