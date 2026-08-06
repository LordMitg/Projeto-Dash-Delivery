-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "notes" TEXT,
    "ltv" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "lastOrderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "costPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "category" TEXT,
    "productType" TEXT NOT NULL DEFAULT 'simple',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "comboOptions" JSONB,
    "packagingIngredientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "totalCost" DECIMAL(10,4) NOT NULL,
    "isMainProtein" BOOLEAN NOT NULL DEFAULT false,
    "isPackaging" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "orderType" TEXT NOT NULL DEFAULT 'delivery',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "observations" TEXT,
    "printedKitchen" BOOLEAN NOT NULL DEFAULT false,
    "printedDelivery" BOOLEAN NOT NULL DEFAULT false,
    "distanceKm" DECIMAL(8,2),
    "deliveryAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdById" TEXT NOT NULL,
    "salesChannelId" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "observations" TEXT,
    "selectedProteinId" TEXT,
    "selectedProteinName" TEXT,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "estimatedTime" TIMESTAMP(3),
    "actualTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "assignedToId" TEXT,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "breakageFactor" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dre_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "dre_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(10,2),
    "expectedBalance" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashRegisterId" TEXT NOT NULL,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierDoc" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invoiceNumber" TEXT,
    "invoiceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dreCategoryId" TEXT,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "emitente" TEXT NOT NULL,
    "emitenteDoc" TEXT NOT NULL,
    "emitenteCidade" TEXT,
    "emitentUF" TEXT,
    "destinatarioDoc" TEXT,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "valorFrete" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valorDesconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valorImposto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "xmlRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "numeroItem" INTEGER NOT NULL,
    "codigoProduto" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT,
    "cfop" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "ingredientId" TEXT,
    "invoiceId" TEXT NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "platformFeePerc" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "platformFeeFixed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentFeePerc" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "targetMarginPerc" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "manualMultiplier" DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "costPrice" DECIMAL(10,4) NOT NULL,
    "markupPerc" DECIMAL(7,4) NOT NULL,
    "suggestedPrice" DECIMAL(10,2) NOT NULL,
    "finalPrice" DECIMAL(10,2) NOT NULL,
    "realMarginPerc" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL DEFAULT 'moto',
    "kmPerLiter" DECIMAL(6,2) NOT NULL DEFAULT 20,
    "fuelCostPerLiter" DECIMAL(6,2) NOT NULL DEFAULT 6.50,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feePerKm" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "baseRadiusKm" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_quotes" (
    "id" TEXT NOT NULL,
    "distanceKm" DECIMAL(8,2) NOT NULL,
    "ownFleetCost" DECIMAL(10,2) NOT NULL,
    "ownFleetBreakdown" JSONB NOT NULL,
    "appDeliveryCost" DECIMAL(10,2) NOT NULL,
    "recommendation" TEXT NOT NULL,
    "estimatedSaving" DECIMAL(10,2) NOT NULL,
    "chosenOption" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fleetId" TEXT,

    CONSTRAINT "delivery_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_name_key" ON "tenants"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_tenantId_key" ON "users"("email", "tenantId");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_tenantId_key" ON "products"("sku", "tenantId");

-- CreateIndex
CREATE INDEX "product_ingredients_tenantId_idx" ON "product_ingredients"("tenantId");

-- CreateIndex
CREATE INDEX "product_ingredients_productId_idx" ON "product_ingredients"("productId");

-- CreateIndex
CREATE INDEX "product_ingredients_ingredientId_idx" ON "product_ingredients"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_productId_ingredientId_key" ON "product_ingredients"("productId", "ingredientId");

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_createdById_idx" ON "orders"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_tenantId_key" ON "orders"("orderNumber", "tenantId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_orderId_key" ON "deliveries"("orderId");

-- CreateIndex
CREATE INDEX "deliveries_tenantId_idx" ON "deliveries"("tenantId");

-- CreateIndex
CREATE INDEX "deliveries_assignedToId_idx" ON "deliveries"("assignedToId");

-- CreateIndex
CREATE INDEX "ingredients_tenantId_idx" ON "ingredients"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_sku_tenantId_key" ON "ingredients"("sku", "tenantId");

-- CreateIndex
CREATE INDEX "dre_categories_tenantId_idx" ON "dre_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "dre_categories_code_tenantId_key" ON "dre_categories"("code", "tenantId");

-- CreateIndex
CREATE INDEX "cash_registers_tenantId_idx" ON "cash_registers"("tenantId");

-- CreateIndex
CREATE INDEX "cash_entries_cashRegisterId_idx" ON "cash_entries"("cashRegisterId");

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_idx" ON "accounts_payable"("tenantId");

-- CreateIndex
CREATE INDEX "accounts_payable_dreCategoryId_idx" ON "accounts_payable"("dreCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_chaveAcesso_key" ON "invoices"("chaveAcesso");

-- CreateIndex
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_items_ingredientId_idx" ON "invoice_items"("ingredientId");

-- CreateIndex
CREATE INDEX "sales_channels_tenantId_idx" ON "sales_channels"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_channels_slug_tenantId_key" ON "sales_channels"("slug", "tenantId");

-- CreateIndex
CREATE INDEX "pricing_rules_tenantId_idx" ON "pricing_rules"("tenantId");

-- CreateIndex
CREATE INDEX "pricing_rules_productId_idx" ON "pricing_rules"("productId");

-- CreateIndex
CREATE INDEX "pricing_rules_channelId_idx" ON "pricing_rules"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_productId_channelId_key" ON "pricing_rules"("productId", "channelId");

-- CreateIndex
CREATE INDEX "fleet_tenantId_idx" ON "fleet"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_quotes_orderId_key" ON "delivery_quotes"("orderId");

-- CreateIndex
CREATE INDEX "delivery_quotes_tenantId_idx" ON "delivery_quotes"("tenantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_salesChannelId_fkey" FOREIGN KEY ("salesChannelId") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dre_categories" ADD CONSTRAINT "dre_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "dre_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dre_categories" ADD CONSTRAINT "dre_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_dreCategoryId_fkey" FOREIGN KEY ("dreCategoryId") REFERENCES "dre_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sales_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet" ADD CONSTRAINT "fleet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "fleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
