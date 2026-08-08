-- Diagnostics for inbound webhooks that couldn't be mapped/verified.
CREATE TABLE "WebhookDiagnostic" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDiagnostic_createdAt_idx" ON "WebhookDiagnostic"("createdAt");
