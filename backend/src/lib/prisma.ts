import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'

/**
 * Instancia unica do Prisma.
 *
 * Antes existia `new PrismaClient()` espalhado por 7+ arquivos. Cada instancia
 * abre o proprio pool de conexoes, o que esgota o limite do PostgreSQL e gera
 * erros intermitentes ("too many clients already"). Aqui centralizamos em um
 * singleton, tambem preservado entre recarregamentos do `tsx watch`.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  })

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma
}

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect()
    console.log('[db] PostgreSQL conectado')
  } catch (error) {
    console.error('')
    console.error('================================================================')
    console.error(' Falha ao conectar no PostgreSQL.')
    console.error('================================================================')
    console.error(` Detalhe: ${error instanceof Error ? error.message : String(error)}`)
    console.error('')
    console.error(' Checklist:')
    console.error('   1. O servico do PostgreSQL esta rodando?')
    console.error('   2. O banco existe?  createdb delivery_erp')
    console.error('   3. DATABASE_URL em backend/.env esta com usuario/senha certos?')
    console.error('   4. As tabelas existem?  pnpm db:migrate')
    console.error('================================================================')
    console.error('')
    process.exit(1)
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect()
}
