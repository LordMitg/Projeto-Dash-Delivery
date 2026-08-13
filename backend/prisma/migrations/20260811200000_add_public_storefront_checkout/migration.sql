ALTER TABLE "tenants" ADD COLUMN "storefrontTheme" JSONB;
ALTER TABLE "orders" ADD COLUMN "publicToken" TEXT;
ALTER TABLE "orders" ALTER COLUMN "createdById" DROP NOT NULL;

CREATE UNIQUE INDEX "orders_publicToken_key" ON "orders"("publicToken");
