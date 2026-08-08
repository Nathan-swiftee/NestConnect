-- Per-message channel: lets a single open conversation carry messages across
-- channels (unified cross-channel thread). Null falls back to the conversation's
-- channel for legacy rows.
ALTER TABLE "Message" ADD COLUMN "channel" "ChannelType";
