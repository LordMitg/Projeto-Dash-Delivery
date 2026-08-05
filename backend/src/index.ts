import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Importar rotas
import authRoutes from './routes/authRoutes';
import ingredientRoutes from './routes/ingredientRoutes';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import financialRoutes from './routes/financialRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import pricingRoutes from './routes/pricingRoutes';

// Importar middlewares
import { tenantMiddleware } from './middleware/tenant';
import { authenticate, requireFinancialAccess } from './middleware/authMiddleware';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;

// Middlewares globais
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Health check (sem autenticação)
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '7.0.0'
  });
});

// ========== ROTAS DE AUTENTICAÇÃO (SEM PROTEÇÃO) ==========
app.use('/api/auth', authRoutes);

// ========== ROTAS PROTEGIDAS COM AUTENTICAÇÃO ==========
// Middleware de autenticação obrigatório a partir daqui
app.use('/api/', authenticate);

// Rotas de Ingredientes
app.use('/api/ingredients', ingredientRoutes);

// Rotas de Produtos
app.use('/api/products', productRoutes);

// Rotas de Pedidos
app.use('/api/orders', orderRoutes);

// Rotas de Notas Fiscais
app.use('/api/invoices', invoiceRoutes);

// Rotas de Precificação
app.use('/api/pricing', pricingRoutes);

// Rotas Financeiras (com acesso restrito)
app.use('/api/financial', requireFinancialAccess, financialRoutes);

// ========== ERROR HANDLING ==========
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Backend Error]', err);
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Token inválido' });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expirado' });
  }
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   🚀 BACKEND DELIVERY ERP - ETAPA 7       ║
╚════════════════════════════════════════════╝

✓ Servidor rodando em: http://localhost:${PORT}
✓ Autenticação JWT: Ativa
✓ Multi-tenant: Ativo
✓ Banco de dados: Conectando...

Endpoints disponíveis:
  • POST   /api/auth/login
  • POST   /api/auth/register
  • GET    /api/auth/me (protegido)
  • GET    /health (sem autenticação)
  
Rotas protegidas por JWT:
  • /api/ingredients/*
  • /api/products/*
  • /api/orders/*
  • /api/invoices/*
  • /api/pricing/*
  • /api/financial/* (requer role: admin/manager/caixa)

Modo: ${process.env.NODE_ENV || 'development'}
Versão: 7.0.0
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nEncerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});
