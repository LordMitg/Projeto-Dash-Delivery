ALTER TABLE "purchase_orders"
  ALTER COLUMN "supplierId" DROP NOT NULL,
  ADD COLUMN "purchaseMode" TEXT NOT NULL DEFAULT 'formal',
  ADD COLUMN "quickVendorName" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "hasReceiptImage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "receiptImageData" TEXT;
