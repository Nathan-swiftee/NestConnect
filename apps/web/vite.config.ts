import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the web app proxies REST + WebSocket traffic to the API on :3001,
// so the browser talks to a single origin (no CORS juggling locally).
export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * One copy of each of these in the bundle, whoever imports them.
     *
     * This is a workspace, and `@ding/client` has its own `node_modules/react`
     * separate from the app's. Both are 18.3.1, but they're different absolute
     * paths, so without this Rollup treats them as different modules and ships
     * two Reacts — which means two sets of context. The shared hooks then call
     * `useQuery` against a React that never saw `<QueryClientProvider>`, and the
     * whole app dies at boot with "No QueryClient set, use QueryClientProvider
     * to set one" — a message that points at the provider, which is fine, rather
     * than at module resolution, which isn't.
     *
     * It only bites the production build: the dev server resolves through a
     * different path and works, so this is exactly the kind of breakage that
     * reaches a deploy without anyone seeing it locally.
     *
     * react-query is listed for the same reason — its client lives in a React
     * context, so a duplicate of it fails identically.
     */
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
    },
  },
  // `vite preview` serves the production build; mirror the dev proxy so the
  // built app can reach the API on :3001 during verification.
  preview: {
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
    },
  },
});
