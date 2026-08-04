# CHECKPOINT TECNICO — ETAPA 3
# ERP/PDV Delivery — Multi-Tenant
# Data: 04/08/2026

---

## 1. ARVORE DE ARQUIVOS ATUALIZADA

```
projeto-dash-delivery/
│
├── CHECKPOINT_ETAPA_1.md
├── CHECKPOINT_ETAPA_2A.md
├── CHECKPOINT_ETAPA_3.md          ← este arquivo
├── .gitignore
├── README.md
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma          ← 14 modelos, 416 linhas
│   └── src/
│       ├── middleware/
│       │   └── tenant.ts          ← extrai e valida tenant_id do JWT
│       ├── routes/
│       │   ├── ingredientRoutes.ts  ← CRUD insumos (5 endpoints)
│       │   ├── productRoutes.ts     ← CRUD produtos + ficha técnica (7 endpoints)
│       │   └── invoiceRoutes.ts     ← importação NF-e (4 endpoints)
│       └── services/
│           ├── tenantService.ts     ← validação e operações de tenant
│           ├── cmvService.ts        ← cálculo CMV, PMP, propagação de preços
│           └── invoiceService.ts    ← parser XML SEFAZ + transação de importação
│
└── frontend/
    ├── index.html
    └── src/
        ├── main.tsx
        ├── pages/
        │   └── App.tsx
        ├── context/
        │   └── TenantContext.tsx   ← estado global: tenant ativo, lista de tenants
        └── components/
            ├── Sidebar.tsx            ← navegação + seletor de empresa
            ├── Dashboard.tsx          ← painel principal (esqueleto)
            ├── IngredientsManagement.tsx  ← CRUD insumos
            ├── TechnicalSheet.tsx         ← ficha técnica + preview CMV em tempo real
            └── InvoiceImporter.tsx        ← importador NF-e 5 etapas
```

---

## 2. SCHEMA DO BANCO DE DADOS (Prisma — Completo)

### Tabela: `tenants`
| Coluna      | Tipo     | Constraints               |
|-------------|----------|---------------------------|
| id          | String   | PK, cuid()                |
| name        | String   | unique                    |
| slug        | String   | unique                    |
| email       | String   |                           |
| phone       | String?  |                           |
| address     | String?  |                           |
| city        | String?  |                           |
| state       | String?  |                           |
| zipCode     | String?  |                           |
| active      | Boolean  | default(true)             |
| createdAt   | DateTime | default(now())            |
| updatedAt   | DateTime | updatedAt                 |

### Tabela: `users`
| Coluna      | Tipo     | Constraints                        |
|-------------|----------|------------------------------------|
| id          | String   | PK, cuid()                         |
| email       | String   | unique(email, tenantId)            |
| password    | String   | bcrypt hash                        |
| firstName   | String   |                                    |
| lastName    | String   |                                    |
| role        | String   | default("staff") — admin/manager/staff/delivery |
| active      | Boolean  | default(true)                      |
| tenantId    | String   | FK → tenants.id CASCADE            |
| createdAt   | DateTime |                                    |
| updatedAt   | DateTime |                                    |

### Tabela: `customers`
| Coluna    | Tipo    | Constraints             |
|-----------|---------|-------------------------|
| id        | String  | PK, cuid()              |
| name      | String  |                         |
| email     | String? |                         |
| phone     | String  |                         |
| address   | String  |                         |
| city      | String  |                         |
| state     | String  |                         |
| zipCode   | String  |                         |
| tenantId  | String  | FK → tenants.id CASCADE |

### Tabela: `products`
| Coluna                | Tipo     | Constraints                                 |
|-----------------------|----------|---------------------------------------------|
| id                    | String   | PK, cuid()                                  |
| name                  | String   |                                             |
| description           | String?  |                                             |
| sku                   | String   | unique(sku, tenantId)                       |
| price                 | Decimal  | 10,2 — preço de venda                       |
| costPrice             | Decimal  | 10,2 — CMV calculado, default(0)            |
| laborCost             | Decimal  | 10,2 — mão de obra, default(0)              |
| category              | String?  |                                             |
| productType           | String   | default("simple") — simple ou combo         |
| active                | Boolean  | default(true)                               |
| stock                 | Int      | default(0)                                  |
| comboOptions          | Json?    | [{group, label, ingredientId}]              |
| packagingIngredientId | String?  | id do insumo embalagem principal            |
| tenantId              | String   | FK → tenants.id CASCADE                     |

### Tabela: `product_ingredients` (Ficha Técnica)
| Coluna         | Tipo    | Constraints                           |
|----------------|---------|---------------------------------------|
| id             | String  | PK, cuid()                            |
| quantity       | Decimal | 10,4 — qtd usada na receita           |
| unitCost       | Decimal | 10,4 — custo unitário no cadastro     |
| totalCost      | Decimal | 10,4 — qty × unitCost × (1+perda%)   |
| isMainProtein  | Boolean | default(false) — flag para combo      |
| isPackaging    | Boolean | default(false) — flag embalagem       |
| notes          | String? |                                       |
| tenantId       | String  | FK → tenants.id CASCADE               |
| productId      | String  | FK → products.id CASCADE              |
| ingredientId   | String  | FK → ingredients.id                   |
| unique         |         | (productId, ingredientId)             |

### Tabela: `orders`
| Coluna      | Tipo    | Constraints                                       |
|-------------|---------|---------------------------------------------------|
| id          | String  | PK, cuid()                                        |
| orderNumber | String  | unique(orderNumber, tenantId)                     |
| status      | String  | pending/confirmed/preparing/ready/dispatched/delivered/cancelled |
| totalAmount | Decimal | 10,2                                              |
| tenantId    | String  | FK → tenants.id CASCADE                           |
| customerId  | String  | FK → customers.id                                 |
| createdById | String  | FK → users.id                                     |

### Tabela: `order_items`
| Coluna    | Tipo    | Constraints              |
|-----------|---------|--------------------------|
| id        | String  | PK, cuid()               |
| quantity  | Int     |                          |
| unitPrice | Decimal | 10,2                     |
| subtotal  | Decimal | 10,2                     |
| orderId   | String  | FK → orders.id CASCADE   |
| productId | String  | FK → products.id         |

### Tabela: `deliveries`
| Coluna        | Tipo     | Constraints                    |
|---------------|----------|--------------------------------|
| id            | String   | PK, cuid()                     |
| status        | String   | pending/assigned/in_transit/delivered/failed |
| estimatedTime | DateTime?|                                |
| actualTime    | DateTime?|                                |
| tenantId      | String   | FK → tenants.id CASCADE        |
| orderId       | String   | FK → orders.id CASCADE, unique |
| assignedToId  | String?  | FK → users.id                  |

### Tabela: `ingredients`
| Coluna        | Tipo    | Constraints                    |
|---------------|---------|--------------------------------|
| id            | String  | PK, cuid()                     |
| name          | String  |                                |
| description   | String? |                                |
| sku           | String  | unique(sku, tenantId)          |
| unit          | String  | kg/l/un/g/ml etc               |
| price         | Decimal | 10,2 — preço unitário atual    |
| breakageFactor| Decimal | 5,2 — % de perda/quebra        |
| stock         | Int     | default(0)                     |
| minimumStock  | Int     | default(0)                     |
| active        | Boolean | default(true)                  |
| tenantId      | String  | FK → tenants.id CASCADE        |

### Tabela: `dre_categories`
| Coluna   | Tipo    | Constraints                          |
|----------|---------|--------------------------------------|
| id       | String  | PK, cuid()                           |
| name     | String  | ex: "Custo de Mercadoria Vendida"    |
| code     | String  | unique(code, tenantId) — ex: "CMV"  |
| type     | String  | revenue / expense / cogs             |
| parentId | String? | FK → dre_categories.id (hierarquia) |
| active   | Boolean | default(true)                        |
| tenantId | String  | FK → tenants.id CASCADE              |

### Tabela: `cash_registers` (Caixa)
| Coluna          | Tipo     | Constraints                    |
|-----------------|----------|--------------------------------|
| id              | String   | PK, cuid()                     |
| openedAt        | DateTime | default(now())                 |
| closedAt        | DateTime?|                                |
| openingBalance  | Decimal  | 10,2 — saldo inicial           |
| closingBalance  | Decimal? | 10,2 — saldo no fechamento     |
| expectedBalance | Decimal? | 10,2 — saldo esperado          |
| difference      | Decimal? | 10,2 — closing - expected      |
| status          | String   | open / closed                  |
| notes           | String?  |                                |
| openedById      | String   | id do usuário que abriu        |
| tenantId        | String   | FK → tenants.id CASCADE        |

### Tabela: `cash_entries` (Lancamentos de Caixa)
| Coluna          | Tipo    | Constraints                    |
|-----------------|---------|--------------------------------|
| id              | String  | PK, cuid()                     |
| type            | String  | income / expense               |
| amount          | Decimal | 10,2                           |
| description     | String  |                                |
| paymentMethod   | String  | cash/credit/debit/pix          |
| referenceType   | String? | order / invoice / manual       |
| referenceId     | String? | id do documento vinculado      |
| cashRegisterId  | String  | FK → cash_registers.id CASCADE |

### Tabela: `accounts_payable` (Contas a Pagar)
| Coluna        | Tipo     | Constraints                    |
|---------------|----------|--------------------------------|
| id            | String   | PK, cuid()                     |
| description   | String   |                                |
| supplierName  | String   |                                |
| supplierDoc   | String?  | CNPJ/CPF                       |
| amount        | Decimal  | 10,2                           |
| amountPaid    | Decimal  | 10,2 — default(0)              |
| dueDate       | DateTime |                                |
| paidAt        | DateTime?|                                |
| status        | String   | pending/partial/paid/overdue   |
| invoiceNumber | String?  |                                |
| invoiceId     | String?  | FK fraco para Invoice          |
| tenantId      | String   | FK → tenants.id CASCADE        |
| dreCategoryId | String?  | FK → dre_categories.id         |

### Tabela: `invoices` (Nota Fiscal — Cabecalho)
| Coluna          | Tipo     | Constraints                      |
|-----------------|----------|----------------------------------|
| id              | String   | PK, cuid()                       |
| chaveAcesso     | String   | unique — 44 digitos SEFAZ        |
| numero          | String   |                                  |
| serie           | String   |                                  |
| emitente        | String   | Razao social fornecedor          |
| emitenteDoc     | String   | CNPJ emitente                    |
| emitenteCidade  | String?  |                                  |
| emitenteUF      | String?  |                                  |
| destinatarioDoc | String?  | CNPJ tenant                      |
| dataEmissao     | DateTime |                                  |
| valorTotal      | Decimal  | 10,2                             |
| valorFrete      | Decimal  | 10,2 — default(0)                |
| valorDesconto   | Decimal  | 10,2 — default(0)                |
| valorImposto    | Decimal  | 10,2 — default(0)                |
| status          | String   | imported / processed / cancelled |
| xmlRaw          | String?  | Text — XML original              |
| tenantId        | String   | FK → tenants.id CASCADE          |

### Tabela: `invoice_items` (Itens da Nota Fiscal)
| Coluna        | Tipo    | Constraints                      |
|---------------|---------|----------------------------------|
| id            | String  | PK, cuid()                       |
| numeroItem    | Int     |                                  |
| codigoProduto | String  | codigo no fornecedor             |
| descricao     | String  |                                  |
| ncm           | String? | classificacao fiscal             |
| cfop          | String? |                                  |
| unit          | String  |                                  |
| quantity      | Decimal | 10,4                             |
| unitPrice     | Decimal | 10,4                             |
| totalPrice    | Decimal | 10,2                             |
| ingredientId  | String? | FK → ingredients.id (mapeamento) |
| invoiceId     | String  | FK → invoices.id CASCADE         |

---

## 3. LOGICAS CRITICAS IMPLEMENTADAS

### 3.1 Multi-Tenant (tenant.ts)
- Middleware extrai `tenant_id` do JWT em cada requisicao
- Todas as queries Prisma recebem `where: { tenantId }` obrigatoriamente
- Tentativa de acesso a dado de outro tenant retorna 403
- Email de usuario e unico por tenant (nao globalmente)

### 3.2 CMV — Calculo de Custo (cmvService.ts)
```
Para cada linha da ficha tecnica:
  effectiveQty  = quantity × (1 + breakageFactor / 100)
  lineCost      = effectiveQty × ingredient.price

totalIngredients = soma de todas as lineCost
totalCMV         = totalIngredients + product.laborCost
grossMargin      = ((salePrice - totalCMV) / salePrice) × 100
```
- `previewCmv()` calcula sem persistir (usado no frontend com debounce 400ms)
- `recalculateCmvForIngredients([ids])` propaga atualizacoes de preco para todos
  os produtos afetados em uma unica transacao

### 3.3 Regra de Combo (cmvService.ts — resolveComboProtein)
- Produto tipo "combo" tem N opcoes visuais em `comboOptions` (JSON)
- Apenas 1 item da ficha tecnica tem `isMainProtein = true`
- Na geracao do pedido, `resolveComboProtein()` recebe a escolha do cliente,
  identifica o ingrediente correto e debita SOMENTE aquele do estoque
- Embalagem divisoria: item com `isPackaging = true` e FK em
  `packagingIngredientId` no produto — calculada automaticamente pelo CMV

### 3.4 Preco Medio Ponderado — PMP (invoiceService.ts)
```
novoPMP = (estoqueAtual × precoAtual + qtdNF × precoUnitNF)
          / (estoqueAtual + qtdNF)
```
- Aplicado a cada item da NF durante `processInvoice()`
- Executa dentro de `prisma.$transaction` — atomico
- Apos commit, dispara `recalculateCmvForIngredients()` para propagar o novo
  preco a todas as fichas tecnicas dos produtos afetados

### 3.5 Transacao de Importacao de NF (invoiceService.ts — processInvoice)
Dentro de uma unica `prisma.$transaction`:
1. Persiste cabecalho `Invoice`
2. Para cada item mapeado: atualiza `stock` e `price` do Ingredient (PMP)
3. Cria `AccountPayable` com vencimento e valor total da NF
4. Se caixa ativo informado: cria `CashEntry` tipo expense
5. Fora da transacao: propaga CMV para produtos afetados

### 3.6 Parser XML SEFAZ (invoiceService.ts — parseInvoiceXml)
- Usa `xml2js` com `explicitArray: false`
- Suporta estrutura `nfeProc > NFe > infNFe` (padrao SEFAZ nacional)
- Normaliza itens em array mesmo quando a NF tem apenas 1 item
- Retorna `ParsedInvoice` tipado com todos os campos necessarios

---

## 4. DEPENDENCIAS INSTALADAS

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
    "xml2js": "^0.6.2",       ← Etapa 3: parser NF-e XML SEFAZ
    "multer": "^1.4.5-lts.1"  ← Etapa 3: upload de arquivo XML
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/multer": "^1.4.11",  ← Etapa 3
    "@types/node": "^20.10.6",
    "@types/xml2js": "^0.4.14",  ← Etapa 3
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
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.0",
    "zustand": "^4.4.7"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.0"
  }
}
```

---

## 5. PROXIMO PASSO EXATO — ETAPA 4: PDV e Pedidos

### Objetivo
Construir o modulo central do sistema: o Point of Sale (PDV) para registrar pedidos
em tempo real, com suporte a combos, e o painel de acompanhamento de pedidos.

### Subtarefas em ordem:

**4A — Schema (adicoes cirurgicas no schema.prisma):**
- Adicionar campo `selectedProteinId String?` em `order_items`
  (armazena a proteina escolhida no combo para aquele item)
- Adicionar campo `observations String?` em `order_items`
- Adicionar campo `discount Decimal?` em `orders`
- Adicionar campo `paymentMethod String?` em `orders`
- Adicionar modelo `Table` (mesas para modo salao — opcional por tenant)

**4B — Backend (productRoutes.ts + novas orderRoutes.ts):**
- `POST /api/orders` — cria pedido dentro de `$transaction`:
  1. Valida estoque de cada item
  2. Chama `resolveComboProtein()` para itens combo
  3. Debita estoque dos ingredientes (via ficha tecnica)
  4. Persiste `Order` + `OrderItems`
  5. Cria `CashEntry` income no caixa ativo
- `GET /api/orders?status=pending` — lista pedidos por status
- `PATCH /api/orders/:id/status` — avanca status do pedido
- `GET /api/orders/:id` — detalhe completo com itens e entrega

**4C — Frontend:**
- `PDV.tsx` — tela de caixa: busca produtos, monta carrinho, exibe popup de
  escolha de proteina para combos, calcula total com desconto
- `OrderBoard.tsx` — kanban de pedidos (Pendente → Preparando → Pronto → Enviado)
- `OrderDetail.tsx` — modal com resumo do pedido e botao de avanco de status

**Comando para criar a migration apos o schema:**
```bash
cd backend
npx prisma migrate dev --name etapa4_pedidos_pdv
```

**Arquivos a criar:**
```
backend/src/routes/orderRoutes.ts
frontend/src/components/PDV.tsx
frontend/src/components/OrderBoard.tsx
frontend/src/components/OrderDetail.tsx
```

**Criterio de conclusao da Etapa 4:**
- [ ] Pedido criado pelo PDV debita estoque dos ingredientes via ficha tecnica
- [ ] Combo registra a proteina escolhida no `order_item`
- [ ] Status do pedido avanca via PATCH e aparece em tempo real no OrderBoard
- [ ] CashEntry income criado automaticamente ao confirmar o pedido

---

## HISTORICO DE ETAPAS

| Etapa | Status | Descricao                                         |
|-------|--------|---------------------------------------------------|
| 1     | OK     | Arquitetura base, Multi-Tenant, Sidebar, Context  |
| 2A    | OK     | Modulo Insumos (Ingredients) CRUD                 |
| 2B    | OK     | Ficha Tecnica, CMV, Regra Combo, Embalagem        |
| 3     | OK     | NF-e XML, Caixa, Contas a Pagar, DRE, PMP         |
| 4     | NEXT   | PDV, Pedidos, Kanban, Debito de Estoque           |
| 5     | -      | Entregas, Motoboy, Rastreamento                   |
| 6     | -      | DRE, Relatorios, Dashboard Financeiro             |
| 7     | -      | Electron (empacotamento desktop)                  |
