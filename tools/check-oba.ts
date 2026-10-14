/**
 * WhatsApp's Official Business Account (the verified badge), against a
 * stand-in for Meta's Graph API.
 *
 *   A  Status: the field asked for, Meta's oba_status read through, "nothing on
 *      file" read as not started, Meta's explanation kept.
 *   B  Applying: the fields Meta reviews, under Meta's names; what isn't given
 *      isn't sent; the status is read again after.
 *   C  Meta saying no reaches the admin in Meta's words; bad input never leaves.
 *
 *     pnpm check:oba
 */
import { BadGatewayException } from "@nestjs/common";
import { MemoryStore } from "../apps/api/src/data/memory.store";
import { ORG_ID } from "../apps/api/src/data/fixtures";
import { runInTenant } from "../apps/api/src/tenancy/tenant-scope";
import { BusinessProfileService } from "../apps/api/src/whatsapp-management/business-profile.service";
import type { SandboxPolicy } from "../apps/api/src/tenancy/sandbox";
import { requestWhatsAppObaInputSchema } from "../packages/schemas/src";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

type Call = { url: string; method: string; body?: Record<string, unknown>; auth?: string };
const calls: Call[] = [];
let reply: (c: Call) => { status: number; json: unknown } = () => ({ status: 200, json: {} });
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const c: Call = {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    auth: headers.authorization,
  };
  calls.push(c);
  const r = reply(c);
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main(): Promise<void> {
  const store = new MemoryStore();
  const sandbox = { assertLive: async () => {} } as unknown as SandboxPolicy;
  const svc = new BusinessProfileService(store, sandbox);

  await runInTenant(ORG_ID, async () => {
    const wa = (await store.listInboxes(ORG_ID)).find((i) => i.type === "whatsapp")!;
    await store.updateInbox(wa.id, { channelConfig: { phoneNumberId: "106540352242922", accessToken: "EAAtest" } });

    console.log("\nA — status\n");
    reply = () => ({ status: 200, json: { official_business_account: { oba_status: "PENDING", status_message: "Under review" }, id: "106540352242922" } });
    calls.length = 0;
    const pending = await svc.obaStatus(wa.id);
    ok("asks for the number's official_business_account", /\/106540352242922\?fields=official_business_account$/.test(calls[0]?.url ?? ""), calls[0]?.url);
    ok("with the number's own token", calls[0]?.auth === "Bearer EAAtest");
    ok("reads Meta's status and message", pending.status === "PENDING" && pending.message === "Under review", JSON.stringify(pending));
    reply = () => ({ status: 200, json: { id: "106540352242922" } });
    ok("nothing on file reads as not started", (await svc.obaStatus(wa.id)).status === "NOT_STARTED");
    reply = () => ({ status: 200, json: { official_business_account: { oba_status: "SOMETHING_NEW" } } });
    ok("a status Meta adds later still shows", (await svc.obaStatus(wa.id)).status === "SOMETHING_NEW");

    console.log("\nB — applying\n");
    calls.length = 0;
    reply = (c) => (c.method === "POST" ? { status: 200, json: { success: true } } : { status: 200, json: { official_business_account: { oba_status: "PENDING" } } });
    const input = requestWhatsAppObaInputSchema.parse({
      businessWebsiteUrl: "https://swiftee.co.uk",
      primaryCountryOfOperation: "United Kingdom",
      primaryLanguage: "English",
      supportingLinks: ["https://www.bbc.co.uk/news/swiftee"],
    });
    const after = await svc.requestOba(wa.id, input);
    const post = calls.find((c) => c.method === "POST");
    ok("posts to the number's official_business_account", /\/106540352242922\/official_business_account$/.test(post?.url ?? ""), post?.url);
    ok("with Meta's field names", JSON.stringify(post?.body) === JSON.stringify({
      business_website_url: "https://swiftee.co.uk",
      primary_country_of_operation: "United Kingdom",
      primary_language: "English",
      supporting_links: ["https://www.bbc.co.uk/news/swiftee"],
    }), JSON.stringify(post?.body));
    ok("leaving out what wasn't given", !("parent_business_or_brand" in (post?.body ?? {})) && !("additional_supporting_information" in (post?.body ?? {})));
    ok("then reads the status again", after.status === "PENDING" && calls.at(-1)?.method === "GET");

    console.log("\nC — when it can't go\n");
    reply = (c) => (c.method === "POST" ? { status: 400, json: { error: { message: "Two-step verification must be enabled", code: 100 } } } : { status: 200, json: {} });
    let said = "";
    try {
      await svc.requestOba(wa.id, input);
    } catch (err) {
      if (err instanceof BadGatewayException) said = err.message;
    }
    ok("Meta's refusal reaches the admin", /Two-step verification/.test(said), said);
    ok("a website that isn't one is refused here", !requestWhatsAppObaInputSchema.safeParse({ ...input, businessWebsiteUrl: "swiftee" }).success);
    ok("as are six supporting links", !requestWhatsAppObaInputSchema.safeParse({ ...input, supportingLinks: Array.from({ length: 6 }, (_, i) => `https://x.com/${i}`) }).success);
    const other = await store.createInbox({ orgId: ORG_ID, type: "email", name: "Mail", handle: "m@x.com", teamIds: ["team_support"], routingStrategy: "manual" });
    let refused = false;
    try {
      await svc.obaStatus(other.id);
    } catch {
      refused = true;
    }
    ok("an email channel has no badge to ask about", refused);
  });

  console.log(failed ? `\n${failed} failed` : "\nall good");
  process.exit(failed ? 1 : 0);
}

void main();
