-- The chats someone has written in (Team Chat oversight: chats an admin or manager stepped into show in their list).
CREATE INDEX "ChatMessage_authorUserId_roomId_idx" ON "ChatMessage"("authorUserId", "roomId");
