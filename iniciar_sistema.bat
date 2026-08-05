@echo off
setlocal enabledelayedexpansion

REM Forca o script a rodar na pasta onde ele esta salvo
cd /d "%~dp0"

cls
echo.
echo =======================================================
echo            DASH DELIVERY ERP - INICIALIZACAO
echo                    Multi-Tenant v6.0.0
echo =======================================================
echo.

REM Verificar se esta rodando como Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo AVISO: Este script deve ser executado como Administrador.
    echo Clique direito no arquivo e selecione "Executar como Administrador".
    pause
    exit /b 1
)

echo Permissoes de Administrador detectadas.
echo.

REM =========================================
REM 1. VERIFICAR PASTA E DEPENDENCIAS DO BACKEND
REM =========================================
echo Verificando pasta Backend...
if not exist "backend" (
    echo ERRO: A pasta "backend" nao foi encontrada neste diretorio!
    pause
    exit /b 1
)

cd backend

if not exist node_modules (
    echo Instalando dependencias do Backend...
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo Erro ao instalar dependencias do backend.
        pause
        exit /b 1
    )
) else (
    echo Dependencias do Backend ja existem.
)

REM =========================================
REM 2. SINCRONIZAR BANCO DE DADOS
REM =========================================
echo.
echo [1/2] Gerando cliente Prisma...
call npx prisma generate
if %errorlevel% neq 0 (
    echo.
    echo ------------------------------------------------ai
    echo ERRO CRITICO: Falha ao executar "npx prisma generate".
    echo Verifique se o schema.prisma existe na pasta backend/prisma.
    echo --------------------------------------------------
    pause
    exit /b 1
)

echo.
echo [2/2] Sincronizando com o PostgreSQL (db push)...
call npx prisma db push --skip-generate
if %errorlevel% neq 0 (
    echo.
    echo --------------------------------------------------
    echo AVISO/ERRO: O Banco de Dados PostgreSQL parece estar 
    echo desligado ou inacessivel na porta 5432!
    echo Certifique-se de que o servico do Postgres esta ativo.
    echo --------------------------------------------------
    pause
) else (
    echo Banco de dados sincronizado com sucesso.
)

cd ..

REM =========================================
REM 3. VERIFICAR PASTA E DEPENDENCIAS DO FRONTEND
REM =========================================
echo.
echo Verificando pasta Frontend...
if not exist "frontend" (
    echo ERRO: A pasta "frontend" nao foi encontrada neste diretorio!
    pause
    exit /b 1
)

cd frontend

if not exist node_modules (
    echo Instalando dependencias do Frontend...
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo Erro ao instalar dependencias do frontend.
        pause
        exit /b 1
    )
) else (
    echo Dependencias do Frontend ja existem.
)

cd ..

REM =========================================
REM 4. INICIAR SERVIDORES
REM =========================================
echo.
echo Iniciando servidores...
echo    - Backend na porta 3001
echo    - Frontend na porta 5173
echo.

start "Dash Delivery - Backend" cmd /k "cd backend && npm run dev"
timeout /t 3 /nobreak >nul
start "Dash Delivery - Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo =========================================
echo INICIALIZACAO CONCLUIDA COM SUCESSO!
echo =========================================
pause
exit /b 0