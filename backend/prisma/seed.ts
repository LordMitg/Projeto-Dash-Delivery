/**
 * Seed do banco de dados.
 *
 * Cria uma loja completa e pronta para operar:
 *   - 1 tenant (a loja) com horarios, taxa de entrega e loja fechada
 *   - 3 usuarios (admin, gerente, atendente)
 *   - Canais de venda com as taxas reais de mercado (Balcao, iFood, WhatsApp)
 *   - Categorias do cardapio
 *   - Insumos com codigo de barras (para testar o scanner do celular)
 *   - Combo "Marmita" com 3 proteinas a escolha (requisito central do sistema)
 *   - Adicionais (bacon extra, refrigerante)
 *   - Categorias de DRE
 *
 * E idempotente: pode rodar quantas vezes quiser sem duplicar dados,
 * porque usa `upsert` em todas as entidades.
 */
// Precisa vir ANTES do PrismaClient: o construtor le DATABASE_URL no momento da
// importacao. Sem esta linha, `pnpm db:seed` falhava com "Environment variable
// not found: DATABASE_URL" mesmo com o backend/.env preenchido — porque o
// `prisma migrate` carrega o .env sozinho, mas `tsx prisma/seed.ts` nao.
// Reusa o carregamento de env do servidor em vez de duplicar dotenv aqui.
import '../src/config/env.js'
import { PrismaClient, Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { ROLE_PRESETS } from '../src/lib/permissions.js'

const prisma = new PrismaClient()

/** Converte number para Decimal do Prisma sem perder precisao. */
const dec = (v: number) => new Prisma.Decimal(v.toFixed(4))

async function main() {
  console.log('[seed] iniciando...')

  // ============================================================
  // 1. TENANT (A LOJA)
  // ============================================================
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'loja-demo' },
    update: {},
    create: {
      name: 'Marmitaria Sabor Caseiro',
      slug: 'loja-demo',
      email: 'contato@saborcaseiro.local',
      phone: '(11) 98765-4321',
      address: 'Rua das Palmeiras, 120',
      city: 'Sao Paulo',
      state: 'SP',
      zipCode: '01234-000',
      active: true,
      // A loja comeca FECHADA de proposito: o operador precisa abrir no painel.
      isOpen: false,
      openingHours: {
        mon: [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '23:00' }],
        tue: [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '23:00' }],
        wed: [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '23:00' }],
        thu: [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '23:00' }],
        fri: [{ from: '11:00', to: '15:00' }, { from: '18:00', to: '23:59' }],
        sat: [{ from: '11:00', to: '23:59' }],
        sun: [{ from: '11:00', to: '16:00' }],
      },
      deliveryFeeBase: dec(8),
      deliveryZones: [
        { name: 'Centro', fee: 5 },
        { name: 'Jardim America', fee: 8 },
        { name: 'Vila Nova', fee: 12 },
      ],
      printSettings: { paperWidthMm: 80, autoPrintOnConfirm: true, copies: 1 },
    },
  })
  console.log(`[seed] tenant: ${tenant.name} (${tenant.id})`)

  // ============================================================
  // 2. USUARIOS
  // ============================================================
  // Senha padrao de desenvolvimento. Troque em producao.
  const passwordHash = await bcrypt.hash('admin123', 10)

  // O acesso a loja vive em `Membership`: `role` aqui e o papel NO NEGOCIO
  // ("owner" = dono, "staff" = funcionario com as permissoes marcadas).
  const users = [
    {
      email: 'admin@local',
      firstName: 'Ana',
      lastName: 'Souza',
      role: 'owner',
      // Owner nao usa lista: `hasPermission` libera tudo pelo papel.
      permissions: [] as string[],
    },
    {
      email: 'gerente@local',
      firstName: 'Bruno',
      lastName: 'Lima',
      role: 'staff',
      permissions: [...ROLE_PRESETS.manager.permissions] as string[],
    },
    {
      email: 'caixa@local',
      firstName: 'Carla',
      lastName: 'Dias',
      role: 'staff',
      permissions: [...ROLE_PRESETS.cashier.permissions] as string[],
    },
  ]

  for (const u of users) {
    const { role, permissions, ...profile } = u
    // Email agora e unico global, entao a chave do upsert e so o email.
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { active: true },
      create: { ...profile, password: passwordHash, active: true },
    })

    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      update: { role, permissions },
      create: { userId: user.id, tenantId: tenant.id, role, permissions },
    })
  }
  console.log(`[seed] ${users.length} usuarios + vinculos (senha: admin123)`)

  // ============================================================
  // 3. CANAIS DE VENDA (com as taxas que corroem a margem)
  // ============================================================
  const channels = [
    {
      name: 'Balcao',
      slug: 'balcao',
      platformFeePerc: 0,
      platformFeeFixed: 0,
      paymentFeePerc: 2.5, // maquininha
      targetMarginPerc: 35,
    },
    {
      name: 'iFood',
      slug: 'ifood',
      platformFeePerc: 27, // comissao real do plano entrega
      platformFeeFixed: 0,
      paymentFeePerc: 3.5,
      targetMarginPerc: 20,
    },
    {
      name: 'WhatsApp',
      slug: 'whatsapp',
      platformFeePerc: 0,
      platformFeeFixed: 0,
      paymentFeePerc: 1.2, // pix
      targetMarginPerc: 35,
    },
  ]

  const channelMap = new Map<string, string>()
  for (const c of channels) {
    const ch = await prisma.salesChannel.upsert({
      where: { slug_tenantId: { slug: c.slug, tenantId: tenant.id } },
      update: { ...c },
      create: {
        ...c,
        platformFeePerc: dec(c.platformFeePerc),
        platformFeeFixed: dec(c.platformFeeFixed),
        paymentFeePerc: dec(c.paymentFeePerc),
        targetMarginPerc: dec(c.targetMarginPerc),
        tenantId: tenant.id,
      },
    })
    channelMap.set(c.slug, ch.id)
  }
  console.log(`[seed] ${channels.length} canais de venda`)

  // ============================================================
  // 4. CATEGORIAS DO CARDAPIO
  // ============================================================
  const categories = [
    { name: 'Marmitas', slug: 'marmitas', sortOrder: 1 },
    { name: 'Bebidas', slug: 'bebidas', sortOrder: 2 },
    { name: 'Sobremesas', slug: 'sobremesas', sortOrder: 3 },
  ]

  const catMap = new Map<string, string>()
  for (const c of categories) {
    const cat = await prisma.menuCategory.upsert({
      where: { slug_tenantId: { slug: c.slug, tenantId: tenant.id } },
      update: { name: c.name, sortOrder: c.sortOrder, active: true },
      create: { ...c, active: true, tenantId: tenant.id },
    })
    catMap.set(c.slug, cat.id)
  }
  console.log(`[seed] ${categories.length} categorias`)

  // ============================================================
  // 5. INSUMOS (com codigo de barras para testar o scanner)
  // ============================================================
  const ingredients = [
    // Proteinas: precos diferentes de proposito, para o simulador de impacto
    { name: 'File de Frango', sku: 'PROT-FRANGO', barcode: '7891000100101', unit: 'kg', price: 18.9, breakage: 8, stock: 25 },
    { name: 'Carne Bovina (Acem)', sku: 'PROT-CARNE', barcode: '7891000100102', unit: 'kg', price: 38.5, breakage: 12, stock: 18 },
    { name: 'File de Tilapia', sku: 'PROT-PEIXE', barcode: '7891000100103', unit: 'kg', price: 32.0, breakage: 10, stock: 12 },
    // Acompanhamentos
    { name: 'Arroz Branco', sku: 'ACOMP-ARROZ', barcode: '7891000100201', unit: 'kg', price: 5.2, breakage: 2, stock: 60 },
    { name: 'Feijao Carioca', sku: 'ACOMP-FEIJAO', barcode: '7891000100202', unit: 'kg', price: 8.4, breakage: 3, stock: 40 },
    { name: 'Batata Frita Congelada', sku: 'ACOMP-BATATA', barcode: '7891000100203', unit: 'kg', price: 12.9, breakage: 5, stock: 30 },
    { name: 'Farofa Pronta', sku: 'ACOMP-FAROFA', barcode: '7891000100204', unit: 'kg', price: 14.0, breakage: 2, stock: 8 },
    // Extras
    { name: 'Bacon em Cubos', sku: 'EXTRA-BACON', barcode: '7891000100301', unit: 'kg', price: 42.0, breakage: 6, stock: 6 },
    { name: 'Refrigerante Lata 350ml', sku: 'BEB-REFRI', barcode: '7891000100401', unit: 'un', price: 3.2, breakage: 0, stock: 120 },
    // Embalagens: o custo que quase todo mundo esquece de somar
    { name: 'Marmita Divisoria 3 Espacos', sku: 'EMB-MARMITA', barcode: '7891000100501', unit: 'un', price: 1.85, breakage: 1, stock: 400 },
    { name: 'Sacola Plastica', sku: 'EMB-SACOLA', barcode: '7891000100502', unit: 'un', price: 0.22, breakage: 1, stock: 800 },
    { name: 'Guardanapo + Talher', sku: 'EMB-KIT', barcode: '7891000100503', unit: 'un', price: 0.45, breakage: 0, stock: 500 },
  ]

  const ingMap = new Map<string, { id: string; price: number; breakage: number }>()
  for (const i of ingredients) {
    const ing = await prisma.ingredient.upsert({
      where: { sku_tenantId: { sku: i.sku, tenantId: tenant.id } },
      update: {
        name: i.name,
        barcode: i.barcode,
        unit: i.unit,
        price: dec(i.price),
        breakageFactor: dec(i.breakage),
        stock: dec(i.stock),
        active: true,
      },
      create: {
        name: i.name,
        sku: i.sku,
        barcode: i.barcode,
        unit: i.unit,
        price: dec(i.price),
        breakageFactor: dec(i.breakage),
        stock: dec(i.stock),
        minimumStock: dec(5),
        active: true,
        tenantId: tenant.id,
      },
    })
    ingMap.set(i.sku, { id: ing.id, price: i.price, breakage: i.breakage })
  }
  console.log(`[seed] ${ingredients.length} insumos`)

  // ============================================================
  // 6. PRODUTOS
  // ============================================================
  /** Custo real de um insumo na receita, ja com a quebra aplicada. */
  const lineCost = (sku: string, qty: number) => {
    const ing = ingMap.get(sku)!
    return ing.price * qty * (1 + ing.breakage / 100)
  }

  // ---- 6.1 COMBO MARMITA: o produto central do sistema ----
  // A ficha tecnica guarda a base COMUM (arroz, feijao, embalagens).
  // A proteina e escolhida na venda, e por isso entra como comboOptions.
  const marmitaBase: Array<{ sku: string; qty: number; packaging?: boolean }> = [
    { sku: 'ACOMP-ARROZ', qty: 0.25 },
    { sku: 'ACOMP-FEIJAO', qty: 0.15 },
    { sku: 'ACOMP-BATATA', qty: 0.12 },
    { sku: 'ACOMP-FAROFA', qty: 0.03 },
    { sku: 'EMB-MARMITA', qty: 1, packaging: true },
    { sku: 'EMB-SACOLA', qty: 1, packaging: true },
    { sku: 'EMB-KIT', qty: 1, packaging: true },
  ]

  const baseCost = marmitaBase.reduce((sum, l) => sum + lineCost(l.sku, l.qty), 0)
  // Proteina padrao (frango) apenas para exibir um custo inicial coerente.
  const proteinQty = 0.18
  const defaultProteinCost = lineCost('PROT-FRANGO', proteinQty)

  const marmita = await prisma.product.upsert({
    where: { sku_tenantId: { sku: 'COMBO-MARMITA', tenantId: tenant.id } },
    update: {
      costPrice: dec(baseCost + defaultProteinCost),
      menuCategoryId: catMap.get('marmitas'),
      packagingIngredientId: ingMap.get('EMB-MARMITA')!.id,
    },
    create: {
      name: 'Marmita Completa',
      description:
        'Arroz, feijao, batata frita, farofa e a proteina que voce escolher.',
      sku: 'COMBO-MARMITA',
      barcode: '7891000900001',
      price: dec(32.9),
      costPrice: dec(baseCost + defaultProteinCost),
      laborCost: dec(2.5),
      category: 'Marmitas',
      menuCategoryId: catMap.get('marmitas'),
      productType: 'combo',
      featured: true,
      sortOrder: 1,
      active: true,
      // As 3 proteinas a escolha: exatamente o requisito do combo.
      comboOptions: [
        { group: 'proteina', label: 'Frango Grelhado', ingredientId: ingMap.get('PROT-FRANGO')!.id, quantity: proteinQty },
        { group: 'proteina', label: 'Carne Bovina', ingredientId: ingMap.get('PROT-CARNE')!.id, quantity: proteinQty },
        { group: 'proteina', label: 'Tilapia Grelhada', ingredientId: ingMap.get('PROT-PEIXE')!.id, quantity: proteinQty },
      ],
      packagingIngredientId: ingMap.get('EMB-MARMITA')!.id,
      tenantId: tenant.id,
    },
  })

  // Ficha tecnica da base do combo
  for (const line of marmitaBase) {
    const ing = ingMap.get(line.sku)!
    const total = lineCost(line.sku, line.qty)
    await prisma.productIngredient.upsert({
      where: { productId_ingredientId: { productId: marmita.id, ingredientId: ing.id } },
      update: { quantity: dec(line.qty), unitCost: dec(ing.price), totalCost: dec(total) },
      create: {
        productId: marmita.id,
        ingredientId: ing.id,
        quantity: dec(line.qty),
        unitCost: dec(ing.price),
        totalCost: dec(total),
        isPackaging: line.packaging ?? false,
        tenantId: tenant.id,
      },
    })
  }

  // ---- 6.2 Produtos simples ----
  const simpleProducts = [
    {
      name: 'Refrigerante Lata 350ml',
      sku: 'BEB-LATA',
      barcode: '7891000900002',
      price: 7.0,
      category: 'bebidas',
      recipe: [{ sku: 'BEB-REFRI', qty: 1 }],
    },
    {
      name: 'Marmita Fitness (Frango + Arroz)',
      sku: 'COMBO-FIT',
      barcode: '7891000900003',
      price: 28.9,
      category: 'marmitas',
      recipe: [
        { sku: 'PROT-FRANGO', qty: 0.2 },
        { sku: 'ACOMP-ARROZ', qty: 0.2 },
        { sku: 'EMB-MARMITA', qty: 1, packaging: true },
        { sku: 'EMB-KIT', qty: 1, packaging: true },
      ],
    },
  ]

  for (const p of simpleProducts) {
    const cost = p.recipe.reduce((s, l) => s + lineCost(l.sku, l.qty), 0)
    const prod = await prisma.product.upsert({
      where: { sku_tenantId: { sku: p.sku, tenantId: tenant.id } },
      update: { costPrice: dec(cost), menuCategoryId: catMap.get(p.category) },
      create: {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: dec(p.price),
        costPrice: dec(cost),
        laborCost: dec(0.5),
        menuCategoryId: catMap.get(p.category),
        productType: 'simple',
        active: true,
        tenantId: tenant.id,
      },
    })

    for (const l of p.recipe as Array<{ sku: string; qty: number; packaging?: boolean }>) {
      const ing = ingMap.get(l.sku)!
      await prisma.productIngredient.upsert({
        where: { productId_ingredientId: { productId: prod.id, ingredientId: ing.id } },
        update: { quantity: dec(l.qty), unitCost: dec(ing.price), totalCost: dec(lineCost(l.sku, l.qty)) },
        create: {
          productId: prod.id,
          ingredientId: ing.id,
          quantity: dec(l.qty),
          unitCost: dec(ing.price),
          totalCost: dec(lineCost(l.sku, l.qty)),
          isPackaging: l.packaging ?? false,
          tenantId: tenant.id,
        },
      })
    }
  }
  console.log(`[seed] ${simpleProducts.length + 1} produtos`)

  // ============================================================
  // 7. ADICIONAIS DO COMBO
  // ============================================================
  const addons = [
    {
      name: 'Bacon Extra',
      price: 6.0,
      groupName: 'Adicionais',
      ingredientSku: 'EXTRA-BACON',
      ingredientQty: 0.04,
      maxQuantity: 3,
      sortOrder: 1,
    },
    {
      name: 'Refrigerante Lata',
      price: 6.5,
      groupName: 'Bebida',
      ingredientSku: 'BEB-REFRI',
      ingredientQty: 1,
      maxQuantity: 2,
      sortOrder: 2,
    },
    {
      name: 'Porcao Extra de Farofa',
      price: 3.0,
      groupName: 'Adicionais',
      ingredientSku: 'ACOMP-FAROFA',
      ingredientQty: 0.03,
      maxQuantity: 2,
      sortOrder: 3,
    },
  ]

  // Remove adicionais antigos deste produto para nao acumular duplicados
  await prisma.productAddon.deleteMany({ where: { productId: marmita.id } })
  for (const a of addons) {
    await prisma.productAddon.create({
      data: {
        name: a.name,
        price: dec(a.price),
        groupName: a.groupName,
        maxQuantity: a.maxQuantity,
        sortOrder: a.sortOrder,
        ingredientId: ingMap.get(a.ingredientSku)!.id,
        ingredientQty: dec(a.ingredientQty),
        active: true,
        productId: marmita.id,
        tenantId: tenant.id,
      },
    })
  }
  console.log(`[seed] ${addons.length} adicionais`)

  // ============================================================
  // 8. CATEGORIAS DE DRE
  // ============================================================
  const dreCategories = [
    { code: 'RECEITA', name: 'Receita Bruta de Vendas', type: 'revenue' },
    { code: 'CMV', name: 'Custo da Mercadoria Vendida', type: 'cogs' },
    { code: 'EMB', name: 'Embalagens', type: 'cogs' },
    { code: 'MOD', name: 'Mao de Obra Direta', type: 'expense' },
    { code: 'ALUGUEL', name: 'Aluguel', type: 'expense' },
    { code: 'ENERGIA', name: 'Energia Eletrica', type: 'expense' },
    { code: 'TAXAS', name: 'Taxas de Plataforma', type: 'expense' },
    { code: 'MARKETING', name: 'Marketing', type: 'expense' },
  ]

  for (const d of dreCategories) {
    await prisma.dreCategory.upsert({
      where: { code_tenantId: { code: d.code, tenantId: tenant.id } },
      update: { name: d.name, type: d.type },
      create: { ...d, active: true, tenantId: tenant.id },
    })
  }
  console.log(`[seed] ${dreCategories.length} categorias de DRE`)

  console.log('\n[seed] concluido com sucesso')
  console.log('[seed] ------------------------------------------')
  console.log('[seed] Acesse com:')
  console.log('[seed]   email: admin@local')
  console.log('[seed]   senha: admin123')
  console.log('[seed] ------------------------------------------')
}

main()
  .catch((e) => {
    console.error('[seed] ERRO:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
