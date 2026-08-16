-- Contact-identity dedup groundwork (Phase 1).
-- Both columns are nullable and additive so this migration cannot fail on
-- existing data: orgId is backfilled here from the owning contact; normalizedValue
-- is populated by the application on startup (it needs the JS phone/email
-- normalizer that SQL can't run). The per-org / normalized UNIQUE constraint is
-- intentionally deferred to a later phase, after duplicates have been merged.

ALTER TABLE "ContactIdentity" ADD COLUMN "orgId" TEXT;
ALTER TABLE "ContactIdentity" ADD COLUMN "normalizedValue" TEXT;

-- Backfill orgId from the contact that owns each identity row.
UPDATE "ContactIdentity" AS ci
SET "orgId" = c."orgId"
FROM "Contact" AS c
WHERE c."id" = ci."contactId";

-- Fast lookup for normalized get-or-create.
CREATE INDEX "ContactIdentity_orgId_kind_normalizedValue_idx"
  ON "ContactIdentity" ("orgId", "kind", "normalizedValue");
