import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vars } from "nativewind";
import { colors } from "@ding/design/tokens";
import { useColorScheme } from "react-native";
import { configureMobileClient, setSignOutHandler } from "../src/api-config";
import { loadSession } from "../src/session";
import "../src/global.css";

// Point the shared client at this app before any hook can fire a request.
configureMobileClient();

/** tokens.ts is camelCased; the CSS variables the Tailwind config reads use the
 *  CSS names, so convert once per scheme rather than on every render. */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const paletteVars = {
  light: vars(Object.fromEntries(Object.entries(colors.light).map(([k, val]) => [`--${kebab(k)}`, val]))),
  dark: vars(Object.fromEntries(Object.entries(colors.dark).map(([k, val]) => [`--${kebab(k)}`, val]))),
};

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
  );
}
