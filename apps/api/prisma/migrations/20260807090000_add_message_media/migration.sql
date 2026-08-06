-- Message type + rich attachment metadata for media / files / voice notes.
ALTER TABLE "Message" ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text';

ALTER TABLE "Attachment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'file';
ALTER TABLE "Attachment" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "width" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "height" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN "waveform" TEXT;

CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
