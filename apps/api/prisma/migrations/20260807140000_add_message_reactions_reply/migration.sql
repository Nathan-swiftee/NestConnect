-- Emoji reactions + quoted replies on messages.
ALTER TABLE "Message" ADD COLUMN "reactions" JSONB;
ALTER TABLE "Message" ADD COLUMN "quotedMsgId" TEXT;
