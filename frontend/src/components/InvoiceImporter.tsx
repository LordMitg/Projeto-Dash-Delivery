import { useState, useRef, useCallback } from 'react'
import { useTenant } from '../context/TenantContext'
import { api, apiGet, errorMessage, unwrap } from '../lib/api'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ParsedItem {
  numeroItem:    number
  codigoProduto: string
  descricao:     string
  ncm:           string
  unit:          string
  quantity:      number
  unitPrice:     number
  totalPrice:    number
}

interface ParsedInvoice {
  chaveAcesso:    string
  numero:         string
  serie:          string
  emitente:       string
  emitenteDoc:    string
  dataEmissao:    string
  valorTotal:     number
  valorFrete:     number
  valorDesconto:  number
  valorImposto:   number
  items:          ParsedItem[]
}

interface Ingredient { id: string; name: string; sku: string; unit: string }
interface DreCategory { id: string; name: string; code: string }
interface CashRegister { id: string; openingBalance: number; status: string }

type Step = 'upload' | 'review' | 'mapping' | 'confirm' | 'done'

// ─── Componente ──────────────────────────────────────────────────────────────

export default function InvoiceImporter() {
  const { activeTenant } = useTenant()
  // Caminho relativo em vez de `http://localhost:3001`: aquele endereco so
  // existe no navegador da propria maquina do backend.
  const API = '/api'

  const [step,           setStep]           = useState<Step>('upload')
  const [xmlFile,        setXmlFile]        = useState<File | null>(null)
  const [parsed,         setParsed]         = useState<ParsedInvoice | null>(null)
  const [ingredients,    setIngredients]    = useState<Ingredient[]>([])
  const [dreCategories,  setDreCategories]  = useState<DreCategory[]>([])
  const [cashRegisters,  setCashRegisters]  = useState<CashRegister[]>([])
  const [mappings,       setMappings]       = useState<Record<string, string>>({})  // codigoProduto → ingredientId
  const [dreCategoryId,  setDreCategoryId]  = useState('')
  const [cashRegisterId, setCashRegisterId] = useState('')
  const [dueDate,        setDueDate]        = useState('')
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [result,         setResult]         = useState<any>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.xml')) {
      setXmlFile(file)
      setError(null)
    } else {
      setError('Apenas arquivos .xml são aceitos.')
    }
  }, [])

  // ── Passo 1: Parse do XML ────────────────────────────────────────────────────
  async function handleParse() {
    if (!xmlFile || !activeTenant) return
    setLoading(true)
    setError(null)

    const form = new FormData()
    form.append('xml', xmlFile)

    try {
      // `Content-Type: undefined` e obrigatorio no upload: o cliente axios tem
      // 'application/json' como padrao, e mante-lo aqui apagaria o boundary do
      // multipart, fazendo o backend receber o XML como corpo ilegivel.
      const res = await api.post(`${API}/invoices/parse`, form, {
        headers: { 'Content-Type': undefined },
      })
      const invoice = unwrap<ParsedInvoice>(res.data)
      setParsed(invoice)

      // Os ingredientes sao obrigatorios (sem eles nao ha o que mapear), mas
      // categoria de DRE e caixa sao campos opcionais do formulario. Suas rotas
      // ainda nao existem no backend e devolvem 404 — com `Promise.all` esse
      // 404 derrubava a importacao inteira, mesmo com o XML lido corretamente.
      // `allSettled` deixa o fluxo seguir com os selects vazios.
      const ingJson = await apiGet<Ingredient[]>(`${API}/ingredients`)
      setIngredients(ingJson || [])

      const [dreRes, cashRes] = await Promise.allSettled([
        apiGet<DreCategory[]>(`${API}/dre-categories`),
        apiGet<CashRegister[]>(`${API}/cash-registers`, { status: 'open' }),
      ])
      setDreCategories(dreRes.status === 'fulfilled' ? dreRes.value ?? [] : [])
      setCashRegisters(cashRes.status === 'fulfilled' ? cashRes.value ?? [] : [])

      // Pré-mapeia automaticamente por SKU igual
      const autoMap: Record<string, string> = {}
      for (const item of invoice?.items ?? []) {
        const match = (ingJson || []).find(
          (i: Ingredient) => i.sku === item.codigoProduto
        )
        if (match) autoMap[item.codigoProduto] = match.id
      }
      setMappings(autoMap)

      setStep('review')
    } catch (err: unknown) {
      // `err.message` do axios seria "Request failed with status code 400";
      // `errorMessage` extrai o motivo real que a API devolveu.
      setError(errorMessage(err, 'Nao foi possivel ler o XML da nota.'))
    } finally {
      setLoading(false)
    }
  }

  // ── Passo 2: Processar ───────────────────────────────────────────────────────
  async function handleProcess() {
    if (!xmlFile || !parsed || !activeTenant) return
    setLoading(true)
    setError(null)

    const form = new FormData()
    form.append('xml', xmlFile)
    form.append('mappings', JSON.stringify(
      Object.entries(mappings).map(([codigoProduto, ingredientId]) => ({
        codigoProduto,
        ingredientId,
      }))
    ))
    if (cashRegisterId) form.append('cashRegisterId', cashRegisterId)
    if (dreCategoryId)  form.append('dreCategoryId', dreCategoryId)
    if (dueDate)        form.append('dueDate', dueDate)

    try {
      const res = await api.post(`${API}/invoices/process`, form, {
        headers: { 'Content-Type': undefined },
      })
      setResult(res.data)
      setStep('done')
    } catch (err: unknown) {
      setError(errorMessage(err, 'Nao foi possivel importar a nota.'))
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setStep('upload')
    setXmlFile(null)
    setParsed(null)
    setMappings({})
    setDreCategoryId('')
    setCashRegisterId('')
    setDueDate('')
    setResult(null)
    setError(null)
  }

  // ─── Renderização por etapa ──────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'monospace', padding: '16px', maxWidth: '960px' }}>
      <h2>Importar Nota Fiscal (XML SEFAZ)</h2>

      {/* Indicador de etapas */}
      <StepIndicator current={step} />

      {error && (
        <div style={{ background: '#fee', border: '1px solid #f00', padding: '8px', margin: '8px 0' }}>
          ERRO: {error}
        </div>
      )}

      {/* ── ETAPA 1: Upload ── */}
      {step === 'upload' && (
        <div>
          <div
            ref={dropRef}
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            style={{
              border:      '2px dashed #aaa',
              padding:     '40px',
              textAlign:   'center',
              cursor:      'pointer',
              margin:      '16px 0',
              background:  xmlFile ? '#f0fff0' : '#fafafa',
            }}
          >
            {xmlFile ? (
              <span>Arquivo: <strong>{xmlFile.name}</strong> ({(xmlFile.size / 1024).toFixed(1)} KB)</span>
            ) : (
              <span>Arraste o XML da NF-e aqui ou</span>
            )}
            <br />
            <input
              type="file"
              accept=".xml"
              style={{ marginTop: '8px' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) { setXmlFile(f); setError(null) }
              }}
            />
          </div>

          <button
            onClick={handleParse}
            disabled={!xmlFile || loading}
            style={{ padding: '8px 16px', cursor: 'pointer' }}
          >
            {loading ? 'Processando...' : 'Ler XML →'}
          </button>
        </div>
      )}

      {/* ── ETAPA 2: Revisão da NF ── */}
      {step === 'review' && parsed && (
        <div>
          <h3>Dados da Nota Fiscal</h3>
          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr><th>Emitente</th><td>{parsed.emitente}</td><th>CNPJ</th><td>{parsed.emitenteDoc}</td></tr>
              <tr><th>Número</th><td>{parsed.numero}/{parsed.serie}</td><th>Data</th><td>{new Date(parsed.dataEmissao).toLocaleDateString('pt-BR')}</td></tr>
              <tr><th>Total</th><td>R$ {parsed.valorTotal.toFixed(2)}</td><th>Frete</th><td>R$ {parsed.valorFrete.toFixed(2)}</td></tr>
              <tr><th>Desconto</th><td>R$ {parsed.valorDesconto.toFixed(2)}</td><th>Impostos</th><td>R$ {parsed.valorImposto.toFixed(2)}</td></tr>
            </tbody>
          </table>

          <h4>Itens ({parsed.items.length})</h4>
          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                <th>#</th><th>Código</th><th>Descrição</th><th>UN</th>
                <th>Qtd</th><th>Vl. Unit.</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {parsed.items.map(item => (
                <tr key={item.numeroItem}>
                  <td>{item.numeroItem}</td>
                  <td>{item.codigoProduto}</td>
                  <td>{item.descricao}</td>
                  <td>{item.unit}</td>
                  <td>{item.quantity}</td>
                  <td>R$ {item.unitPrice.toFixed(4)}</td>
                  <td>R$ {item.totalPrice.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setStep('upload')} style={{ padding: '8px 16px' }}>
              ← Voltar
            </button>
            <button onClick={() => setStep('mapping')} style={{ padding: '8px 16px' }}>
              Mapear Insumos →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 3: Mapeamento de Insumos ── */}
      {step === 'mapping' && parsed && (
        <div>
          <h3>Mapeamento: Itens da NF → Insumos do Sistema</h3>
          <p style={{ fontSize: '12px', color: '#666' }}>
            Itens com SKU igual foram mapeados automaticamente. Confirme ou ajuste os demais.
          </p>

          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                <th>Código NF</th><th>Descrição NF</th><th>Qtd</th><th>Insumo do Sistema</th>
              </tr>
            </thead>
            <tbody>
              {parsed.items.map(item => (
                <tr key={item.codigoProduto} style={{ background: mappings[item.codigoProduto] ? '#f0fff0' : '#fff8e1' }}>
                  <td>{item.codigoProduto}</td>
                  <td>{item.descricao}</td>
                  <td>{item.quantity} {item.unit}</td>
                  <td>
                    <select
                      value={mappings[item.codigoProduto] || ''}
                      onChange={e => setMappings(prev => ({
                        ...prev,
                        [item.codigoProduto]: e.target.value,
                      }))}
                      style={{ width: '100%', fontSize: '12px' }}
                    >
                      <option value="">-- Ignorar item --</option>
                      {ingredients.map(ing => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.sku}) [{ing.unit}]
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Configurações Financeiras</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <label>
              Categoria DRE
              <select
                value={dreCategoryId}
                onChange={e => setDreCategoryId(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '4px' }}
              >
                <option value="">-- Selecione --</option>
                {dreCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.code} – {c.name}</option>
                ))}
              </select>
            </label>

            <label>
              Caixa (lançar saída)
              <select
                value={cashRegisterId}
                onChange={e => setCashRegisterId(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '4px' }}
              >
                <option value="">-- Não lançar no caixa --</option>
                {cashRegisters.map(c => (
                  <option key={c.id} value={c.id}>
                    Caixa #{c.id.slice(-6)} (abertura: R$ {Number(c.openingBalance).toFixed(2)})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Vencimento da Conta
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '4px' }}
              />
            </label>
          </div>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setStep('review')} style={{ padding: '8px 16px' }}>
              ← Voltar
            </button>
            <button onClick={() => setStep('confirm')} style={{ padding: '8px 16px' }}>
              Revisar e Confirmar →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 4: Confirmação ── */}
      {step === 'confirm' && parsed && (
        <div>
          <h3>Confirmacao Final</h3>

          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <th>NF</th>
                <td>{parsed.numero}/{parsed.serie} — {parsed.emitente}</td>
              </tr>
              <tr>
                <th>Valor Total</th>
                <td>R$ {parsed.valorTotal.toFixed(2)}</td>
              </tr>
              <tr>
                <th>Itens mapeados</th>
                <td>
                  {Object.values(mappings).filter(Boolean).length} de {parsed.items.length}
                  {' '}({parsed.items.length - Object.values(mappings).filter(Boolean).length} itens serão ignorados)
                </td>
              </tr>
              <tr>
                <th>Conta a Pagar</th>
                <td>Sera criada com vencimento em {dueDate || '+30 dias'}</td>
              </tr>
              <tr>
                <th>Caixa</th>
                <td>{cashRegisterId ? 'Lancamento de saida sera criado' : 'Nenhum lancamento de caixa'}</td>
              </tr>
            </tbody>
          </table>

          <p style={{ background: '#fff8e1', padding: '8px', marginTop: '12px' }}>
            <strong>Operacoes que serao executadas em transacao atomica:</strong>
            <br />1. Persistir NF + itens no banco
            <br />2. Atualizar estoque de {Object.values(mappings).filter(Boolean).length} insumo(s)
            <br />3. Recalcular Preco Medio Ponderado (PMP) de cada insumo
            <br />4. Criar Conta a Pagar no modulo financeiro
            {cashRegisterId && <><br />5. Registrar saida no Caixa ativo</>}
            <br />{cashRegisterId ? '6' : '5'}. Recalcular CMV dos produtos afetados
          </p>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setStep('mapping')} style={{ padding: '8px 16px' }}>
              ← Voltar
            </button>
            <button
              onClick={handleProcess}
              disabled={loading}
              style={{ padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              {loading ? 'Processando...' : 'Confirmar e Importar NF'}
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 5: Resultado ── */}
      {step === 'done' && result && (
        <div>
          <h3 style={{ color: '#28a745' }}>Nota Fiscal Importada com Sucesso</h3>
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
            <tbody>
              <tr><th>Invoice ID</th><td>{result.invoiceId}</td></tr>
              <tr><th>Conta a Pagar</th><td>{result.accountPayable}</td></tr>
              <tr><th>Insumos atualizados</th><td>{result.stockUpdates}</td></tr>
              <tr><th>Lancamento de Caixa</th><td>{result.cashEntry || '—'}</td></tr>
            </tbody>
          </table>

          <button
            onClick={reset}
            style={{ marginTop: '16px', padding: '8px 16px', cursor: 'pointer' }}
          >
            Importar Nova NF
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Indicador de etapas ─────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',  label: '1. Upload'   },
  { key: 'review',  label: '2. Revisão'  },
  { key: 'mapping', label: '3. Mapeamento' },
  { key: 'confirm', label: '4. Confirmação' },
  { key: 'done',    label: '5. Concluído'  },
]

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex(s => s.key === current)
  return (
    <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', fontSize: '12px' }}>
      {STEPS.map((s, i) => (
        <span
          key={s.key}
          style={{
            padding:    '4px 10px',
            background: i === currentIdx ? '#0066cc' : i < currentIdx ? '#28a745' : '#eee',
            color:      i <= currentIdx ? '#fff' : '#666',
            borderRadius: '4px',
          }}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}
