-- Speeds up inbound idempotency (skip already-stored provider messages) and
-- delivery-status reconciliation, both of which look a message up by its
-- channel message id.
CREATE INDEX "Message_channelMsgId_idx" ON "Message"("channelMsgId");
