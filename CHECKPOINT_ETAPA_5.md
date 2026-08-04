# CHECKPOINT TECNICO — ETAPA 5
# ERP/PDV Delivery — Multi-Tenant
# Data: 04/08/2026 | Versao: 5.0.0

---

## 1. ARVORE DE ARQUIVOS

```
projeto-dash-delivery/
├── CHECKPOINT_ETAPA_1.md
├── CHECKPOINT_ETAPA_2A.md
├── CHECKPOINT_ETAPA_3.md
├── CHECKPOINT_ETAPA_5.md          <- este arquivo
├── .gitignore
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma          <- 18 modelos | 580 linhas
│   └── src/
│       ├── middleware/
│       │   └── tenant.ts          <- isolamento JWT por tenant
│       ├── routes/
│       │   ├── ingredientRoutes.ts    <- 5 endpoints CRUD
│       │   ├── productRoutes.ts       <- 7 endpoints + preview-cmv
│       │   ├── invoiceRoutes.ts       <- 4 endpoints NF-e
│       │   ├── orderRoutes.ts         <- 6 endpoints PDV + LTV
│       │   └── pricingRoutes.ts       <- 8 endpoints canais/frota
│       └── services/
│           ├── tenantService.ts       <- validacao e operacoes de tenant
│           ├── cmvService.ts          <- calculo CMV + combo + ficha tecnica
│           ├── invoiceService.ts      <- processamento NF + PMP + transacao
│           ├── pricingService.ts      <- markup reverso + precificacao multicanal
│           └── logisticsService.ts    <- cotacao frota propria vs app
│
├── electron/
│   ├── main.ts                    <- IPC + ESC/POS USB (cozinha + entregador)
│   └── preload.ts                 <- contextBridge seguro
│
└── frontend/
    └── src/
        ├── context/
        │   └── TenantContext.tsx   <- estado global de empresa ativa
        ├── hooks/
        │   └── usePrinter.ts      <- abstrai IPC Electron para o renderer
        ├── pages/
        │   └── App.tsx            <- layout principal com Sidebar
        └── components/
            ├── Sidebar.tsx                <- troca de empresa + navegacao
            ├── Dashboard.tsx              <- painel principal
            ├── IngredientsManagement.tsx  <- CRUD insumos (515 linhas)
            ├── TechnicalSheet.tsx         <- ficha tecnica + CMV live (539 linhas)
            ├── InvoiceImporter.tsx        <- importacao NF-e 5 etapas (485 linhas)
            ├── PDV.tsx                    <- ponto de venda + impressao (804 linhas)
            └── PricingPanel.tsx           <- precificacao + despacho (626 linhas)
```

---

## 2. BANCO DE DADOS — 18 TABELAS

### tenants
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name | String UNIQUE | Razao social |
| slug | String UNIQUE | URL-friendly |
| email | String | |
| phone | String? | |
| address, city, state, zipCode | String? | |
| active | Boolean default(true) | |
| createdAt, updatedAt | DateTime | |

### users
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| email | String | UNIQUE com tenantId |
| password | String | Hash bcrypt |
| firstName, lastName | String | |
| role | String default("staff") | admin/manager/staff/delivery |
| active | Boolean default(true) | |
| tenantId | String FK | Cascade delete |

### customers
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name, phone | String | |
| email | String? | |
| address, city, state, zipCode | String? | |
| notes | String? | |
| ltv | Decimal(10,2) default(0) | Lifetime Value acumulado |
| totalOrders | Int default(0) | Contador de pedidos |
| lastOrderAt | DateTime? | Data do ultimo pedido |
| tenantId | String FK | Cascade delete |

### products
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name, description?, sku | String | UNIQUE(sku, tenantId) |
| price | Decimal(10,2) | Preco de venda |
| costPrice | Decimal(10,2) default(0) | CMV calculado automaticamente |
| laborCost | Decimal(10,2) default(0) | Mao de obra fixa por unidade |
| category? | String | |
| productType | String default("simple") | simple / combo |
| active | Boolean default(true) | |
| stock | Int default(0) | |
| comboOptions | Json? | [{group, label, ingredientId}] |
| packagingIngredientId | String? | FK para embalagem divisoria |
| tenantId | String FK | Cascade delete |

### product_ingredients (Ficha Tecnica)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| quantity | Decimal(10,4) | Qtd usada na receita |
| unitCost | Decimal(10,4) | Snapshot do preco no cadastro |
| totalCost | Decimal(10,4) | qty x unitCost x (1+perda%) |
| isMainProtein | Boolean default(false) | Proteina principal do combo |
| isPackaging | Boolean default(false) | Marca como embalagem |
| notes | String? | |
| tenantId | String FK | Cascade delete |
| productId | String FK | Cascade delete |
| ingredientId | String FK | |
| UNIQUE(productId, ingredientId) | | |

### orders
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| orderNumber | String | UNIQUE com tenantId |
| status | String default("pending") | pending/confirmed/preparing/ready/dispatched/delivered/cancelled |
| orderType | String default("delivery") | delivery / balcao / mesa |
| totalAmount | Decimal(10,2) | |
| discount | Decimal(10,2) default(0) | |
| paymentMethod | String default("cash") | cash/credit/debit/pix/voucher |
| paymentStatus | String default("pending") | pending / paid |
| observations | String? | |
| printedKitchen | Boolean default(false) | Comanda cozinha impressa |
| printedDelivery | Boolean default(false) | Comanda entregador impressa |
| distanceKm | Decimal(8,2)? | Para cotacao logistica |
| deliveryAddress | String? | Denormalizado para historico |
| tenantId | String FK | Cascade delete |
| customerId | String? FK | |
| createdById | String FK | |
| salesChannelId | String? FK | Canal de origem do pedido |

### order_items
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| quantity | Int | |
| unitPrice, subtotal | Decimal(10,2) | |
| observations | String? | ex: "sem cebola" |
| selectedProteinId | String? | ingredientId escolhido no combo |
| selectedProteinName | String? | Denormalizado para impressao |
| orderId | String FK | Cascade delete |
| productId | String FK | |

### deliveries
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| status | String default("pending") | pending/assigned/in_transit/delivered/failed |
| estimatedTime, actualTime | DateTime? | |
| tenantId | String FK | Cascade delete |
| orderId | String UNIQUE FK | Cascade delete |
| assignedToId | String? FK | User (motoboy) |

### ingredients
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name, sku | String | UNIQUE(sku, tenantId) |
| description | String? | |
| unit | String | kg/l/un/g/ml |
| price | Decimal(10,2) | Preco unitario atual |
| breakageFactor | Decimal(5,2) default(0) | % de perda/quebra |
| stock | Int default(0) | |
| minimumStock | Int default(0) | |
| active | Boolean default(true) | |
| tenantId | String FK | Cascade delete |

### dre_categories
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name | String | ex: "Custo de Mercadoria Vendida" |
| code | String | ex: "CMV" — UNIQUE com tenantId |
| type | String | revenue / expense / cogs |
| parentId | String? FK self | Auto-relacao hierarquica |
| active | Boolean default(true) | |
| tenantId | String FK | Cascade delete |

### cash_registers (Caixa)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| openedAt | DateTime default(now) | |
| closedAt | DateTime? | |
| openingBalance | Decimal(10,2) default(0) | |
| closingBalance, expectedBalance | Decimal(10,2)? | |
| difference | Decimal(10,2)? | closingBalance - expectedBalance |
| status | String default("open") | open / closed |
| notes | String? | |
| tenantId | String FK | Cascade delete |
| openedById | String | userId |

### cash_entries (Lancamentos de Caixa)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| type | String | income / expense |
| amount | Decimal(10,2) | |
| description | String | |
| paymentMethod | String default("cash") | |
| referenceType | String? | order / invoice / manual |
| referenceId | String? | FK polimorficoa (id do pedido/nota) |
| cashRegisterId | String FK | Cascade delete |

### accounts_payable (Contas a Pagar)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| description, supplierName | String | |
| supplierDoc | String? | CNPJ/CPF |
| amount | Decimal(10,2) | |
| amountPaid | Decimal(10,2) default(0) | |
| dueDate | DateTime | |
| paidAt | DateTime? | |
| status | String default("pending") | pending/partial/paid/overdue |
| invoiceNumber, invoiceId | String? | Referencia a NF |
| notes | String? | |
| tenantId | String FK | Cascade delete |
| dreCategoryId | String? FK | |

### invoices (Nota Fiscal)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| chaveAcesso | String UNIQUE | 44 digitos SEFAZ |
| numero, serie | String | |
| emitente | String | Razao social fornecedor |
| emitenteDoc | String | CNPJ emitente |
| emitenteCidade, emitentUF | String? | |
| destinatarioDoc | String? | CNPJ do tenant |
| dataEmissao | DateTime | |
| valorTotal, valorFrete, valorDesconto, valorImposto | Decimal(10,2) | |
| status | String default("imported") | imported/processed/cancelled |
| xmlRaw | String? Text | XML original armazenado |
| tenantId | String FK | Cascade delete |

### invoice_items
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| numeroItem | Int | |
| codigoProduto, descricao | String | |
| ncm, cfop | String? | |
| unit | String | |
| quantity | Decimal(10,4) | |
| unitPrice | Decimal(10,4) | Preco na nota |
| totalPrice | Decimal(10,2) | |
| ingredientId | String? FK | Mapeamento NF -> insumo interno |
| invoiceId | String FK | Cascade delete |

### sales_channels
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name | String | ex: "iFood" |
| slug | String | UNIQUE com tenantId |
| active | Boolean default(true) | |
| platformFeePerc | Decimal(5,2) default(0) | % taxa da plataforma |
| platformFeeFixed | Decimal(10,2) default(0) | R$ fixo por pedido |
| paymentFeePerc | Decimal(5,2) default(0) | % taxa do gateway/maquininha |
| targetMarginPerc | Decimal(5,2) default(30) | Margem minima desejada (%) |
| manualMultiplier | Decimal(5,4) default(1.0) | Multiplicador manual extra |
| tenantId | String FK | Cascade delete |

### pricing_rules (Snapshot de Precificacao)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| costPrice | Decimal(10,4) | CMV + mao de obra |
| markupPerc | Decimal(7,4) | Markup calculado |
| suggestedPrice | Decimal(10,2) | Preco antes do arredondamento |
| finalPrice | Decimal(10,2) | Preco aprovado (editavel) |
| realMarginPerc | Decimal(7,4) | Margem real apos taxas |
| active | Boolean default(true) | |
| calculatedAt | DateTime | |
| tenantId | String FK | Cascade delete |
| productId | String FK | UNIQUE com channelId |
| channelId | String FK | |

### fleet (Frota Propria)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| name | String | Nome do motoboy/veiculo |
| vehicleType | String default("moto") | moto/carro/bicicleta |
| kmPerLiter | Decimal(6,2) default(20) | Consumo medio |
| fuelCostPerLiter | Decimal(6,2) default(6.50) | Custo combustivel R$/l |
| deliveryFee | Decimal(10,2) default(0) | Taxa fixa por corrida |
| feePerKm | Decimal(6,2) default(0) | Taxa por km extra |
| baseRadiusKm | Decimal(6,2) default(3) | Raio coberto pela taxa fixa |
| active | Boolean default(true) | |
| tenantId | String FK | Cascade delete |

### delivery_quotes (Cotacao Logistica)
| Coluna | Tipo | Observacao |
|--------|------|------------|
| id | String CUID PK | |
| distanceKm | Decimal(8,2) | |
| ownFleetCost | Decimal(10,2) | Custo frota propria |
| ownFleetBreakdown | Json | {fuel, driverFee, extraKmFee} |
| appDeliveryCost | Decimal(10,2) | Custo estimado do app |
| recommendation | String | own_fleet / app_delivery |
| estimatedSaving | Decimal(10,2) | Economia ao seguir recomendacao |
| chosenOption | String? | Decisao do operador |
| decidedAt | DateTime? | |
| tenantId | String FK | Cascade delete |
| orderId | String UNIQUE FK | Cascade delete |
| fleetId | String? FK | |

---

## 3. LOGICAS CRITICAS

### Multi-Tenant (Middleware)
- JWT decodificado no middleware `tenant.ts`
- `tenantId` injetado em `req.tenant` em TODAS as rotas protegidas
- Toda query Prisma usa `where: { tenantId }` — sem excecao
- `TenantContext.tsx` no frontend distribui empresa ativa globalmente

### CMV — Calculo de Custo (cmvService.ts)
```
totalCostLinha = quantidade x precoUnitario x (1 + breakageFactor / 100)
CMV_produto    = SOMA(totalCostLinha) + laborCost
```
- `previewCmv()` calcula sem persistir (usado no formulario live)
- `recalculateAndPersist()` usa `prisma.$transaction` atomico
- `resolveComboProtein()` filtra `isMainProtein = true` das N opcoes visuais

### Preco Medio Ponderado — NF-e (invoiceService.ts)
```
newPMP = (stockAtual x precoAtual + qtdNF x precoNF) / (stockAtual + qtdNF)
```
- Executado dentro de `prisma.$transaction` com:
  1. Criacao de Invoice + InvoiceItems
  2. Atualizacao de stock e price do Ingredient
  3. Criacao de AccountPayable
  4. Criacao de CashEntry (opcional)
  5. `recalculateCmvForIngredients()` — propaga para fichas tecnicas

### Markup Reverso (pricingService.ts)
```
Preco = (CMV + laborCost) / (1 - Tp - Tg - M) + Tf
onde:
  Tp = platformFeePerc / 100
  Tg = paymentFeePerc / 100
  M  = targetMarginPerc / 100
  Tf = platformFeeFixed
```
- Arredondamento psicologico: centavos -> .90
- `recalculateAllPricing()` itera todos produtos x canais ativos em loop
- Upsert via `prisma.pricingRule.upsert` para idempotencia

### Cotacao Logistica (logisticsService.ts)
```
custoFrota = (distKm x 2) / kmPerLiter x fuelCostPerLiter
           + deliveryFee
           + MAX(0, distKm - baseRadiusKm) x feePerKm

custoApp   = totalPedido x (platformFeePerc / 100) + platformFeeFixed
```
- Itera todas as frotas ativas, retorna a mais barata
- Compara com custo do canal de venda do pedido
- Persiste snapshot em `DeliveryQuote` com recomendacao e economia estimada

### PDV + Impressao ESC/POS (electron/main.ts)
- IPC handlers: `printer:list`, `printer:print-kitchen`, `printer:print-delivery`
- Buffer ESC/POS construido em memoria com bytes diretos
- Layout Cozinha: pedido + itens + proteina + obs — corte parcial
- Layout Entregador: cliente + endereco + total em fonte dupla — corte total
- Escrita via `fs.createWriteStream` na porta USB configurada
- `preload.ts` expoe API via `contextBridge` sem `nodeIntegration`

### LTV do Cliente (orderRoutes.ts)
- A cada pedido confirmado: `ltv += totalAmount`, `totalOrders += 1`, `lastOrderAt = now()`
- Executado dentro da mesma transacao de criacao do pedido

---

## 4. DEPENDENCIAS

### backend/package.json
```json
{
  "dependencies": {
    "@prisma/client": "^5.8.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.1.2",
    "multer": "^1.4.5",
    "xml2js": "^0.6.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.10.6",
    "@types/xml2js": "^0.4.14",
    "nodemon": "^3.0.2",
    "prisma": "^5.8.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

### frontend/package.json (a instalar)
```json
{
  "dependencies": {
    "axios": "^1.6.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "zustand": "^4.x"
  },
  "devDependencies": {
    "@types/react": "^18.x",
    "@types/react-dom": "^18.x",
    "electron": "^28.x",
    "typescript": "^5.x",
    "vite": "^5.x",
    "@vitejs/plugin-react": "^4.x"
  }
}
```

---

## 5. PROXIMO PASSO EXATO — ETAPA 6: DRE + Dashboard Gerencial

### Objetivo
Construir o modulo financeiro completo com DRE em tempo real e o Dashboard
gerencial com os KPIs principais do negocio.

### Arquivos a criar
```
backend/src/routes/financialRoutes.ts
  - GET /dre?month=&year=            <- DRE mensal consolidado
  - GET /cashflow?from=&to=          <- Fluxo de caixa por periodo
  - GET /kpis                        <- KPIs do dashboard (ticket medio, CMV%, etc.)
  - POST /cash-register/open         <- Abrir caixa
  - POST /cash-register/close        <- Fechar caixa com conferencia
  - POST /cash-register/entry        <- Lancamento manual

backend/src/services/dreService.ts
  - buildDre(tenantId, month, year)  <- agrega receitas, COGS, despesas por categoria
  - calcKpis(tenantId, period)       <- CMV%, margem bruta, ticket medio, LTV medio

frontend/src/components/DashboardKPIs.tsx   <- cards de KPIs com variacao
frontend/src/components/DreReport.tsx       <- tabela DRE hierarquica
frontend/src/components/CashRegister.tsx    <- abertura/fechamento de caixa
```

### Schema: nenhuma alteracao necessaria
Todas as tabelas necessarias (dre_categories, cash_registers,
cash_entries, accounts_payable) ja existem.

### Formula DRE
```
(+) Receita Bruta        = SUM(orders.totalAmount) WHERE paymentStatus = "paid"
(-) Descontos            = SUM(orders.discount)
(=) Receita Liquida
(-) CMV                  = SUM(orderItems.subtotal x product.costPrice / product.price)
(=) Lucro Bruto
(-) Despesas Operacionais = SUM(accounts_payable.amount) por categoria DRE
(=) EBITDA
(-) Depreciacoes (manual)
(=) Lucro Liquido
```

### Validacao de sucesso da Etapa 6
- [ ] DRE bate com soma manual dos lancamentos
- [ ] Caixa abre com saldo inicial e fecha com diferenca calculada
- [ ] KPIs do dashboard refletem dados reais do banco
- [ ] CMV% exibido por produto e consolidado no periodo

---
