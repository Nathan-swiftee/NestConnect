-- Templates belong to a WhatsApp Business Account, not to the workspace.
--
-- Every phone number under one WABA can send all of that WABA's templates, and
-- none of another's. A workspace with two accounts was showing one merged list,
-- so an agent could pick a template the sending number's account has never
-- heard of — which Meta rejects with 132001 "template name does not exist",
-- after the message has already been queued.
--
-- The column is nullable on purpose. Existing rows have no way of knowing which
-- account they came from, and guessing here would be worse than admitting it:
-- they stay null ("unclaimed", shown for every account) until a template sync
-- matches them by name and language to a real WABA and claims them. Templates
-- authored in Nest Connect and never sent to Meta stay null for good, which is
-- right — they belong to no account.
ALTER TABLE "Template" ADD COLUMN "wabaId" TEXT;

-- The old key made "order_update/en" unique per workspace. It has to be unique
-- per *account* now: two WABAs may each hold their own, and they are different
-- templates that must both be storable. Postgres treats NULLs as distinct in a
-- unique index, so an unclaimed row never blocks a synced one from arriving.
DROP INDEX IF EXISTS "Template_orgId_name_language_key";
CREATE UNIQUE INDEX "Template_orgId_wabaId_name_language_key"
  ON "Template" ("orgId", "wabaId", "name", "language");

-- Postgres treats NULLs as distinct in a unique index, which is what lets two
-- accounts each hold their own "order_update/en" — and, unintentionally, what
-- would let two *unclaimed* rows share a name once the old workspace-wide key
-- was dropped. Nothing in a sync creates those (it matches by name before
-- inserting), but authoring a template by hand could, and two identical names
-- in the list with no account to tell them apart is exactly the confusion this
-- migration exists to end. A partial index keeps the old guarantee for rows
-- that belong to no account.
CREATE UNIQUE INDEX "Template_orgId_name_language_unclaimed_key"
  ON "Template" ("orgId", "name", "language")
  WHERE "wabaId" IS NULL;
