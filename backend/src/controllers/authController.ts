import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRY = '7d';

interface LoginPayload {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
}

export const authController = {
  // POST /auth/login
  login: async (req: Request, res: Response) => {
    try {
      const { email, password, tenantId } = req.body;

      if (!email || !password || !tenantId) {
        return res.status(400).json({ error: 'Email, password e tenantId requeridos' });
      }

      // Buscar usuário pelo email DENTRO do tenant específico
      const user = await prisma.user.findFirst({
        where: {
          email,
          tenantId
        },
        include: {
          tenant: true
        }
      });

      if (!user) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      // Verificar senha
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      if (!user.active) {
        return res.status(401).json({ error: 'Usuário inativo' });
      }

      // Gerar JWT com payload expandido
      const tokenPayload: LoginPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRY
      });

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          tenantName: user.tenant.name
        }
      });
    } catch (error) {
      console.error('[Backend] Erro ao fazer login:', error);
      res.status(500).json({ error: 'Erro ao fazer login' });
    }
  },

  // POST /auth/register
  register: async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName, tenantId } = req.body;

      if (!email || !password || !tenantId) {
        return res.status(400).json({ error: 'Email, password e tenantId requeridos' });
      }

      // Verificar se email já existe neste tenant
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          tenantId
        }
      });

      if (existingUser) {
        return res.status(409).json({ error: 'Email já registrado nesta empresa' });
      }

      // Hash da senha
      const hashedPassword = await bcrypt.hash(password, 10);

      // Criar usuário (role padrão: 'staff')
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName: firstName || 'Usuário',
          lastName: lastName || '',
          role: 'staff',
          tenantId,
          active: true
        },
        include: {
          tenant: true
        }
      });

      // Gerar token
      const tokenPayload: LoginPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRY
      });

      res.status(201).json({
        success: true,
        message: 'Usuário registrado com sucesso',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId
        }
      });
    } catch (error) {
      console.error('[Backend] Erro ao registrar:', error);
      res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
  },

  // POST /auth/verify
  verify: async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
      }

      const decoded = jwt.verify(token, JWT_SECRET) as LoginPayload;

      res.json({
        valid: true,
        user: decoded
      });
    } catch (error) {
      res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  },

  // POST /auth/refresh (opcional, para renovar token)
  refresh: async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
      }

      const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as LoginPayload;

      // Gerar novo token
      const newToken = jwt.sign(
        {
          userId: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          tenantId: decoded.tenantId
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      res.json({
        success: true,
        token: newToken
      });
    } catch (error) {
      res.status(401).json({ error: 'Erro ao renovar token' });
    }
  }
};
