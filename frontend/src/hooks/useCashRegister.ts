/**
 * Estado do turno de caixa, compartilhado entre o PDV e a tela de Caixa.
 *
 * Por que um hook e nao estado local: duas telas diferentes precisam da mesma
 * verdade ("o caixa esta aberto?"). O PDV usa para liberar ou bloquear a venda;
 * a tela de Caixa usa para montar o painel do turno. Se cada uma buscasse por
 * conta propria, o PDV continuaria vendendo depois de o gerente fechar o caixa
 * em outra aba — e a venda cairia num turno que nao existe mais.
 *
 * Por isso ele tambem escuta os eventos de tempo real: `cash:opened`,
 * `cash:entry` e `cash:closed` revalidam o dado na hora, sem F5.
 */

import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

import { apiPost, swrFetcher } from '../lib/api'
import { useRealtime } from './useRealtime'

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Formas de pagamento aceitas no caixa. */
export type CashMethod = 'cash' | 'credit' | 'debit' | 'pix' | 'voucher' | 'fiado'

/** Natureza de um lancamento no turno. */
export type CashEntryType = 'sale' | 'supply' | 'withdrawal' | 'expense' | 'refund'

export interface CashRegisterRow {
  id: string
  openedAt: string
  closedAt: string | null
  openingBalance: string
  closingBalance: string | null
  expectedBalance: string | null
  difference: string | null
  status: 'open' | 'closed'
  notes: string | null
  openedBy?: { id: string; firstName: string; lastName: string } | null
  closedBy?: { id: string; firstName: string; lastName: string } | null
}

/**
 * Resumo calculado pelo servidor.
 *
 * `expectedCash` e o unico numero que vale para conferir a gaveta: soma abertura
 * + vendas em dinheiro + suprimentos, e subtrai sangrias, despesas, estornos e
 * troco. Cartao e Pix entram em `byMethod`/`totalSales` mas NAO na gaveta.
 */
export interface CashSummary {
  registerId: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  openingBalance: number
  totalSales: number
  salesCount: number
  byMethod: Record<string, { amount: number; count: number }>
  supplies: number
  withdrawals: number
  expenses: number
  refunds: number
  changeGiven: number
  expectedCash: number
  countedCash: number | null
  difference: number | null
}

interface CurrentPayload {
  register: CashRegisterRow | null
  summary: CashSummary | null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCashRegister() {
  const { data, error, isLoading, mutate } = useSWR<CurrentPayload>(
    '/api/cash/current',
    swrFetcher,
    {
      // O turno muda pouco, mas quando muda importa muito. Revalidar ao focar a
      // janela cobre o caso do operador que volta para a aba do PDV depois de
      // fechar o caixa em outra.
      revalidateOnFocus: true,
    },
  )

  // Eventos do servidor: qualquer mexida no caixa refaz a consulta.
  const handlers = useMemo(
    () => ({
      'cash:opened': () => void mutate(),
      'cash:entry': () => void mutate(),
      'cash:closed': () => void mutate(),
    }),
    [mutate],
  )
  useRealtime({ handlers })

  const register = data?.register ?? null
  const summary = data?.summary ?? null

  /** Abre o turno com o troco inicial informado. */
  const open = useCallback(
    async (openingBalance: number, notes?: string) => {
      const result = await apiPost<CashRegisterRow>('/api/cash/open', { openingBalance, notes })
      await mutate()
      return result
    },
    [mutate],
  )

  /** Lanca suprimento, sangria, despesa ou estorno no turno aberto. */
  const addEntry = useCallback(
    async (input: {
      type: CashEntryType
      amount: number
      description: string
      paymentMethod?: CashMethod
    }) => {
      const result = await apiPost<{ summary: CashSummary }>('/api/cash/entries', input)
      await mutate()
      return result
    },
    [mutate],
  )

  /** Fecha o turno com o valor contado na gaveta. */
  const close = useCallback(
    async (registerId: string, countedCash: number, notes?: string) => {
      const result = await apiPost<{ register: CashRegisterRow; summary: CashSummary }>(
        `/api/cash/${registerId}/close`,
        { countedCash, notes },
      )
      await mutate()
      return result
    },
    [mutate],
  )

  return {
    register,
    summary,
    /** `true` quando existe turno aberto — o PDV so vende neste caso. */
    isOpen: register?.status === 'open',
    isLoading,
    error,
    reload: mutate,
    open,
    addEntry,
    close,
  }
}
