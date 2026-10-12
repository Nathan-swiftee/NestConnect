-- Email signatures move from each person to each email channel; people get a
-- position to fill into them. Additive only.
ALTER TABLE "User" ADD COLUMN "position" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "signatureHtml" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "signatureFooterHtml" TEXT;
