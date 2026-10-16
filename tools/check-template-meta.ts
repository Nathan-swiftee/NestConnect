/**
 * Templates, per WhatsApp account, kept in step with Meta.
 *
 *   A  A new template on an account is submitted to Meta for approval there —
 *      with an example for each variable, as Meta requires — and kept only if
 *      Meta accepts it. Without an account it's kept here, linked to nothing.
 *   B  One linked to no account can be submitted to an account later.
 *   C  On an account, its wording is Meta's: only the pre-fill can be changed.
 *   D  Deleting one on an account deletes it at Meta too.
 *   E  Accounts are synced by themselves: when first seen, hourly after, and
 *      every ten minutes while a template waits on Meta's review.
 *   F  A number with an account can't send a template linked to no account.
 *
 * Nothing here reaches Meta: the Graph API is a fake that records each call.
 *
 *     pnpm check:template-meta
 */
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { DEMO_USER_ID, ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { TemplatesService } from "../apps/api/src/templates/templates.service";
import { ConversationsService } from "../apps/api/src/conversations/conversations.service";
import type { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import type { RealtimeGateway } from "../apps/api/src/realtime/realtime.gateway";
import { createTemplateInputSchema, templatesForWaba } from "../packages/schemas/src/index";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refusal(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return (err as { getStatus?: () => number }).getStatus?.() === 400 ? (err as Error).message : `unexpected: ${String(err)}`;
  }
}

const WABA = "waba_swiftee";
const notSandbox = { isSandbox: async () => false, current: async () => false, assertLive: async () => {} } as unknown as SandboxPolicy;

interface Call {
  method: string;
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** The service, with Meta replaced by a script of answers. */
class FakeMetaTemplates extends TemplatesService {
  calls: Call[] = [];
  answer: (c: Call) => { ok: boolean; status: number; json: Record<string, unknown> } = () => ({ ok: true, status: 200, json: {} });
  protected override async graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string, body?: unknown) {
    const call = { method, path, token, body: body as Record<string, unknown> | undefined };
    this.calls.push(call);
    return this.answer(call) as unknown as { ok: boolean; status: number; json: T };
  }
}

async function main(): Promise<void> {
  const store = new MemoryStore();
  const svc = new FakeMetaTemplates(store, notSandbox);
  const parse = (v: unknown) => createTemplateInputSchema.parse(v);

  await runInTenant(ORG_ID, async () => {
    // The demo's WhatsApp number, on a real account.
    await store.updateInbox("inbox_wa", { channelConfig: { wabaId: WABA, accessToken: "tok_swiftee", phoneNumberId: "pn_1" } });

    console.log("\nA — a new template goes to Meta for approval\n");
    svc.answer = (c) =>
      c.method === "POST" ? { ok: true, status: 200, json: { id: "meta_1", status: "PENDING", category: "UTILITY" } } : { ok: true, status: 200, json: {} };
    const made = await svc.create(
      parse({
        name: "delivery_update",
        category: "utility",
        language: "en_GB",
        body: "Hi {{1}}, your delivery {{2}} is out today. — {{3}}",
        variableDefaults: ["{{contact.first_name}}", "", "{{agent.name}}"],
        wabaId: WABA,
      }),
    );
    const post = svc.calls.find((c) => c.method === "POST");
    ok("it's sent to Meta, on that account, with the account's token", post?.path === `${WABA}/message_templates` && post.token === "tok_swiftee", post?.path);
    ok("as Meta wants it: name, language, category in capitals", post?.body?.name === "delivery_update" && post.body.language === "en_GB" && post.body.category === "UTILITY");
    const body = (post?.body?.components as Array<Record<string, unknown>>)?.[0];
    ok("the body, with an example of each variable", body?.type === "BODY" && JSON.stringify(body.example) === JSON.stringify({ body_text: [["Alex", "example 2", "Sam Jones"]] }), JSON.stringify(body?.example));
    ok("it's kept on that account, waiting for review", made.wabaId === WABA && made.approvalStatus === "pending");
    ok("with our pre-fill kept", JSON.stringify(made.variableDefaults) === JSON.stringify(["{{contact.first_name}}", "", "{{agent.name}}"]));
    ok("the number on that account is offered it", templatesForWaba(await svc.list(), WABA).some((t) => t.id === made.id));

    svc.answer = () => ({ ok: false, status: 400, json: { error: { message: "Invalid parameter", error_user_msg: "Variables can't be at the start or end of the template." } } });
    const before = (await store.listTemplates(ORG_ID)).length;
    const why = await refusal(svc.create(parse({ name: "bad_one", body: "{{1}}", wabaId: WABA })));
    ok("Meta refusing it says why, in Meta's words", !!why && why.includes("Variables can't be at the start or end"), why ?? "");
    ok("…and nothing is kept", (await store.listTemplates(ORG_ID)).length === before);
    ok("an account this workspace doesn't have is refused", !!(await refusal(svc.create(parse({ name: "x_y", body: "Hi", wabaId: "waba_someone_else" })))));

    const local = await svc.create(parse({ name: "draft_idea", body: "Hello {{1}}, thanks for your order." }));
    ok("without an account it's kept here, linked to nothing", !local.wabaId);
    ok("…and a number with an account isn't offered it", !templatesForWaba(await svc.list(), WABA).some((t) => t.id === local.id));

    console.log("\nB — submitting one that's linked to nothing\n");
    svc.calls = [];
    svc.answer = (c) => (c.method === "POST" ? { ok: true, status: 200, json: { id: "meta_2", status: "PENDING" } } : { ok: true, status: 200, json: {} });
    const submitted = await svc.submit(local.id, WABA);
    ok("it's sent to Meta on that account", svc.calls.some((c) => c.method === "POST" && c.body?.name === "draft_idea"));
    ok("the same template, now on the account", submitted.id === local.id && submitted.wabaId === WABA && submitted.approvalStatus === "pending");
    ok("one already on an account can't be submitted again", !!(await refusal(svc.submit(local.id, WABA))));

    console.log("\nC — on an account, the wording is Meta's\n");
    ok("changing the wording is refused", !!(await refusal(svc.update(made.id, { body: "Something else {{1}}" }))));
    ok("…as is renaming it", !!(await refusal(svc.update(made.id, { name: "renamed" }))));
    const prefilled = await svc.update(made.id, { variableDefaults: ["{{contact.name}}", "today", ""] });
    ok("the pre-fill can still be changed", prefilled.variableDefaults[1] === "today");
    const same = await svc.update(made.id, { name: made.name, body: made.body, variableDefaults: ["", "", ""] });
    ok("a save that leaves the wording alone is fine", same.body === made.body);

    console.log("\nD — deleting one on an account deletes it at Meta\n");
    svc.calls = [];
    svc.answer = (c) =>
      c.method === "GET"
        ? { ok: true, status: 200, json: { data: [{ id: "meta_en", name: "delivery_update", language: "en_US" }, { id: "meta_gb", name: "delivery_update", language: "en_GB" }] } }
        : { ok: true, status: 200, json: { success: true } };
    await svc.remove(made.id);
    const del = svc.calls.find((c) => c.method === "DELETE");
    ok("just that language is deleted at Meta", del?.path === `${WABA}/message_templates?hsm_id=meta_gb&name=delivery_update`, del?.path);
    ok("and here", !(await store.getTemplate(made.id)));

    svc.answer = (c) =>
      c.method === "GET" ? { ok: true, status: 200, json: { data: [{ id: "meta_2", name: "draft_idea", language: "en" }] } } : { ok: false, status: 400, json: { error: { message: "Permissions error" } } };
    ok("Meta refusing the delete keeps it here, and says so", !!(await refusal(svc.remove(submitted.id))) && !!(await store.getTemplate(submitted.id)));
    svc.answer = () => ({ ok: true, status: 200, json: { data: [] } });
    await svc.remove(submitted.id);
    ok("one Meta no longer has is simply removed here", !(await store.getTemplate(submitted.id)));

    console.log("\nE — keeping up with Meta by itself\n");
    svc.calls = [];
    svc.answer = (c) =>
      c.method === "GET"
        ? { ok: true, status: 200, json: { data: [{ id: "m9", name: "welcome", language: "en", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "Welcome {{1}}" }] }] } }
        : { ok: true, status: 200, json: {} };
    const t0 = new Date();
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    await store.setAppSetting(ORG_ID, `wa_templates_synced_at:${WABA}`, "");
    ok("an account never synced is synced", (await svc.syncDue(t0)) === 1 && svc.calls.some((c) => c.method === "GET" && c.path.startsWith(`${WABA}/message_templates`)));
    ok("…which brings in what's at Meta", (await store.listTemplates(ORG_ID)).some((t) => t.name === "welcome" && t.wabaId === WABA));
    ok("not again straight away", (await svc.syncDue(at(1))) === 0);
    ok("every ten minutes while one waits on review", (await svc.syncDue(at(11))) === 1);
    svc.answer = (c) =>
      c.method === "GET"
        ? { ok: true, status: 200, json: { data: [{ id: "m9", name: "welcome", language: "en", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Welcome {{1}}" }] }] } }
        : { ok: true, status: 200, json: {} };
    await store.setAppSetting(ORG_ID, `wa_templates_synced_at:${WABA}`, at(11).toISOString());
    ok("…so the approval comes through", (await svc.syncDue(at(22))) === 1 && (await store.listTemplates(ORG_ID)).find((t) => t.name === "welcome")?.approvalStatus === "approved");
    await store.setAppSetting(ORG_ID, `wa_templates_synced_at:${WABA}`, at(22).toISOString());
    ok("with nothing waiting, not before the hour", (await svc.syncDue(at(52))) === 0);
    ok("then hourly", (await svc.syncDue(at(83))) === 1);

    console.log("\nF — a number can't send a template linked to no account\n");
    const inert = new Proxy({}, { get: () => async () => {} }) as never;
    const realtime = new Proxy({}, { get: () => () => {} }) as unknown as RealtimeGateway;
    const convs = new ConversationsService(store, realtime, inert, { enqueueDelivery: async () => {} } as never, inert, { notify() {} } as never, inert);
    const unlinked = (await store.listTemplates(ORG_ID)).find((t) => !t.wabaId && t.name === "welcome_back")!;
    const refused = await refusal(convs.sendMessage("conv_harbour", { body: "", template: { id: unlinked.id, params: ["Marta"] } } as never, DEMO_USER_ID));
    ok("refused, saying how to fix it", !!refused && /isn't on this number's WhatsApp account/.test(refused), refused ?? "");
    const own = (await store.listTemplates(ORG_ID)).find((t) => t.name === "welcome" && t.wabaId === WABA)!;
    const sent = await refusal(convs.sendMessage("conv_harbour", { body: "", template: { id: own.id, params: ["Marta"] } } as never, DEMO_USER_ID));
    ok("its own account's template goes", sent === null, sent ?? "");
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
