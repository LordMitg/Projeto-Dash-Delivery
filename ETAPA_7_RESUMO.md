# ETAPA 7: AUTENTICAÇÃO JWT + DASHBOARD RECHARTS
## Resumo Técnico das Entregas

---

## BACKEND - Autenticação JWT

### 1. `authController.ts` (206 linhas)
Controlador com 4 endpoints:
- **POST /auth/login** — Autentica user com email/password, retorna JWT
- **POST /auth/register** — Cria novo user, retorna JWT + user data
- **POST /auth/verify** — Valida token JWT, retorna user payload
- **POST /auth/refresh** — Renova token expirado

**JWT Payload:**
```json
{
  "userId": "user_id",
  "email": "user@company.com",
  "role": "admin|manager|staff|caixa",
  "tenantId": "tenant_id"
}
```

**Segurança:**
- Senhas com hash bcrypt (10 salts)
- Multi-tenant isolado: `(email, tenantId)` é único
- JWT expira em 7 dias
- Token não armazenado no servidor (stateless)

---

### 2. `authMiddleware.ts` (93 linhas)
4 middlewares de proteção de rotas:
- **authenticate** — Verifica JWT, injeta `req.user` e `req.tenant`
- **requireAdmin** — Restringe a roles admin/manager
- **requireFinancialAccess** — Restringe a admin/manager/caixa
- **requireStockAccess** — Restringe a admin/manager

**Uso:**
```typescript
router.get('/api/financial/dre', authenticate, requireFinancialAccess, handler);
```

---

### 3. `authRoutes.ts` (46 linhas)
4 rotas públicas + 1 protegida:
- `POST /auth/login` — sem proteção
- `POST /auth/register` — sem proteção
- `POST /auth/verify` — sem proteção (valida próprio token)
- `POST /auth/refresh` — sem proteção
- `GET /auth/me` — **protegido** (requer authenticate)

---

## FRONTEND - Dashboard + Autenticação

### 4. `DashboardCharts.tsx` (234 linhas)
Dashboard com 2 gráficos Recharts:

**Gráfico 1: Barras (Faturamento vs Custos)**
- Eixo X: Meses (últimos 12)
- Eixo Y: R$ (valores monetários)
- 3 séries: Receita (azul), Custos (vermelho), Lucro (verde)
- Dados via `/api/financial/dre?month=&year=`

**Gráfico 2: Linhas (Crescimento Clientes/Vendas)**
- Eixo X: Meses (últimos 12)
- Eixo Y Esquerda: Clientes (azul)
- Eixo Y Direita: Pedidos (verde)
- Dados via `/api/financial/kpis`

**Estatísticas Resumidas:**
- Receita Total (12m)
- Custos Totais (12m)
- Lucro Total (12m)
- Margem Média (12m)

---

### 5. `LoginPage.tsx` (263 linhas)
Interface de autenticação com 2 modos:
- **Login** — email + password + tenantId (com seletor)
- **Register** — email + password + firstName + lastName + tenantId

**Design:**
- 50/50 split: branding esquerda, form direita
- Erro inline (alert box)
- Toggle entre login/register
- Responsive (desktop)

---

### 6. `useAuth.ts` (175 linhas)
Hook React para gerenciar autenticação:
```typescript
const {
  user,                    // Dados do user autenticado
  token,                   // JWT token
  loading,                 // Loading state
  isAuthenticated,         // Boolean
  login,                   // Função login
  register,                // Função register
  logout,                  // Função logout
  refreshToken,            // Renovar JWT
  verifyToken              // Verificar JWT válido
} = useAuth();
```

**Funcionalidades:**
- Carrega token/user do localStorage ao iniciar
- Configura header padrão `Authorization: Bearer <token>` em axios
- Persiste sessão entre reloads
- Auto-logout se token expirar

---

## INTEGRAÇÃO

### Como Usar Backend + Frontend

1. **Protect rotas financeiras:**
```typescript
// backend/src/routes/financialRoutes.ts
router.get('/kpis', authenticate, requireFinancialAccess, (req, res) => {
  const tenantId = (req as any).user.tenantId;
  // buscar KPIs do tenant
});
```

2. **Usar no Frontend:**
```typescript
const { token, login, isAuthenticated } = useAuth();

if (!isAuthenticated) return <LoginPage />;
return <DashboardCharts />;
```

3. **Requisições com Token:**
```typescript
// useAuth configura automaticamente
const response = await axios.get('/api/financial/dre?month=1&year=2024');
// Header já inclui: Authorization: Bearer <token>
```

---

## DEPENDÊNCIAS A INSTALAR

### Frontend
```bash
npm install recharts
# Já está: axios, react, react-dom
```

### Backend
```bash
# Já instalado: bcryptjs, jsonwebtoken, @prisma/client
npm install --save-dev @types/bcryptjs @types/jsonwebtoken
```

---

## SEGURANÇA: CHECKLIST

✅ Senhas com bcrypt (10 rounds)
✅ JWT com expiração (7 dias)
✅ Multi-tenant isolamento (tenantId em todas queries)
✅ Role-based access control (admin/manager/staff/caixa)
✅ Middlewares de autenticação em rotas críticas
✅ Stateless (nenhum token armazenado no servidor)
✅ Token renovável via refresh endpoint
✅ Password nunca exposto em responses
✅ Email único por tenant (não global)

---

## FLUXO DE AUTENTICAÇÃO

```
1. Usuário acessa aplicação
   ↓
2. useAuth detecta localStorage
   ├─ Tem token? → verifyToken()
   │  ├─ Válido? → Carrega dashboard
   │  └─ Expirado? → Tenta refresh
   └─ Sem token? → Mostra LoginPage
   ↓
3. Usuário faz login (LoginPage)
   ├─ POST /auth/login
   │  ├─ Sucesso → localStorage + axios header
   │  └─ Falha → Mostra erro
   ├─ Armazena token
   ├─ Redireciona para Dashboard
   └─ useAuth injeta em componentes
   ↓
4. Todas requisições posteriores
   ├─ Header automático: Authorization: Bearer <token>
   ├─ Backend verifica middleware authenticate
   ├─ Injeta req.user + req.tenant
   └─ Roteia para handler
   ↓
5. Logout ou expiração
   └─ localStorage.removeItem('token')
      axios.defaults.headers = {}
      Volta para LoginPage
```

---

## DADOS FLUXO: Charts

```
Backend (12 meses)
├─ /api/financial/dre?month=M&year=Y
│  └─ { revenue, cogs, expenses, netIncome }
└─ /api/financial/kpis?period=month
   └─ { totalOrders, activeCustomers, ... }
        ↓
   Frontend (useEffect)
   ├─ Loop 12 meses
   ├─ Fetch para cada mês
   ├─ Monta arrays:
   │  ├─ monthlyData: [{ month, revenue, costs, profit }, ...]
   │  └─ growthData: [{ month, customers, sales }, ...]
   └─ Passa para Recharts
        ↓
   Recharts renderiza
   ├─ BarChart (revenue vs costs)
   └─ LineChart (customers vs sales)
```

---

## PRÓXIMOS PASSOS (Etapa 8)

1. Integrar LoginPage em App.tsx (router)
2. Proteger todas rotas financeiras/estoque
3. Adicionar role-based UI (esconder botões por role)
4. Implementar session timeout (logout automático)
5. Adicionar 2FA (opcional: SMS/email)
6. Testes unitários para authMiddleware

---

## TROUBLESHOOTING

**Erro: "Token inválido"**
→ localStorage corrompido: `localStorage.clear()`, refaça login

**Erro: "CORS preflight"**
→ Backend precisa CORS policy, adicione middleware:
```typescript
app.use(cors({ origin: 'http://localhost:5173' }));
```

**Charts vazios**
→ Verifica `/api/financial/dre` retorna dados corretos
→ Check localStorage token válido

**Login falha com 401**
→ Senha ou email incorreto
→ tenantId inválido
→ Verifique table users tem dados de teste

---

**Versão:** 7.0.0 (Autenticação + Charts)
**Status:** Pronto para Etapa 8 (Integração e Polimento)
