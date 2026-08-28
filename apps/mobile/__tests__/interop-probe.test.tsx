/**
 * One rule, held here because four shipped bugs came out of not knowing it:
 *
 *   On a component `cssInterop` has registered — which is every React Native
 *   primitive, plus `Animated.View`/`Text`/`ScrollView` from `src/animated.ts`
 *   — an animated style is the *only* style that reaches the component. A
 *   `style={[animated, somethingElse]}` array arrives as `animated` alone, and
 *   a `className` on the same element is dropped with it.
 *
 * What that cost, in order: a swipe panel that took 44pt of layout above every
 * conversation instead of sitting behind the row; a microphone with no disc,
 * because its `h-10 w-10 rounded-full` never arrived; a reply arrow at the top
 * of the row rather than beside its bubble, because its `top` never arrived;
 * and two sheet scrims with neither a position nor a colour. Every one of them
 * rendered correctly in a browser — react-native-web resolves the interop
 * differently — so the fix is a rule rather than a screenshot.
 *
 * The check that follows is a comparison, not an inspection, which is what
 * makes it evidence: the same style array is given to a registered component
 * and to one the interop has never heard of. Reanimated, Jest and the style are
 * identical across the two; only the registration differs. If the unregistered
 * one keeps the static half and the registered one does not, the interop is
 * where it goes.
 *
 * `scripts/check-layout-rules.mjs` is what actually guards the call sites — it
 * reads every element in the app, where this reads one. This exists so that
 * when the rule stops being true (an interop release, a NativeWind major) the
 * failure is a red test with an explanation rather than a silent chance to
 * delete a checker nobody can justify any more.
 */
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { render } from "nativewind/dist/test";
// The app's `cssInterop(Animated.View, …)` registration, imported for its side
// effect from the root layout. Without it this file tests a different program.
import "../src/animated";

/** The static half of the style under test, on both components. */
const STATIC = { position: "absolute" as const, top: 45, height: 28 };

/** A component the interop registry has no entry for. */
function Bare(props: Record<string, unknown>) {
  return <View testID="bare-inner" {...props} />;
}
const AnimatedBare = Animated.createAnimatedComponent(Bare);

function Probe({ registered }: { registered: boolean }) {
  const sv = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ opacity: sv.value }));
  const style = [anim, STATIC];
  return registered ? (
    <Animated.View testID="probe" style={style} />
  ) : (
    <AnimatedBare testID="probe" style={style} />
  );
}

/**
 * Everything the element ends up styled by, flattened.
 *
 * Both channels, because reanimated's Jest shim splits them: the animated half
 * stays on `style`, the static half moves to `jestInlineStyle`. Reading only
 * one of them is how this test first reported that reanimated dropped the
 * static styles, which it does not.
 */
function styling(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s)) return s.forEach(walk);
    Object.assign(out, s);
  };
  walk(props.jestInlineStyle);
  walk(props.style);
  return out;
}

async function styleReaching(registered: boolean) {
  const r = await render(<Probe registered={registered} />, { config: { safelist: [] } });
  // The registered case renders one host View; the unregistered case renders
  // `Bare`, which renders a host View of its own. Either way the deepest host
  // View carrying a style is the one the styles had to reach.
  const styled = (r.UNSAFE_root.findAllByType(View as never) as { props: unknown }[])
    .map((n) => n.props as Record<string, unknown>)
    .filter((p) => "style" in p);
  expect(styled.length).toBeGreaterThan(0);
  return styling(styled[styled.length - 1]);
}

describe("a style array containing an animated style", () => {
  it("keeps its static half on a component the interop has not registered", async () => {
    const style = await styleReaching(false);
    // The control. If this fails, the comparison below proves nothing: it would
    // mean reanimated or the test renderer is losing the static half and the
    // interop is not implicated.
    expect(style).toMatchObject(STATIC);
    expect(style.opacity).toBe(1);
  });

  it("loses its static half on a registered one — the whole reason for the rule", async () => {
    const style = await styleReaching(true);
    // The animated half is all that survives.
    expect(style.opacity).toBe(1);
    expect(style.position).toBeUndefined();
    expect(style.top).toBeUndefined();
    expect(style.height).toBeUndefined();
  });
});
