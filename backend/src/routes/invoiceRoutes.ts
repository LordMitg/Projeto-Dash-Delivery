import { Router, Request, Response } from 'express'
import multer from 'multer'
import { tenantMiddleware, AuthRequest } from '../middleware/tenant.js'
import { prisma } from '../lib/prisma.js'
import {
  parseInvoiceXml,
  processInvoice,
  getUnmappedItems,
} from '../services/invoiceService.js'

const router = Router()

// Multer: armazena em memória (max 2MB por XML)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/xml' || file.originalname.endsWith('.xml')) {
      cb(null, true)
    } else {
      cb(new Error('Apenas arquivos XML são aceitos.'))
    }
  },
})

// ── POST /api/invoices/parse ─────────────────────────────────────────────────
// Faz o parse do XML e retorna os dados para o frontend montar o mapeamento
// sem persistir nada ainda
router.post('/parse', tenantMiddleware, upload.single('xml'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo XML não enviado.' })
    }

    const xmlContent = req.file.buffer.toString('utf-8')
    const parsed     = await parseInvoiceXml(xmlContent)

    return res.json({ success: true, data: parsed })
  } catch (err: any) {
    return res.status(422).json({ error: err.message || 'Erro ao parsear XML.' })
  }
})

// ── POST /api/invoices/process ───────────────────────────────────────────────
// Recebe XML + mapeamentos + configurações e executa a transaction completa
router.post('/process', tenantMiddleware, upload.single('xml'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!

    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo XML não enviado.' })
    }

    // mappings vem como JSON string no body (multipart)
    const mappings        = JSON.parse(req.body.mappings        || '[]')
    const cashRegisterId  = req.body.cashRegisterId             || undefined
    const dreCategoryId   = req.body.dreCategoryId              || undefined
    const dueDate         = req.body.dueDate ? new Date(req.body.dueDate) : undefined

    const xmlContent = req.file.buffer.toString('utf-8')
    const parsed     = await parseInvoiceXml(xmlContent)

    const result = await processInvoice(
      tenantId,
      parsed,
      mappings,
      cashRegisterId,
      dreCategoryId,
      dueDate,
      xmlContent,
    )

    return res.status(201).json({
      success: true,
      invoiceId:      result.invoice.id,
      accountPayable: result.accountPayable.id,
      stockUpdates:   result.stockUpdates.length,
      cashEntry:      result.cashEntry?.id || null,
    })
  } catch (err: any) {
    // Erro de chave duplicada = NF já importada
    if (err.message?.includes('já foi importada')) {
      return res.status(409).json({ error: err.message })
    }
    console.error('[invoiceRoutes] process error:', err)
    return res.status(500).json({ error: err.message || 'Erro interno ao processar NF.' })
  }
})

// ── GET /api/invoices ────────────────────────────────────────────────────────
// Lista todas as NFs do tenant
router.get('/', tenantMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId!
    const { page = '1', limit = '20', status } = req.query as Record<string, string>
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const where: any = { tenantId }
    if (status) where.status = status

    // Antes usava `(req as any).prisma`, que nunca foi definido por nenhum
    // middleware: esta rota quebrava com "cannot read property invoice of
    // undefined". Agora usa a instancia compartilhada.
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { items: { select: { id: true, descricao: true, quantity: true, totalPrice: true, ingredientId: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.invoice.count({ where }),
    ])

    return res.json({ success: true, data: invoices, total, page: parseInt(page) })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /api/invoices/:id/unmapped ───────────────────────────────────────────
// Retorna itens da NF sem mapeamento de ingrediente (para corrigir depois)
router.get('/:id/unmapped', tenantMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id ?? '')
    const tenantId = req.tenantId!
    const items    = await getUnmappedItems(tenantId, id)
    return res.json({ success: true, data: items })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
