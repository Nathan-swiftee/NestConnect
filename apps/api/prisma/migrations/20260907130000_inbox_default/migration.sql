-- Which number or mailbox a channel sends from, when the thread's own inbox
-- isn't the one being used.
--
-- A reply switched onto another channel goes from that channel's inbox, and
-- with two numbers "that channel's inbox" was decided by age alone —
-- deterministic, but arbitrary, and not necessarily the number a workspace
-- wants to be known by. This is how it says so.
ALTER TABLE "Inbox" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- At most one default per channel type, enforced here rather than trusting the
-- setter. This decides which number a customer sees; two rows both claiming it
-- would put us straight back to a coin toss, and a partial index is the only
-- thing that can say "at most one true, any number of false".
CREATE UNIQUE INDEX "Inbox_orgId_type_default_key"
  ON "Inbox" ("orgId", "type")
  WHERE "isDefault";

-- No backfill. Nothing is default until somebody chooses, and until then the
-- oldest-first rule stands — which is exactly what shipped in the previous
-- migration, so this changes no behaviour on its own.
