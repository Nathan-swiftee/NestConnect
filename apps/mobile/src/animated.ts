import { cssInterop } from "nativewind";
import Animated from "react-native-reanimated";

/**
 * Teach NativeWind about Reanimated's views.
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

export {};
