#!/usr/bin/env node
/**
 * Simulate WhatsApp group traffic against a running Ding API (no deps).
 *
 *   node tools/simulate-group.mjs msg   <groupRef> <fromPhone> <name> <text>
 *   node tools/simulate-group.mjs join  <groupRef> <phone> <name>
 *   node tools/simulate-group.mjs leave <groupRef> <phone>
 *
 * <groupRef> is the conversation's channelRef (the WhatsApp group id) — visible
 * in GET /api/conversations/:id. Env: DING_API (default http://localhost:3001).
 */
const API = process.env.DING_API ?? "http://localhost:3001";
const [kind, groupId, a, b, c] = process.argv.slice(2);

async function post(body) {
  const res = await fetch(`${API}/api/channels/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`${res.status} ${res.statusText}:`, await res.text());
}
const wrap = (field, value) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field, value }] }] });

if (kind === "msg") {
  if (!groupId || !a) { console.error("usage: msg <groupRef> <fromPhone> <name> <text>"); process.exit(1); }
  await post(
    wrap("messages", {
      metadata: { phone_number_id: "PN_TEST", group_id: groupId },
      contacts: [{ wa_id: a, profile: { name: b } }],
      messages: [{ from: a, id: `wamid.g_${Date.now()}`, type: "text", text: { body: c ?? "hello group" } }],
    }),
  );
} else if (kind === "join" || kind === "leave") {
  if (!groupId || !a) { console.error(`usage: ${kind} <groupRef> <phone> [name]`); process.exit(1); }
  await post(
    wrap("group_participants_update", {
      group_id: groupId,
      participants: [{ wa_id: a, action: kind === "join" ? "add" : "remove", profile: { name: b } }],
    }),
  );
} else {
  console.error("usage: simulate-group.mjs msg|join|leave <groupRef> …");
  process.exit(1);
}
