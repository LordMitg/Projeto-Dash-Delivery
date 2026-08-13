CREATE TABLE "stock_movements" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "delta" DECIMAL(12,4) NOT NULL,
  "balanceBefore" DECIMAL(12,4) NOT NULL,
  "balanceAfter" DECIMAL(12,4) NOT NULL,
  "reason" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT NOT NULL,
  "ingredientId" TEXT NOT NULL,
  "actorId" TEXT,

  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_movements_tenantId_createdAt_idx"
  ON "stock_movements"("tenantId", "createdAt");
CREATE INDEX "stock_movements_ingredientId_createdAt_idx"
  ON "stock_movements"("ingredientId", "createdAt");
CREATE INDEX "stock_movements_actorId_idx" ON "stock_movements"("actorId");

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
