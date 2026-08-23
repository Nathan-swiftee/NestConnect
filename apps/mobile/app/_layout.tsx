import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { colors } from "@ding/design/tokens";
import { useColorScheme } from "react-native";
import { configureMobileClient, setSignOutHandler } from "../src/api-config";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { loadSession } from "../src/session";
import { initTelemetry } from "../src/telemetry";
import { paletteVars } from "../src/theme";
import "../src/global.css";

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
        <SafeAreaProvider>
          {/* The palette for this scheme, published as CSS variables to everything
              below. Every colour utility (`text-fg`, `bg-surface`, …) resolves
              through these, so switching the phone to dark switches the whole app
              rather than only the places that read useTheme() directly. */}
          <View style={paletteVars[scheme]} className="flex-1">
            <QueryClientProvider client={queryClient}>
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
            </QueryClientProvider>
          </View>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
