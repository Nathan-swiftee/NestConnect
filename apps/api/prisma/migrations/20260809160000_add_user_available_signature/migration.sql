-- AlterTable
ALTER TABLE "User" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "emailSignature" TEXT;
