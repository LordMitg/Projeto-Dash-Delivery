-- Script para criar Tenant e Usuário de Teste
-- Execute no PostgreSQL local com: psql -U postgres -d delivery_erp -f seed-test-user.sql

-- Criar Tenant de teste
INSERT INTO "Tenant" (id, name, domain, "createdAt", "updatedAt")
VALUES (
  'tenant_test_001',
  'Minha Empresa Teste',
  'minha-empresa-teste.local',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Criar Usuário Admin de teste (senha: admin123)
-- Hash bcrypt de "admin123": $2a$10$VvS5wV2qfJ0TuF2cJkxQwOd5mKvYtBGxYPqLqlJqBeFZe1H1EljDe
INSERT INTO "User" (
  id,
  email,
  password,
  "firstName",
  "lastName",
  role,
  "tenantId",
  active,
  "createdAt",
  "updatedAt"
)
VALUES (
  'user_admin_test_001',
  'admin@testempresa.com',
  '$2a$10$VvS5wV2qfJ0TuF2cJkxQwOd5mKvYtBGxYPqLqlJqBeFZe1H1EljDe',
  'Admin',
  'Teste',
  'admin',
  'tenant_test_001',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Criar Usuário Caixa de teste (senha: caixa123)
-- Hash bcrypt de "caixa123": $2a$10$EV.nDmSzlI7F4UGqLXxG4O9kd2L.pPvYfN5Xgh3R7.9E2pQr1FHp6
INSERT INTO "User" (
  id,
  email,
  password,
  "firstName",
  "lastName",
  role,
  "tenantId",
  active,
  "createdAt",
  "updatedAt"
)
VALUES (
  'user_caixa_test_001',
  'caixa@testempresa.com',
  '$2a$10$EV.nDmSzlI7F4UGqLXxG4O9kd2L.pPvYfN5Xgh3R7.9E2pQr1FHp6',
  'Caixa',
  'Teste',
  'caixa',
  'tenant_test_001',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Criar alguns Ingredientes de teste
INSERT INTO "Ingredient" (
  id,
  "tenantId",
  sku,
  name,
  category,
  unit,
  costPrice,
  stock,
  "minimumStock",
  "breakageFactor",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'ing_frango_001',
    'tenant_test_001',
    'FRAN-001',
    'Frango Filé',
    'Proteína',
    'kg',
    15.50,
    50,
    10,
    2,
    NOW(),
    NOW()
  ),
  (
    'ing_arroz_001',
    'tenant_test_001',
    'ARR-001',
    'Arroz Tipo 1',
    'Acompanhamento',
    'kg',
    3.20,
    100,
    20,
    1,
    NOW(),
    NOW()
  ),
  (
    'ing_feijao_001',
    'tenant_test_001',
    'FEI-001',
    'Feijão Carioca',
    'Acompanhamento',
    'kg',
    5.80,
    80,
    15,
    1,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Criar Produto de teste
INSERT INTO "Product" (
  id,
  "tenantId",
  name,
  sku,
  description,
  "basePrice",
  "costPrice",
  "laborCost",
  "comboOptions",
  active,
  "createdAt",
  "updatedAt"
)
VALUES (
  'prod_marmita_001',
  'tenant_test_001',
  'Marmita Executiva',
  'MAR-EXEC-001',
  'Marmita com arroz, feijão e proteína',
  28.90,
  12.50,
  3.00,
  NULL,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Associar Ingredientes ao Produto
INSERT INTO "ProductIngredient" (
  id,
  "productId",
  "ingredientId",
  quantity,
  "isMainProtein",
  "isPackaging",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'pi_frango_001',
    'prod_marmita_001',
    'ing_frango_001',
    0.15,
    true,
    false,
    NOW(),
    NOW()
  ),
  (
    'pi_arroz_001',
    'prod_marmita_001',
    'ing_arroz_001',
    0.20,
    false,
    false,
    NOW(),
    NOW()
  ),
  (
    'pi_feijao_001',
    'prod_marmita_001',
    'ing_feijao_001',
    0.15,
    false,
    false,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Log
SELECT 'Dados de teste criados com sucesso!' as status;
SELECT 
  'Login Test User' as info,
  'Email: admin@testempresa.com' as email,
  'Password: admin123' as password,
  'Role: admin' as role,
  'Tenant: Minha Empresa Teste' as tenant;

SELECT 
  'Login Caixa User' as info,
  'Email: caixa@testempresa.com' as email,
  'Password: caixa123' as password,
  'Role: caixa' as role,
  'Tenant: Minha Empresa Teste' as tenant;
