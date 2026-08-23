import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureClient } from "@ding/client";
import { App } from "./App";
import { playReceived, playSent } from "./lib/sound";
import { syncThemeColor } from "./lib/theme";
import { initViewport } from "./lib/viewport";
import { initLayout } from "./lib/layout";
// Design tokens first (shared with the native app), then the app's own CSS,
// which consumes those custom properties. Order matters: variables before use.
import "@ding/design/tokens.css";
import "./styles.css";
// Tailwind utilities last so they can override component CSS as it's migrated.
import "./tailwind.css";

// Tell the shared client how the web reaches the API and behaves at the edges
// where a browser differs from a phone. Must run before anything renders.
configureClient({
  // Empty in production (the API serves the SPA from the same origin); the dev
  // server points at the API with VITE_API_URL.
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  auth: { kind: "cookie" },
  cues: { received: playReceived, sent: playSent },
  // clear() re-triggers the active ["session"] query, which can race and bounce
  // you back into the app; a full reload guarantees a clean unauthenticated start.
  onSignedOut: () => window.location.assign("/"),
});

syncThemeColor();
// Keep the browser chrome colour correct if the OS theme flips at runtime.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
// Pin the app shell to the visual viewport so the mobile keyboard can't push the header off-screen.
initViewport();
// Restore the saved conversation-list width before first paint (no resize flash).
initLayout();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
