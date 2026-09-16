-- A customer's phone, for push.
--
-- Separate from "Device" on purpose. That one belongs to a User — an agent with
-- a login, a session and a role — and is addressed through Expo, because the
-- agent app is an Expo app. This belongs to a Contact: somebody who has never
-- signed in to anything of ours, reachable through whatever push service the
-- business's own app already uses. One table for both would mean a nullable
-- userId beside a nullable contactId and a comment promising exactly one is
-- set, which is two tables wearing one name.
CREATE TABLE "CustomerDevice" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  -- Which channel registered it. A customer with two of the business's apps has
  -- two rows here, and a reply on one must not ring the other.
  "inboxId"   TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "platform"  TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set when the push service says the address is dead. Kept rather than
  -- deleted, so a token that comes back can be told from a new one.
  "disabledAt"     TIMESTAMP(3),
  "disabledReason" TEXT,
  CONSTRAINT "CustomerDevice_pkey" PRIMARY KEY ("id")
);

-- One row per address. A phone that re-registers moves to its new owner rather
-- than leaving a stale row that would ring somebody else's notification.
CREATE UNIQUE INDEX "CustomerDevice_token_key" ON "CustomerDevice" ("token");
CREATE INDEX "CustomerDevice_contactId_inboxId_idx"
  ON "CustomerDevice" ("contactId", "inboxId");
CREATE INDEX "CustomerDevice_orgId_idx" ON "CustomerDevice" ("orgId");

-- Cascades: a deleted contact or a deleted channel has no devices worth
-- keeping, and a row pointing at neither is a push nobody can explain.
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_inboxId_fkey"
  FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
