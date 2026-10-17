-- One sign-in per email address, across workspaces (see Login in schema.prisma).
-- A User becomes one person's place in one workspace; the same person can now
-- be in several, all pointing at one Login. The User credential columns stay,
-- unread, as retired copies — a rollback to the previous release still finds
-- them where it expects.

-- CreateTable
CREATE TABLE "Login" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorMethod" TEXT,
    "totpSecret" TEXT,
    "twoFactorEmailCodeHash" TEXT,
    "twoFactorEmailCodeExpires" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "lastOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Login_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Login_email_key" ON "Login"("email");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "loginId" TEXT;
ALTER TABLE "RecoveryCode" ADD COLUMN "loginId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- Backfill: one Login per address (lower-cased), carrying the credentials of
-- the earliest account with it. Until now an address could only sign in when
-- exactly one account had it, so in practice this is one Login per User.
INSERT INTO "Login" ("id", "email", "passwordHash", "twoFactorEnabled", "twoFactorMethod", "totpSecret", "lastOrgId", "createdAt")
SELECT DISTINCT ON (lower(u."email"))
  'lgn_' || u."id", lower(u."email"), u."passwordHash", u."twoFactorEnabled", u."twoFactorMethod", u."totpSecret", u."orgId", u."createdAt"
FROM "User" u
ORDER BY lower(u."email"), u."createdAt" ASC, u."id" ASC;

-- Each workspace's account with that address joins it — one per workspace: if
-- a workspace somehow holds two accounts differing only in case, the earliest
-- is linked and the other is left without a sign-in (it had none before either).
UPDATE "User" u SET "loginId" = l."id"
FROM (
  SELECT DISTINCT ON (u2."orgId", lower(u2."email")) u2."id" AS "userId", lower(u2."email") AS "email"
  FROM "User" u2
  ORDER BY u2."orgId", lower(u2."email"), u2."createdAt" ASC, u2."id" ASC
) pick
JOIN "Login" l ON l."email" = pick."email"
WHERE u."id" = pick."userId";

-- Recovery codes follow their account to its Login.
UPDATE "RecoveryCode" r SET "loginId" = u."loginId"
FROM "User" u
WHERE u."id" = r."userId" AND u."loginId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "RecoveryCode_loginId_idx" ON "RecoveryCode"("loginId");
CREATE INDEX "User_loginId_idx" ON "User"("loginId");
CREATE UNIQUE INDEX "User_orgId_loginId_key" ON "User"("orgId", "loginId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "Login"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "Login"("id") ON DELETE CASCADE ON UPDATE CASCADE;
