-- Organisation routing: an organisation's people's new chats go to a team
-- (and optionally a person) unless the contact has routing of their own.
-- Additive only.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "routeTeamId" TEXT,
ADD COLUMN     "routeUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_routeTeamId_fkey" FOREIGN KEY ("routeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_routeUserId_fkey" FOREIGN KEY ("routeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

