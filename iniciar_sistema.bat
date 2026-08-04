@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM =========================================
REM TRAVA DE SEGURANÇA 1: FORÇAR A PASTA EXATA
REM Isso impede o bug do System32 no modo Administrador
cd /d "%~dp0"
REM =========================================

cls
echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║          🚚 DASH DELIVERY ERP - INICIALIZAÇÃO             ║
echo ║                   Multi-Tenant v6.0.0                     ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM =========================================
REM TRAVA DE SEGURANÇA 2: CHECAGEM DE ADMIN SEM BLOCO (Evita crash)
REM =========================================
net session >nul 2>&1
if %errorlevel% equ 0 goto admin_ok

echo ⚠️  AVISO: Este script deve ser executado como Administrador!
echo.
echo    Clique com o botao direito no arquivo e selecione
echo    "Executar como Administrador"
echo.
pause
exit /b

:admin_ok
echo ✓ Permissoes de Administrador detectadas.
echo.

echo 🔓 Liberando permissoes de build...
powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" 2>nul
echo.

REM =========================================
REM 2. VERIFICAR E INSTALAR DEPENDENCIAS BACKEND
REM =========================================
echo 📦 Verificando pasta BACKEND...
if not exist "backend" (
    echo ❌ ERRO: A pasta 'backend' nao foi encontrada aqui!
    pause
    exit /b
)

cd backend
if not exist "node_modules" (
    echo   - Instalando dependencias do backend (Isso pode demorar um pouco)...
    call npm install --legacy-peer-deps
) else (
    echo ✓ Backend dependencias ja instaladas.
)

echo 🔨 Reconstruindo modulos nativos (se necessario)...
call npm rebuild 2>nul

echo 🗄️  Sincronizando banco de dados (Prisma)...
call npx prisma generate
call npx prisma db push --skip-generate
cd ..

echo.
REM =========================================
REM 4. VERIFICAR E INSTALAR DEPENDENCIAS FRONTEND
REM =========================================
echo 📦 Verificando pasta FRONTEND...
if not exist "frontend" (
    echo ❌ ERRO: A pasta 'frontend' nao foi encontrada aqui!
    pause
    exit /b
)

cd frontend
if not exist "node_modules" (
    echo   - Instalando dependencias do frontend...
    call npm install --legacy-peer-deps
) else (
    echo ✓ Frontend dependencias ja instaladas.
)
cd ..

REM =========================================
REM 5. INICIAR SERVIDOR E APLICACAO
REM =========================================
echo.
echo 🚀 Iniciando servidores em abas separadas...

REM Iniciar Backend
echo ⏳ Iniciando API (Node.js)...
start "Dash Delivery - Backend" cmd /k "cd backend && npm run dev"

REM Pausa de 3 segundos para o Backend respirar antes de ligar o Front
timeout /t 3 /nobreak >nul

REM Iniciar Frontend (Electron/Vite)
echo ⏳ Iniciando PDV (Electron)...
start "Dash Delivery - Frontend" cmd /k "cd frontend && npm start"

echo.
echo ✅ INICIALIZACAO CONCLUIDA! AS TELAS VAO ABRIR AUTOMATICAMENTE.
echo.
pause