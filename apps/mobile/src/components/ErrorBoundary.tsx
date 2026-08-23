import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "@ding/design/tokens";
import { reportError } from "../telemetry";

/**
 * The last line of defence: an uncaught render error, caught.
 *
 * Without this, a crash in any screen leaves Expo Router's own error page — a
 * black screen with a raw stack trace, which is right for a developer and
 * useless to an agent mid-shift, who is left with no way back into the app and
 * nothing to tell anyone except "it broke".
 *
 * So: say something true, offer the one action that helps (go back to the
 * inbox, which remounts the tree), and send the crash on so it gets fixed
 * rather than merely survived.
 *
 * A class, because `componentDidCatch` has no hook equivalent — this is one of
 * the two things React still only does this way.
 *
 * The palette is read from tokens directly rather than through `useTheme`,
 * because a boundary that needs a working provider to render its own fallback
 * has misunderstood its job.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: (info.componentStack ?? "").slice(0, 500) });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Light palette: a fallback that reads the colour scheme is a fallback with
    // one more thing to go wrong, and this surface exists precisely for the
    // moment something has.
    const c = colors.light;
    return (
      <View
        style={{ backgroundColor: c.bg }}
        className="flex-1 items-center justify-center gap-2 px-8"
      >
        <Text style={{ color: c.text }} className="text-xl font-semibold">
          Something went wrong
        </Text>
        <Text style={{ color: c.textMuted }} className="text-center text-md leading-snug">
          This screen hit an error and stopped. Nothing you'd sent has been lost — messages are
          queued until the server accepts them.
        </Text>
        <Pressable
          onPress={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Back to the inbox"
          style={{ backgroundColor: c.brand }}
          className="mt-3 rounded-full px-5 py-2.5 active:opacity-80"
        >
          <Text className="text-lg font-semibold text-white">Back to the inbox</Text>
        </Pressable>
        {__DEV__ ? (
          <Text style={{ color: c.textFaint }} className="mt-4 text-2xs">
            {error.message}
          </Text>
        ) : null}
      </View>
    );
  }
}
