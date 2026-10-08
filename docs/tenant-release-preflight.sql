-- Read-only integrity gate, run on the PRE-migration sanitized restore first.
-- Counts only; never export customer rows to CI/logs. Every violation count
-- must be zero unless explicitly reviewed, quarantined and rehearsed.
BEGIN TRANSACTION READ ONLY;
SELECT 'contact_owner_user' AS check_name, count(*) AS violations
FROM "Contact" c LEFT JOIN "User" u ON u.id = c."ownerUserId"
WHERE c."ownerUserId" IS NOT NULL AND (u.id IS NULL OR u."orgId" <> c."orgId")
UNION ALL
SELECT 'contact_owner_team', count(*)
FROM "Contact" c LEFT JOIN "Team" t ON t.id = c."ownerTeamId"
WHERE c."ownerTeamId" IS NOT NULL AND (t.id IS NULL OR t."orgId" <> c."orgId")
UNION ALL
SELECT 'conversation_contact', count(*)
FROM "Conversation" c LEFT JOIN "Contact" p ON p.id = c."contactId"
WHERE p.id IS NULL OR p."orgId" <> c."orgId"
UNION ALL
SELECT 'conversation_inbox', count(*)
FROM "Conversation" c LEFT JOIN "Inbox" i ON i.id = c."inboxId"
WHERE i.id IS NULL OR i."orgId" <> c."orgId"
UNION ALL
SELECT 'conversation_assignee', count(*)
FROM "Conversation" c LEFT JOIN "User" u ON u.id = c."assigneeUserId"
WHERE c."assigneeUserId" IS NOT NULL AND (u.id IS NULL OR u."orgId" <> c."orgId")
UNION ALL
SELECT 'conversation_team', count(*)
FROM "Conversation" c LEFT JOIN "Team" t ON t.id = c."assignedTeamId"
WHERE c."assignedTeamId" IS NOT NULL AND (t.id IS NULL OR t."orgId" <> c."orgId")
UNION ALL
SELECT 'identity_missing_contact', count(*)
FROM "ContactIdentity" i LEFT JOIN "Contact" c ON c.id = i."contactId" WHERE c.id IS NULL
UNION ALL
SELECT 'duplicate_identity_after_backfill', count(*) FROM (
  SELECT c."orgId", i.kind, i.value FROM "ContactIdentity" i JOIN "Contact" c ON c.id = i."contactId"
  GROUP BY c."orgId", i.kind, i.value HAVING count(*) > 1
) d
UNION ALL
SELECT 'attachment_missing_message', count(*)
FROM "Attachment" a LEFT JOIN "Message" m ON m.id = a."messageId"
WHERE a."messageId" IS NOT NULL AND m.id IS NULL;
-- Backfill volume and staged uploads are not violations, but require an owner
-- decision when more than one organization exists. Never guess their owner.
SELECT count(*) AS organizations FROM "Organization";
SELECT count(*) AS staged_uploads FROM "Attachment" WHERE "messageId" IS NULL;
SELECT count(*) AS identities_requiring_backfill FROM "ContactIdentity" i
JOIN "Contact" c ON c.id = i."contactId" WHERE i."orgId" IS DISTINCT FROM c."orgId";
ROLLBACK;
