ALTER TABLE "tenants"
  ADD COLUMN "couponsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "loyaltyPointsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cashbackEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pointsPerReal" DECIMAL(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN "pointRedemptionValue" DECIMAL(10,4) NOT NULL DEFAULT 0.01,
  ADD COLUMN "cashbackPercent" DECIMAL(5,2) NOT NULL DEFAULT 2;

ALTER TABLE "orders" ADD COLUMN "pointsUsed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "customer_addresses" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Principal',
  "address" TEXT NOT NULL,
  "neighborhood" TEXT NOT NULL,
  "city" TEXT,
  "state" TEXT,
  "zipCode" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_addresses_tenantId_customerId_idx" ON "customer_addresses"("tenantId", "customerId");
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "consumer_addresses" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Principal',
  "address" TEXT NOT NULL,
  "neighborhood" TEXT NOT NULL,
  "city" TEXT,
  "state" TEXT,
  "zipCode" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "consumerProfileId" TEXT NOT NULL,
  CONSTRAINT "consumer_addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consumer_addresses_consumerProfileId_idx" ON "consumer_addresses"("consumerProfileId");
ALTER TABLE "consumer_addresses" ADD CONSTRAINT "consumer_addresses_consumerProfileId_fkey" FOREIGN KEY ("consumerProfileId") REFERENCES "consumer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
