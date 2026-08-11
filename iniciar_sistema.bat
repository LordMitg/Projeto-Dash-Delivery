@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  DASH DELIVERY ERP - INICIALIZACAO (Windows)
REM
REM  Duplo clique neste arquivo. NAO precisa de Administrador.
REM
REM  O banco de dados fica na NUVEM (Neon), entao:
REM    - nao precisa instalar PostgreSQL no PC
REM    - precisa de internet para o sistema funcionar
REM    - os dados sao os mesmos vistos de qualquer computador
REM
REM  O que este script faz, na ordem:
REM    1. confere Node.js e habilita o pnpm
REM    2. cria backend\.env na primeira vez e pede a string do Neon
REM    3. instala dependencias (pnpm, na raiz - e um workspace)
REM    4. confere a conexao com o banco, com o erro explicado
REM    5. cria/atualiza as tabelas e o usuario de acesso
REM    6. sobe backend (3001) e frontend (3000) em duas janelas
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
    echo.
    echo   Instale a versao LTS em https://nodejs.org
    echo   Depois FECHE esta janela e abra este arquivo de novo.
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
REM
REM Diferente da versao com banco local, aqui NAO da para gerar um
REM endereco valido sozinho: a string do Neon e pessoal. Por isso o
REM script abre o arquivo no Notepad e espera ele ser fechado.
REM ---------------------------------------------------------
if not exist "backend\.env" (
    echo Primeira execucao: criando backend\.env a partir do exemplo...
    copy /y "backend\.env.example" "backend\.env" >nul

    REM JWT_SECRET aleatorio: o valor do exemplo nao serve para uso real.
    REM Feito com Node (ja verificado acima) em vez de PowerShell: o valor e
    REM hexadecimal, entao dispensa aspas no .env e evita escapes fragis no bat.
    node -e "const f=require('fs'),p='backend/.env';let c=f.readFileSync(p,'utf8');c=c.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+require('crypto').randomBytes(48).toString('hex'));f.writeFileSync(p,c)"

    echo.
    echo    =============================================================
    echo     FALTA UM PASSO SEU: o endereco do banco de dados
    echo    =============================================================
    echo.
    echo     1. Entre em https://neon.tech e abra o seu projeto
    echo     2. Clique no botao "Connect"
    echo     3. Copie a string que aparece (comeca com postgresql://)
    echo     4. O Notepad vai abrir: substitua a linha
    echo          DATABASE_URL="COLE_AQUI_A_STRING_DO_NEON"
    echo        pela string copiada, MANTENDO as aspas duplas
    echo     5. Salve (Ctrl+S) e feche o Notepad
    echo.
    echo     A string precisa terminar com  ?sslmode=require
    echo    =============================================================
    echo.
    pause
    start /wait notepad "backend\.env"
    echo.
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
REM A conferencia vem ANTES do Prisma de proposito: ela testa arquivo,
REM formato do endereco, DNS, porta e senha em etapas separadas e diz
REM em portugues qual delas quebrou. O Prisma sozinho responde
REM "P1001: Can't reach database server" para qualquer uma dessas
REM causas - foi exatamente o erro que travou a primeira versao.
REM ---------------------------------------------------------
echo [1/4] Conferindo o endereco do banco de dados...
call !PNPM! --filter delivery-erp-backend db:check
if %errorlevel% neq 0 (
    echo.
    echo   Corrija o que foi indicado acima e abra este arquivo de novo.
    echo   O arquivo a editar e:  backend\.env
    echo.
    pause
    exit /b 1
)

echo [2/4] Gerando cliente Prisma...
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
echo [3/4] Criando/atualizando as tabelas na nuvem...
call !PNPM! --filter delivery-erp-backend db:deploy
if %errorlevel% neq 0 (
    echo.
    echo --------------------------------------------------
    echo ERRO: as tabelas nao puderam ser criadas.
    echo.
    echo O endereco passou na conferencia, entao o problema
    echo costuma ser um destes:
    echo.
    echo   1. Conexao "pooler" do Neon travando a migracao.
    echo      No painel do Neon escolha "Direct connection"
    echo      (endereco SEM a parte "-pooler") e troque a
    echo      linha DATABASE_URL em backend\.env.
    echo.
    echo   2. A internet caiu no meio do processo.
    echo      Tente abrir este arquivo de novo.
    echo --------------------------------------------------
    echo.
    pause
    exit /b 1
)

REM O seed usa upsert, entao rodar sempre e seguro: ele nao apaga
REM pedidos nem cadastros ja existentes. Sem ele nao existe nenhum
REM usuario e a tela de login fica intransponivel.
echo [4/4] Garantindo usuario de acesso...
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
echo  Se a tela abrir mas nada carregar, olhe a janela
echo  "Dash Delivery - Backend": o erro aparece la.
echo.
echo  Para parar: feche as duas janelas de terminal.
echo =======================================================
echo.
pause
exit /b 0
