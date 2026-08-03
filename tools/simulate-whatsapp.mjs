#!/usr/bin/env node
/**
 * Simulate a Meta WhatsApp Cloud API webhook against a running Ding API.
 * No dependencies — uses Node's global fetch (Node 18+).
 *
 * Inbound message:
 *   node tools/simulate-whatsapp.mjs "447700900123" "Jordan Fields" "Hi, need a quote"
 *
 * Delivery status for an outbound message (moves the ticks):
 *   node tools/simulate-whatsapp.mjs --status wamid.mock_123 read
 *
 * Env: DING_API (default http://localhost:3001), WHATSAPP_PHONE_NUMBER_ID (default PN_TEST)
 */
const API = process.env.DING_API ?? "http://localhost:3001";
const PN = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "PN_TEST";
const args = process.argv.slice(2);

async function post(body) {
  const res = await fetch(`${API}/api/channels/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`${res.status} ${res.statusText}:`, await res.text());
}

function wrap(value) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] };
}

if (args[0] === "--status") {
  const [, id, status = "read"] = args;
  if (!id) {
    console.error("usage: --status <wamid> [sent|delivered|read|failed]");
    process.exit(1);
  }
  await post(wrap({ metadata: { phone_number_id: PN }, statuses: [{ id, status, recipient_id: "000" }] }));
} else {
  const from = args[0] ?? "447700900123";
  const name = args[1] ?? "Jordan Fields";
  const text = args[2] ?? "Hi, could I get a quote for weekly collections?";
  await post(
    wrap({
      metadata: { phone_number_id: PN, display_phone_number: "+44 20 7946 0100" },
      contacts: [{ wa_id: from, profile: { name } }],
      messages: [{ from, id: `wamid.sim_${Date.now()}`, type: "text", text: { body: text } }],
    }),
  );
}
