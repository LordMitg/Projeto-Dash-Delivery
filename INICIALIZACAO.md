# Inicialização

> **Este guia foi substituído por [`COMECE_AQUI.md`](./COMECE_AQUI.md).**
>
> Use aquele arquivo. Ele é o único guia de instalação mantido.

O conteúdo anterior descrevia uma versão em **Electron** (aplicativo de
desktop) que não existe mais: hoje o sistema é um **servidor local acessado
pelo navegador** em `http://localhost:3000`.

As instruções antigas estavam erradas em pontos que impediam o sistema de
subir — e uma delas era destrutiva:

| Dizia | Realidade |
|---|---|
| Frontend em Electron, porta 5173 | Navegador, porta **3000** |
| Instalar com `npm install` em cada pasta | `pnpm install` na raiz (é um workspace) |
| Preparar o banco com `prisma db push` | `pnpm db:deploy` (aplica as migrations versionadas) |
| Rodar como Administrador | Não é necessário |
| Nada sobre o seed | Sem `pnpm db:seed` **não existe usuário para entrar** |
| `prisma db push --force-reset` para consertar migration | **Apaga o banco inteiro**, incluindo suas vendas |

Para instalar, configurar e resolver problemas, veja **[`COMECE_AQUI.md`](./COMECE_AQUI.md)**.
