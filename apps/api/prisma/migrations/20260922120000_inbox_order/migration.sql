-- Where a channel sits in the sidebar, the same idea as Team."order".
--
-- Everything starts at 0 on purpose. That is a tie, not a chosen order, and
-- the queries break it with createdAt — so a workspace that has never touched
-- the arrows sees exactly the order it saw yesterday, and one that has sees
-- its own. Backfilling a distinct position per row would invent an ordering
-- nobody asked for and call it a preference.
ALTER TABLE "Inbox" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
