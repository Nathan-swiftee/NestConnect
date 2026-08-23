import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Haptic feedback, named by what happened rather than how hard it buzzes.
 *
 * Two reasons this is a wrapper rather than calls to expo-haptics scattered
 * through the screens:
 *
 *  - **Intent, not intensity.** `success()` reads at the call site; `Light` vs
 *    `Medium` doesn't, and the two drift apart the moment someone picks the
 *    wrong one. Naming the moment also keeps the vocabulary small: there are
 *    five things worth feeling in this app, not fifteen.
 *  - **It must never be able to fail.** Haptics are unavailable on plenty of
 *    real devices — a tablet with no Taptic Engine, an Android build without
 *    the vibrate permission, an iPhone in Low Power Mode — and every call here
 *    sits inside an interaction that matters. A rejected promise from a *nice
 *    touch* must not take a send or a reply down with it, so every one is
 *    swallowed.
 *
 * Used deliberately and sparingly. A phone that buzzes at everything is a phone
 * people turn the haptics off on, and then the moments that mattered are gone
 * with the rest.
 */
const off = Platform.OS === "web";

const impact = (style: Haptics.ImpactFeedbackStyle) => {
  if (off) return;
  void Haptics.impactAsync(style).catch(() => {});
};

const notify = (type: Haptics.NotificationFeedbackType) => {
  if (off) return;
  void Haptics.notificationAsync(type).catch(() => {});
};

export const haptics = {
  /** A gesture completed — swipe-to-reply committing, a sheet snapping open. */
  tap: () => impact(Haptics.ImpactFeedbackStyle.Light),
  /** A choice landed — picking a reaction, switching view, toggling a filter. */
  select: () => {
    if (off) return;
    void Haptics.selectionAsync().catch(() => {});
  },
  /** Something went out or was accepted — a message sent, a conversation resolved. */
  success: () => notify(Haptics.NotificationFeedbackType.Success),
  /** A refusal the person needs to feel — sending outside the WhatsApp window. */
  warning: () => notify(Haptics.NotificationFeedbackType.Warning),
  /** It failed. Pairs with a visible message; never the only signal. */
  error: () => notify(Haptics.NotificationFeedbackType.Error),
};
