import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { colors } from "@ding/design/tokens";
import { useColorScheme } from "react-native";
import { configureMobileClient, setSignOutHandler } from "../src/api-config";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { ToastProvider } from "../src/components/Toast";
import { loadSession } from "../src/session";
import { initTelemetry } from "../src/telemetry";
import { paletteVars } from "../src/theme";
import "../src/global.css";
// Side effect only: registers className support on Reanimated's views. Must run
// before any of them render, or their utility classes are silently dropped.
import "../src/animated";

// Both before anything renders: the client so no hook can fire an
// unconfigured request, and telemetry so a crash during the first paint is
// still reported. Telemetry is a no-op unless a DSN was baked into the build.
configureMobileClient();
initTelemetry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // A phone drops off the network constantly — a couple of retries turns a
      // lift-shaft moment into a slightly slow load rather than an error state.
      retry: 2,
    },
  },
});

export default function RootLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const c = colors[scheme];
  // The stored token must be in memory before the first request, or a signed-in
  // launch would fire an unauthenticated /auth/session and bounce to sign-in.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSignOutHandler(() => {
      queryClient.clear();
      router.replace("/sign-in");
    });
    void loadSession().finally(() => setReady(true));
  }, []);

  return (
    // Gesture handler needs its own root above everything, or pan gestures
    // (swipe-to-reply) silently never fire on Android.
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Outside the providers on purpose: a boundary that needs a working
          provider to draw its own fallback has misunderstood its job. */}
      <ErrorBoundary onReset={() => router.replace("/")}>
        {/* Safe-area first, and above the keyboard provider — the order is the
            bug we shipped for months, not a style preference.

            On Android the system bar insets arrive as WindowInsets and are
            passed down the view tree, and a view in the middle can consume them
            before anything below sees them. KeyboardProvider does exactly that
            when told the bars are translucent, so with it on the outside every
            `useSafeAreaInsets()` in the app answered zero: the chat header sat
            under the clock and the composer under the navigation bar, on every
            screen, since the first build. Nothing about it looks wrong in a
            browser, where there are no system bars to inset for.

            `initialMetrics` is the belt to that braces. It reads the insets
            synchronously from the native module at startup instead of waiting
            for the first measurement to come back, so the first frame is
            already correct — and a screen still gets real numbers even if the
            listener path fails again. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {/* Android draws edge-to-edge from SDK 54 on, and there is no opting
              out. That breaks the platform's own `adjustResize`: the window no
              longer shrinks when the keyboard opens, so anything anchored to the
              bottom — the composer — ends up underneath it. This provider is
              what restores it, reading the real keyboard frame and publishing it
              as animated values. Reanimated's useAnimatedKeyboard is deprecated
              in favour of exactly this. */}
          <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
            {/* The palette for this scheme, published as CSS variables to everything
                below. Every colour utility (`text-fg`, `bg-surface`, …) resolves
                through these, so switching the phone to dark switches the whole app
                rather than only the places that read useTheme() directly. */}
            <View style={paletteVars[scheme]} className="flex-1">
              <QueryClientProvider client={queryClient}>
                {/* Inside the query provider so a mutation can raise a toast, and
                    above the navigator so one survives a screen change. */}
                <ToastProvider>
                  <StatusBar style={scheme === "dark" ? "light" : "dark"} />
                  {ready ? (
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: c.bg },
                        animation: "slide_from_right",
                      }}
                    >
                      <Stack.Screen name="index" />
                      <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
                      <Stack.Screen name="(app)" />
                    </Stack>
                  ) : (
                    <View style={{ backgroundColor: c.bg }} className="flex-1 items-center justify-center">
                      <ActivityIndicator color={c.brand} />
                    </View>
                  )}
                </ToastProvider>
              </QueryClientProvider>
            </View>
          </KeyboardProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
