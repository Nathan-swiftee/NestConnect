-- Business Ops: the workspace's own SOPs, by team, with versions, read
-- confirmations, review dates and personal checklists. Additive only.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "opsSopId" TEXT;

-- CreateTable
CREATE TABLE "OpsCollection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📁',
    "color" TEXT NOT NULL DEFAULT '#0FA47A',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsSop" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "collectionId" TEXT,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📘',
    "color" TEXT NOT NULL DEFAULT '#0FA47A',
    "summary" TEXT NOT NULL DEFAULT '',
    "warnings" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL DEFAULT '',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "allTeams" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "mustRead" BOOLEAN NOT NULL DEFAULT false,
    "reviewEveryMonths" INTEGER,
    "reviewDueAt" TIMESTAMP(3),
    "reviewNotifiedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "ownerName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsSop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsSopTeam" (
    "opsSopId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "OpsSopTeam_pkey" PRIMARY KEY ("opsSopId","teamId")
);

-- CreateTable
CREATE TABLE "OpsSopRevision" (
    "id" TEXT NOT NULL,
    "opsSopId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "publishedByName" TEXT,

    CONSTRAINT "OpsSopRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAck" (
    "opsSopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsAck_pkey" PRIMARY KEY ("opsSopId","userId")
);

-- CreateTable
CREATE TABLE "OpsChecklist" (
    "opsSopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "done" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsChecklist_pkey" PRIMARY KEY ("opsSopId","userId")
);

-- CreateIndex
CREATE INDEX "OpsCollection_orgId_idx" ON "OpsCollection"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsCollection_orgId_name_key" ON "OpsCollection"("orgId", "name");

-- CreateIndex
CREATE INDEX "OpsSop_orgId_status_idx" ON "OpsSop"("orgId", "status");

-- CreateIndex
CREATE INDEX "OpsSop_reviewDueAt_idx" ON "OpsSop"("reviewDueAt");

-- CreateIndex
CREATE INDEX "OpsSopTeam_teamId_idx" ON "OpsSopTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsSopRevision_opsSopId_version_key" ON "OpsSopRevision"("opsSopId", "version");

-- CreateIndex
CREATE INDEX "OpsAck_userId_idx" ON "OpsAck"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_opsSopId_fkey" FOREIGN KEY ("opsSopId") REFERENCES "OpsSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsCollection" ADD CONSTRAINT "OpsCollection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSop" ADD CONSTRAINT "OpsSop_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSop" ADD CONSTRAINT "OpsSop_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "OpsCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSopTeam" ADD CONSTRAINT "OpsSopTeam_opsSopId_fkey" FOREIGN KEY ("opsSopId") REFERENCES "OpsSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSopTeam" ADD CONSTRAINT "OpsSopTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSopRevision" ADD CONSTRAINT "OpsSopRevision_opsSopId_fkey" FOREIGN KEY ("opsSopId") REFERENCES "OpsSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAck" ADD CONSTRAINT "OpsAck_opsSopId_fkey" FOREIGN KEY ("opsSopId") REFERENCES "OpsSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAck" ADD CONSTRAINT "OpsAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsChecklist" ADD CONSTRAINT "OpsChecklist_opsSopId_fkey" FOREIGN KEY ("opsSopId") REFERENCES "OpsSop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsChecklist" ADD CONSTRAINT "OpsChecklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

