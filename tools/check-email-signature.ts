/**
 * Email signatures — one design per email channel, filled in per sender.
 *
 *   A  rendering: the default layout, a missing position dropping its line
 *      (and its "·"), values escaped, unknown tags left alone, the marketing
 *      section underneath, a deliberately blank layout;
 *   B  a position: admins set anyone's, a person sets their own, an agent
 *      can't set somebody else's;
 *   C  the channel's design: only admins and managers save it, only on email,
 *      and it's sanitised;
 *   D  sending: the email carries the sending mailbox's signature with the
 *      sender's details — the default until one is designed, the design after,
 *      the other mailbox's on a reply that goes out from it — and nothing on a
 *      note or a WhatsApp reply.
 *
 *     pnpm check:email-signature
 */
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import { WorkspaceController } from "../apps/api/src/workspace/workspace.controller";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import {
  DEFAULT_SIGNATURE_LAYOUT,
  fillSignatureHtml,
  renderEmailSignature,
  signedAsLine,
  updateUserInputSchema,
  type SignatureContext,
} from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
}
/** Anything the code under test calls on a collaborator we don't care about. */
const inert = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
const text = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n").replace(/<[^>]*>/g, "").trim();

const NATHAN: SignatureContext = {
  agentName: "Nathan A",
  agentPosition: "Operations Manager",
  agentEmail: "nathan@swiftee.co.uk",
  teamName: "Support team",
  channelName: "Swiftee Support",
  channelEmail: "support@swiftee.co.uk",
};

async function main() {
  console.log("\nA — rendering\n");
  const def = renderEmailSignature(null, NATHAN);
  ok("the default is name, position, channel email", text(def) === "Nathan A\nOperations Manager\nsupport@swiftee.co.uk", text(def));
  const noPos = renderEmailSignature(null, { ...NATHAN, agentPosition: "" });
  ok("no position: the line goes, not left blank", text(noPos) === "Nathan A\nsupport@swiftee.co.uk", text(noPos));
  const sep = fillSignatureHtml("<p>{{agent.position}} · {{team.name}}</p>", { ...NATHAN, agentPosition: null });
  ok("a separator goes with its empty tag", text(sep) === "Support team", text(sep));
  const sep2 = fillSignatureHtml("<p>{{team.name}} | {{agent.position}}</p>", { ...NATHAN, agentPosition: null });
  ok("on either side", text(sep2) === "Support team", text(sep2));
  const both = fillSignatureHtml("<p>A</p><p>{{agent.position}} · {{team.name}}</p><p>B</p>", { agentName: "x" });
  ok("a line with nothing left is dropped whole", both === "<p>A</p><p>B</p>", both);
  // A logo, then a banner under it: the editor keeps each as a block, written
  // out as bare <img> tags — which a mail client would put side by side.
  const pics = renderEmailSignature(
    { layoutHtml: '<p>{{agent.name}}</p><img src="https://x/logo.png" width="120"><img src="https://x/banner.png">', footerHtml: null } as never,
    NATHAN,
  );
  ok("images on their own lines stay on their own lines", pics.includes('<div><img src="https://x/logo.png" width="120"></div><div><img src="https://x/banner.png"></div>'), pics);
  const icon = renderEmailSignature({ layoutHtml: '<p>Call <img src="https://x/phone.png" width="12"> us</p>', footerHtml: null } as never, NATHAN);
  ok("an icon inside a line of text stays in the line", icon === '<p>Call <img src="https://x/phone.png" width="12"> us</p>', icon);
  const esc = renderEmailSignature(null, { ...NATHAN, agentName: "<b>Eve</b> & Co" });
  ok("values are escaped, not markup", esc.includes("&lt;b&gt;Eve&lt;/b&gt; &amp; Co") && !esc.includes("<b>Eve"), esc);
  const unknown = fillSignatureHtml("<p>Ref {{order.number}}</p>", NATHAN);
  ok("a tag we don't know is left as written", unknown === "<p>Ref {{order.number}}</p>", unknown);
  const first = fillSignatureHtml("<p>Cheers, {{agent.first_name}}</p>", NATHAN);
  ok("first name", text(first) === "Cheers, Nathan", first);
  const withFooter = renderEmailSignature({ layoutHtml: null, footerHtml: "<p><img src=\"https://cdn.x/banner.png\"></p><p>Free delivery over £50</p>" }, NATHAN);
  ok("the marketing section goes underneath", withFooter.indexOf("Operations Manager") < withFooter.indexOf("banner.png") && withFooter.includes("Free delivery"), withFooter);
  ok("a picture-only line is kept", fillSignatureHtml("<p><img src=\"https://cdn.x/logo.png\"></p>", NATHAN).includes("logo.png"));
  ok("a blank layout means no name block", text(renderEmailSignature({ layoutHtml: "", footerHtml: "<p>Legal line</p>" }, NATHAN)) === "Legal line");
  ok("and nothing at all is nothing", renderEmailSignature({ layoutHtml: "", footerHtml: null }, NATHAN) === "");
  ok("the composer line", signedAsLine(NATHAN) === "Nathan A · Operations Manager" && signedAsLine({ agentName: "Amara" }) === "Amara");

  const store = new MemoryStore();
  const mailer = { sendInvite: async () => ({ sent: false }) } as never;
  const ws = new WorkspaceController(store, mailer, inert, { assertLive: async () => {}, twoFactorRequired: async () => false } as never);
  const convs = new ConversationsService(store, inert, inert, inert, inert, inert, inert);

  await runInTenant(ORG_ID, async () => {
    console.log("\nB — positions\n");
    await ws.updateUser(DEMO_USER_ID, "usr_amara", updateUserInputSchema.parse({ position: "  Sales Lead " }));
    ok("an admin sets someone's position", (await store.getUser("usr_amara"))?.position === "Sales Lead");
    ok("an agent can't set someone else's", (await status(ws.updateUser("usr_james", "usr_amara", { position: "CEO" }))) === 403);
    await ws.updateMyProfile("usr_james", { position: "Senior Support" });
    ok("a person sets their own", (await store.getUser("usr_james"))?.position === "Senior Support");
    await ws.updateMyProfile("usr_james", { position: "" });
    ok("blank clears it", (await store.getUser("usr_james"))?.position === null);
    ok("a position is kept short", !updateUserInputSchema.safeParse({ position: "x".repeat(81) }).success);
    const invited = await ws.createUser(DEMO_USER_ID, { name: "Priya", email: "priya@swiftee.co.uk", role: "agent", teamIds: [], position: "Account Manager" });
    ok("an invite can carry a position", invited.user.position === "Account Manager");

    console.log("\nC — the channel's design\n");
    const design = {
      layoutHtml: '<p><strong>{{agent.name}}</strong> · {{agent.position}}</p><p>Swiftee Logistics</p><script>alert(1)</script>',
      footerHtml: '<p><a href="https://swiftee.co.uk" onclick="x()">Free delivery over £50</a></p>',
    };
    ok("an agent can't change it", (await status(ws.setInboxSignature("usr_james", "inbox_support", design))) === 403);
    ok("only email channels have one", (await status(ws.setInboxSignature(DEMO_USER_ID, "inbox_wa", design))) === 400);
    const saved = await ws.setInboxSignature(DEMO_USER_ID, "inbox_support", design);
    ok("an admin saves it", !!saved.signature?.layoutHtml?.includes("{{agent.position}}"));
    ok("scripts and handlers are stripped", !saved.signature!.layoutHtml!.includes("script") && !saved.signature!.footerHtml!.includes("onclick"));
    ok("links are kept", saved.signature!.footerHtml!.includes('href="https://swiftee.co.uk"'));

    console.log("\nD — what goes out\n");
    const sigOf = async (messageId: string) => (await store.getOutboundMessage(messageId))?.deliveryMeta?.signatureHtml ?? "";
    const reply = await convs.sendMessage("conv_bloom", { body: "Thanks, sorted." } as never, DEMO_USER_ID);
    const sent = await sigOf(reply.id);
    ok("an email reply carries the channel's design, filled in", text(sent).startsWith("Nathan A · Operations Manager\nSwiftee Logistics"), text(sent));
    ok("with the marketing section", sent.includes("Free delivery over £50"));
    ok("nothing is added to the message shown in the app", reply.body === "Thanks, sorted.");
    const amara = await convs.sendMessage("conv_bloom", { body: "Following up." } as never, "usr_amara");
    ok("a different sender signs as themselves", text(await sigOf(amara.id)).startsWith("Amara · Sales Lead"), text(await sigOf(amara.id)));
    const james = await convs.sendMessage("conv_bloom", { body: "Me too." } as never, "usr_james");
    ok("no position, no dangling “·”", text(await sigOf(james.id)).startsWith("James\nSwiftee Logistics"), text(await sigOf(james.id)));
    const note = await convs.sendMessage("conv_bloom", { body: "internal", internal: true } as never, DEMO_USER_ID);
    ok("a note isn't signed", (await sigOf(note.id)) === "");
    const wa = await convs.sendMessage("conv_north", { body: "On WhatsApp" } as never, DEMO_USER_ID);
    ok("a WhatsApp reply isn't signed", (await sigOf(wa.id)) === "");
    // hello@ has never been designed: the default, with its own address.
    const tide = await store.getConversation("conv_tide");
    await store.setInboxSignature("inbox_hello", { layoutHtml: null, footerHtml: null });
    const helloConv = (
      await store.findOrCreateOpenConversation({ orgId: ORG_ID, inboxId: "inbox_hello", contact: tide!.contact, channel: "email", forceNew: true })
    ).conversation;
    const fromHello = await convs.sendMessage(helloConv.id, { body: "Hello!" } as never, DEMO_USER_ID);
    ok("an undesigned mailbox sends the default, with its own address", text(await sigOf(fromHello.id)) === "Nathan A\nOperations Manager\nhello@swiftee.co.uk", text(await sigOf(fromHello.id)));
    // A WhatsApp chat answered by email goes out from the email default — and signs as it.
    await store.setDefaultInbox("inbox_hello", true);
    const cross = await convs.sendMessage("conv_north", { body: "By email", channel: "email" } as never, DEMO_USER_ID);
    ok("a reply switched onto email signs as the mailbox it leaves from", text(await sigOf(cross.id)).endsWith("hello@swiftee.co.uk"), text(await sigOf(cross.id)));
    ok("the default layout is what an undesigned mailbox uses", DEFAULT_SIGNATURE_LAYOUT.includes("{{agent.position}}"));
  });

  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall email signature checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
