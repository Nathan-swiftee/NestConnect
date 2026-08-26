import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Appearance = "system" | "light" | "dark";

const KEY = "nest.appearance";

/**
 * Light, dark, or whatever the phone is doing.
 *
 * "System" is the default and the right default — a phone that dims itself in
 * the evening should dim this too. But it isn't sufficient on its own: plenty of
 * people run their phone in dark and want one bright app, or the reverse, and an
 * inbox someone stares at all shift is exactly the kind of app they'll have an
 * opinion about. Leaving it to the OS is a choice we made for them.
 *
 * AsyncStorage rather than the keystore the session token uses: this is a
 * display preference, not a credential, and it should survive without asking
 * the OS to unlock anything.
 */
const Ctx = createContext<{
  /** What the user picked. */
  preference: Appearance;
  /** What that resolves to right now, once "system" is applied. */
  scheme: "light" | "dark";
  set: (a: Appearance) => void;
}>({ preference: "system", scheme: "light", set: () => {} });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [preference, setPreference] = useState<Appearance>("system");

  useEffect(() => {
    // A stored value arrives a frame or two after launch. The app starts on the
    // system scheme and switches if the stored choice differs, which is a brief
    // flash for the minority who set it — the alternative is holding the whole
    // app back on a disk read for everyone.
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setPreference(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      preference,
      scheme: preference === "system" ? system : preference,
      set: (a: Appearance) => {
        setPreference(a);
        void AsyncStorage.setItem(KEY, a).catch(() => {});
      },
    }),
    [preference, system],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppearance() {
  return useContext(Ctx);
}
