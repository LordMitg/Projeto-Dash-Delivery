# 🚀 COMECE AQUI - Dash Delivery ERP

## Guia Rápido para Iniciar

### ⚡ Início em 30 Segundos

```
1. Abra iniciar_sistema.bat (duplo clique)
   Na primeira vez: direito do mouse → "Executar como Administrador"

2. Aguarde ~10-30 segundos

3. 2 janelas abrirão automaticamente:
   • Terminal 1: Backend Express (porta 3001)
   • Terminal 2: Electron Frontend

4. Dashboard do ERP estará pronto para usar!
```

---

## 📋 Pré-Requisitos

- ✅ PostgreSQL 12+ instalado e rodando
- ✅ Node.js 18+
- ✅ npm 9+
- ✅ Arquivo `backend/.env` configurado

### Configurar .env (primeira vez)

```bash
# Copiar e editar
cp backend/.env.example backend/.env

# Editar backend/.env com suas credenciais
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/delivery_erp"
JWT_SECRET="seu-valor-secreto-aleatorio"
```

---

## 📁 Estrutura

```
projeto-dash-delivery/
├── iniciar_sistema.bat          ← Clique aqui para iniciar
├── INICIALIZACAO.md             ← Instruções completas
├── COMECE_AQUI.md               ← Este arquivo
├── ETAPA_BONUS_RESUMO.txt       ← Resumo técnico
├── CHECKPOINT_ETAPA_6.md        ← Documentação do projeto
│
├── backend/
│   ├── .env                     ← Configure aqui (primeiro uso)
│   ├── .env.example             ← Template
│   ├── prisma/schema.prisma     ← Schema BD
│   └── src/                     ← APIs (Express + Prisma)
│
└── frontend/
    ├── src/
    │   ├── index.css            ← Tema Enterprise
    │   └── components/          ← Componentes React
    └── index.html
```

---

## ✅ Após Iniciar

### Backend Rodando
```
URL:    http://localhost:3001
APIs:   /api/ingredients, /api/products, /api/orders, etc.
BD:     PostgreSQL sincronizado
```

### Frontend Aberto
```
Aplicação:  Electron + React
Dashboard:  KPIs em tempo real
Operações:  PDV, Precificação, NF-e, Relatórios
```

---

## 🎯 Próximos Passos

1. **Criar Primeira Empresa (Tenant)**
   - No dashboard → Sidebar → Selecionar/Criar empresa

2. **Testar PDV**
   - Adicionar insumos → Produtos → Fazer pedido

3. **Importar Nota Fiscal**
   - NF-e → Upload XML → Mapear itens

4. **Usar Simulador**
   - Prever impacto de contratações e novos veículos

---

## ⚡ Atalhos

| Tecla | Ação |
|-------|------|
| `Ctrl + C` | Para servidor |
| `F12` / `Ctrl+Shift+I` | DevTools (Electron) |
| `Ctrl + R` | Recarrega interface |

---

## 🐛 Problemas?

### Erro: Acesso Negado
→ Execute como Administrador (primeira vez)

### Erro: PostgreSQL não conecta
→ Inicie PostgreSQL (Services do Windows)

### Erro: npm not found
→ Reinstale Node.js + adicione ao PATH

### Mais ajuda?
→ Veja `INICIALIZACAO.md` (troubleshooting completo)

---

## 📚 Documentação

| Arquivo | Conteúdo |
|---------|----------|
| `INICIALIZACAO.md` | Guia detalhado + troubleshooting |
| `CHECKPOINT_ETAPA_6.md` | Estado técnico do projeto |
| `ETAPA_BONUS_RESUMO.txt` | Resumo do script .bat |
| `.env.example` | Template variáveis |

---

## 🆘 Suporte

**Arquivo principal**: `INICIALIZACAO.md`
**Documentação técnica**: `CHECKPOINT_ETAPA_6.md`
**Estado do projeto**: Ver checklist em `CHECKPOINT_ETAPA_6.md`

---

## 🎉 Sucesso!

Se tudo funcionou:
- 2 janelas abertas (Backend + Frontend) ✓
- Dashboard exibindo KPIs ✓
- Sem erros vermelhos ✓

**Pronto para começar a usar o Dash Delivery ERP!**

---

**Versão**: 6.0.0 | **Status**: Production Ready | **Data**: 04/08/2026
