-- Emailed-invite flow: a single-use, hashed token (SHA-256) and its expiry,
-- used to let an invited teammate set their own password. Cleared on use.
ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
