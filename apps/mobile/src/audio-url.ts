import { needsPhoneAudio, type Attachment } from "@ding/schemas";

/**
 * Where to play a clip from. A browser's recording (WebM or Ogg Opus — what
 * Chrome and Firefox make) is fetched as the server's AAC copy: the iPhone's
 * player can't open either, and doesn't say so; it just never loads.
 */
export function playableUrl(att: Pick<Attachment, "url" | "mime">): string {
  if (!needsPhoneAudio(att.mime)) return att.url;
  return `${att.url}${att.url.includes("?") ? "&" : "?"}as=m4a`;
}
