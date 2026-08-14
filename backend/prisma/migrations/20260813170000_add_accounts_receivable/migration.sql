CREATE TABLE "accounts_receivable" (
  "id" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "amountReceived" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3),
  "paymentMethod" TEXT,
  "installment" INTEGER NOT NULL DEFAULT 1,
  "installments" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT,
  CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_receivable_orderId_key" ON "accounts_receivable"("orderId");
CREATE INDEX "accounts_receivable_tenantId_dueDate_idx" ON "accounts_receivable"("tenantId", "dueDate");
CREATE INDEX "accounts_receivable_customerId_idx" ON "accounts_receivable"("customerId");
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
