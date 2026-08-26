import { useMemo } from "react";
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
  withSpring,
  withTiming,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";

/**
 * The app's motion vocabulary, in one place.
 *
 * Two rules hold everything below together.
 *
 * **Springs move things, curves fade things.** Anything that travels — a sheet
 * rising, a pill landing, a button pressing — uses a spring, because a spring
 * is how a physical object arrives and the eye reads the difference. Anything
 * that only changes opacity uses a timing curve, because there is no mass in a
 * fade and a spring on one just looks indecisive.
 *
 * **Three speeds, no more.** `quick` for something that must not be noticed
 * (a press), `base` for the common case, `settle` for something arriving from
 * off-screen with distance to cover. Every duration in the app comes from here,
 * so nothing is a hair faster than the thing beside it for no reason.
 *
 * All of it defers to the OS. Every spring and curve carries
 * `ReduceMotion.System`, so a phone set to reduce motion gets the state change
 * without the travel — not a slower animation, no animation. `useMotion()`
 * exposes the same answer to code that has to branch rather than configure.
 */

/** Springs. Damping over stiffness: nothing in a work tool should overshoot far
 *  enough to be visible as a bounce — it reads as a toy. */
export const spring = {
  /** A press, a toggle, a tick landing. Over before it registers. */
  quick: {
    damping: 26,
    stiffness: 420,
    mass: 0.7,
    reduceMotion: ReduceMotion.System,
  } satisfies WithSpringConfig,
  /** The default. A pill appearing, a chip sliding, a row settling. */
  base: {
    damping: 22,
    stiffness: 260,
    mass: 0.9,
    reduceMotion: ReduceMotion.System,
  } satisfies WithSpringConfig,
  /** Distance to cover: a sheet from the bottom, a toast from off-screen. Softer
   *  so the arrival is a glide rather than a snap. */
  settle: {
    damping: 24,
    stiffness: 180,
    mass: 1,
    reduceMotion: ReduceMotion.System,
  } satisfies WithSpringConfig,
  /**
   * The deliberate exception to "nothing should overshoot visibly".
   *
   * For something small appearing from nothing, where the bounce *is* the
   * content: the six reaction emoji popping out of the pill one after another.
   * There the overshoot isn't a physical artefact to be damped away, it's the
   * whole reason the row feels alive rather than merely rendered — the web
   * mobile overlay does the same thing (`@keyframes emojiPop`, 0 → 1.22 → 1).
   *
   * Tuned to that peak rather than eyeballed: damping ratio
   * ζ = damping / 2√(stiffness·mass) = 12 / 2√(260 × 0.7) ≈ 0.44, and a spring's
   * first overshoot is exp(−πζ/√(1−ζ²)) ≈ 0.22 above the target. Use it only on
   * scale, only on something under ~50pt, and never on a thing that travels —
   * a bouncing panel reads as a toy.
   */
  pop: {
    damping: 12,
    stiffness: 260,
    mass: 0.7,
    reduceMotion: ReduceMotion.System,
  } satisfies WithSpringConfig,
};

/** Timing curves, for opacity and colour. `Easing.out` on the way in so the
 *  change is mostly done early, which is what makes it feel responsive rather
 *  than merely fast. */
export const timing = {
  quick: {
    duration: 120,
    easing: Easing.out(Easing.quad),
    reduceMotion: ReduceMotion.System,
  } satisfies WithTimingConfig,
  base: {
    duration: 220,
    easing: Easing.out(Easing.cubic),
    reduceMotion: ReduceMotion.System,
  } satisfies WithTimingConfig,
  settle: {
    duration: 320,
    easing: Easing.out(Easing.cubic),
    reduceMotion: ReduceMotion.System,
  } satisfies WithTimingConfig,
};

/** Shorthands, so a call site reads as intent rather than configuration. */
export const springTo = (v: number, cfg: WithSpringConfig = spring.base) => withSpring(v, cfg);
export const fadeTo = (v: number, cfg: WithTimingConfig = timing.base) => withTiming(v, cfg);

/**
 * Layout animations, pre-configured.
 *
 * Deliberately restrained: a list where every row flies in from a different
 * direction is a list nobody can read. Rows fade up a few pixels, everything
 * else just fades, and re-layout is a single shared curve so two things moving
 * at once move together.
 */
export const enter = {
  /** A row, a bubble, a card. Up-and-in, a short distance. */
  row: FadeInDown.springify().damping(22).stiffness(260).mass(0.9).reduceMotion(ReduceMotion.System),
  /** Something that appears in place — a badge, a banner, an error line. */
  soft: FadeIn.duration(timing.base.duration).reduceMotion(ReduceMotion.System),
};

export const exit = {
  soft: FadeOut.duration(timing.quick.duration).reduceMotion(ReduceMotion.System),
};

/** For a list that reorders or grows: one curve, applied to everything moving. */
export const reflow = LinearTransition.springify()
  .damping(24)
  .stiffness(220)
  .mass(0.9)
  .reduceMotion(ReduceMotion.System);

/**
 * Stagger, capped.
 *
 * A cascade is only pleasant while it's short. Past about eight rows the last
 * one is waiting long enough to read as lag rather than choreography, so the
 * delay stops growing — later rows all arrive together and the effect degrades
 * into a plain fade instead of a slow one.
 */
export function stagger(index: number, step = 28, cap = 8): number {
  return Math.min(index, cap) * step;
}

/**
 * A staggered row entrance — one fresh animation per call.
 *
 * It has to be built rather than shared: reanimated's builders mutate in place
 * and return themselves, so `enter.row.delay(n)` would quietly stamp that delay
 * onto the shared instance and every other user of it. `enter.row` stays for
 * the un-delayed case; anything that needs a delay comes through here.
 */
export function rowIn(index = 0) {
  return FadeInDown.springify()
    .damping(22)
    .stiffness(260)
    .mass(0.9)
    .delay(stagger(index))
    .reduceMotion(ReduceMotion.System);
}

/**
 * Whether to animate at all.
 *
 * For the cases configuration can't reach: a component that would otherwise
 * mount an animated value and drive it from an effect. `useReducedMotion()`
 * reads the OS setting and updates if it changes mid-session.
 */
export function useMotion(): { on: boolean; enter: typeof enter; exit: typeof exit } {
  const reduced = useReducedMotion();
  return useMemo(
    () => ({
      on: !reduced,
      enter,
      exit,
    }),
    [reduced],
  );
}
