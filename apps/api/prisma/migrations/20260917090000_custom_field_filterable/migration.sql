-- Whether a custom field gets a chip in the inbox's filter row.
--
-- Opt-in, and false for every existing field on purpose. A field is defined
-- because it is worth recording; a chip earns its place only if people filter
-- by it. Defaulting this to true would have put a chip in the row for every
-- field an org has ever defined, which is how a filter row stops being read.
ALTER TABLE "CustomField" ADD COLUMN "filterable" BOOLEAN NOT NULL DEFAULT false;
