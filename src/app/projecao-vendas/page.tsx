'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  orderBy,
  deleteField,
} from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  ChartBarIcon,
  CurrencyDollarIcon,
  ArrowTrendingUpIcon,
  UsersIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'

type Cliente = {
  id: string
  name: string
  phone: string
  funnelId?: string
  funnelStage?: string
  funnelStageUpdatedAt?: string
  lastFollowUpAt?: string
  dealValue?: number
  closingProbability?: number
}

type FunnelStage = {
  id: string
  name: string
  order: number
  funnelId: string
  probability?: number
}

type Funnel = {
  id: string
  name: string
  color?: string
}

type SortField = 'name' | 'stage' | 'probability' | 'dealValue' | 'expectedValue' | 'daysInStage' | 'lastContact'
type SortDir = 'asc' | 'desc'

function getClientProbability(client: { closingProbability?: number }, stage?: { probability?: number }): number {
  if (client.closingProbability != null) return client.closingProbability
  return stage?.probability ?? 0
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatCurrencyShort(value: number): string {
  if (!value) return 'R$ 0'
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`
  return `R$ ${Math.round(value)}`
}

export default function ProjecaoVendasPage() {
  const { orgId } = useCrmUser()

  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [clients, setClients] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('expectedValue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Load funnels
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(
      collection(db, 'organizations', orgId, 'funnels'),
      (snap) => {
        setFunnels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Funnel)))
      },
      (err) => console.error('Funnels listener error:', err)
    )
    return () => unsub()
  }, [orgId])

  // Load stages
  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'funnelStages'), where('orgId', '==', orgId), orderBy('order'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setStages(snap.docs.map(d => ({ id: d.id, ...d.data() } as FunnelStage)))
      },
      (err) => console.error('Stages listener error:', err)
    )
    return () => unsub()
  }, [orgId])

  // Load clients
  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'clients'), where('orgId', '==', orgId))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cliente)))
        setLoading(false)
      },
      (err) => {
        console.error('Clients listener error:', err)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [orgId])

  // Filter clients: dealValue > 0 OR probability > 0
  const eligibleClients = useMemo(() => {
    return clients.filter(c => {
      const stage = stages.find(s => s.id === c.funnelStage)
      const prob = getClientProbability(c, stage)
      return (c.dealValue && c.dealValue > 0) || prob > 0
    })
  }, [clients, stages])

  // Group by funnel
  const clientsByFunnel = useMemo(() => {
    const grouped: Record<string, Cliente[]> = {}
    eligibleClients.forEach(c => {
      const fid = c.funnelId || 'none'
      if (!grouped[fid]) grouped[fid] = []
      grouped[fid].push(c)
    })
    return grouped
  }, [eligibleClients])

  // Sort function
  const sortClients = (arr: Cliente[]) => {
    return [...arr].sort((a, b) => {
      const stageA = stages.find(s => s.id === a.funnelStage)
      const stageB = stages.find(s => s.id === b.funnelStage)
      const probA = getClientProbability(a, stageA)
      const probB = getClientProbability(b, stageB)
      const expectedA = (a.dealValue || 0) * probA / 100
      const expectedB = (b.dealValue || 0) * probB / 100

      let valA: number | string = 0
      let valB: number | string = 0

      switch (sortField) {
        case 'name':
          valA = a.name.toLowerCase()
          valB = b.name.toLowerCase()
          break
        case 'stage':
          valA = stageA?.name?.toLowerCase() || ''
          valB = stageB?.name?.toLowerCase() || ''
          break
        case 'probability':
          valA = probA
          valB = probB
          break
        case 'dealValue':
          valA = a.dealValue || 0
          valB = b.dealValue || 0
          break
        case 'expectedValue':
          valA = expectedA
          valB = expectedB
          break
        case 'daysInStage':
          valA = a.funnelStageUpdatedAt ? Math.floor((Date.now() - new Date(a.funnelStageUpdatedAt).getTime()) / 86400000) : 9999
          valB = b.funnelStageUpdatedAt ? Math.floor((Date.now() - new Date(b.funnelStageUpdatedAt).getTime()) / 86400000) : 9999
          break
        case 'lastContact':
          valA = a.lastFollowUpAt ? new Date(a.lastFollowUpAt).getTime() : 0
          valB = b.lastFollowUpAt ? new Date(b.lastFollowUpAt).getTime() : 0
          break
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  // Global totals
  const globalTotals = useMemo(() => {
    let totalDeal = 0
    let totalExpected = 0
    eligibleClients.forEach(c => {
      const stage = stages.find(s => s.id === c.funnelStage)
      const prob = getClientProbability(c, stage)
      totalDeal += c.dealValue || 0
      totalExpected += ((c.dealValue || 0) * prob) / 100
    })
    return { totalContacts: eligibleClients.length, totalDeal, totalExpected }
  }, [eligibleClients, stages])

  // Inline edit handlers
  const handleInlineDealValue = async (clientId: string, value: string) => {
    const num = value ? parseFloat(value) : null
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        dealValue: num !== null ? num : deleteField(),
        updatedAt: new Date().toISOString(),
      })
      toast.success('Valor atualizado')
    } catch {
      toast.error('Erro ao atualizar valor')
    }
  }

  const handleInlineProbability = async (clientId: string, value: string) => {
    const num = value ? parseInt(value) : null
    if (num !== null && (num < 0 || num > 100)) {
      toast.error('Probabilidade deve ser entre 0 e 100')
      return
    }
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        closingProbability: num !== null ? num : deleteField(),
        updatedAt: new Date().toISOString(),
      })
      toast.success('Probabilidade atualizada')
    } catch {
      toast.error('Erro ao atualizar probabilidade')
    }
  }

  const handleInlineStageChange = async (clientId: string, stageId: string, funnelId: string) => {
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        funnelStage: stageId,
        funnelId: funnelId,
        funnelStageUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closingProbability: deleteField(),
      })
      toast.success('Etapa atualizada')
    } catch {
      toast.error('Erro ao atualizar etapa')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-1" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-1" />
    )
  }

  if (loading) {
    return <div className="p-8 text-center text-neutral-400">Carregando projeção de vendas...</div>
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Projeção de Vendas</h1>
        <p className="text-sm text-neutral-500 mt-1">Visualize e gerencie a expectativa de receita por contato</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6 md:mb-8">
        <div className="bg-white rounded-xl border border-neutral-200 p-3 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
            <div className="hidden md:block p-2 bg-blue-50 rounded-lg">
              <UsersIcon className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-neutral-500 leading-tight">Contatos</p>
              <p className="text-lg md:text-xl font-bold text-neutral-900">{globalTotals.totalContacts}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-neutral-200 p-3 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
            <div className="hidden md:block p-2 bg-emerald-50 rounded-lg">
              <CurrencyDollarIcon className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-neutral-500 leading-tight">Negócios</p>
              <p className="text-sm font-bold text-neutral-900 md:hidden">{formatCurrencyShort(globalTotals.totalDeal)}</p>
              <p className="hidden md:block text-xl font-bold text-neutral-900">{formatCurrency(globalTotals.totalDeal)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-neutral-200 p-3 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
            <div className="hidden md:block p-2 bg-amber-50 rounded-lg">
              <ArrowTrendingUpIcon className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-neutral-500 leading-tight">Esperado</p>
              <p className="text-sm font-bold text-neutral-900 md:hidden">{formatCurrencyShort(globalTotals.totalExpected)}</p>
              <p className="hidden md:block text-xl font-bold text-neutral-900">{formatCurrency(globalTotals.totalExpected)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {eligibleClients.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-neutral-200 rounded-2xl">
          <ChartBarIcon className="w-12 h-12 mx-auto text-neutral-300 mb-4" />
          <h3 className="text-lg font-semibold text-neutral-700 mb-2">Nenhum contato com projeção</h3>
          <p className="text-sm text-neutral-500 max-w-md mx-auto">
            Adicione valor de negócio ou probabilidade aos seus contatos para visualizar a projeção de vendas.
          </p>
        </div>
      )}

      {/* Tables per funnel */}
      {funnels.filter(f => clientsByFunnel[f.id]?.length > 0).map(funnel => {
        const funnelClients = sortClients(clientsByFunnel[funnel.id] || [])
        const funnelStages = stages.filter(s => s.funnelId === funnel.id)
        const totalDeal = funnelClients.reduce((sum, c) => sum + (c.dealValue || 0), 0)
        const totalExpected = funnelClients.reduce((sum, c) => {
          const stage = stages.find(s => s.id === c.funnelStage)
          return sum + ((c.dealValue || 0) * getClientProbability(c, stage) / 100)
        }, 0)

        return (
          <div key={funnel.id} className="mb-8">
            {/* Funnel Header */}
            <div className="flex items-center gap-2 md:gap-3 mb-3">
              <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: funnel.color || '#6366f1' }} />
              <h2 className="text-base md:text-lg font-semibold text-neutral-900 truncate">{funnel.name}</h2>
              <span className="text-[10px] md:text-xs bg-neutral-100 text-neutral-600 px-1.5 md:px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                {funnelClients.length} contato{funnelClients.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {/* Mobile sort selector */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-neutral-500">Ordenar:</span>
                <select
                  value={sortField}
                  onChange={(e) => {
                    setSortField(e.target.value as SortField)
                    setSortDir('desc')
                  }}
                  className="text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="expectedValue">Valor Esperado</option>
                  <option value="dealValue">Valor Negócio</option>
                  <option value="probability">Probabilidade</option>
                  <option value="name">Nome</option>
                  <option value="daysInStage">Dias na Etapa</option>
                  <option value="lastContact">Último Contato</option>
                </select>
                <button
                  onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="p-1 rounded border border-neutral-200 bg-neutral-50"
                >
                  {sortDir === 'asc' ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                </button>
              </div>

              {funnelClients.map(client => {
                const stage = stages.find(s => s.id === client.funnelStage)
                const prob = getClientProbability(client, stage)
                const expected = (client.dealValue || 0) * prob / 100
                const daysInStage = client.funnelStageUpdatedAt
                  ? Math.floor((Date.now() - new Date(client.funnelStageUpdatedAt).getTime()) / 86400000)
                  : null
                const lastContact = client.lastFollowUpAt
                  ? new Date(client.lastFollowUpAt).toLocaleDateString('pt-BR')
                  : 'Sem contato'

                return (
                  <div key={client.id} className="bg-white rounded-xl border border-neutral-200 p-4">
                    {/* Card header: name + expected value */}
                    <div className="flex items-start justify-between mb-3">
                      <Link href={`/contatos/${client.id}`} className="text-primary-600 hover:underline font-semibold text-sm leading-tight flex-1 mr-2">
                        {client.name}
                      </Link>
                      <span className="text-sm font-bold text-emerald-700 whitespace-nowrap">
                        {formatCurrencyShort(expected)}
                      </span>
                    </div>

                    {/* Stage select */}
                    <div className="mb-3">
                      <select
                        defaultValue={client.funnelStage || ''}
                        key={`stage-m-${client.id}`}
                        onChange={(e) => handleInlineStageChange(client.id, e.target.value, funnel.id)}
                        className="w-full px-2 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                      >
                        {funnelStages.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Inline fields row */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <label className="text-[10px] text-neutral-400 uppercase tracking-wider">Valor (R$)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={client.dealValue ?? ''}
                          key={`deal-m-${client.id}`}
                          onBlur={(e) => handleInlineDealValue(client.id, e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-400 uppercase tracking-wider">Prob. (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          defaultValue={client.closingProbability ?? stage?.probability ?? 0}
                          key={`prob-m-${client.id}`}
                          onBlur={(e) => handleInlineProbability(client.id, e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center justify-between text-[11px] text-neutral-400 border-t border-neutral-100 pt-2">
                      <span>{daysInStage !== null ? `${daysInStage}d na etapa` : 'Sem dados'}</span>
                      <span>{lastContact}</span>
                    </div>
                  </div>
                )
              })}

              {/* Mobile totals */}
              <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-700">Total</span>
                <div className="text-right">
                  <p className="text-xs text-neutral-500">Negócios: <span className="font-semibold text-neutral-700">{formatCurrencyShort(totalDeal)}</span></p>
                  <p className="text-xs text-neutral-500">Esperado: <span className="font-bold text-emerald-700">{formatCurrencyShort(totalExpected)}</span></p>
                </div>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block bg-white rounded-xl border border-neutral-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/50">
                    <th className="text-left px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('name')}>
                      Nome <SortIcon field="name" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('stage')}>
                      Etapa <SortIcon field="stage" />
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('probability')}>
                      Prob. (%) <SortIcon field="probability" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('dealValue')}>
                      Valor (R$) <SortIcon field="dealValue" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('expectedValue')}>
                      Esperado (R$) <SortIcon field="expectedValue" />
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('daysInStage')}>
                      Dias na Etapa <SortIcon field="daysInStage" />
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900" onClick={() => handleSort('lastContact')}>
                      Último Contato <SortIcon field="lastContact" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {funnelClients.map(client => {
                    const stage = stages.find(s => s.id === client.funnelStage)
                    const prob = getClientProbability(client, stage)
                    const expected = (client.dealValue || 0) * prob / 100
                    const daysInStage = client.funnelStageUpdatedAt
                      ? Math.floor((Date.now() - new Date(client.funnelStageUpdatedAt).getTime()) / 86400000)
                      : null
                    const lastContact = client.lastFollowUpAt
                      ? new Date(client.lastFollowUpAt).toLocaleDateString('pt-BR')
                      : 'Sem contato'

                    return (
                      <tr key={client.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                        <td className="px-4 py-3">
                          <Link href={`/contatos/${client.id}`} className="text-primary-600 hover:underline font-medium">
                            {client.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            defaultValue={client.funnelStage || ''}
                            key={`stage-${client.id}`}
                            onChange={(e) => handleInlineStageChange(client.id, e.target.value, funnel.id)}
                            className="px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            {funnelStages.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            defaultValue={client.closingProbability ?? stage?.probability ?? 0}
                            key={`prob-${client.id}`}
                            onBlur={(e) => handleInlineProbability(client.id, e.target.value)}
                            className="w-16 px-2 py-1 text-xs text-center bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={client.dealValue ?? ''}
                            key={`deal-${client.id}`}
                            onBlur={(e) => handleInlineDealValue(client.id, e.target.value)}
                            className="w-28 px-2 py-1 text-xs text-right bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700">
                          {formatCurrency(expected)}
                        </td>
                        <td className="px-4 py-3 text-center text-neutral-500">
                          {daysInStage !== null ? `${daysInStage}d` : '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-neutral-500">
                          {lastContact}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Footer totals */}
                <tfoot>
                  <tr className="bg-neutral-50 font-semibold">
                    <td className="px-4 py-3 text-neutral-700" colSpan={3}>Total</td>
                    <td className="px-4 py-3 text-right text-neutral-700">{formatCurrency(totalDeal)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(totalExpected)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
