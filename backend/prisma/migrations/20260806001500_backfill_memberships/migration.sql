-- Backfill dos vinculos conta<->negocio.
--
-- Roda ANTES de remover `users.tenantId`: cada usuario existente ganha um
-- Membership apontando para a loja que ele ja tinha. Se essa ordem se
-- invertesse, o vinculo original seria perdido e ninguem mais entraria.
--
-- Mapeamento de papel:
--   admin           -> owner (acesso total, `permissions` vazio de proposito)
--   manager         -> staff com as permissoes equivalentes ao que ja acessava
--   staff/cashier   -> staff com o basico de operacao
--   delivery        -> staff so com leitura de pedidos
--
-- `gen_random_uuid()` vem da extensao pgcrypto, presente por padrao no
-- PostgreSQL 13+. O id nao precisa ser cuid: nada depende do formato.
INSERT INTO "memberships" ("id", "userId", "tenantId", "role", "permissions", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."tenantId",
  CASE WHEN u."role" = 'admin' THEN 'owner' ELSE 'staff' END,
  CASE
    WHEN u."role" = 'admin' THEN ARRAY[]::text[]
    WHEN u."role" = 'manager' THEN ARRAY[
      'pdv:use','kitchen:view','scanner:use',
      'orders:view','orders:manage',
      'products:view','products:manage',
      'ingredients:view','ingredients:manage','invoices:manage',
      'customers:view','customers:manage',
      'pricing:view','reports:view'
    ]::text[]
    WHEN u."role" = 'delivery' THEN ARRAY['orders:view']::text[]
    ELSE ARRAY['pdv:use','orders:view','customers:view']::text[]
  END,
  NOW(),
  NOW()
FROM "users" u
-- Idempotente: reexecutar a migration nao duplica vinculos.
WHERE NOT EXISTS (
  SELECT 1 FROM "memberships" m
  WHERE m."userId" = u."id" AND m."tenantId" = u."tenantId"
);

-- Garante que toda loja tenha ao menos um dono. Uma loja cujo unico usuario era
-- 'manager' ficaria sem ninguem capaz de gerenciar funcionarios e configuracoes;
-- nesse caso, promove o usuario mais antigo da loja a owner.
UPDATE "memberships" m
SET "role" = 'owner', "permissions" = ARRAY[]::text[]
WHERE m."id" IN (
  SELECT DISTINCT ON (m2."tenantId") m2."id"
  FROM "memberships" m2
  WHERE NOT EXISTS (
    SELECT 1 FROM "memberships" m3
    WHERE m3."tenantId" = m2."tenantId" AND m3."role" = 'owner'
  )
  ORDER BY m2."tenantId", m2."createdAt" ASC
);
