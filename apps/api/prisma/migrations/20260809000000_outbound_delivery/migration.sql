-- Durable outbound delivery bookkeeping on each message.
ALTER TABLE "Message"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "providerError" TEXT,
  ADD COLUMN "providerErrorCode" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "deliveryMeta" JSONB;

-- Dedup outbound sends by idempotency key.
CREATE UNIQUE INDEX "Message_idempotencyKey_key" ON "Message"("idempotencyKey");

-- Restart recovery scans for still-in-flight outbound messages (queued/sending).
CREATE INDEX "Message_direction_status_idx" ON "Message"("direction", "status");
