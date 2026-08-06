-- Etapa 3 de 3 do multi-negocio: remove o vinculo 1:1 `users.tenantId` agora que
-- todo usuario tem o seu `Membership` (criado na migration de backfill anterior),
-- e torna o email unico GLOBAL.
--
-- Ordem importa: a rede de seguranca roda ANTES do DROP, para nunca existir um
-- instante em que o vinculo antigo foi apagado sem o novo estar no lugar.

-- 1) Rede de seguranca: se algum usuario ainda estiver sem vinculo, aborta a
--    migration inteira. Sem isso, o DROP abaixo deixaria a conta sem acesso a
--    nenhuma loja e sem como recuperar de qual loja ela era.
DO $$
DECLARE
  orfaos INT;
BEGIN
  SELECT COUNT(*) INTO orfaos
  FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m."userId" = u.id);

  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Abortado: % usuario(s) sem membership. Rode o backfill antes de remover users.tenantId.',
      orfaos;
  END IF;
END $$;

-- 2) Rede de seguranca: email duplicado faria o indice unico global falhar no
--    meio da migration. Falha aqui com mensagem explicita em vez de erro cru.
DO $$
DECLARE
  dups INT;
BEGIN
  SELECT COUNT(*) INTO dups FROM (
    SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1
  ) t;

  IF dups > 0 THEN
    RAISE EXCEPTION
      'Abortado: % email(s) repetido(s) em users. Resolva os duplicados antes de aplicar o unique global.',
      dups;
  END IF;
END $$;

-- 3) Remove o unique composto por loja e a FK/indice do vinculo antigo.
DROP INDEX IF EXISTS "users_email_tenantId_key";
DROP INDEX IF EXISTS "users_tenantId_idx";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_tenantId_fkey";

-- 4) Remove a coluna do vinculo 1:1. O acesso agora vem de `memberships`.
ALTER TABLE "users" DROP COLUMN IF EXISTS "tenantId";

-- 5) Email passa a ser unico global: e o identificador do login, agora que uma
--    unica conta atende varias lojas.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
