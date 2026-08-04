# 🚀 INICIALIZAÇÃO DO SISTEMA DASH DELIVERY

## Arquivo: `iniciar_sistema.bat`

Arquivo executável para Windows que automatiza todo o processo de inicialização do projeto.

---

## 📋 O que o Script Faz

1. **Permissões Windows** — Libera ExecutionPolicy do PowerShell
2. **Dependências** — Verifica e instala `npm install` em backend e frontend
3. **Módulos Nativos** — Executa `npm rebuild` (necessário para Electron + USB)
4. **Banco de Dados** — Roda `npx prisma generate` e `npx prisma db push`
5. **Servidores** — Inicia Backend (Express na porta 3001) e Frontend (Electron)
6. **Feedback** — Exibe mensagens amigáveis no console

---

## 📍 Localização do Arquivo

```
projeto-dash-delivery/
├── iniciar_sistema.bat        ← COLOQUE AQUI (raiz do projeto)
├── backend/
├── frontend/
├── CHECKPOINT_ETAPA_6.md
└── ...
```

---

## ⚙️ Como Usar

### **Primeira Execução (COM Privilégios de Administrador)**

1. Clique **direito** no arquivo `iniciar_sistema.bat`
2. Selecione **"Executar como Administrador"**
3. Clique em **"Sim"** na janela de confirmação do Windows

   Isso é necessário apenas para:
   - Atualizar `ExecutionPolicy` do PowerShell
   - Autorizar rebuild de módulos nativos (Electron)

### **Execuções Posteriores (NORMAL)**

Você pode clicar duplo normalmente, sem precisar de Administrador.

---

## 📊 Fluxo de Execução

```
┌─────────────────────────────────┐
│  Executar iniciar_sistema.bat   │
└────────────┬────────────────────┘
             │
      ┌──────▼──────┐
      │ Admin Check  │
      └──────┬──────┘
             │
      ┌──────▼──────────────┐
      │ Set ExecutionPolicy │
      └──────┬──────────────┘
             │
   ┌────────┴────────┐
   │                 │
┌──▼──────┐    ┌─────▼─────┐
│ Backend │    │ Frontend  │
│ npm i   │    │ npm i     │
└──┬──────┘    └─────┬─────┘
   │                 │
┌──▼──────────────────▼─────┐
│ Prisma generate + db push │
└────────┬──────────────────┘
         │
    ┌────▼──────────┐
    │ npm run dev   │
    │ (paralelo)    │
    └───────────────┘
         │
    ┌────▼────────────────┐
    │ Backend: 3001 ✓     │
    │ Frontend: Electron ✓│
    └─────────────────────┘
```

---

## 🔧 Requisitos Prévios

### Antes de Executar o Script

1. **PostgreSQL instalado e rodando localmente**
   - Porta padrão: 5432
   - Banco: `delivery_erp` (será criado via `db push`)
   - Usuário: postgres / Senha: (conforme sua config)

2. **Node.js 18+**
   ```bash
   node --version  # deve ser v18.0.0 ou superior
   ```

3. **npm 9+**
   ```bash
   npm --version   # deve ser 9.0.0 ou superior
   ```

4. **Arquivo `.env` no backend**
   ```bash
   # backend/.env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/delivery_erp"
   JWT_SECRET="your-secret-key-here"
   PORT=3001
   ```

---

## 🖥️ O Que Acontece Após Iniciar

### Terminal 1: Backend
```
> npm run dev

[backend] ✓ Compilado com sucesso
[backend] Server running on http://localhost:3001
[backend] Database connected ✓
```

### Terminal 2: Frontend (Electron)
```
> npm start

[electron] Loading React App...
[vite] Ready on http://localhost:5173
[electron] Window created ✓
```

### Aplicação
A janela do Electron abrirá automaticamente com a interface do ERP.

---

## ⚡ Atalhos Úteis Após Iniciar

| Atalho | Ação |
|--------|------|
| `Ctrl + C` (em qualquer terminal) | Para o servidor |
| `Ctrl + Shift + I` (Electron) | Abre DevTools (F12) |
| `Ctrl + R` (Electron) | Recarrega a interface |
| `npm run dev` (em backend/) | Reinicia backend |
| `npm start` (em frontend/) | Reinicia frontend |

---

## 🐛 Troubleshooting

### Erro: "Acesso Negado" ao executar .bat
**Solução:** Clique direito → "Executar como Administrador"

### Erro: "PostgreSQL não está rodando"
```bash
# Windows - Iniciar PostgreSQL
# Services > PostgreSQL > Start
# OU
psql -U postgres -h localhost -d postgres -c "SELECT 1;"
```

### Erro: "npm not found"
**Solução:** Reinstale Node.js e adicione ao PATH

### Erro: "Prisma migration failed"
```bash
# No terminal backend/
npx prisma db push --force-reset
# Aviso: Isso deletará o banco
```

### Electron não abre após iniciar Frontend
- Verifique se há outra instância rodando: `taskkill /IM electron.exe`
- Tente manualmente em `frontend/`: `npm start`

---

## 📝 Logs & Debugging

O script escreve todas as operações no console. Para salvar em arquivo:

```batch
REM Editar iniciar_sistema.bat ou usar comando:
iniciar_sistema.bat > logfile.txt 2>&1
```

---

## 🔐 Considerações de Segurança

- **ExecutionPolicy**: Alterado para `RemoteSigned` (permite scripts locais)
- **npm rebuild**: Executa código C++ (Electron, serial ports) — seguro se Node.js é oficial
- **Banco de dados**: Usa conexão local por padrão (nunca remote na Etapa 1)

---

## ✅ Checklist de Sucesso

Após executar o script, você deve ver:

- [ ] Ambas as janelas (Backend + Frontend) abertas
- [ ] Backend respondendo em `http://localhost:3001`
- [ ] Frontend (Electron) exibindo o dashboard
- [ ] Mensagens no console: "✓ Permissões...", "✓ Dependências...", "✓ Banco sincronizado"
- [ ] Nenhum erro vermelho (⚠️ amarelas são OK)

---

## 🆘 Suporte

Se o script não funcionar:

1. Execute como Administrador (primeira vez)
2. Verifique PostgreSQL está rodando
3. Confirme Node.js 18+ e npm 9+
4. Verifique arquivo `.env` no backend
5. Deletar `node_modules` em ambas pastas e tente novamente

---

## 📚 Documentação Relacionada

- [CHECKPOINT_ETAPA_6.md](./CHECKPOINT_ETAPA_6.md) — Estado completo do projeto
- [backend/.env.example](./backend/.env.example) — Template variáveis ambiente
- [README.md](./README.md) — Guia geral do projeto

---

**Versão**: 1.0 (Etapa Bônus)
**Atualizado**: 04/08/2026
**Compatibilidade**: Windows 10+ | Node 18+ | npm 9+
