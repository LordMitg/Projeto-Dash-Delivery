import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTenant } from '../context/TenantContext';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  price: number;
  breakageFactor: number;
}

interface SheetLine {
  ingredientId: string;
  quantity: number;
  isMainProtein: boolean;
  isPackaging: boolean;
  notes?: string;
}

interface CMVLine {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  breakageFactor: number;
  effectiveQuantity: number;
  lineCost: number;
  isMainProtein: boolean;
  isPackaging: boolean;
}

interface CMVResult {
  ingredientCost: number;
  laborCost: number;
  packagingCost: number;
  totalCostPrice: number;
  margin: number;
  lines: CMVLine[];
}

interface ProductForm {
  name: string;
  sku: string;
  price: string;
  laborCost: string;
  category: string;
  productType: 'simple' | 'combo';
  description: string;
}

const EMPTY_FORM: ProductForm = {
  name: '',
  sku: '',
  price: '',
  laborCost: '0',
  category: '',
  productType: 'simple',
  description: '',
};

const API = 'http://localhost:3001/api';

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function TechnicalSheet() {
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id ?? '';

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [sheet, setSheet] = useState<SheetLine[]>([]);
  const [cmv, setCmv] = useState<CMVResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Linha em edição temporária para adicionar na ficha
  const [newLine, setNewLine] = useState<Partial<SheetLine>>({
    ingredientId: '',
    quantity: 0,
    isMainProtein: false,
    isPackaging: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega ingredientes do tenant
  useEffect(() => {
    if (!tenantId) return;
    fetch(`${API}/ingredients`, {
      headers: { 'x-tenant-id': tenantId },
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setIngredients(res.data);
      });
  }, [tenantId]);

  // Preview CMV com debounce de 400ms
  const previewCMV = useCallback(
    (currentSheet: SheetLine[], laborCost: string, salePrice: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!tenantId || currentSheet.length === 0) {
          setCmv(null);
          return;
        }
        try {
          const res = await fetch(`${API}/products/preview-cmv`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-tenant-id': tenantId,
            },
            body: JSON.stringify({
              technicalSheet: currentSheet,
              laborCost: Number(laborCost) || 0,
              salePrice: Number(salePrice) || 0,
            }),
          });
          const data = await res.json();
          if (data.success) setCmv(data.data);
        } catch (_) {
          // erro silencioso no preview
        }
      }, 400);
    },
    [tenantId]
  );

  // Dispara preview toda vez que a ficha, mão de obra ou preço mudam
  useEffect(() => {
    previewCMV(sheet, form.laborCost, form.price);
  }, [sheet, form.laborCost, form.price, previewCMV]);

  // Adiciona linha à ficha técnica
  function addLine() {
    if (!newLine.ingredientId || !newLine.quantity) return;

    // Regra combo: apenas 1 proteína principal
    if (newLine.isMainProtein) {
      const alreadyHasProtein = sheet.some((l) => l.isMainProtein);
      if (alreadyHasProtein) {
        alert('Já existe uma proteína principal na ficha. Remova-a antes de adicionar outra.');
        return;
      }
    }

    // Evita duplicatas
    if (sheet.some((l) => l.ingredientId === newLine.ingredientId)) {
      alert('Este ingrediente já está na ficha técnica.');
      return;
    }

    setSheet((prev) => [
      ...prev,
      {
        ingredientId: newLine.ingredientId!,
        quantity: Number(newLine.quantity),
        isMainProtein: newLine.isMainProtein ?? false,
        isPackaging: newLine.isPackaging ?? false,
        notes: newLine.notes,
      },
    ]);
    setNewLine({ ingredientId: '', quantity: 0, isMainProtein: false, isPackaging: false });
  }

  function removeLine(ingredientId: string) {
    setSheet((prev) => prev.filter((l) => l.ingredientId !== ingredientId));
  }

  function updateLineQty(ingredientId: string, quantity: number) {
    setSheet((prev) =>
      prev.map((l) => (l.ingredientId === ingredientId ? { ...l, quantity } : l))
    );
  }

  // Salva produto com ficha técnica
  async function handleSave() {
    if (!form.name || !form.sku || !form.price) {
      alert('Preencha nome, SKU e preço de venda.');
      return;
    }
    if (form.productType === 'combo') {
      const proteins = sheet.filter((l) => l.isMainProtein);
      if (proteins.length !== 1) {
        alert('Combos devem ter exatamente 1 proteína principal marcada na ficha técnica.');
        return;
      }
    }

    setLoading(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          laborCost: Number(form.laborCost) || 0,
          technicalSheet: sheet,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg('Produto salvo com sucesso!');
        setForm(EMPTY_FORM);
        setSheet([]);
        setCmv(null);
      } else {
        setSaveMsg(`Erro: ${data.error}`);
      }
    } catch (e) {
      setSaveMsg('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }

  // Helpers de display
  const getIngredient = (id: string) => ingredients.find((i) => i.id === id);

  const marginColor = (margin: number) => {
    if (margin >= 60) return '#22c55e';
    if (margin >= 40) return '#eab308';
    return '#ef4444';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'monospace', padding: '1rem', maxWidth: '900px' }}>
      <h2 style={{ borderBottom: '2px solid #555', paddingBottom: '0.5rem' }}>
        Ficha Técnica / CMV
        {activeTenant && (
          <span style={{ fontSize: '0.8rem', color: '#888', marginLeft: '1rem' }}>
            [{activeTenant.name}]
          </span>
        )}
      </h2>

      {/* ── DADOS DO PRODUTO ─────────────────────────────────────── */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3>1. Dados do Produto</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <label>
            Nome *
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label>
            SKU *
            <input
              value={form.sku}
              onChange={(e) => setForm((p) => ({ ...p, sku: e.target.value.toUpperCase() }))}
              style={inputStyle}
            />
          </label>
          <label>
            Preço de Venda (R$) *
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label>
            Mão de Obra (R$)
            <input
              type="number"
              step="0.01"
              value={form.laborCost}
              onChange={(e) => setForm((p) => ({ ...p, laborCost: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label>
            Categoria
            <input
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label>
            Tipo
            <select
              value={form.productType}
              onChange={(e) =>
                setForm((p) => ({ ...p, productType: e.target.value as 'simple' | 'combo' }))
              }
              style={inputStyle}
            >
              <option value="simple">Simples</option>
              <option value="combo">Combo</option>
            </select>
          </label>
        </div>
        {form.productType === 'combo' && (
          <p style={{ color: '#f59e0b', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            MODO COMBO: marque exatamente 1 ingrediente como "Proteina Principal" na ficha abaixo.
            O cliente vera ate 3 opcoes visuais, mas apenas 1 proteina sera debitada no CMV.
          </p>
        )}
      </section>

      {/* ── ADICIONAR LINHA NA FICHA ─────────────────────────────── */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3>2. Ficha Técnica — Adicionar Ingrediente</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto auto', gap: '0.5rem', alignItems: 'end' }}>
          <label>
            Ingrediente
            <select
              value={newLine.ingredientId}
              onChange={(e) => setNewLine((p) => ({ ...p, ingredientId: e.target.value }))}
              style={inputStyle}
            >
              <option value="">Selecione...</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit}) — R$ {Number(i.price).toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qtd
            <input
              type="number"
              step="0.0001"
              min="0"
              value={newLine.quantity || ''}
              onChange={(e) => setNewLine((p) => ({ ...p, quantity: Number(e.target.value) }))}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: '0.75rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={newLine.isMainProtein ?? false}
              onChange={(e) => setNewLine((p) => ({ ...p, isMainProtein: e.target.checked }))}
            />{' '}
            Proteina<br />Principal
          </label>
          <label style={{ fontSize: '0.75rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={newLine.isPackaging ?? false}
              onChange={(e) => setNewLine((p) => ({ ...p, isPackaging: e.target.checked }))}
            />{' '}
            Embalagem
          </label>
          <button onClick={addLine} style={btnStyle('add')}>
            + Adicionar
          </button>
        </div>
      </section>

      {/* ── TABELA DA FICHA TÉCNICA ──────────────────────────────── */}
      {sheet.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3>3. Ficha Técnica</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#222', color: '#ccc' }}>
                <th style={th}>Ingrediente</th>
                <th style={th}>Unidade</th>
                <th style={th}>Qtd Receita</th>
                <th style={th}>Perda %</th>
                <th style={th}>Qtd Efetiva</th>
                <th style={th}>Custo/Un</th>
                <th style={th}>Custo Linha</th>
                <th style={th}>Flags</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sheet.map((line) => {
                const ing = getIngredient(line.ingredientId);
                const cmvLine = cmv?.lines.find((l) => l.ingredientId === line.ingredientId);
                if (!ing) return null;
                return (
                  <tr key={line.ingredientId} style={{ borderBottom: '1px solid #333' }}>
                    <td style={td}>{ing.name}</td>
                    <td style={td}>{ing.unit}</td>
                    <td style={td}>
                      <input
                        type="number"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(e) => updateLineQty(line.ingredientId, Number(e.target.value))}
                        style={{ width: '70px', background: '#111', color: '#eee', border: '1px solid #444', padding: '2px 4px' }}
                      />
                    </td>
                    <td style={{ ...td, color: '#f59e0b' }}>
                      {Number(ing.breakageFactor).toFixed(1)}%
                    </td>
                    <td style={td}>
                      {cmvLine ? cmvLine.effectiveQuantity.toFixed(4) : '—'}
                    </td>
                    <td style={td}>R$ {Number(ing.price).toFixed(4)}</td>
                    <td style={{ ...td, fontWeight: 'bold', color: '#60a5fa' }}>
                      {cmvLine ? `R$ ${cmvLine.lineCost.toFixed(4)}` : '—'}
                    </td>
                    <td style={td}>
                      {line.isMainProtein && (
                        <span style={{ color: '#a78bfa', fontSize: '0.7rem' }}>PROTEINA </span>
                      )}
                      {line.isPackaging && (
                        <span style={{ color: '#34d399', fontSize: '0.7rem' }}>EMBAL</span>
                      )}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => removeLine(line.ingredientId)}
                        style={btnStyle('remove')}
                      >
                        X
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── PAINEL CMV ───────────────────────────────────────────── */}
      {cmv && (
        <section
          style={{
            background: '#111',
            border: '1px solid #333',
            padding: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <h3 style={{ marginTop: 0 }}>4. Resultado CMV (Tempo Real)</h3>
          <table style={{ fontSize: '0.9rem', width: '100%' }}>
            <tbody>
              <tr>
                <td style={tdLabel}>Custo Insumos:</td>
                <td>R$ {cmv.ingredientCost.toFixed(4)}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Custo Embalagem:</td>
                <td>R$ {cmv.packagingCost.toFixed(4)}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Mão de Obra:</td>
                <td>R$ {cmv.laborCost.toFixed(4)}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #444', fontWeight: 'bold' }}>
                <td style={tdLabel}>CMV Total:</td>
                <td style={{ color: '#60a5fa' }}>R$ {cmv.totalCostPrice.toFixed(4)}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Margem Bruta:</td>
                <td style={{ color: marginColor(cmv.margin), fontWeight: 'bold' }}>
                  {cmv.margin.toFixed(2)}%
                  {cmv.margin < 40 && ' ⚠ MARGEM BAIXA'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ── AÇÕES ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={loading}
          style={btnStyle('save')}
        >
          {loading ? 'Salvando...' : 'Salvar Produto'}
        </button>
        <button
          onClick={() => { setForm(EMPTY_FORM); setSheet([]); setCmv(null); }}
          style={btnStyle('clear')}
        >
          Limpar
        </button>
        {saveMsg && (
          <span style={{ color: saveMsg.startsWith('Erro') ? '#ef4444' : '#22c55e' }}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Estilos Utilitários ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: '#111',
  color: '#eee',
  border: '1px solid #444',
  padding: '4px 8px',
  marginTop: '2px',
  fontFamily: 'monospace',
};

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #444' };
const td: React.CSSProperties = { padding: '4px 8px', color: '#ccc' };
const tdLabel: React.CSSProperties = { padding: '4px 8px', color: '#888', width: '180px' };

function btnStyle(variant: 'add' | 'remove' | 'save' | 'clear'): React.CSSProperties {
  const base: React.CSSProperties = {
    cursor: 'pointer',
    padding: '6px 14px',
    fontFamily: 'monospace',
    border: 'none',
    fontWeight: 'bold',
  };
  const variants = {
    add: { background: '#1d4ed8', color: '#fff' },
    remove: { background: '#7f1d1d', color: '#fca5a5', padding: '2px 8px' },
    save: { background: '#166534', color: '#bbf7d0', padding: '8px 20px', fontSize: '1rem' },
    clear: { background: '#374151', color: '#ccc' },
  };
  return { ...base, ...variants[variant] };
}
