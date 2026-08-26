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
 * `KeyboardAvoidingView` is deliberately NOT registered here, and that is the
 * whole point of this note.
 *
 * It was, once. Every screen built on it passed `className="flex-1"`, the
 * className was being dropped, and registering it looked like the fix. Then the
 * call sites moved to `style={{ flex: 1 }}` and the registration turned from
 * unnecessary into actively harmful: `cssInterop(C, { className: "style" })`
 * means "compute styles from className and write them into `style`", so with no
 * className to read it computes nothing and *overwrites* the inline style with
 * it. The prop is still there in the source and simply never arrives.
 *
 * That cost several rounds. The screen's `paddingTop` vanished, so the header
 * sat under the clock; the fix for that leaned on `flex: 1` for sizing, which
 * vanished the same way, so the message list collapsed to nothing and the
 * composer ended up directly under the header.
 *
 * If a screen ever wants `className` on this component, register it again — but
 * then every call site must use className for layout, not `style`, because the
 * two cannot coexist on an interop'd component.
 */

export {};
