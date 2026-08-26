import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Attachment } from "@ding/schemas";
import { API_URL } from "./api-config";
import { sessionToken } from "./session";

/**
 * Hand an attachment to the rest of the phone.
 *
 * The naive version of this was `Linking.openURL(mediaUrl)`, and it could never
 * have worked: `/api/media/:id` sits behind the session guard, and a URL passed
 * to the OS is opened by some other app with no session of its own. The user
 * got a browser tab showing 401 — for photos, videos, PDFs, everything.
 *
 * A URL can't carry the credential, so a file does. This downloads it with the
 * bearer header attached, into the app's own cache, and shares the local copy.
 * The share sheet is the right destination anyway: "open in", "save to Files",
 * "send to WhatsApp" and print are all one gesture from there, rather than
 * being four separate things the app would have to implement.
 *
 * Returns `null` on success, or a sentence to show the agent. Never throws —
 * every failure here is a thing that happened to a file, not a bug in a caller.
 */
export async function saveAttachment(att: Attachment): Promise<string | null> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return "This phone has nowhere to send the file to.";
    }

    const url = /^https?:\/\//.test(att.url)
      ? att.url
      : `${API_URL}${att.url.startsWith("/") ? "" : "/"}${att.url}`;
    const token = sessionToken();

    // Its own directory under the cache, named for the attachment, so two files
    // called "invoice.pdf" from different customers don't collide and the OS is
    // free to reclaim the lot when storage runs short.
    const dir = new Directory(Paths.cache, `attachments/${att.id}`);
    if (!dir.exists) dir.create({ intermediates: true });

    const name = safeName(att.filename) || `${att.kind}-${att.id}`;
    const file = await File.downloadFileAsync(url, new File(dir, name), {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      // Re-opening the same attachment shouldn't fail on the copy it left
      // behind last time.
      idempotent: true,
    });

    await Sharing.shareAsync(file.uri, {
      mimeType: att.mime || undefined,
      // iOS wants a UTI and falls back gracefully to the MIME type when the one
      // it's given isn't a real UTI, which is why passing the MIME here is safe.
      UTI: att.mime || undefined,
      dialogTitle: att.filename || "Attachment",
    });
    return null;
  } catch (err) {
    return err instanceof Error && err.message ? err.message : "Couldn't open that file.";
  }
}

/** A filename the filesystem will accept, keeping the extension so the OS can
 *  still tell what the file is. */
function safeName(name?: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ]+/g, "_").trim().slice(0, 120);
}
