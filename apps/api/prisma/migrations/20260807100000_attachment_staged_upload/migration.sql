-- Allow attachments to be uploaded (staged) before they're attached to a sent
-- message, so the composer can upload media then reference it on send.
ALTER TABLE "Attachment" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
