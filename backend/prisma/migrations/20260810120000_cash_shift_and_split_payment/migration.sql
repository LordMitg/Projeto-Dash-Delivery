-- Caixa (turno) e pagamento misto.
--
-- Estas estruturas existiam apenas em `schema.prisma`: nenhuma migration as
-- criava. O resultado era um banco em que `prisma migrate status` dizia "up to
-- date" (as 6 migrations estavam aplicadas) enquanto o Prisma Client, gerado a
-- partir do schema, pedia colunas inexistentes. Na pratica:
--
--   - `GET /api/cash/current` respondia 500 (`P2022: cash_registers.closedById`),
--     e como o PDV usa essa rota para decidir se pode vender, a frente de caixa
--     ficava travada em "caixa fechado" para sempre.
--   - `order_payments` nao existia, entao NENHUMA venda podia ser gravada: o
--     fechamento do PDV cria as parcelas de pagamento na mesma transacao do
--     pedido.
--
-- Tudo aqui e aditivo (colunas anulaveis, tabela nova, indices e FKs), entao
-- roda sobre uma base com dados sem perder nada.

-- ---------------------------------------------------------------------------
-- Responsavel pelos movimentos: sangria e despesa precisam de nome atras.
-- Anulavel de proposito — lancamentos de venda sao criados pelo sistema, e os
-- registros que ja existirem no banco nao tem como saber quem os fez.
-- ---------------------------------------------------------------------------
ALTER TABLE "cash_entries" ADD COLUMN "createdById" TEXT;

-- Quem fechou o turno. Anulavel porque um turno aberto ainda nao tem esse dado.
ALTER TABLE "cash_registers" ADD COLUMN "closedById" TEXT;

-- Turno a que a venda pertence. Anulavel: pedidos anteriores a este modulo
-- (e pedidos de canais que nao passam pelo PDV) nao tem caixa associado.
ALTER TABLE "orders" ADD COLUMN "cashRegisterId" TEXT;

-- ---------------------------------------------------------------------------
-- Pagamento misto: uma venda pode ter varias formas.
--
-- `Order.paymentMethod` continua existindo e guarda a forma predominante, para
-- as telas e relatorios antigos nao quebrarem; o detalhe (e o troco) mora aqui.
-- ---------------------------------------------------------------------------
CREATE TABLE "order_payments" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    -- Nota entregue pelo cliente (ex.: R$ 50 numa conta de R$ 37). So faz
    -- sentido em especie, por isso e anulavel.
    "changeFor" DECIMAL(10,2),
    "changeAmount" DECIMAL(10,2),
    "cardBrand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------
CREATE INDEX "order_payments_orderId_idx" ON "order_payments"("orderId");

-- `type` e filtrado em todo resumo de caixa (entradas x saidas).
CREATE INDEX "cash_entries_type_idx" ON "cash_entries"("type");

-- `findOpenRegister` busca por status a cada venda: e a consulta mais quente
-- do PDV.
CREATE INDEX "cash_registers_status_idx" ON "cash_registers"("status");

CREATE INDEX "orders_cashRegisterId_idx" ON "orders"("cashRegisterId");

-- ---------------------------------------------------------------------------
-- Chaves estrangeiras
-- ---------------------------------------------------------------------------

-- SET NULL, e nao CASCADE: apagar um turno jamais pode apagar os pedidos dele.
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashRegisterId_fkey"
  FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE aqui e correto: uma parcela de pagamento nao existe sem o pedido.
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: quem abriu o caixa nao pode ser removido enquanto houver turno
-- apontando para ele — a conferencia perderia o responsavel.
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
