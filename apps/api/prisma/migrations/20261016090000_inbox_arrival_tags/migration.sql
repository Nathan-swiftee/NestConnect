-- What a channel files its arrivals under: a tag on the customer, a label on the conversation.
ALTER TABLE "Inbox" ADD COLUMN "contactTag" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "conversationLabelId" TEXT;
