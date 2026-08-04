import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyTenant } from '../middleware/tenant';

const router = Router();
const prisma = new PrismaClient();

// Estender type de Request para incluir tenantId
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

// ===== LISTAR INSUMOS =====
router.get('/ingredients', verifyTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;

    const ingredients = await prisma.ingredient.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json({
      success: true,
      data: ingredients,
    });
  } catch (error) {
    console.error('[Ingredient] Erro ao listar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao listar insumos',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

// ===== OBTER INSUMO POR ID =====
router.get('/ingredients/:id', verifyTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const ingredient = await prisma.ingredient.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!ingredient) {
      return res.status(404).json({
        success: false,
        message: 'Insumo não encontrado',
      });
    }

    res.json({
      success: true,
      data: ingredient,
    });
  } catch (error) {
    console.error('[Ingredient] Erro ao obter:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao obter insumo',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

// ===== CRIAR INSUMO =====
router.post('/ingredients', verifyTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { name, description, sku, unit, price, breakageFactor, stock, minimumStock, active } =
      req.body;

    // Validação básica
    if (!name || !sku || !unit || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Campos obrigatórios faltando: name, sku, unit, price',
      });
    }

    // Verificar se SKU já existe para este tenant
    const existingSku = await prisma.ingredient.findFirst({
      where: {
        sku,
        tenantId,
      },
    });

    if (existingSku) {
      return res.status(409).json({
        success: false,
        message: 'SKU já existe para este tenant',
      });
    }

    const ingredient = await prisma.ingredient.create({
      data: {
        name,
        description: description || null,
        sku,
        unit,
        price: parseFloat(price),
        breakageFactor: parseFloat(breakageFactor) || 0,
        stock: parseInt(stock) || 0,
        minimumStock: parseInt(minimumStock) || 0,
        active: active !== undefined ? active : true,
        tenantId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Insumo criado com sucesso',
      data: ingredient,
    });
  } catch (error) {
    console.error('[Ingredient] Erro ao criar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao criar insumo',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

// ===== ATUALIZAR INSUMO =====
router.put('/ingredients/:id', verifyTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { name, description, sku, unit, price, breakageFactor, stock, minimumStock, active } =
      req.body;

    // Verificar se insumo existe e pertence ao tenant
    const ingredient = await prisma.ingredient.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!ingredient) {
      return res.status(404).json({
        success: false,
        message: 'Insumo não encontrado',
      });
    }

    // Se SKU mudou, verificar duplicação
    if (sku && sku !== ingredient.sku) {
      const existingSku = await prisma.ingredient.findFirst({
        where: {
          sku,
          tenantId,
          id: {
            not: id,
          },
        },
      });

      if (existingSku) {
        return res.status(409).json({
          success: false,
          message: 'SKU já existe para outro insumo neste tenant',
        });
      }
    }

    const updatedIngredient = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(sku && { sku }),
        ...(unit && { unit }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(breakageFactor !== undefined && { breakageFactor: parseFloat(breakageFactor) }),
        ...(stock !== undefined && { stock: parseInt(stock) }),
        ...(minimumStock !== undefined && { minimumStock: parseInt(minimumStock) }),
        ...(active !== undefined && { active }),
      },
    });

    res.json({
      success: true,
      message: 'Insumo atualizado com sucesso',
      data: updatedIngredient,
    });
  } catch (error) {
    console.error('[Ingredient] Erro ao atualizar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar insumo',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

// ===== DELETAR INSUMO =====
router.delete('/ingredients/:id', verifyTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    // Verificar se insumo existe e pertence ao tenant
    const ingredient = await prisma.ingredient.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!ingredient) {
      return res.status(404).json({
        success: false,
        message: 'Insumo não encontrado',
      });
    }

    await prisma.ingredient.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Insumo deletado com sucesso',
    });
  } catch (error) {
    console.error('[Ingredient] Erro ao deletar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao deletar insumo',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});

export default router;
