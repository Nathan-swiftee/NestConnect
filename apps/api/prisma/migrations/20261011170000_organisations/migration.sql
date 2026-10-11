-- Organisations: customer companies and their knowledge (alerts, SOPs with
-- revisions, notes, resources, activity), contacts linked many-to-many, and the
-- organisation a conversation is about. Additive only.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'prospect', 'inactive');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "legalName" TEXT,
    "reference" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "overview" TEXT NOT NULL DEFAULT '',
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerUserId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "role" TEXT,
    "department" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAlert" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'important',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "AccountAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSop" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "summary" TEXT NOT NULL DEFAULT '',
    "warnings" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "AccountSop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSopRevision" (
    "id" TEXT NOT NULL,
    "sopId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL,
    "editedById" TEXT,
    "editedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSopRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "AccountNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountResource" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'General',
    "url" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "attachmentId" TEXT,
    "sopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,

    CONSTRAINT "AccountResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountActivity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_orgId_archivedAt_name_idx" ON "Account"("orgId", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "Account_orgId_nameKey_idx" ON "Account"("orgId", "nameKey");

-- CreateIndex
CREATE INDEX "AccountContact_contactId_idx" ON "AccountContact"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountContact_accountId_contactId_key" ON "AccountContact"("accountId", "contactId");

-- CreateIndex
CREATE INDEX "AccountAlert_accountId_idx" ON "AccountAlert"("accountId");

-- CreateIndex
CREATE INDEX "AccountSop_accountId_status_idx" ON "AccountSop"("accountId", "status");

-- CreateIndex
CREATE INDEX "AccountSopRevision_sopId_version_idx" ON "AccountSopRevision"("sopId", "version");

-- CreateIndex
CREATE INDEX "AccountNote_accountId_idx" ON "AccountNote"("accountId");

-- CreateIndex
CREATE INDEX "AccountResource_accountId_idx" ON "AccountResource"("accountId");

-- CreateIndex
CREATE INDEX "AccountActivity_accountId_createdAt_idx" ON "AccountActivity"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_accountId_idx" ON "Conversation"("accountId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountContact" ADD CONSTRAINT "AccountContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountContact" ADD CONSTRAINT "AccountContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAlert" ADD CONSTRAINT "AccountAlert_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSop" ADD CONSTRAINT "AccountSop_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSopRevision" ADD CONSTRAINT "AccountSopRevision_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "AccountSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountNote" ADD CONSTRAINT "AccountNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountResource" ADD CONSTRAINT "AccountResource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountResource" ADD CONSTRAINT "AccountResource_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "AccountSop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

