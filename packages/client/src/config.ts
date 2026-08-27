/**
 * How this client reaches the API, and what it does at the edges where the two
 * apps genuinely differ.
 *
 * The transport, the endpoint list and the react-query hooks are identical on
 * web and native. Three things are not: where the API lives (same origin on the
 * web, an absolute URL on a phone), how the session travels (an httpOnly cookie
 * the browser manages, versus a bearer token the app holds in the Keychain), and
 * what happens on sign-out (a page navigation, versus a router reset).
 *
 * Rather than fork the client, each app calls {@link configureClient} once at
 * startup and everything downstream is shared. The alternative — a React context
 * threaded through every hook — would touch hundreds of call sites to express
 * three facts that are fixed for the lifetime of the process.
 */

/** How the session travels on the wire. */
export type AuthMode =
  /** Browser: the httpOnly cookie, sent by `credentials: "include"`. */
  | { kind: "cookie" }
  /**
   * Native: `Authorization: Bearer <jwt>`, read fresh on every request so a
   * refresh (or a sign-out) takes effect immediately rather than at next launch.
   */
  | { kind: "bearer"; getToken: () => string | null };

/** Sound cues for realtime events. The web app plays its own; native leaves them
 *  to the OS notification, so both are optional. */
export interface ClientCues {
  /** A message arrived from a customer. */
  received?: () => void;
  /** One of ours actually left the building (never on queued/failed). */
  sent?: (channel?: string) => void;
}

/**
 * A file already on this device's disk, named the way the multipart part should
 * be. Only a native app can produce one; a browser has `File` instead.
 */
export interface UploadFile {
  /** `file://…` — where it actually is. */
  uri: string;
  name: string;
  type: string;
}

/** What the server should record about an upload beyond its bytes. */
export interface UploadMeta {
  filename?: string;
  kind?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  waveform?: number[];
}

export interface ClientConfig {
  /** API origin. Empty string means "same origin", which is the web's case. */
  baseUrl: string;
  auth: AuthMode;
  cues: ClientCues;
  /** Called after a successful logout, once the caches are cleared. */
  onSignedOut?: () => void;
  /**
   * How this platform posts a file that is already on disk.
   *
   * The web doesn't set this: a browser has a `File`, `FormData` takes it, and
   * `fetch` posts it. A phone has neither of those things in a usable form, and
   * the attempts to pretend otherwise are worth recording, because there were
   * two and both shipped:
   *
   *  - Handing React Native's `FormData` a `Blob` produced a part the native
   *    networking layer refused.
   *  - Handing it `{ uri, name, type }` — the shape React Native's own FormData
   *    documents — produced "Unsupported FormDataPart implementation", because
   *    Expo replaces the global `fetch` with its own, and that implementation
   *    builds the multipart body in JavaScript and accepts only a `Blob` or
   *    something with `.bytes()`. Its own source says so: *"`uri` is not
   *    supported for React Native's FormData."*
   *
   * There is no shape that satisfies both runtimes, so this stops trying. The
   * app that owns a disk supplies the uploader for it — on the phone that's a
   * native streaming multipart request, which is also the only version that
   * doesn't read a video into JavaScript memory to send it.
   */
  uploadFile?: (file: UploadFile, meta: UploadMeta) => Promise<unknown>;
}

let config: ClientConfig = {
  baseUrl: "",
  auth: { kind: "cookie" },
  cues: {},
};

/** Call once, before rendering. */
export function configureClient(next: Partial<ClientConfig>): void {
  config = { ...config, ...next };
}

export function clientConfig(): ClientConfig {
  return config;
}

/** The `Authorization` header for the current mode, if there is one. */
export function authHeaders(): Record<string, string> {
  const { auth } = config;
  if (auth.kind !== "bearer") return {};
  const token = auth.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
