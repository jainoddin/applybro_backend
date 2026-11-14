CREATE TABLE IF NOT EXISTS "BrowserDevice" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMPTZ NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "revokedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "BrowserDevice_userId_idx" ON "BrowserDevice"("userId");
CREATE TABLE IF NOT EXISTS "BrowserRun" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "deviceId" TEXT NOT NULL REFERENCES "BrowserDevice"("id"), "applicationId" TEXT,
 "kind" TEXT NOT NULL, "portal" TEXT NOT NULL, "url" TEXT NOT NULL,
 "stage" TEXT NOT NULL DEFAULT 'CREATED', "details" JSONB NOT NULL DEFAULT '{}',
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "BrowserRun_userId_idx" ON "BrowserRun"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "BrowserRun_one_active_application" ON "BrowserRun"("userId","applicationId")
 WHERE "kind"='APPLY' AND "stage" IN ('CREATED','OPENED','LOGIN_REQUIRED','REVIEW_REQUIRED','SUBMITTING','UNKNOWN');
