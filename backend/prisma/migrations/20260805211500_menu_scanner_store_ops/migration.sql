-- Migration aditiva: cardapio estruturado, scanner por codigo de barras,
-- operacao da loja (abrir/fechar, horarios, taxa de entrega) e troco.
-- Nenhuma coluna ou tabela e removida: todas as adicoes sao nullable
-- ou possuem DEFAULT, portanto e seguro aplicar sobre uma base com dados.

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "barcode" TEXT,
ALTER COLUMN "stock" SET DEFAULT 0,
ALTER COLUMN "stock" SET DATA TYPE DECIMAL(12,4),
ALTER COLUMN "minimumStock" SET DEFAULT 0,
ALTER COLUMN "minimumStock" SET DATA TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "addons" JSONB,
ADD COLUMN     "addonsTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "changeAmount" DECIMAL(10,2),
ADD COLUMN     "changeFor" DECIMAL(10,2),
ADD COLUMN     "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "menuCategoryId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deliveryFeeBase" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryZones" JSONB,
ADD COLUMN     "isOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openingHours" JSONB,
ADD COLUMN     "printSettings" JSONB;

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_addons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "groupName" TEXT NOT NULL DEFAULT 'Adicionais',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "ingredientId" TEXT,
    "ingredientQty" DECIMAL(10,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "product_addons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_categories_tenantId_idx" ON "menu_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_slug_tenantId_key" ON "menu_categories"("slug", "tenantId");

-- CreateIndex
CREATE INDEX "product_addons_tenantId_idx" ON "product_addons"("tenantId");

-- CreateIndex
CREATE INDEX "product_addons_productId_idx" ON "product_addons"("productId");

-- CreateIndex
CREATE INDEX "ingredients_barcode_idx" ON "ingredients"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_barcode_tenantId_key" ON "ingredients"("barcode", "tenantId");

-- CreateIndex
CREATE INDEX "products_menuCategoryId_idx" ON "products"("menuCategoryId");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_tenantId_key" ON "products"("barcode", "tenantId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_menuCategoryId_fkey" FOREIGN KEY ("menuCategoryId") REFERENCES "menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
