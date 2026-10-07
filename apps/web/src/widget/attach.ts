import {
  NESTCHAT_MAX_ATTACHMENTS,
  NESTCHAT_MAX_UPLOAD_BYTES,
  nestchatAcceptsUpload,
  type NestChatAttachment,
} from "@ding/schemas";

/**
 * Files a visitor attaches, before they are sent.
 *
 * The server has the last word on all of this — it checks the type and the
 * size again on upload — but a file it would refuse is better turned away the
 * moment it is picked, with a sentence saying why, than after a 20 MB upload.
 */

/** What the file picker offers. The same list the server accepts, so the
 *  picker does not suggest a file that would then be refused; SVG is left out
 *  by the server and so it is here, though `image/*` would let it through the
 *  picker on some systems — `refusal` catches it. */
export const ATTACH_ACCEPT = "image/*,video/*,audio/*,application/pdf,text/plain";

/** A file waiting under the message box. */
export interface StagedFile {
  /** Local, for React and for removing it. */
  key: string;
  name: string;
  mime: string;
  size: number;
  /** A blob URL for an image, so the chip can show what it is. */
  preview?: string;
  /** Set once uploaded: the signed claim the message redeems. */
  ticket?: string;
  /** Set if the upload failed; such a file is not sent. */
  failed?: string;
}

/** Why a file cannot be attached, in a sentence — or nothing if it can. */
export function refusal(file: { type: string; size: number }): string | undefined {
  if (!file.size) return "That file is empty.";
  if (file.size > NESTCHAT_MAX_UPLOAD_BYTES) {
    return `That file is too large — ${Math.round(NESTCHAT_MAX_UPLOAD_BYTES / 1024 / 1024)} MB is the limit.`;
  }
  // No type at all is what a browser reports for an extension it does not
  // know. Nothing on the allowlist arrives like that.
  if (!file.type || !nestchatAcceptsUpload(file.type)) {
    return "That kind of file can’t be attached here. Photos, videos, audio, PDFs and text files can.";
  }
  return undefined;
}

/**
 * Which of the picked files to take, given how many are already waiting.
 *
 * The ones that can be attached, up to the limit, in the order they were
 * picked; and one sentence for everything turned away — the first reason, as
 * a list of five refusals is a wall nobody reads.
 */
export function admit<F extends { type: string; size: number }>(
  picked: F[],
  waiting: number,
): { take: F[]; notice?: string } {
  const room = Math.max(0, NESTCHAT_MAX_ATTACHMENTS - waiting);
  const take: F[] = [];
  let notice: string | undefined;
  for (const f of picked) {
    const why = refusal(f);
    if (why) {
      notice ??= why;
      continue;
    }
    if (take.length >= room) {
      notice ??= `You can attach up to ${NESTCHAT_MAX_ATTACHMENTS} files at a time.`;
      continue;
    }
    take.push(f);
  }
  return { take, ...(notice ? { notice } : {}) };
}

/** An image the bubble can draw inline rather than list as a file. */
export function isPicture(a: Pick<NestChatAttachment, "mime">): boolean {
  return a.mime.startsWith("image/") && !a.mime.includes("svg");
}

/** "2.4 MB", "830 KB" — the size on a chip. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The attachment as the message shows it before the server's copy arrives. */
export function optimisticAttachment(f: StagedFile, id: string): NestChatAttachment {
  const kind = f.mime.startsWith("image/")
    ? "image"
    : f.mime.startsWith("video/")
      ? "video"
      : f.mime.startsWith("audio/")
        ? "audio"
        : "document";
  return { id, filename: f.name, mime: f.mime, kind };
}
