-- Additive OAuth account fields; existing user records and passwords are retained.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firebaseUid" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authProvider" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_firebaseUid_key" ON "User"("firebaseUid");
ALTER TABLE "StudentVerification" ADD COLUMN IF NOT EXISTS "userId" TEXT;
