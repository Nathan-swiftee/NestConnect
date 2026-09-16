/**
 * Files from strangers.
 *
 * Until now a customer could only send words. A food-delivery chat is mostly
 * about a photograph — this is what turned up, this is what the driver left at
 * the door — so the pictures matter more than the sentence attached to them.
 *
 * But this is an endpoint that takes files from people who have not signed in
 * to anything, stores them, and serves them back from our own domain. The
 * question for any given type is therefore not "is it dangerous" but "is there
 * a reason to accept it": a photo of a wrong order, yes; an installer, no, and
 * every reason not to become the place somebody hosts one.
 *
 * The rules:
 *
 *   1. An allowlist decides what may be uploaded, not a list of what may not.
 *   2. A ticket belongs to the customer it was issued to, and to nobody else.
 *   3. A forged, expired or borrowed ticket is dropped, not honoured.
 *   4. The file's own details ride inside the ticket, so a client cannot rename
 *      or re-type a file between uploading it and attaching it.
 *
 *     pnpm check:visitor-uploads
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { NestChatService } from "../apps/api/src/channels/nestchat/nestchat.service";
import { VisitorBus } from "../apps/api/src/channels/nestchat/visitor-bus";
import type { AttachmentInput } from "../apps/api/src/data/store";
import {
  nestchatAcceptsUpload,
  NESTCHAT_MAX_ATTACHMENTS,
  NESTCHAT_MAX_UPLOAD_BYTES,
  nestchatSendInputSchema,
} from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const file = (over: Partial<AttachmentInput> = {}): AttachmentInput => ({
  storageKey: "k/abc.jpg", kind: "image", mime: "image/jpeg", size: 1024,
  filename: "curry.jpg", ...over,
});

async function main(): Promise<void> {
  const nestchat = new NestChatService(new MemoryStore(), new VisitorBus());

  console.log("\nWhat may be uploaded\n");
  for (const mime of ["image/jpeg", "image/png", "image/heic", "video/mp4", "audio/mpeg", "application/pdf", "text/plain"]) {
    ok(`${mime} is accepted`, nestchatAcceptsUpload(mime));
  }
  // None of these has a reason to arrive in a support chat, and every one of
  // them has a reason not to be served from our domain.
  for (const mime of [
    "application/x-msdownload",
    "application/vnd.microsoft.portable-executable",
    "application/zip",
    "application/x-sh",
    "text/html",
    "image/svg+xml",
    "application/octet-stream",
  ]) {
    ok(`${mime} is refused`, !nestchatAcceptsUpload(mime));
  }
  // text/html and SVG in particular: both are documents a browser will execute
  // script from, and both would otherwise pass a naive "is it text or an image"
  // test.
  ok("case and padding don't get round it", !nestchatAcceptsUpload("  TEXT/HTML  "));

  console.log("\nA ticket belongs to one customer\n");
  const mine = nestchat.signAttachmentTicket("con_me", file());
  ok("mine redeems", nestchat.redeemAttachmentTickets("con_me", [mine]).length === 1);
  // The attack this exists to stop: lift a ticket, attach somebody else's file
  // to your own conversation.
  ok("somebody else's does not", nestchat.redeemAttachmentTickets("con_you", [mine]).length === 0);
  ok("nor does a forgery", nestchat.redeemAttachmentTickets("con_me", ["not.a.ticket"]).length === 0);
  ok(
    "and a bad one doesn't take the good one with it",
    nestchat.redeemAttachmentTickets("con_me", ["rubbish", mine]).length === 1,
  );

  console.log("\nThe file is what the server said it was\n");
  const redeemed = nestchat.redeemAttachmentTickets("con_me", [mine])[0]!;
  ok("the storage key survives", redeemed.storageKey === "k/abc.jpg");
  ok("and so do the type and size", redeemed.mime === "image/jpeg" && redeemed.size === 1024);
  // The details travel inside the signature, so there is nothing for a client
  // to edit on the way — a raw id plus a client-supplied filename would have
  // let somebody call an image "invoice.pdf".
  const tampered = mine.slice(0, -4) + "aaaa";
  ok("a tampered ticket is worthless", nestchat.redeemAttachmentTickets("con_me", [tampered]).length === 0);

  console.log("\nWhat a message may carry\n");
  const photoOnly = nestchatSendInputSchema.safeParse({ attachments: [mine] });
  // A photo on its own is a complete message. Demanding a caption for it turns
  // a chat into a form.
  ok("a photo with no words is a message", photoOnly.success && photoOnly.data.body === "");
  const wordsOnly = nestchatSendInputSchema.safeParse({ body: "where is it?" });
  ok("and words with no photo still are", wordsOnly.success && wordsOnly.data.attachments.length === 0);
  const tooMany = nestchatSendInputSchema.safeParse({
    body: "", attachments: Array(NESTCHAT_MAX_ATTACHMENTS + 1).fill(mine),
  });
  ok("too many at once is refused", !tooMany.success);
  ok("the size cap is well under an agent's", NESTCHAT_MAX_UPLOAD_BYTES <= 25 * 1024 * 1024);

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
