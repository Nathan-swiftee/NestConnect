-- Working hours per user (null = the availability switch alone decides).
ALTER TABLE "User" ADD COLUMN "availabilitySchedule" JSONB;

-- Website chat: how far through a conversation unseen replies have been emailed
-- to a visitor who left. Existing conversations start at 0; the sweep only looks
-- at replies newer than its lookback window, so nothing old is emailed.
ALTER TABLE "Conversation" ADD COLUMN "visitorEmailedSeq" INTEGER NOT NULL DEFAULT 0;
