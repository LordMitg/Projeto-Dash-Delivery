# COMECE AQUI — Dash Delivery ERP

Sistema de ERP/PDV para delivery. Roda **no seu PC**, como um servidor local,
e você acessa **pelo navegador** (não é aplicativo instalado).

---

## Pré-requisitos (instalar uma vez)

| O quê | Versão | Onde |
|---|---|---|
| **Node.js** | 20.11 ou maior | https://nodejs.org (baixe a versão **LTS**) |
| **PostgreSQL** | 12 ou maior | https://www.postgresql.org/download/windows/ |

Ao instalar o PostgreSQL ele pede uma **senha para o usuário `postgres`**.
Anote essa senha: você vai precisar dela no passo 2.

Não é preciso criar o banco de dados na mão — o sistema cria sozinho.

---

## Início rápido (Windows)

### 1. Dê um duplo clique em `iniciar_sistema.bat`

Ele faz tudo: instala as dependências, cria o `backend/.env`, prepara o banco,
sobe os servidores e abre o navegador.

Não precisa de "Executar como Administrador".

### 2. Confirme a senha do PostgreSQL

Na **primeira** execução o script cria o arquivo `backend/.env` e pausa para
você conferir. Abra `backend/.env` e ajuste a linha:

```
DATABASE_URL="postgresql://postgres:SUA_SENHA@localhost:5432/delivery_erp?schema=public"
```

Troque `SUA_SENHA` pela senha que você definiu ao instalar o PostgreSQL.
Se a sua senha for literalmente `postgres`, não precisa mudar nada.

Salve o arquivo e volte à janela do script para continuar.

### 3. Entre no sistema

O navegador abre em **http://localhost:3000** com a tela de login:

```
e-mail: admin@local
senha:  admin123
```

Trocar essa senha é o primeiro passo recomendado depois de entrar.

---

## Início pelo terminal (Windows, Linux ou macOS)

Se preferir não usar o `.bat`:

```bash
# 1. copie o arquivo de configuração e ajuste a senha do Postgres
cp backend/.env.example backend/.env

# 2. instale, prepare o banco e crie o usuário de acesso
pnpm init:app

# 3. suba backend e frontend juntos
pnpm dev
```

Se o `pnpm` não estiver disponível, habilite com `corepack enable`.

Acesse http://localhost:3000.

---

## O que sobe

| Serviço | Endereço | O que é |
|---|---|---|
| Frontend | http://localhost:3000 | A interface (React + Vite) |
| Backend | http://localhost:3001 | A API (Express + Prisma) |
| Banco | localhost:5432 | PostgreSQL |

As duas portas precisam estar livres. A do frontend é fixa (`strictPort`):
se a 3000 estiver ocupada, o Vite falha em vez de trocar de porta —
e trocar de porta quebraria o CORS do backend.

---

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe backend e frontend juntos |
| `pnpm dev:api` | Só o backend |
| `pnpm dev:web` | Só o frontend |
| `pnpm init:app` | Instala tudo, aplica migrations e roda o seed |
| `pnpm db:deploy` | Aplica as migrations pendentes |
| `pnpm db:seed` | Recria o usuário de acesso e os dados de exemplo |
| `pnpm db:studio` | Abre o Prisma Studio para inspecionar o banco |
| `pnpm typecheck` | Confere os tipos (não gera arquivos) |

O `db:seed` usa *upsert*: rodar de novo **não apaga** seus pedidos e cadastros.

`pnpm db:reset` **apaga o banco inteiro**. Use apenas se quiser começar do zero.

---

## Estrutura

```
projeto-dash-delivery/
├── iniciar_sistema.bat      <- duplo clique para iniciar (Windows)
├── COMECE_AQUI.md           <- este arquivo
│
├── backend/                 API Express + Prisma
│   ├── .env                 <- suas configurações (criado no 1o uso)
│   ├── .env.example         <- modelo
│   ├── prisma/
│   │   ├── schema.prisma    <- schema do banco
│   │   ├── migrations/      <- histórico de alterações do banco
│   │   └── seed.ts          <- dados iniciais
│   └── src/
│       ├── routes/          <- endpoints da API
│       └── middleware/      <- autenticação e permissões
│
└── frontend/                React + Vite
    └── src/
        ├── pages/           <- telas
        ├── components/      <- componentes
        └── contexts/        <- sessão e negócio ativo
```

---

## Problemas comuns

### A tela abre, mas fica vazia / nada carrega

Quase sempre é **CORS**: o `CORS_ORIGINS` do `backend/.env` precisa incluir a
porta em que o frontend roda (**3000**). Abra o console do navegador com `F12`
e veja se há erro de CORS. O valor correto é:

```
CORS_ORIGINS="https://localhost:3000,http://localhost:3000"
```

### `Environment variable not found: DATABASE_URL`

O arquivo `backend/.env` não existe. Crie com:

```bash
cp backend/.env.example backend/.env
```

### `Can't reach database server at localhost:5432`

O PostgreSQL não está rodando, ou a senha no `.env` está errada.

- Windows: `Win+R` → `services.msc` → procure por **postgresql** → Iniciar
- Confirme a senha na linha `DATABASE_URL` do `backend/.env`

### Não consigo fazer login

Nenhum usuário foi criado. Rode:

```bash
pnpm db:seed
```

E entre com `admin@local` / `admin123`.

### `Port 3000 is already in use`

Outro programa está usando a porta. Feche-o, ou descubra qual é:

```
netstat -ano | findstr :3000
```

### O scanner pelo celular não conecta

Acrescente o IP do seu PC ao `CORS_ORIGINS` do `backend/.env`, por exemplo
`https://192.168.0.10:3000`. Para descobrir o IP:

- Windows: `ipconfig` (procure "Endereço IPv4")
- Linux/macOS: `hostname -I`

---

## Papéis de acesso

O sistema é multi-negócio. Cada usuário tem um vínculo por negócio:

- **Dono** — acesso total, incluindo *Meu negócio* e *Funcionários*
- **Funcionário** — apenas o que o dono marcar na tela *Funcionários*

O seed cria três usuários (todos com a senha `admin123`):

| E-mail | Papel |
|---|---|
| `admin@local` | Dono |
| `caixa@local` | Funcionário (PDV) |
| `gerente@local` | Funcionário (gerência) |
