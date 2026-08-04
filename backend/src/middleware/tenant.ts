import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Estender Request para incluir tenantId
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}

export const tenantMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    
    req.tenantId = decoded.tenantId;
    req.userId = decoded.userId;

    if (!req.tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Helper para garantir tenant_id em queries Prisma
export const withTenantContext = (tenantId: string) => ({
  where: { tenantId }
});
