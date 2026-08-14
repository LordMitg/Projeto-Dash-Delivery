ALTER TABLE "deliveries"
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "pickedUpAt" TIMESTAMP(3),
  ADD COLUMN "deliveryCode" TEXT,
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "proofNotes" TEXT,
  ADD COLUMN "courierId" TEXT;

ALTER TABLE "fleet"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "plate" TEXT,
  ADD COLUMN "availability" TEXT NOT NULL DEFAULT 'available';

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "fleet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "deliveries_courierId_idx" ON "deliveries"("courierId");
CREATE INDEX "deliveries_tenantId_status_createdAt_idx" ON "deliveries"("tenantId", "status", "createdAt");
CREATE INDEX "fleet_tenantId_availability_active_idx" ON "fleet"("tenantId", "availability", "active");
