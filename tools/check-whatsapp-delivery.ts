/**
 * What a failed WhatsApp message tells the person reading the conversation.
 *
 * This exists because of a real hour spent in a log file. A template to a
 * customer sat on one tick; Meta had told us over the webhook exactly what was
 * wrong — the WhatsApp Business account had no currency configured, with a link
 * to the page that fixes it — and we logged that and dropped it. The thread
 * said "Not delivered". The only way to learn the actual answer was to open the
 * server logs, which is not something an agent can do mid-conversation.
 *
 * So the rules being pinned down here are about honesty and readability, and
 * both fail quietly if broken: a wrong reason is worse than no reason, because
 * somebody will act on it.
 *
 *     pnpm check:whatsapp-delivery
 */
import { deliveryFailureReason } from "../apps/api/src/channels/whatsapp/delivery-failure";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** The error Meta actually sent, verbatim from the production log. */
const CURRENCY = {
  code: 131042,
  title: "Business eligibility payment issue",
  error_data: {
    details:
      "Message failed to send because your WhatsApp Business account currency is not configured. " +
      "Visit https://business.facebook.com/billing_hub/accounts/details/?business_id=1398120554657817" +
      "&asset_id=1602122691508426&wizard_name=CHANGE_COUNTRY_CURRENCY&account_type=whatsapp-business-account" +
      " to resolve this issue.",
  },
};

function main(): void {
  console.log("\nThe failure that started this\n");
  const currency = deliveryFailureReason(CURRENCY) ?? "";
  ok("says what Meta said", /currency is not configured/i.test(currency), currency);
  ok("keeps Meta's own title", /business eligibility payment issue/i.test(currency));
  // A 200-character billing URL would be most of the banner, and nobody types a
  // link off a screen. The full text with the link stays in the log.
  ok("drops the URL", !currency.includes("http"), currency);
  // Taking out the link alone used to leave "…is not configured. to resolve
  // this issue." — a dangling clause that reads like our bug, not Meta's text.
  ok("and the clause that pointed at it", !/to resolve this issue/i.test(currency), currency);
  ok("ends as a sentence", /[.!?]$/.test(currency), currency.slice(-30));
  ok("fits on a line", currency.length <= 220, `${currency.length} chars`);

  console.log("\nThe two an agent can act on themselves\n");
  const window = deliveryFailureReason({ code: 131047, title: "Re-engagement message" }) ?? "";
  ok("a closed window says to send a template", /approved template/i.test(window), window);
  const undeliverable = deliveryFailureReason({ code: 131026, title: "Message undeliverable" }) ?? "";
  ok("an unreachable number says to check the number", /on whatsapp/i.test(undeliverable), undeliverable);

  console.log("\nEverything else is Meta's own words\n");
  // Deliberately a code this file has never heard of. Inventing a sentence for
  // it would be guessing; passing Meta's through stays right when Meta changes.
  const unknown = deliveryFailureReason({
    code: 999999,
    title: "Something new",
    error_data: { details: "A reason nobody has written a case for yet." },
  }) ?? "";
  ok("title and details are joined", /Something new — A reason nobody/.test(unknown), unknown);

  const dupe = deliveryFailureReason({
    code: 1,
    title: "Media upload error",
    error_data: { details: "Media upload error: the file was too large." },
  }) ?? "";
  ok(
    "a title repeated inside details is not said twice",
    (dupe.match(/media upload error/gi) ?? []).length === 1,
    dupe,
  );

  const messageOnly = deliveryFailureReason({ code: 5, message: "Older shape, no title." }) ?? "";
  ok("the older `message` shape still reads", /Older shape/.test(messageOnly), messageOnly);

  console.log("\nWhen there is nothing worth saying\n");
  // "WhatsApp: error 0" under a message is worse than the UI's own fallback.
  ok("no error at all → nothing", deliveryFailureReason(undefined) === undefined);
  ok("an empty error → nothing", deliveryFailureReason({}) === undefined);
  ok(
    "a bare code still names itself",
    /error 131099/.test(deliveryFailureReason({ code: 131099 }) ?? ""),
    deliveryFailureReason({ code: 131099 }),
  );

  console.log("\nLong prose\n");
  const long = deliveryFailureReason({
    code: 2,
    title: "Verbose",
    error_data: { details: "word ".repeat(200) },
  }) ?? "";
  ok("is clamped", long.length <= 220, `${long.length} chars`);
  ok("and says it was clamped", long.endsWith("…"), long.slice(-24));
  // "…configu…" is a worse read than one word fewer.
  ok("on a whole word", /\bword…$/.test(long), long.slice(-14));

  console.log(failed === 0 ? "\nall good\n" : `\n${failed} check(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
