-- DropIndex
DROP INDEX "tenants_name_key";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "logoData" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryLockedUntil" TIMESTAMP(3),
ADD COLUMN     "securityAnswer1Hash" TEXT,
ADD COLUMN     "securityAnswer2Hash" TEXT,
ADD COLUMN     "securityQuestion1" TEXT,
ADD COLUMN     "securityQuestion2" TEXT;

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tenantId_key" ON "memberships"("userId", "tenantId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
