-- A demo workspace flag: synthetic data only, and nothing it does reaches anyone.
ALTER TABLE "Organization" ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;
