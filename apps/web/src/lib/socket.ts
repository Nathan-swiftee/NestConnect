import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@ding/schemas";

// Socket.IO types listen-events first, emit-events second.
export type DingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: DingSocket | null = null;

export function getSocket(): DingSocket {
  if (!socket) {
    const url = import.meta.env.VITE_API_URL;
    // withCredentials sends the httpOnly session cookie on the handshake so the
    // server can authenticate the socket (required cross-origin in dev too).
    const opts = { path: "/socket.io", transports: ["websocket", "polling"], withCredentials: true };
    socket = url ? io(url, opts) : io(opts);
  }
  return socket;
}
