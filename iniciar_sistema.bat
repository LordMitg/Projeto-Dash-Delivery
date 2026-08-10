@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  DASH DELIVERY ERP - INICIALIZACAO (Windows)
REM
REM  Duplo clique neste arquivo. NAO precisa de Administrador.
REM
REM  O que este script faz, na ordem:
REM    1. confere Node.js e habilita o pnpm
REM    2. cria backend\.env na primeira vez (com JWT_SECRET aleatorio)
REM    3. instala dependencias (pnpm, na raiz - e um workspace)
REM    4. cria/atualiza o banco e popula o usuario de acesso
REM    5. sobe backend (3001) e frontend (3000) em duas janelas
REM ============================================================

cd /d "%~dp0"
cls
echo.
echo =======================================================
echo            DASH DELIVERY ERP - INICIALIZACAO
echo                    Multi-Tenant v6.0.0
echo =======================================================
echo.

REM ---------------------------------------------------------
REM 1. Node.js e pnpm
REM
REM Este projeto e um workspace pnpm (ver pnpm-workspace.yaml) e
REM fixa "packageManager": "pnpm". Instalar com npm nas subpastas
REM ignora o workspace e o bloco onlyBuiltDependencies, que e o
REM que autoriza o Prisma a baixar o query engine.
REM ---------------------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: Node.js nao encontrado.
    echo Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node.js %%v encontrado.

set "PNPM=pnpm"
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo pnpm nao encontrado. Habilitando via corepack...
    call corepack enable >nul 2>&1
    where pnpm >nul 2>&1
    if !errorlevel! neq 0 (
        echo Usando "npx pnpm" como alternativa.
        set "PNPM=npx --yes pnpm"
    )
)
echo Gerenciador de pacotes: !PNPM!
echo.

REM ---------------------------------------------------------
REM 2. backend\.env
REM
REM Sem este arquivo o Prisma falha com uma mensagem obscura
REM ("Environment variable not found: DATABASE_URL").
REM ---------------------------------------------------------
if not exist "backend\.env" (
    echo Primeira execucao: criando backend\.env a partir do exemplo...
    copy /y "backend\.env.example" "backend\.env" >nul

    REM JWT_SECRET aleatorio: o valor do exemplo nao serve para uso real.
    REM Feito com Node (ja verificado acima) em vez de PowerShell: o valor e
    REM hexadecimal, entao dispensa aspas no .env e evita escapes fragis no bat.
    node -e "const f=require('fs'),p='backend/.env';let c=f.readFileSync(p,'utf8');c=c.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+require('crypto').randomBytes(48).toString('hex'));f.writeFileSync(p,c)"

    echo.
    echo    backend\.env criado com JWT_SECRET aleatorio.
    echo.
    echo    ATENCAO: confira a senha do PostgreSQL dentro dele.
    echo    A linha DATABASE_URL vem com o padrao postgres:postgres.
    echo    Se a sua senha for outra, edite o arquivo antes de continuar.
    echo.
    pause
) else (
    echo backend\.env ja existe.
)
echo.

REM ---------------------------------------------------------
REM 3. Dependencias (na RAIZ - workspace)
REM ---------------------------------------------------------
echo Instalando dependencias do projeto...
call !PNPM! install
if %errorlevel% neq 0 (
    echo.
    echo ERRO: falha ao instalar as dependencias.
    echo Verifique sua conexao com a internet e tente novamente.
    echo.
    pause
    exit /b 1
)
echo Dependencias prontas.
echo.

REM ---------------------------------------------------------
REM 4. Banco de dados
REM
REM "migrate deploy" aplica as migrations versionadas e cria o
REM banco caso ele ainda nao exista (nao usar "db push": ele
REM ignora o historico de migrations e causa divergencia).
REM ---------------------------------------------------------
echo [1/3] Gerando cliente Prisma...
call !PNPM! --filter delivery-erp-backend db:generate
if %errorlevel% neq 0 (
    echo.
    echo ERRO: falha no "prisma generate".
    echo.
    pause
    exit /b 1
)

REM db:deploy = "prisma migrate deploy". NAO usar db:migrate aqui: aquele e o
REM "migrate dev", que e interativo e pode oferecer RESETAR o banco (apagando
REM suas vendas) quando detecta divergencia no schema.
echo [2/3] Aplicando migrations no PostgreSQL...
call !PNPM! --filter delivery-erp-backend db:deploy
if %errorlevel% neq 0 (
    echo.
    echo --------------------------------------------------
    echo ERRO: nao foi possivel falar com o PostgreSQL.
    echo.
    echo Verifique:
    echo   1. O servico do PostgreSQL esta rodando?
    echo      Win+R  ^>  services.msc  ^>  procure "postgresql"
    echo   2. A senha em backend\.env (DATABASE_URL) esta correta?
    echo   3. A porta esta certa? O padrao do Postgres e 5432.
    echo.
    echo O banco NAO precisa existir: as migrations criam ele.
    echo --------------------------------------------------
    echo.
    pause
    exit /b 1
)

REM O seed usa upsert, entao rodar sempre e seguro: ele nao apaga
REM pedidos nem cadastros ja existentes. Sem ele nao existe nenhum
REM usuario e a tela de login fica intransponivel.
echo [3/3] Garantindo usuario de acesso (seed)...
call !PNPM! --filter delivery-erp-backend db:seed
if %errorlevel% neq 0 (
    echo AVISO: o seed falhou. O sistema sobe, mas talvez sem usuario para entrar.
    pause
)
echo Banco de dados pronto.
echo.

REM ---------------------------------------------------------
REM 5. Subir os servidores
REM ---------------------------------------------------------
echo Iniciando servidores...
echo    - Backend  em http://localhost:3001
echo    - Frontend em http://localhost:3000
echo.

start "Dash Delivery - Backend" cmd /k "cd /d "%~dp0backend" && !PNPM! dev"
timeout /t 5 /nobreak >nul
start "Dash Delivery - Frontend" cmd /k "cd /d "%~dp0frontend" && !PNPM! dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo =======================================================
echo  PRONTO! O navegador vai abrir em http://localhost:3000
echo.
echo  Entre com:
echo     e-mail: admin@local
echo     senha:  admin123
echo.
echo  Para parar: feche as duas janelas de terminal.
echo =======================================================
echo.
pause
exit /b 0
