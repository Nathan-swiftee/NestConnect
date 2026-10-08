-- Automatic subjects for new WhatsApp and website-chat conversations.
-- Existing conversations keep subjectAuto = false: their subjects are left alone.
ALTER TABLE "Conversation" ADD COLUMN "subjectAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "subjectTopic" TEXT;
