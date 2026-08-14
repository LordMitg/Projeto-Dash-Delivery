ALTER TABLE "products"
  ADD COLUMN "preparationStation" TEXT NOT NULL DEFAULT 'Cozinha',
  ADD COLUMN "preparationTimeMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "order_items"
  ADD COLUMN "productionStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "preparationStation" TEXT NOT NULL DEFAULT 'Cozinha',
  ADD COLUMN "preparationTimeMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "readyAt" TIMESTAMP(3);

CREATE INDEX "order_items_productionStatus_preparationStation_idx"
  ON "order_items"("productionStatus", "preparationStation");
