CREATE TABLE "purchase_receipts" (
  "id" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "notes" TEXT,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "receivedById" TEXT,
  CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_items" (
  "id" TEXT NOT NULL,
  "receivedQuantity" DECIMAL(12,4) NOT NULL,
  "stockQuantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,4) NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "receiptId" TEXT NOT NULL,
  "purchaseOrderItemId" TEXT NOT NULL,
  CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_receipts_purchaseOrderId_receiptNumber_key" ON "purchase_receipts"("purchaseOrderId", "receiptNumber");
CREATE INDEX "purchase_receipts_tenantId_createdAt_idx" ON "purchase_receipts"("tenantId", "createdAt");
CREATE UNIQUE INDEX "purchase_receipt_items_receiptId_purchaseOrderItemId_key" ON "purchase_receipt_items"("receiptId", "purchaseOrderItemId");
CREATE INDEX "purchase_receipt_items_purchaseOrderItemId_idx" ON "purchase_receipt_items"("purchaseOrderItemId");

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
