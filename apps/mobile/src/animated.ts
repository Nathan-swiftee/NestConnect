import { cssInterop } from "nativewind";
import Animated from "react-native-reanimated";

/**
 * Teach NativeWind about the views it doesn't ship knowing.
 *
 * NativeWind's `className` isn't a real prop — a Babel plugin rewrites it into
 * `style` for the components it knows about, and it only knows about React
 * Native's own. `Animated.View` is a different component object, so a
 * `className` on one is silently dropped: no error, no warning, the styles
 * simply never arrive. It's a nasty failure because a component that also
 * passes `style` looks half-styled rather than broken, which reads as a layout
 * bug somewhere else entirely — the sign-in mark rendered as a full-width green
 * bar, because its background came through `style` and its 64×64 size didn't.
 *
 * `cssInterop` registers the mapping, once, for the whole app. Imported for its
 * side effect from the root layout, before anything renders.
 */
cssInterop(Animated.View, { className: "style" });
cssInterop(Animated.Text, { className: "style" });
cssInterop(Animated.ScrollView, { className: "style", contentContainerClassName: "contentContainerStyle" });

/**
 * Registering a component here is not free, so a note on the cost.
 *
 * `cssInterop` doesn't add a prop — it swaps the component. The JSX runtime
 * looks every element type up in the interop registry and substitutes the
 * wrapper whether or not that element passes a `className`, and the wrapper
 * renders the real component with `{ ...yourProps, ...whatTheInteropComputed }`.
 * The interop's props win. So the moment a component is registered, `style` at
 * its call sites stops being the last word on that component's styling.
 *
 * That is why `KeyboardAvoidingView` is deliberately not in the list above. It
 * was for a while, and its call sites later moved from `className="flex-1"` to
 * `style={{ flex: 1 }}` — which left a registration reading a className that no
 * longer existed, on the one component in the app whose sizing everything else
 * on the screen depended on.
 *
 * Honest about what that did and didn't explain: un-registering it did not fix
 * the thread screen. The composer was still at the top afterwards. What fixed it
 * was taking `KeyboardAvoidingView` out of the layout path entirely — see the
 * comment at the top of app/(app)/thread/[id].tsx, and docs/11-mobile-layout.md
 * for the whole account. The registration is gone because nothing needs it, not
 * because it was proven to be the culprit.
 *
 * If a screen ever does want `className` on this component, register it again —
 * but then move that screen's layout to className too, because the interop's
 * computed props override the call site's.
 */

export {};
