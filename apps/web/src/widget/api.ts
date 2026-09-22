import type {
  NestChatConfig,
  NestChatIdentifyResult,
  NestChatMessage,
  NestChatSession,
  NestChatStartInput,
  NestChatStartResult,
  NestChatUploadResult,
} from "@ding/schemas";
import { TYPING_PREVIEW_MAX } from "@ding/schemas";

/**
 * The widget's whole API surface — plain fetch, no shared client.
 *
 * The inbox app's client carries auth, sockets, react-query and a cache; none of
 * that belongs in a chat bubble on someone's marketing site, where every
 * kilobyte is charged to a page we don't own.
 *
 * Same-origin by construction: the widget page is served by the API, so an
 * embed on any website still calls back to us, not to the host page's origin.
 */
const base = "/api/nestchat";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export function fetchConfig(widgetKey: string): Promise<NestChatConfig> {
  return fetch(`${base}/${encodeURIComponent(widgetKey)}/config`).then(json<NestChatConfig>);
}

export function openSession(
  widgetKey: string,
  input: { visitorId?: string; name?: string; email?: string },
): Promise<NestChatSession> {
  return fetch(`${base}/${encodeURIComponent(widgetKey)}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then(json<NestChatSession>);
}

export function sendMessage(
  token: string,
  body: string,
  pageUrl?: string,
  extra?: { attachments?: string[]; quotedMsgId?: string },
): Promise<{ ok: boolean; message?: NestChatMessage; token?: string }> {
  return fetch(`${base}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      body,
      pageUrl,
      attachments: extra?.attachments ?? [],
      quotedMsgId: extra?.quotedMsgId,
    }),
  }).then(json<{ ok: boolean; message?: NestChatMessage; token?: string }>);
}

/**
 * Put the recording somewhere, and get back the ticket that attaches it.
 *
 * Multipart rather than JSON because the audio is bytes, and base64 in a JSON
 * body would cost a third again on a connection that is very often a phone's.
 * The duration and the bars ride alongside as ordinary fields: the recorder
 * measured both while the note was being made, and they are what tells the
 * server this is a voice note rather than an audio file somebody attached.
 */
export function uploadVoice(
  token: string,
  blob: Blob,
  meta: { durationMs: number; waveform: number[] },
): Promise<NestChatUploadResult> {
  const form = new FormData();
  // An extension the server can map to a type, and a name nobody ever reads —
  // a voice note is drawn as a waveform, never as its filename.
  form.append("file", blob, `voice.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  form.append("durationMs", String(Math.round(meta.durationMs)));
  form.append("waveform", JSON.stringify(meta.waveform));
  return fetch(`${base}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }).then(json<NestChatUploadResult>);
}

/**
 * Put an emoji on a message, or take ours off.
 *
 * The answer carries the whole message back, because a reaction is a set with
 * one slot per person: the server is the only party that knows what the set
 * looks like after both sides have touched it, and applying our own guess on
 * top is how two quick taps end up disagreeing.
 */
export function react(
  token: string,
  messageId: string,
  emoji: string,
): Promise<{ ok: boolean; message?: NestChatMessage }> {
  return fetch(`${base}/react`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messageId, emoji }),
  }).then(json<{ ok: boolean; message?: NestChatMessage }>);
}

export function fetchMessages(token: string): Promise<{ messages: NestChatMessage[] }> {
  return fetch(`${base}/messages`, { headers: { Authorization: `Bearer ${token}` } }).then(
    json<{ messages: NestChatMessage[] }>,
  );
}

/**
 * Submit the pre-chat form: who they are, and what they're here about.
 *
 * Not fire-and-forget, unlike the receipts below — the answer decides which
 * team the conversation goes to and carries the token that says so, and a
 * visitor whose form silently failed would be typing to nobody in particular.
 */
export function start(token: string, input: NestChatStartInput): Promise<NestChatStartResult> {
  return fetch(`${base}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  }).then(json<NestChatStartResult>);
}

export function identify(
  token: string,
  input: { name?: string; email?: string; phone?: string },
): Promise<NestChatIdentifyResult> {
  return fetch(`${base}/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  }).then(json<NestChatIdentifyResult>);
}

/**
 * Tell the server how far the visitor has actually got.
 *
 * Fire-and-forget: a receipt that doesn't arrive costs an agent a tick, which
 * is not worth failing a send or showing anyone an error over.
 */
export function reportRead(
  token: string,
  throughMessageId: string,
  status: "delivered" | "read",
): void {
  void fetch(`${base}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ throughMessageId, status }),
  }).catch(() => {});
}

/** Fire-and-forget: a dropped typing ping is not worth a retry or an error. */
/**
 * Say we're typing, and what.
 *
 * Fire-and-forget: a dropped typing ping is a dropped typing ping, and making
 * the visitor's keystrokes wait on a round trip to tell somebody about them
 * would be a strange trade.
 */
export function pingTyping(token: string, preview: string): void {
  void fetch(`${base}/typing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ preview: preview.slice(0, TYPING_PREVIEW_MAX) }),
  }).catch(() => {});
}

/** The download URL for a file an agent sent. The token rides in the query
 *  because this goes into an `<a href>`, where a header cannot follow. */
export function attachmentUrl(token: string, attachmentId: string): string {
  return `${base}/media/${encodeURIComponent(attachmentId)}?token=${encodeURIComponent(token)}`;
}

export function streamUrl(token: string): string {
  return `${base}/stream?token=${encodeURIComponent(token)}`;
}
