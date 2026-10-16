/**
 * Reactions, the way WhatsApp and Gmail do them.
 *
 *   A  A customer reacting to one of our messages tells whoever the
 *      conversation is for: "Reacted ❤️ to: “…”". Not for taking a reaction
 *      off, and not for a reaction to their own message.
 *   B  Reacting to a customer's email sends Gmail's reaction: a reply to that
 *      exact email, with the emoji in Gmail's reaction part and a short note
 *      for every other mail app. Taking it off sends nothing.
 *   C  A reaction coming back from Gmail lands on the email it answers instead
 *      of arriving as a new message, from Gmail sync and from hosted inboxes.
 *
 *     pnpm check:reactions
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { ChannelDispatcher } from "../apps/api/src/channels/channel-dispatcher";
import { ChannelProvider } from "../apps/api/src/channels/channel-provider";
import { EmailService } from "../apps/api/src/channels/email/email.service";
import { reactionFallback } from "../apps/api/src/channels/email/email.provider";
import { buildMime, extractReaction, GMAIL_REACTION_MIME, parseReactionJson } from "../apps/api/src/channels/google/gmail-api";
import { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushRequest, PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";
import type { MediaService } from "../apps/api/src/storage/media.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Collects what a provider was asked to react with. */
class FakeEmailProvider extends ChannelProvider {
  readonly reactions: Array<Parameters<NonNullable<ChannelProvider["sendReaction"]>>[0]> = [];
  supports(channel: string) {
    return channel === "email";
  }
  async sendText() {
    return { ok: true as const, channelMsgId: "x" };
  }
  async sendReaction(params: Parameters<NonNullable<ChannelProvider["sendReaction"]>>[0]) {
    this.reactions.push(params);
  }
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const accounts = new AccountsService(new MemoryAccountStore(), store);
  const pushes: PushRequest[] = [];
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const ingest = new IngestService(
    store,
    new RoutingService(store, accounts),
    realtime,
    { bind() {}, orgId: ORG_ID } as unknown as TenantContext,
    { notify: (r: PushRequest) => pushes.push(r) } as unknown as PushService,
    { customerWrote() {}, fieldsChanged: async () => {} } as unknown as ConversationSubjectService,
  );
  const provider = new FakeEmailProvider();
  const dispatcher = new ChannelDispatcher([provider], store, {} as MediaService, new SandboxPolicy(store));

  await runInTenant(ORG_ID, async () => {
    const conv = (await store.getConversation("conv_bloom"))!;
    const theirs = conv.messages.find((m) => m.direction === "in")!;
    const ours = conv.messages.find((m) => m.direction === "out")!;
    await store.setMessageChannelId(theirs.id, "<po-2288@bloomflorists.co.uk>");
    await store.setMessageChannelId(ours.id, "<ding.conv_bloom.1@swiftee.co.uk>");

    console.log("\nA — telling us a customer reacted\n");
    await ingest.customerReacted(conv.id, ours.id, "❤️");
    ok("a reaction to our message is pushed", pushes.length >= 1, JSON.stringify(pushes));
    const p = pushes[0];
    ok("to the assignee, as a message from the customer", p?.userIds.includes(DEMO_USER_ID) === true && p.kind === "message" && p.conversationId === conv.id);
    ok("saying what they reacted with, and to what", p?.title === conv.contact.displayName && /^Reacted ❤️ to: “Got it, thank you!/.test(p?.body ?? ""), p?.body);
    pushes.length = 0;
    await ingest.customerReacted(conv.id, ours.id, "");
    ok("taking a reaction off says nothing", pushes.length === 0);
    await ingest.customerReacted(conv.id, theirs.id, "👍");
    ok("nor does a reaction to their own message", pushes.length === 0);

    console.log("\nB — reacting to a customer's email\n");
    const fresh = (await store.getConversation(conv.id))!;
    const target = fresh.messages.find((m) => m.id === theirs.id)!;
    await dispatcher.sendEmailReaction(fresh, target, "👍", "Nathan A");
    const r = provider.reactions[0];
    ok("the email provider is asked to send it", provider.reactions.length === 1);
    ok("to the customer", r?.to === fresh.contact.email, r?.to);
    ok("as a reply to that exact email", r?.context?.inReplyTo === "<po-2288@bloomflorists.co.uk>" && r?.channelMsgId === "<po-2288@bloomflorists.co.uk>");
    ok("with who reacted, and the emoji", r?.reactorName === "Nathan A" && r?.emoji === "👍");
    await dispatcher.sendEmailReaction(fresh, target, "", "Nathan A");
    ok("taking it off sends nothing", provider.reactions.length === 1);

    const raw = Buffer.from(
      buildMime({
        from: "support@swiftee.co.uk",
        to: "hello@bloomflorists.co.uk",
        subject: "Re: Weekly stem order",
        body: reactionFallback("👍", "Nathan A").text,
        html: reactionFallback("👍", "Nathan A").html,
        messageId: "<r1@swiftee.co.uk>",
        inReplyTo: "<po-2288@bloomflorists.co.uk>",
        references: "<po-2288@bloomflorists.co.uk>",
        reaction: { emoji: "👍" },
      }),
      "base64url",
    ).toString("utf8");
    ok("the email is a reply (In-Reply-To the original)", raw.includes("In-Reply-To: <po-2288@bloomflorists.co.uk>"));
    ok("its alternatives include Gmail's reaction part", raw.includes("multipart/alternative") && raw.includes(`Content-Type: ${GMAIL_REACTION_MIME}`));
    const encoded = raw.split(`Content-Type: ${GMAIL_REACTION_MIME}; charset="UTF-8"`)[1]!.split("\r\n\r\n")[1]!.split("\r\n--")[0]!;
    ok("…carrying {emoji, version: 1}", Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8") === '{"emoji":"👍","version":1}');
    ok("and the fallback says who reacted", raw.includes("text/plain") && reactionFallback("👍", "Nathan A").text === "👍 Nathan A reacted to your email");

    console.log("\nC — a reaction coming back from Gmail\n");
    const gmailReaction = {
      id: "g1",
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("❤️ Bloom reacted via Gmail").toString("base64url") } },
          { mimeType: GMAIL_REACTION_MIME, body: { data: Buffer.from('{"emoji":"❤️","version":1}').toString("base64url") } },
        ],
      },
    };
    ok("Gmail's reaction part is read", extractReaction(gmailReaction) === "❤️");
    ok("an ordinary email isn't a reaction", extractReaction({ id: "g2", payload: { mimeType: "text/plain", body: { data: "aGk" } } }) === undefined);
    ok("nonsense in the part is ignored", parseReactionJson("{nope") === undefined && parseReactionJson('{"emoji":""}') === undefined);

    const before = (await store.getConversation(conv.id))!.messages.length;
    pushes.length = 0;
    const landed = await ingest.ingestEmailReaction({ inReplyTo: "<ding.conv_bloom.1@swiftee.co.uk>", emoji: "❤️", by: "contact" });
    const after = (await store.getConversation(conv.id))!;
    ok("it lands on the email it answers", landed && JSON.stringify(after.messages.find((m) => m.id === ours.id)?.reactions ?? {}).includes("❤️"), JSON.stringify(after.messages.find((m) => m.id === ours.id)?.reactions));
    ok("…without adding a message", after.messages.length === before);
    ok("…and we're told", pushes.some((x) => /Reacted ❤️/.test(x.body)));
    ok("an answer to an email we don't have is filed normally instead", !(await ingest.ingestEmailReaction({ inReplyTo: "<unknown@x>", emoji: "❤️", by: "contact" })));

    const email = new EmailService(ingest);
    const res = await email.handleWebhook({
      From: "Bloom Florists <hello@bloomflorists.co.uk>",
      To: "support@swiftee.co.uk",
      Subject: "Re: Weekly stem order",
      TextBody: "👍 Bloom reacted via Gmail",
      Headers: [{ Name: "In-Reply-To", Value: "<ding.conv_bloom.1@swiftee.co.uk>" }],
      Attachments: [{ Name: "", ContentType: `${GMAIL_REACTION_MIME}; charset=UTF-8`, Content: Buffer.from('{"emoji":"👍","version":1}').toString("base64") }],
    });
    const viaHosted = (await store.getConversation(conv.id))!;
    ok("a hosted inbox reads it too", res.handled === 1 && viaHosted.messages.length === before && JSON.stringify(viaHosted.messages.find((m) => m.id === ours.id)?.reactions ?? {}).includes("👍"));
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
