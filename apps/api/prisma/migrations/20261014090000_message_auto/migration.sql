-- The website chat's automatic reply while nobody is online.
ALTER TABLE "Message" ADD COLUMN "auto" TEXT;
