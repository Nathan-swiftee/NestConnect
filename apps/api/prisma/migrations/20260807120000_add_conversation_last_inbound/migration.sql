-- Track the most recent inbound (customer) message time per conversation, to
-- drive WhatsApp's 24-hour customer-service window.
ALTER TABLE "Conversation" ADD COLUMN "lastInboundAt" TIMESTAMP(3);

-- Backfill from existing message history so open windows are correct right away.
UPDATE "Conversation" c
SET "lastInboundAt" = sub.max_in
FROM (
  SELECT "conversationId", MAX("createdAt") AS max_in
  FROM "Message"
  WHERE direction = 'in'
  GROUP BY "conversationId"
) sub
WHERE sub."conversationId" = c.id;
