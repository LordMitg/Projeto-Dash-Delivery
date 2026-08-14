ALTER TABLE "orders"
  ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priorityReason" TEXT,
  ADD COLUMN "prioritizedAt" TIMESTAMP(3);

ALTER TABLE "order_items"
  ADD COLUMN "printedAt" TIMESTAMP(3);

CREATE INDEX "orders_tenantId_priority_createdAt_idx"
  ON "orders"("tenantId", "priority", "createdAt");
