import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class TenantService {
  // Obter tenant por ID (sempre com isolamento de contexto)
  static async getTenantById(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId }
    });
  }

  // Listar todos os tenants do usuário (múltiplas empresas)
  static async getUserTenants(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true
      }
    });
  }

  // Criar novo tenant (empresa)
  static async createTenant(data: {
    name: string;
    slug: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  }) {
    return prisma.tenant.create({
      data
    });
  }

  // Validar acesso do usuário ao tenant
  static async validateUserAccess(userId: string, tenantId: string) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: tenantId
      }
    });

    return !!user;
  }

  // Listar usuarios do tenant
  static async getTenantUsers(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true
      }
    });
  }

  // Contar pedidos por tenant (exemplo de query com isolamento)
  static async getTenantOrderCount(tenantId: string) {
    return prisma.order.count({
      where: { tenantId }
    });
  }
}
