-- Team Chat, part 3: photos, voice notes and files on messages, a link
-- preview, and starred messages. Additive only.

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "link" JSONB;

-- CreateTable
CREATE TABLE "ChatStar" (
    "userId" TEXT NOT NULL,
    "chatMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatStar_pkey" PRIMARY KEY ("userId","chatMessageId")
);

-- CreateIndex
CREATE INDEX "ChatStar_userId_createdAt_idx" ON "ChatStar"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatStar" ADD CONSTRAINT "ChatStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStar" ADD CONSTRAINT "ChatStar_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

