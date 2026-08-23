import { useEffect, useState } from "react";
import { isSoundOn, subscribeSound, toggleSound } from "./lib/sound";
import { effectiveTheme } from "./lib/theme";

/**
 * The data hooks — queries, mutations and realtime — live in `@ding/client`,
 * shared with the native apps. Re-exported here so every existing
 * `from "../hooks"` import keeps working.
 *
 * What stays behind is what genuinely belongs to a browser: `matchMedia`, the
 * Web Audio sound toggle, and the CSS-variable theme. Native has its own
 * answers to all three, so pushing them into the shared package would only
 * mean guarding them at every call.
 */
export * from "@ding/client";

/** Reactive `matchMedia` for responsive (mobile ⇄ desktop) layout switches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Sound on/off state bound to the shared sound module. */
export function useSound(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(isSoundOn);
  useEffect(() => subscribeSound(setOn), []);
  return { on, toggle: toggleSound };
}

/** The theme currently in effect, re-read whenever it's toggled or the OS flips. */
export function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(effectiveTheme);
  useEffect(() => {
    const update = () => setTheme(effectiveTheme());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("themechange", update);
    mql.addEventListener("change", update);
    return () => {
      window.removeEventListener("themechange", update);
      mql.removeEventListener("change", update);
    };
  }, []);
  return theme;
}
