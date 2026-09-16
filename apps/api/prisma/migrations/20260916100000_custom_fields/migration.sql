-- Facts a workspace wants to record that we did not think of.
--
-- "Order id" is a food-delivery business's word for the thing a booking agency
-- calls a booking reference and an insurer calls a policy number. A column per
-- idea would mean a migration every time somebody integrates something, and a
-- schema that reads as a list of our customers — so the definitions are data.
CREATE TABLE "CustomField" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  -- The stable machine name an SDK sends. The label is what changes.
  "key"       TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "type"      TEXT NOT NULL DEFAULT 'text',
  -- contact | conversation. A contact's facts follow the person; a
  -- conversation's belong to one thread.
  "entity"    TEXT NOT NULL,
  "options"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Which channels offer it. Empty means all of them.
  "inboxIds"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "position"  INTEGER NOT NULL DEFAULT 0,
  -- Retired rather than deleted: the values recorded against it are history.
  "archived"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- The key is the identity, and it has to be unique for a payload naming a field
-- by key to mean one thing.
CREATE UNIQUE INDEX "CustomField_orgId_key_key" ON "CustomField" ("orgId", "key");
CREATE INDEX "CustomField_orgId_entity_archived_idx"
  ON "CustomField" ("orgId", "entity", "archived");

-- One field's value on one contact or one conversation.
--
-- A table rather than JSON on each row, and the reason is search: an order
-- number is read out over the phone and looked up far more often than it is
-- written, so it has to be an index hit rather than a scan.
CREATE TABLE "CustomFieldValue" (
  "id"       TEXT NOT NULL,
  -- Denormalised from the field so a search can be scoped without a join.
  "orgId"    TEXT NOT NULL,
  "fieldId"  TEXT NOT NULL,
  "entity"   TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  -- As entered, for display.
  "value"    TEXT NOT NULL,
  -- Folded for matching: trimmed, lower-cased, and stripped of the spaces and
  -- dashes people put in reference numbers. "dg 88412" finds "DG-88412".
  "normalizedValue" TEXT NOT NULL,
  CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- One value per field per record. Enforced here rather than trusted to the
-- setter: two rows for one field is a value that reads differently depending on
-- which the query happened to return first.
CREATE UNIQUE INDEX "CustomFieldValue_fieldId_entity_entityId_key"
  ON "CustomFieldValue" ("fieldId", "entity", "entityId");
-- The panel's read: every field on the record being opened.
CREATE INDEX "CustomFieldValue_orgId_entity_entityId_idx"
  ON "CustomFieldValue" ("orgId", "entity", "entityId");
-- The search, when the field is known.
CREATE INDEX "CustomFieldValue_orgId_fieldId_normalizedValue_idx"
  ON "CustomFieldValue" ("orgId", "fieldId", "normalizedValue");
-- And when it isn't: a bare reference typed into the search box.
CREATE INDEX "CustomFieldValue_orgId_normalizedValue_idx"
  ON "CustomFieldValue" ("orgId", "normalizedValue");

ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Cascade: archiving is how a field is retired. An actual delete is a decision
-- to destroy its values too, and should not leave them orphaned.
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
