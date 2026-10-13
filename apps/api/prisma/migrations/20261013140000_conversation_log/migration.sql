-- The conversation log: routing, assignment, status and every change made to
-- a conversation besides its messages. Additive, plus a one-off copy of the
-- assignment history already recorded, so existing conversations start with
-- something in their log.

-- CreateTable
CREATE TABLE "ConversationEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationEvent_conversationId_createdAt_idx" ON "ConversationEvent"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationEvent" ADD CONSTRAINT "ConversationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each recorded assignment becomes a log entry. Nobody behind it means
-- automatic routing; somebody means a teammate assigned it (or, with no person,
-- moved it to a team).
INSERT INTO "ConversationEvent" ("id", "conversationId", "type", "actorKind", "actorUserId", "data", "createdAt")
SELECT
    'bf_' || ae."id",
    ae."conversationId",
    CASE
        WHEN ae."byUserId" IS NULL THEN 'routed'
        WHEN ae."toUserId" IS NOT NULL THEN 'assigned'
        WHEN ae."toTeamId" IS NOT NULL THEN 'team_changed'
        ELSE 'unassigned'
    END,
    CASE WHEN ae."byUserId" IS NULL THEN 'system' ELSE 'agent' END,
    ae."byUserId",
    jsonb_strip_nulls(jsonb_build_object(
        'toUserId', ae."toUserId",
        'toTeamId', ae."toTeamId",
        'userId', ae."toUserId",
        'teamId', ae."toTeamId",
        'fromUserId', ae."fromUserId",
        'backfilled', true
    )),
    ae."createdAt"
FROM "AssignmentEvent" ae;
