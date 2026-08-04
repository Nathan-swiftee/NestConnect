import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { initViewport } from "./lib/viewport";
import { syncThemeColor } from "./lib/theme";
import "./styles.css";

initViewport();
syncThemeColor();
// Keep the browser chrome colour correct if the OS theme flips at runtime.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);

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
