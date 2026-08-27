import { Platform } from "react-native";
import { File, UploadType } from "expo-file-system";
import type { UploadFile, UploadMeta } from "@ding/client";
import type { Attachment } from "@ding/schemas";
import { API_URL } from "./api-config";
import { sessionToken } from "./session";

/**
 * Post a file off this phone's disk, natively.
 *
 * Not through `fetch`, and that is the whole point. Two versions of this went
 * out through `fetch` and both failed on a real device:
 *
 *  - `FormData` + a `Blob`: React Native's networking layer refused the part.
 *  - `FormData` + `{ uri, name, type }` — the shape React Native's own FormData
 *    documents — failed with "Unsupported FormDataPart implementation". Expo
 *    replaces the global `fetch` with its own (`expo/src/winter/runtime.native`
 *    installs it unless `EXPO_PUBLIC_USE_RN_FETCH` is set), and that
 *    implementation assembles the multipart body in JavaScript from `Blob`s and
 *    objects with `.bytes()`. Its own source says it: *"`uri` is not supported
 *    for React Native's FormData."*
 *
 * So there is no FormData here at all. `expo-file-system` streams the file into
 * a multipart request from native code, which is both the version that works
 * and the version that doesn't read a 40MB video into JavaScript memory in
 * order to send it.
 *
 * The trade is that this is a second HTTP client — it doesn't go through the
 * shared `request()`, so the auth header and the base URL are applied here by
 * hand and the response is parsed here. That's why it lives next to the two
 * things it has to agree with (`API_URL`, `sessionToken`) rather than in
 * `@ding/client`, which has neither.
 */
export async function uploadFile(file: UploadFile, meta: UploadMeta): Promise<Attachment> {
  // The web export has no filesystem for `expo-file-system` to stream from, and
  // its `uri` is a `blob:` URL the browser can hand back. It isn't a shipped
  // surface — it exists so the app can be driven in a browser during
  // verification — but a path that only pretends to work is worse than none, so
  // it takes the browser's own route: fetch the bytes back, post them as
  // `FormData`. This is a platform test, and it is in the right place: an app
  // knows which platform it is, `@ding/client` does not.
  if (Platform.OS === "web") return uploadViaFormData(file, meta);

  if (!file.uri.startsWith("file://")) {
    // Every picker in the app is configured to copy into the cache first, so a
    // `content://` URI would mean one of them changed. Say so, rather than
    // failing somewhere further down with a message about bytes.
    throw new Error(`Can only upload a local file, got: ${file.uri.slice(0, 24)}…`);
  }

  // Everything the server reads besides the bytes travels as ordinary form
  // fields, which is what the browser path sends too — `media.controller.ts`
  // reads them with @Body().
  const parameters: Record<string, string> = {};
  // The multipart filename is the name on disk, which for a picked document is
  // a cache filename rather than "Purchase-Order-4471.pdf". The real one is
  // sent alongside and the server prefers it.
  if (meta.filename) parameters.filename = meta.filename;
  if (meta.kind) parameters.kind = meta.kind;
  if (meta.durationMs != null) parameters.durationMs = String(Math.round(meta.durationMs));
  if (meta.width != null) parameters.width = String(Math.round(meta.width));
  if (meta.height != null) parameters.height = String(Math.round(meta.height));
  if (meta.waveform) parameters.waveform = JSON.stringify(meta.waveform);

  const token = sessionToken();
  const res = await new File(file.uri).upload(`${API_URL}/api/media`, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.type,
    parameters,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  if (res.status < 200 || res.status >= 300) {
    // The API answers with `{ message }` on an error; show that when it's there,
    // because it's the difference between "Upload failed" and "File too large".
    let message: string | undefined;
    try {
      const body = JSON.parse(res.body) as { message?: string | string[] };
      message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    } catch {
      /* not JSON — the status is all we have */
    }
    throw new Error(message ?? `Upload failed: ${res.status}`);
  }

  return JSON.parse(res.body) as Attachment;
}

/**
 * The browser route, for the web export only.
 *
 * Deliberately a copy of what `@ding/client` does for a `File`, rather than a
 * call into it: reaching back into `api.uploadMedia` with a converted file
 * would work, but it makes a loop between two modules that are meant to sit on
 * either side of a seam, and this is a dozen lines.
 */
async function uploadViaFormData(file: UploadFile, meta: UploadMeta): Promise<Attachment> {
  const blob = await (await fetch(file.uri)).blob();
  const form = new FormData();
  form.append("file", blob, meta.filename ?? file.name);
  if (meta.filename) form.append("filename", meta.filename);
  if (meta.kind) form.append("kind", meta.kind);
  if (meta.durationMs != null) form.append("durationMs", String(Math.round(meta.durationMs)));
  if (meta.width != null) form.append("width", String(Math.round(meta.width)));
  if (meta.height != null) form.append("height", String(Math.round(meta.height)));
  if (meta.waveform) form.append("waveform", JSON.stringify(meta.waveform));

  const token = sessionToken();
  const res = await fetch(`${API_URL}/api/media`, {
    method: "POST",
    body: form,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(message ?? `Upload failed: ${res.status}`);
  }
  return (await res.json()) as Attachment;
}
