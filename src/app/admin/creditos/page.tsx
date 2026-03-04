'use client'

import { useState, useEffect } from 'react'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit as firestoreLimit,
} from 'firebase/firestore'
import type { CreditBalance, CreditTransaction } from '@/types/credits'
import { toast } from 'sonner'
import PermissionGate from '@/components/PermissionGate'
import PlanGate from '@/components/PlanGate'

const TYPE_LABELS: Record<CreditTransaction['type'], string> = {
  purchase: 'Compra',
  consumption: 'Consumo',
  adjustment: 'Ajuste',
  bonus: 'Bonus',
}

const TYPE_BADGE_CLASSES: Record<CreditTransaction['type'], string> = {
  purchase: 'bg-green-100 text-green-800',
  consumption: 'bg-red-100 text-red-800',
  adjustment: 'bg-yellow-100 text-yellow-800',
  bonus: 'bg-blue-100 text-blue-800',
}

const CREDIT_TYPE_LABELS: Record<string, string> = {
  minutes: 'Minutos',
  actions: 'Ações',
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

type CreditFilter = 'all' | 'minutes' | 'actions'

export default function CreditsPage() {
  const { orgId } = useCrmUser()

  const [balance, setBalance] = useState<CreditBalance | null>(null)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [loadingTransactions, setLoadingTransactions] = useState(true)
  const [filter, setFilter] = useState<CreditFilter>('all')

  // Real-time balance listener
  useEffect(() => {
    if (!orgId) return

    const balanceRef = doc(db, 'organizations', orgId, 'credits', 'balance')
    const unsubscribe = onSnapshot(
      balanceRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setBalance(snapshot.data() as CreditBalance)
        } else {
          setBalance({ balance: 0, totalPurchased: 0, totalConsumed: 0, actionBalance: 0, actionTotalPurchased: 0, actionTotalConsumed: 0 })
        }
        setLoadingBalance(false)
      },
      (error) => {
        console.error('Error listening to credit balance:', error)
        toast.error('Erro ao carregar saldo de creditos.')
        setLoadingBalance(false)
      }
    )

    return () => unsubscribe()
  }, [orgId])

  // Real-time transactions listener
  useEffect(() => {
    if (!orgId) return

    const transactionsRef = collection(
      db,
      'organizations',
      orgId,
      'creditTransactions'
    )
    const q = query(
      transactionsRef,
      orderBy('createdAt', 'desc'),
      firestoreLimit(50)
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: CreditTransaction[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CreditTransaction, 'id'>),
        }))
        setTransactions(items)
        setLoadingTransactions(false)
      },
      (error) => {
        console.error('Error listening to credit transactions:', error)
        toast.error('Erro ao carregar historico de transacoes.')
        setLoadingTransactions(false)
      }
    )

    return () => unsubscribe()
  }, [orgId])

  const filteredTransactions = filter === 'all'
    ? transactions
    : transactions.filter(tx => tx.creditType === filter)

  return (
    <PlanGate feature="voice_agent">
      <PermissionGate action="canManageSettings">
        <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-primary-50">
          <div className="flex w-full flex-col gap-8 py-10">
            {/* Header */}
            <section className="relative overflow-hidden rounded-3xl bg-white/80 p-6 shadow-sm ring-1 ring-primary-100/60 sm:p-8">
              <div className="absolute -right-20 top-1/2 hidden h-60 w-60 -translate-y-1/2 rounded-full bg-gradient-to-br from-primary-100 via-primary-200/70 to-primary-50 blur-3xl md:block" />
              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full bg-primary-100/70 px-3 py-1 text-xs font-medium text-primary-700">
                  Gestao de Creditos
                </span>
                <h1 className="mt-4 text-2xl font-semibold text-slate-900 sm:text-3xl">
                  Creditos
                </h1>
                <p className="mt-2 max-w-xl text-sm text-slate-600 sm:text-base">
                  Acompanhe o saldo de creditos de acoes e minutos de ligacao da sua
                  organizacao.
                </p>
              </div>
            </section>

            {/* Balance Cards — Actions */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Acoes (Ligacoes + WhatsApp)</h2>
              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary-500">
                    Saldo de acoes
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-primary-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-primary-700">
                        {balance?.actionBalance?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        acoes disponiveis
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-red-500">
                    Acoes consumidas
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-red-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-red-600">
                        {balance?.actionTotalConsumed?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        acoes usadas
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-green-500">
                    Acoes adquiridas
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-green-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-green-600">
                        {balance?.actionTotalPurchased?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        acoes compradas
                      </p>
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* Balance Cards — Minutes */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Minutos de Ligacao</h2>
              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary-500">
                    Saldo de minutos
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-primary-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-primary-700">
                        {balance?.balance?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        minutos disponiveis
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-red-500">
                    Minutos consumidos
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-red-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-red-600">
                        {balance?.totalConsumed?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        minutos usados
                      </p>
                    </>
                  )}
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-primary-100/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-green-500">
                    Minutos adquiridos
                  </p>
                  {loadingBalance ? (
                    <div className="mt-3 h-10 w-24 animate-pulse rounded-lg bg-green-50" />
                  ) : (
                    <>
                      <p className="mt-2 text-4xl font-bold text-green-600">
                        {balance?.totalPurchased?.toLocaleString('pt-BR') ?? 0}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        minutos comprados
                      </p>
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* Transaction History */}
            <section className="rounded-3xl bg-white/90 shadow-sm ring-1 ring-primary-100/70">
              <div className="flex items-center justify-between border-b border-primary-50 px-6 py-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Historico de transacoes
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Ultimas 50 transacoes de creditos da organizacao.
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                  {(['all', 'actions', 'minutes'] as CreditFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        filter === f
                          ? 'bg-white text-primary-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {f === 'all' ? 'Todos' : f === 'actions' ? 'Acoes' : 'Minutos'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 pb-6 pt-4">
                {loadingTransactions ? (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-primary-200 bg-primary-50/30 px-6 py-12 text-sm text-primary-500">
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                    Carregando transacoes...
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary-200 bg-primary-50/40 px-6 py-12 text-center">
                    <p className="text-sm font-medium text-slate-600">
                      Nenhuma transacao registrada.
                    </p>
                    <p className="text-xs text-slate-400">
                      As transacoes aparecerao aqui conforme creditos forem
                      adicionados ou consumidos.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-primary-100 shadow-sm">
                    <table className="min-w-full divide-y divide-primary-100 text-left text-sm text-slate-600">
                      <thead className="bg-primary-50/80 text-xs font-semibold uppercase tracking-wider text-primary-600">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-3">Data</th>
                          <th className="whitespace-nowrap px-4 py-3">Tipo</th>
                          <th className="whitespace-nowrap px-4 py-3">Credito</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">
                            Quantidade
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">
                            Saldo apos
                          </th>
                          <th className="whitespace-nowrap px-4 py-3">
                            Descricao
                          </th>
                          <th className="whitespace-nowrap px-4 py-3">
                            Responsavel
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-primary-50">
                        {filteredTransactions.map((tx) => (
                          <tr
                            key={tx.id}
                            className="transition-colors hover:bg-primary-50/60"
                          >
                            <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                              {formatDate(tx.createdAt)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE_CLASSES[tx.type]}`}
                              >
                                {TYPE_LABELS[tx.type]}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                tx.creditType === 'actions'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-sky-100 text-sky-800'
                              }`}>
                                {CREDIT_TYPE_LABELS[tx.creditType] || tx.creditType}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                              <span
                                className={
                                  tx.amount >= 0
                                    ? 'text-green-600'
                                    : 'text-red-600'
                                }
                              >
                                {tx.amount >= 0 ? '+' : ''}
                                {tx.amount.toLocaleString('pt-BR')}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-700">
                              {tx.balance.toLocaleString('pt-BR')}
                            </td>
                            <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                              {tx.description || '-'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                              {tx.adminEmail || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </PermissionGate>
    </PlanGate>
  )
}
