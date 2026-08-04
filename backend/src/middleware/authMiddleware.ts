import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    tenantId: string;
  };
  tenant?: {
    id: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Middleware: Verifica JWT e injeta user no request
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: string;
      tenantId: string;
    };

    // Injeta user e tenant no request
    req.user = decoded;
    req.tenant = { id: decoded.tenantId };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expirado' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    res.status(401).json({ error: 'Autenticação falhou' });
  }
};

// Middleware: Verifica se usuário é admin
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Acesso negado: privilégios insuficientes' });
  }

  next();
};

// Middleware: Verifica se usuário tem acesso financeiro (admin/manager)
export const requireFinancialAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const allowedRoles = ['admin', 'manager', 'caixa'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado: privilégios insuficientes' });
  }

  next();
};

// Middleware: Verifica se usuário tem acesso a estoque (admin/manager)
export const requireStockAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const allowedRoles = ['admin', 'manager'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado: privilégios insuficientes' });
  }

  next();
};

export default authenticate;
