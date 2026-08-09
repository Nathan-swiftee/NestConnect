import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { syncThemeColor } from "./lib/theme";
import { initViewport } from "./lib/viewport";
import { initLayout } from "./lib/layout";
import "./styles.css";

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
