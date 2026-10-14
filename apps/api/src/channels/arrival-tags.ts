import { nestchatAppSchema, type Inbox } from "@ding/schemas";
import type { Store } from "../data/store";
import { ConversationLog, SYSTEM } from "../conversations/conversation-log";

/**
 * The tag a channel puts on its customers. The channel's own setting; for a
 * NestChat channel set up before there was one, the in-app SDK's "tag every
 * customer from here", which is where the Ding app's tag was first kept.
 */
export async function channelContactTag(store: Store, inbox: Inbox): Promise<string> {
  // Set — including to "", which is turned off — means the channel's own.
  if (inbox.contactTag !== undefined) return inbox.contactTag.trim();
  if (inbox.type !== "nestchat") return "";
  try {
    const raw = (await store.getInboxConfig(inbox.id))?.app;
    const app = raw ? nestchatAppSchema.safeParse(JSON.parse(raw)) : undefined;
    return app?.success ? app.data.contactTag.trim() : "";
  } catch {
    return "";
  }
}

/**
 * File a conversation that has just started on a channel the way the channel
 * says: its tag on the customer, its label on the conversation.
 *
 * Only when a conversation starts — not on every message — so a tag or label
 * someone takes off by hand stays off. Added, never replaced: a customer who
 * came in through the app and later the website carries both.
 */
export async function fileArrival(store: Store, inbox: Inbox, contactId: string, conversationId: string): Promise<void> {
  const tag = await channelContactTag(store, inbox);
  if (tag) {
    const contact = await store.getContact(contactId);
    if (contact && !contact.tags.includes(tag)) await store.updateContact(contactId, { tags: [...contact.tags, tag] });
  }

  const labelId = inbox.conversationLabelId;
  if (!labelId) return;
  // A label deleted since it was chosen is simply not applied.
  const label = (await store.listLabels(inbox.orgId)).find((l) => l.id === labelId);
  const conv = label ? await store.getConversation(conversationId) : undefined;
  if (!label || !conv) return;
  const have = (conv.labels ?? []).map((l) => l.id);
  if (have.includes(labelId)) return;
  await store.setConversationLabels(conversationId, [...have, labelId]);
  await new ConversationLog(store).record(conversationId, "labels", SYSTEM, { added: [label.name], removed: [], byChannel: true });
}
