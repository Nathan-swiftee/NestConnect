-- Macros: saved replies for the composer, each belonging to team inboxes
-- (none = every team). Additive only.

-- CreateTable
CREATE TABLE "Macro" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortcut" TEXT,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Macro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroTeam" (
    "macroId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "MacroTeam_pkey" PRIMARY KEY ("macroId","teamId")
);

-- CreateIndex
CREATE INDEX "Macro_orgId_idx" ON "Macro"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Macro_orgId_shortcut_key" ON "Macro"("orgId", "shortcut");

-- CreateIndex
CREATE INDEX "MacroTeam_teamId_idx" ON "MacroTeam"("teamId");

-- AddForeignKey
ALTER TABLE "Macro" ADD CONSTRAINT "Macro_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroTeam" ADD CONSTRAINT "MacroTeam_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroTeam" ADD CONSTRAINT "MacroTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
