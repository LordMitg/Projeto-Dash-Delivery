-- Abre o livro de estoque para saldos que ja existiam antes da auditoria.
-- Nao tenta inventar a origem historica: registra apenas o ponto de partida.
INSERT INTO "stock_movements" (
  "id",
  "type",
  "delta",
  "balanceBefore",
  "balanceAfter",
  "reason",
  "sourceType",
  "tenantId",
  "ingredientId",
  "createdAt"
)
SELECT
  'stock_baseline_' || ingredient."id",
  'initial',
  ingredient."stock",
  0,
  ingredient."stock",
  'Saldo existente na ativacao do livro de estoque',
  'migration',
  ingredient."tenantId",
  ingredient."id",
  CURRENT_TIMESTAMP
FROM "ingredients" ingredient
WHERE ingredient."stock" <> 0
  AND NOT EXISTS (
    SELECT 1
    FROM "stock_movements" movement
    WHERE movement."ingredientId" = ingredient."id"
  );
