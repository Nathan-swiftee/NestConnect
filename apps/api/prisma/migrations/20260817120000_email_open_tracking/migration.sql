-- Per-recipient email open-tracking (read receipts, Front-style).
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'to',
    "token" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailRecipient_token_key" ON "EmailRecipient"("token");

CREATE INDEX "EmailRecipient_messageId_idx" ON "EmailRecipient"("messageId");

ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
