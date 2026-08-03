import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the web app proxies REST + WebSocket traffic to the API on :3001,
// so the browser talks to a single origin (no CORS juggling locally).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
    },
  },
});
