-- Tenant isolation: the last places a row's workspace was implied rather than recorded.

-- 1. Attachments carry their workspace. Backfilled from the message they belong
--    to; an upload still staged (no message yet) can only belong to the
--    deployment's one workspace if there is exactly one — otherwise it is left
--    unowned, which makes it unreadable rather than readable by the wrong org.
ALTER TABLE "Attachment" ADD COLUMN "orgId" TEXT;

UPDATE "Attachment" AS a
SET "orgId" = c."orgId"
FROM "Message" AS m
JOIN "Conversation" AS c ON c."id" = m."conversationId"
WHERE a."messageId" = m."id" AND a."orgId" IS NULL;

UPDATE "Attachment"
SET "orgId" = (SELECT "id" FROM "Organization" LIMIT 1)
WHERE "orgId" IS NULL
  AND (SELECT COUNT(*) FROM "Organization") = 1;

CREATE INDEX "Attachment_orgId_idx" ON "Attachment"("orgId");

-- 2. Webhook diagnostics carry the workspace they concern, when one is known.
--    Existing rows were recorded before that was possible and stay unowned:
--    the platform's operators can still see them.
ALTER TABLE "WebhookDiagnostic" ADD COLUMN "orgId" TEXT;
CREATE INDEX "WebhookDiagnostic_orgId_createdAt_idx" ON "WebhookDiagnostic"("orgId", "createdAt");

-- 3. A customer identity is unique per workspace, not across the platform: the
--    same phone number can message two businesses, and each has its own contact.
--    Every identity takes its contact's workspace first.
UPDATE "ContactIdentity" AS i
SET "orgId" = c."orgId"
FROM "Contact" AS c
WHERE i."contactId" = c."id" AND (i."orgId" IS NULL OR i."orgId" <> c."orgId");

DROP INDEX IF EXISTS "ContactIdentity_kind_value_key";
CREATE UNIQUE INDEX "ContactIdentity_orgId_kind_value_key" ON "ContactIdentity"("orgId", "kind", "value");
