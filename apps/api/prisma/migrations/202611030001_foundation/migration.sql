CREATE TABLE "EnvironmentIdentity" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL UNIQUE);
CREATE TABLE "OutboxEvent" ("id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3));
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");
