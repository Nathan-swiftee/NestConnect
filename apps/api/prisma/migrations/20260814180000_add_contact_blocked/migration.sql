-- Add a "blocked" flag to Contact: blocked contacts have their inbound dropped
-- and are hidden from the customer directory by default.
ALTER TABLE "Contact" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
