-- Who started each existing NestChat conversation, on "channelRef".
--
-- From now on a visitor is only shown, and only writes into, conversations
-- carrying their own mark: "visitor:" followed by their browser's id, or by
-- the external identity of a signed-in app or website user. See visitorStamp
-- in nestchat.service.ts. Before that, a detail typed into the pre-chat form
-- merged a visitor onto the customer who owned it, and the visitor's browser
-- could then list and read that customer's chats and join their live one.
--
-- Conversations that already exist are marked here when there is exactly one
-- browser or signed-in user they can have come from — the contact's only
-- NestChat identity. A contact with several (one person on two browsers, or a
-- visitor already merged onto a customer) cannot say which one started which
-- chat, so those stay unmarked: hidden from every visitor, still on the
-- customer's record for agents, and a visitor writing again starts a new chat.
-- Guessing would be the leak this closes.
UPDATE "Conversation" AS c
SET "channelRef" = 'visitor:' || i."value"
FROM "ContactIdentity" AS i
WHERE c."channel" = 'nestchat'
  AND c."channelRef" IS NULL
  AND i."contactId" = c."contactId"
  AND i."kind" IN ('nestchat', 'external')
  AND (
    SELECT COUNT(*)
    FROM "ContactIdentity" AS x
    WHERE x."contactId" = c."contactId"
      AND x."kind" IN ('nestchat', 'external')
  ) = 1;
