/**
 * A WhatsApp number that stays on the WhatsApp Business app (Meta's
 * "coexistence"), against simulated Meta events.
 *
 *   A  Connecting: the number Meta named is the one connected, unrouted, marked
 *      as on the app; its history is asked for; the API "register" step is refused.
 *   B  Messages sent from the phone land in the thread, labelled, once; they
 *      count as answering.
 *   C  History arrives newest first and is filed in date order, closed and read,
 *      once; a business that didn't share it is told so.
 *   D  The phone's contacts fill in names we only had numbers for, and leave
 *      names we have alone.
 *   E  Meta unlinking the number shows on the channel.
 *   F  A number Meta added as an ordinary API number, from the same card, is
 *      connected as one — registrable, nothing asked of the phone — and a
 *      channel wrongly taken for a Business app number is put right.
 *
 *     pnpm check:coexistence
 */
process.env.META_OAUTH_MOCK = "true";

import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { MemoryAccountStore } from "../apps/api/src/accounts/memory-account.store";
import { AccountsService } from "../apps/api/src/accounts/accounts.service";
import { RoutingService } from "../apps/api/src/channels/routing.service";
import { IngestService } from "../apps/api/src/channels/ingest.service";
import { WhatsAppService } from "../apps/api/src/channels/whatsapp/whatsapp.service";
import { MetaController } from "../apps/api/src/channels/meta/meta.controller";
import { MetaOAuthService } from "../apps/api/src/channels/meta/meta-oauth.service";
import { WhatsAppRegistrationService } from "../apps/api/src/whatsapp-management/whatsapp-registration.service";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import type { TenantContext } from "../apps/api/src/tenancy/tenant-context";
import type { PushService } from "../apps/api/src/push/push.service";
import type { ConversationSubjectService } from "../apps/api/src/ai/conversation-subject.service";
import type { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import type { GroupsService } from "../apps/api/src/channels/groups/groups.service";
import type { MediaService } from "../apps/api/src/storage/media.service";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function until(cond: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return cond();
}

const PNID = "100000000000002";
const WABA = "100000000000001";
const BIZ = "+44 20 8800 0000";
const change = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: WABA, changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: PNID, display_phone_number: BIZ }, ...value } }] }],
});
const ts = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));

async function main(): Promise<void> {
  const store = new MemoryStore();
  const accounts = new AccountsService(new MemoryAccountStore(), store);
  const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
  const ingest = new IngestService(
    store,
    new RoutingService(store, accounts),
    realtime,
    { bind() {}, orgId: ORG_ID } as unknown as TenantContext,
    { notify() {} } as unknown as PushService,
    { customerWrote() {}, fieldsChanged: async () => {} } as unknown as ConversationSubjectService,
  );
  const wa = new WhatsAppService(ingest, {} as GroupsService, store, realtime, {} as MediaService);
  const sandbox = { assertLive: async () => {}, current: async () => false } as unknown as SandboxPolicy;
  const oauth = new MetaOAuthService(store);
  const meta = new MetaController(oauth, store, sandbox);
  const registration = new WhatsAppRegistrationService(store);

  await runInTenant(ORG_ID, async () => {
    console.log("\nA — connecting\n");
    const res = await meta.connectCoexistence(DEMO_USER_ID, { code: "mock-code", wabaId: WABA, phoneNumberId: PNID });
    const inbox = (await store.listInboxes(ORG_ID)).find((i) => i.handle === PNID)!;
    const cfg = (await store.getInboxConfig(inbox.id))!;
    ok("the number Meta named is the one connected", res.handle === PNID && cfg.phoneNumberId === PNID && cfg.wabaId === WABA);
    ok("marked as on the Business app, linked", inbox.channelConfigPublic?.coexistence === "true" && inbox.channelConfigPublic?.coexistenceState === "connected");
    ok("unrouted until an admin chooses", inbox.teamIds.length === 0);
    ok("its contacts and history were asked for", res.sync.startsWith("requested"), res.sync);
    let refused = "";
    try {
      await registration.register(inbox.id, "123456");
    } catch (err) {
      refused = (err as Error).message;
    }
    ok("the API register step is refused for it", /must not be registered/.test(refused), refused);
    let agentRefused = false;
    try {
      await meta.connectCoexistence("usr_james", { code: "x", wabaId: WABA, phoneNumberId: PNID });
    } catch {
      agentRefused = true;
    }
    ok("an agent can't connect channels", agentRefused);

    console.log("\nB — messages sent from the phone\n");
    await wa.handleWebhook(change("messages", { contacts: [{ wa_id: "447700900111", profile: { name: "Ruth" } }], messages: [{ from: "447700900111", id: "wamid.in1", type: "text", text: { body: "Is my van booked?" }, timestamp: ts("2026-10-14T10:00:00Z") }] }) as never);
    const live = (await store.listConversations("inbox:" + inbox.id, DEMO_USER_ID)).items.find((c) => c.contact.displayName === "Ruth")!;
    ok("a customer's message arrives as normal", !!live && live.status === "open");
    await wa.handleWebhook(change("smb_message_echoes", { message_echoes: [{ from: "442088000000", to: "447700900111", id: "wamid.echo1", type: "text", text: { body: "Yes, 9am tomorrow" }, timestamp: ts("2026-10-14T10:01:00Z") }] }) as never);
    const thread = (await store.getConversation(live.id))!;
    const echo = thread.messages.at(-1)!;
    ok("the phone's reply is in the same thread", echo.body === "Yes, 9am tomorrow" && echo.direction === "out", echo.body);
    ok("labelled as sent from the app", echo.authorName === "WhatsApp Business app", echo.authorName);
    ok("and counts as answering", !thread.unread && !thread.slaDueAt, `unread=${thread.unread} sla=${thread.slaDueAt}`);
    await wa.handleWebhook(change("smb_message_echoes", { message_echoes: [{ from: "442088000000", to: "447700900111", id: "wamid.echo1", type: "text", text: { body: "Yes, 9am tomorrow" } }] }) as never);
    ok("Meta resending it adds nothing", (await store.getConversation(live.id))!.messages.filter((m) => m.channelMsgId === "wamid.echo1").length === 1);
    await wa.handleWebhook(change("smb_message_echoes", { message_echoes: [{ from: "442088000000", to: "447700900222", id: "wamid.echo2", type: "text", text: { body: "Hi Sam, your parcel is ready" } }] }) as never);
    const started = (await store.listConversations("inbox:" + inbox.id, DEMO_USER_ID)).items.find((c) => c.preview.includes("parcel is ready"));
    ok("a chat started from the phone appears on the channel", !!started && started.status === "open" && !started.assigneeUserId);

    console.log("\nC — history\n");
    // Newest first, as Meta sends it.
    await wa.handleWebhook(change("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 40 }, threads: [{ id: "447700900333", messages: [
      { from: "447700900333", id: "wamid.h3", type: "text", text: { body: "Thanks!" }, timestamp: ts("2026-10-01T12:00:00Z") },
      { from: "442088000000", id: "wamid.h2", type: "text", text: { body: "It's on its way" }, timestamp: ts("2026-10-01T11:00:00Z") },
    ] }] }] }) as never);
    await wa.handleWebhook(change("history", { history: [{ metadata: { phase: 1, chunk_order: 2, progress: 100 }, threads: [{ id: "447700900333", messages: [
      { from: "447700900333", id: "wamid.h1", type: "text", text: { body: "Where's my order?" }, timestamp: ts("2026-09-30T09:00:00Z") },
      { from: "447700900333", id: "wamid.h0", type: "text", text: { body: "Hello" }, timestamp: ts("2026-09-30T08:59:00Z") },
    ] }] }] }) as never);
    const histConv = () => store.listConversations("inbox:" + inbox.id, DEMO_USER_ID).then((p) => p.items.find((c) => c.contact.phone?.includes("447700900333") || c.contact.displayName === "447700900333"));
    await until(async () => ((await histConv()) ? (await store.getConversation((await histConv())!.id))!.messages.length === 4 : false));
    const hist = (await store.getConversation((await histConv())!.id))!;
    ok("all four messages, in date order", hist.messages.map((m) => m.body).join(" | ") === "Hello | Where's my order? | It's on its way | Thanks!", hist.messages.map((m) => m.body).join(" | "));
    ok("the business's own messages are outbound", hist.messages.find((m) => m.channelMsgId === "wamid.h2")?.direction === "out" && hist.messages.find((m) => m.channelMsgId === "wamid.h1")?.direction === "in");
    ok("closed and read — nobody's queue fills up", hist.status === "closed" && !hist.unread && !hist.assigneeUserId);
    ok("the channel says history is imported", await until(async () => !!(await store.getInboxConfig(inbox.id))?.coexistenceSync?.startsWith("history imported")), (await store.getInboxConfig(inbox.id))?.coexistenceSync);
    await wa.handleWebhook(change("history", { history: [{ metadata: { progress: 100 }, threads: [{ id: "447700900333", messages: [{ from: "447700900333", id: "wamid.h0", type: "text", text: { body: "Hello" }, timestamp: ts("2026-09-30T08:59:00Z") }] }] }] }) as never);
    await new Promise((r) => setTimeout(r, 100));
    ok("a batch sent twice adds nothing", (await store.getConversation(hist.id))!.messages.length === 4);
    await wa.handleWebhook(change("messages", { contacts: [{ wa_id: "447700900333" }], messages: [{ from: "447700900333", id: "wamid.new", type: "text", text: { body: "Another order please" } }] }) as never);
    const fresh = (await store.listConversations("inbox:" + inbox.id, DEMO_USER_ID)).items.filter((c) => c.preview === "Another order please");
    ok("a new message after the import opens a live conversation, not the closed history", fresh.length === 1 && fresh[0]!.id !== hist.id && fresh[0]!.status === "open");
    await wa.handleWebhook(change("history", { history: [{ errors: [{ code: 2593109, title: "History sharing is turned off by the business" }] }] }) as never);
    ok("a business that didn't share history is told so", await until(async () => !!(await store.getInboxConfig(inbox.id))?.coexistenceSync?.startsWith("history not shared")));

    console.log("\nD — the phone's contacts\n");
    const numberOnly = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "wa_id", value: "447700900444", displayName: "447700900444" });
    const named = await store.upsertContactByIdentity({ orgId: ORG_ID, kind: "wa_id", value: "447700900555", displayName: "Kim (accounts)" });
    await wa.handleWebhook(change("smb_app_state_sync", { state_sync: [
      { type: "contact", action: "add", contact: { full_name: "Lee Carter", phone_number: "447700900444" } },
      { type: "contact", action: "add", contact: { full_name: "Kimberly Holt", phone_number: "447700900555" } },
      { type: "contact", action: "add", contact: { full_name: "New Person", phone_number: "447700900666" } },
    ] }) as never);
    ok("a number-only customer takes the phone's name", (await store.getContact(numberOnly.id))?.displayName === "Lee Carter", (await store.getContact(numberOnly.id))?.displayName);
    ok("a name we already have is left alone", (await store.getContact(named.id))?.displayName === "Kim (accounts)");
    ok("a new contact is added with their name", (await store.listContacts()).some((c) => c.displayName === "New Person"));

    console.log("\nE — unlinked\n");
    await wa.handleWebhook({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }] } as never);
    ok("Meta unlinking it shows on the channel", (await store.getInboxConfig(inbox.id))?.coexistenceState === "disconnected");
    await meta.connectCoexistence(DEMO_USER_ID, { code: "mock-code", wabaId: WABA, phoneNumberId: PNID });
    ok("connecting again links it again, same channel", (await store.getInboxConfig(inbox.id))?.coexistenceState === "connected" && (await store.listInboxes(ORG_ID)).filter((i) => i.handle === PNID).length === 1);

    console.log("\nF — an ordinary API number from the same card\n");
    const PNID2 = "100000000000003";
    const flags = async (id: string) => {
      const c = await store.getInboxConfig(id);
      return { coexistence: c?.coexistence, state: c?.coexistenceState, sync: c?.coexistenceSync };
    };
    const plain = await meta.connectCoexistence(DEMO_USER_ID, { code: "mock-code", wabaId: WABA, phoneNumberId: PNID2, finishEvent: "FINISH" });
    const plainInbox = (await store.listInboxes(ORG_ID)).find((i) => i.handle === PNID2)!;
    ok("Meta finishing a plain sign-up connects it as an ordinary number", plain.coexistence === false);
    const f1 = await flags(plainInbox.id);
    ok("…not marked as on the Business app, nothing asked of the phone", f1.coexistence === "false" && !f1.state && !f1.sync, JSON.stringify(f1));
    let why = "";
    try {
      await registration.register(plainInbox.id, "123456");
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }
    ok("…and the register step isn't refused for it", !/must not be registered/.test(why), why);

    const linked = await meta.connectCoexistence(DEMO_USER_ID, {
      code: "mock-code",
      wabaId: WABA,
      phoneNumberId: PNID2,
      finishEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    });
    ok("connecting it again as a Business app number marks it so", linked.coexistence && (await flags(plainInbox.id)).coexistence === "true");

    // What production saw: the card, then Meta refusing the phone's data because
    // the number is an ordinary API one.
    const PROD = `Meta request smb_app_state_sync failed (400): {"error":{"message":"This API is only available to WhatsApp Business App phone numbers onboarded on to WhatsApp Business Platform","code":131000,"type":"OAuthException","error_subcode":10,"fbtrace_id":"x"}}`;
    ok("Meta's 'not a Business app number' refusal is recognised", MetaOAuthService.notBusinessAppNumber(new Error(PROD)));
    ok("…and a different failure isn't", !MetaOAuthService.notBusinessAppNumber(new Error(`Meta request history failed (400): {"error":{"code":100,"error_subcode":33}}`)));
    const realRequest = oauth.requestAppData.bind(oauth);
    oauth.requestAppData = async () => {
      throw new Error(PROD);
    };
    const repaired = await meta.connectCoexistence(DEMO_USER_ID, { code: "mock-code", wabaId: WABA, phoneNumberId: PNID2 });
    const f2 = await flags(plainInbox.id);
    ok("a channel taken for a Business app number is put right when Meta refuses", !repaired.coexistence && f2.coexistence === "false" && !f2.state && !f2.sync, JSON.stringify(f2));
    oauth.requestAppData = realRequest;

    const realAsk = oauth.onBusinessApp.bind(oauth);
    oauth.onBusinessApp = async () => false;
    const askedNo = await meta.connectCoexistence(DEMO_USER_ID, {
      code: "mock-code",
      wabaId: WABA,
      phoneNumberId: PNID2,
      finishEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    });
    ok("Meta saying it isn't on the app outranks the sign-up event", !askedNo.coexistence);
    oauth.onBusinessApp = async () => true;
    const askedYes = await meta.connectCoexistence(DEMO_USER_ID, { code: "mock-code", wabaId: WABA, phoneNumberId: PNID2, finishEvent: "FINISH" });
    ok("…and so does Meta saying it is", askedYes.coexistence && (await flags(plainInbox.id)).coexistence === "true");
    oauth.onBusinessApp = realAsk;
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
