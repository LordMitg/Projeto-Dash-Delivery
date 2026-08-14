ALTER TABLE "users" ADD COLUMN "phone" TEXT;

ALTER TABLE "deliveries"
  ADD COLUMN "pickupToken" TEXT,
  ADD COLUMN "pickupTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "driverUserId" TEXT,
  ADD COLUMN "routeBatchId" TEXT,
  ADD COLUMN "routePosition" INTEGER,
  ADD COLUMN "routeStartedAt" TIMESTAMP(3),
  ADD COLUMN "destinationLatitude" DOUBLE PRECISION,
  ADD COLUMN "destinationLongitude" DOUBLE PRECISION,
  ADD COLUMN "estimatedArrivalAt" TIMESTAMP(3);

ALTER TABLE "fleet"
  ADD COLUMN "currentLatitude" DOUBLE PRECISION,
  ADD COLUMN "currentLongitude" DOUBLE PRECISION,
  ADD COLUMN "locationAccuracy" DOUBLE PRECISION,
  ADD COLUMN "locationHeading" DOUBLE PRECISION,
  ADD COLUMN "locationUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "driverUserId" TEXT;

CREATE UNIQUE INDEX "deliveries_pickupToken_key" ON "deliveries"("pickupToken");
CREATE INDEX "deliveries_driverUserId_status_routePosition_idx" ON "deliveries"("driverUserId", "status", "routePosition");
CREATE INDEX "deliveries_tenantId_routeBatchId_idx" ON "deliveries"("tenantId", "routeBatchId");
CREATE UNIQUE INDEX "fleet_tenantId_driverUserId_key" ON "fleet"("tenantId", "driverUserId");

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fleet" ADD CONSTRAINT "fleet_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
