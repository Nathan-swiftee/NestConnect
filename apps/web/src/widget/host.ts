/**
 * What the page around the chat says about who is signed in.
 *
 * The loader (`public/nestchat.js`) holds `NestChatSettings.user` and hands it
 * over by postMessage once this frame says it is listening — never in the
 * frame's URL, which lands in server logs and browser history. It is a claim,
 * not a credential: the server believes the id only with a valid `hash`, made
 * by the website's own server with the channel's signing secret.
 */

export interface HostUser {
  id: string;
  hash?: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface HostIdentity {
  user: HostUser | null;
  fields: Record<string, string> | null;
}

/** How long to wait for a page that said it would speak. Past this the chat
 *  opens as a visitor rather than not at all — a broken host page must not
 *  mean a broken chat. */
export const HOST_WAIT_MS = 2500;

/** Whether this frame was put up by a loader that will say who is signed in. */
export function hostWillSpeak(search: string): boolean {
  return new URLSearchParams(search).get("hs") === "1";
}

/** A message from the host page, if it is one of ours. */
export function readHostMessage(data: unknown): HostIdentity | undefined {
  if (!data || typeof data !== "object") return undefined;
  const msg = data as { type?: unknown; user?: unknown; fields?: unknown };
  if (msg.type !== "nestchat:user") return undefined;
  return { user: cleanUser(msg.user), fields: cleanFields(msg.fields) };
}

/**
 * The loader's word on whether this chat fills the screen — it does when it's
 * open on a phone (see `small()` in public/nestchat.js). Full screen, the
 * chat draws its own minimise button: the loader's round one is hidden, since
 * it would sit on top of the composer.
 */
export function readLayoutMessage(data: unknown): { fullscreen: boolean; keyboard: boolean } | undefined {
  if (!data || typeof data !== "object") return undefined;
  const msg = data as { type?: unknown; fullscreen?: unknown; keyboard?: unknown };
  if (msg.type !== "nestchat:layout") return undefined;
  // `keyboard`: the page can see the on-screen keyboard (its visual viewport
  // shrinks); this frame, sized to fit above it, can't tell on its own.
  return { fullscreen: msg.fullscreen === true, keyboard: msg.fullscreen === true && msg.keyboard === true };
}

/** Ask the loader to put the chat away — the full-screen chat's minimise. */
export function askHostToClose(): void {
  // Carries nothing but the request; the loader checks it came from its frame.
  window.parent?.postMessage({ type: "nestchat:close" }, "*");
}

function cleanUser(raw: unknown): HostUser | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const id = str(r.id);
  if (!id) return null;
  return { id, hash: str(r.hash), name: str(r.name), email: str(r.email), phone: str(r.phone) };
}

function cleanFields(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Whether two identities are the same person, so a page repeating itself
 *  does not tear down the conversation on screen. */
export function sameIdentity(a: HostIdentity | null, b: HostIdentity | null): boolean {
  return (a?.user?.id ?? "") === (b?.user?.id ?? "");
}

/**
 * What to open the session with.
 *
 * A signed-in user is sent with their signature and details. An email is only
 * sent alongside an id and a hash — on its own it would be a visitor asking to
 * be written onto somebody's record, which the server would discard anyway.
 */
export function sessionInputFor(
  who: HostIdentity | null,
  visitorId: string | undefined,
): {
  visitorId?: string;
  externalId?: string;
  userHash?: string;
  name?: string;
  email?: string;
  phone?: string;
  fields?: Record<string, string>;
} {
  const fields = who?.fields ?? undefined;
  const user = who?.user;
  if (!user) return { visitorId, ...(fields ? { fields } : {}) };
  return {
    visitorId,
    externalId: user.id,
    ...(user.hash ? { userHash: user.hash } : {}),
    ...(user.name ? { name: user.name } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    ...(fields ? { fields } : {}),
  };
}

/**
 * Ask the page who is signed in, and hear every later change.
 *
 * `onIdentity` is called with the first answer and with each later one — a
 * sign-in or sign-out without a page load. Only the parent window is
 * listened to; the page cannot be checked further than that, and does not
 * need to be, because nothing it says is believed without the signature.
 */
export function listenToHost(onIdentity: (who: HostIdentity) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const who = readHostMessage(event.data);
    if (who) onIdentity(who);
  };
  window.addEventListener("message", handler);
  // The page's origin is not known, and this carries nothing but "ready".
  window.parent?.postMessage({ type: "nestchat:ready" }, "*");
  return () => window.removeEventListener("message", handler);
}
