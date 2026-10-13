-- Team Chat, part 4: a customer conversation shared into a chat to discuss.
-- Additive only.

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "shared" JSONB;

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_idx" ON "ChatMessage"("conversationId");

-- CreateIndex
CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

