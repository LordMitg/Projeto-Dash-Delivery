# ETAPA 7: GUIA DE INTEGRAÇÃO
## Como Conectar Backend, Middleware e Frontend

---

## 1. INTEGRAR MIDDLEWARE DE AUTENTICAÇÃO NO BACKEND

Arquivo: `backend/src/index.ts` (ou main.ts)

```typescript
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import { authenticate, requireFinancialAccess } from './middleware/authMiddleware';
import ingredientRoutes from './routes/ingredientRoutes';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import financialRoutes from './routes/financialRoutes';

const app = express();

// Middlewares globais
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Rotas de autenticação (SEM proteção)
app.use('/api/auth', authRoutes);

// ===== PROTEGER ROTAS EXISTENTES COM AUTHENTICATE =====
// Adicione 'authenticate' antes do handler em rotas críticas

// Rotas de Ingredientes (com autenticação)
app.use('/api/ingredients', authenticate, ingredientRoutes);

// Rotas de Produtos (com autenticação)
app.use('/api/products', authenticate, productRoutes);

// Rotas de Pedidos (com autenticação)
app.use('/api/orders', authenticate, orderRoutes);

// Rotas Financeiras (com autenticação + requireFinancialAccess)
app.use('/api/financial', authenticate, requireFinancialAccess, financialRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
```

---

## 2. ATUALIZAR ROTAS FINANCEIRAS COM MIDDLEWARE

Arquivo: `backend/src/routes/financialRoutes.ts`

```typescript
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/financial/kpis
router.get('/kpis', async (req: any, res: Response) => {
  try {
    const { period } = req.query;
    const tenantId = req.user.tenantId; // ← Vem do middleware

    // Buscar KPIs filtrando por tenantId
    const orders = await prisma.order.findMany({
      where: { tenantId },
      include: { items: true }
    });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    res.json({
      totalOrders,
      totalRevenue,
      avgTicket,
      activeCustomers: 0, // Implementar contagem real
      cmvPercentage: 30,  // Placar genérico
      period
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar KPIs' });
  }
});

// GET /api/financial/dre?month=1&year=2024
router.get('/dre', async (req: any, res: Response) => {
  try {
    const { month, year } = req.query;
    const tenantId = req.user.tenantId; // ← Vem do middleware

    // Buscar dados de receita do mês
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(`${year}-${month}-01`),
          lt: new Date(`${year}-${parseInt(month) + 1}-01`)
        }
      },
      include: { items: { include: { product: true } } }
    });

    const revenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const cogs = 0; // Calcular real
    const expenses = 0; // Calcular real
    const netIncome = revenue - cogs - expenses;

    res.json({
      month,
      year,
      revenue,
      cogs,
      expenses,
      netIncome
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar DRE' });
  }
});

export default router;
```

---

## 3. INTEGRAR USELAUTH NO APP.TSX

Arquivo: `frontend/src/pages/App.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { LoginPage } from './LoginPage';
import { DashboardCharts } from '../components/DashboardCharts';
import { useAuth } from '../hooks/useAuth';
import { TenantProvider } from '../context/TenantContext';

export const App: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <TenantProvider>
      {isAuthenticated ? <DashboardCharts /> : <LoginPage onLoginSuccess={() => window.location.reload()} />}
    </TenantProvider>
  );
};
```

---

## 4. PROTEGER COMPONENTES POR ROLE (OPCIONAL)

Hook para verificar permissões:

```typescript
// frontend/src/hooks/usePermissions.ts
import { useAuth } from './useAuth';

export const usePermissions = () => {
  const { user } = useAuth();

  return {
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager',
    isStaff: user?.role === 'staff',
    isCaixa: user?.role === 'caixa',
    canEditProducts: ['admin', 'manager'].includes(user?.role || ''),
    canViewFinancial: ['admin', 'manager', 'caixa'].includes(user?.role || '')
  };
};
```

Usar em componentes:

```typescript
const { canEditProducts } = usePermissions();

return (
  <>
    {canEditProducts && <button>Editar Produto</button>}
  </>
);
```

---

## 5. INSTALAR DEPENDÊNCIA RECHARTS

```bash
cd frontend
npm install recharts
```

---

## 6. FLUXO COMPLETO DE AUTENTICAÇÃO

```
┌─────────────────────────────────────────────────────────┐
│  1. Usuário abre aplicação                              │
└────────────────┬────────────────────────────────────────┘
                 │
       ┌─────────▼─────────┐
       │ App.tsx carrega   │
       │ useAuth() hook    │
       └────────┬──────────┘
                │
    ┌───────────┴───────────┐
    │ localStorage.token?   │
    └───┬───────────────┬───┘
        │ SIM           │ NÃO
    ┌───▼────┐      ┌───▼────┐
    │ Verify │      │ Show   │
    │ Token  │      │ Login  │
    └────┬───┘      └────┬───┘
         │               │
    ┌────▼─────┐     ┌────▼─────┐
    │ Valid?   │     │ User     │
    │ Yes→     │     │ submits  │
    │ Load     │     │ form     │
    │ Dashboard│     └────┬─────┘
    └──────────┘          │
         ↑                │
         │         ┌──────▼──────┐
         │         │ POST        │
         │         │ /auth/login │
         │         └──────┬──────┘
         │                │
         │    ┌───────────▼───────────┐
         │    │ Backend valida       │
         │    │ • hash password      │
         │    │ • find user (tenant) │
         │    │ • jwt.sign(payload)  │
         │    └───────────┬───────────┘
         │                │
         └────────────────┘
              Token
            (localStorage)

2. Todas requisições posteriores:
   ├─ Header: Authorization: Bearer <token>
   ├─ Backend: middleware authenticate
   ├─ Injeta req.user + req.tenant
   └─ Handler filtra por tenantId
```

---

## 7. EXEMPLO: CRIAR USUÁRIO DE TESTE

```bash
# No backend, via Node REPL ou script:
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const tenant = await prisma.tenant.create({
  data: {
    name: 'Minha Empresa',
    domain: 'minha-empresa.local'
  }
});

const user = await prisma.user.create({
  data: {
    email: 'admin@empresa.com',
    password: await bcrypt.hash('admin123', 10),
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    tenantId: tenant.id,
    active: true
  }
});

console.log(`Usuário criado: ${user.email}`);
console.log(`Tenant: ${tenant.name}`);
```

---

## 8. TESTAR ENDPOINTS COM CURL

```bash
# 1. Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@empresa.com",
    "password": "admin123",
    "tenantId": "tenant_id_aqui"
  }'

# Response:
# {
#   "success": true,
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "user": { "id": "...", "email": "...", "role": "admin", ... }
# }

# 2. Usar token em rota protegida
curl -X GET http://localhost:3001/api/financial/kpis \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Response:
# { "totalOrders": 10, "totalRevenue": 5000, "avgTicket": 500, ... }

# 3. Sem token (deve retornar 401)
curl -X GET http://localhost:3001/api/financial/kpis

# Response:
# { "error": "Token não fornecido" }
```

---

## 9. CHECKLIST DE INTEGRAÇÃO

- [ ] Middleware authMiddleware.ts importado em index.ts
- [ ] Rotas protegidas com `authenticate` middleware
- [ ] authRoutes.ts registrado como `/api/auth`
- [ ] useAuth hook criado e usado em App.tsx
- [ ] DashboardCharts importado em App.tsx
- [ ] LoginPage importada em App.tsx
- [ ] recharts instalado: `npm install recharts`
- [ ] Database schema atualizado com users/tenants
- [ ] Variável JWT_SECRET setada em .env
- [ ] CORS configurado para localhost:5173
- [ ] Usuário de teste criado no BD

---

## 10. TROUBLESHOOTING

**"Token não fornecido"**
→ useAuth não setou localStorage
→ Verificar POST /auth/login retorna token

**"CORS error preflight"**
→ Backend precisa:
```typescript
app.use(cors({ origin: 'http://localhost:5173' }));
```

**Charts vazios**
→ /api/financial/dre retorna dados?
→ Verificar month/year formato
→ Confirmar tenantId correto no middleware

**Login infinito**
→ Token inválido? → localStorage.clear()
→ Backend? → Verificar logs

---

**Status:** Integração completa Etapa 7
**Próximo:** Etapa 8 (Polimento UI + Testes)
