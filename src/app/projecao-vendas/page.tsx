'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  orderBy,
  deleteField,
  getDocs,
} from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useFreePlanGuard } from '@/hooks/useFreePlanGuard'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  ChartBarIcon,
  CurrencyDollarIcon,
  ArrowTrendingUpIcon,
  UsersIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
  assignedTo?: string
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
type SortDir = 'asc' | 'desc' | null

const ITEMS_PER_PAGE = 30

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
  const { orgId, member, userEmail } = useCrmUser()
  const { viewScope } = usePermissions()
  const { isBlocked: isPlanBlocked } = useFreePlanGuard()

  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [clients, setClients] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStage, setFilterStage] = useState<string>('all')
  const [filterMinValue, setFilterMinValue] = useState<string>('')
  const [filterMaxValue, setFilterMaxValue] = useState<string>('')
  const [filterMinProb, setFilterMinProb] = useState<string>('')
  const [filterMaxProb, setFilterMaxProb] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  // Allowed member IDs for partner-scoped access
  const [allowedMemberIds, setAllowedMemberIds] = useState<Set<string> | null>(null)

  // Pagination state per funnel
  const [funnelPages, setFunnelPages] = useState<Record<string, number>>({})

  // When orgId is not available, stop loading immediately
  useEffect(() => {
    if (!orgId) {
      setLoading(false)
    }
  }, [orgId])

  // Compute allowed member IDs for partner-scoped access
  useEffect(() => {
    if (!orgId || !member || viewScope !== 'own') {
      setAllowedMemberIds(null) // No filter needed — admin/full access
      return
    }

    const fetchAllowedMembers = async () => {
      try {
        const membersSnap = await getDocs(
          query(collection(db, 'organizations', orgId, 'members'), where('status', '==', 'active'))
        )
        const allowed = new Set<string>()

        // Always include self
        allowed.add(member.id)

        if (member.invitedBy) {
          // Current user is a partner: include only the inviter
          membersSnap.docs.forEach((d) => {
            const data = d.data()
            if (data.email === member.invitedBy) {
              allowed.add(d.id)
            }
          })
        } else if (userEmail) {
          // Current user is org owner: include partners they invited
          membersSnap.docs.forEach((d) => {
            const data = d.data()
            if (data.invitedBy === userEmail.toLowerCase()) {
              allowed.add(d.id)
            }
          })
        }

        setAllowedMemberIds(allowed)
      } catch (error) {
        console.error('Erro ao carregar parceiros:', error)
        // Fallback: only show own data
        setAllowedMemberIds(new Set([member.id]))
      }
    }

    fetchAllowedMembers()
  }, [orgId, member, viewScope, userEmail])

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

  // Load clients (one-time fetch, no real-time needed for projections)
  useEffect(() => {
    if (!orgId) return
    const fetchClients = async () => {
      try {
        const q = query(collection(db, 'clients'), where('orgId', '==', orgId))
        const snap = await getDocs(q)
        setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cliente)))
      } catch (err) {
        console.error('Clients fetch error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchClients()
  }, [orgId])

  // Filter clients: dealValue > 0 OR probability > 0, then apply user filters
  const eligibleClients = useMemo(() => {
    return clients.filter(c => {
      // Apply viewScope filter: non-admin users see only their own + partners' contacts
      if (allowedMemberIds && (!c.assignedTo || !allowedMemberIds.has(c.assignedTo))) return false

      const stage = stages.find(s => s.id === c.funnelStage)
      const prob = getClientProbability(c, stage)
      const isEligible = (c.dealValue && c.dealValue > 0) || prob > 0
      if (!isEligible) return false

      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        if (!c.name.toLowerCase().includes(term)) return false
      }

      // Stage filter
      if (filterStage !== 'all' && c.funnelStage !== filterStage) return false

      // Value range filter
      const minVal = filterMinValue ? parseFloat(filterMinValue) : null
      const maxVal = filterMaxValue ? parseFloat(filterMaxValue) : null
      const dealVal = c.dealValue || 0
      if (minVal !== null && dealVal < minVal) return false
      if (maxVal !== null && dealVal > maxVal) return false

      // Probability range filter
      const minProb = filterMinProb ? parseFloat(filterMinProb) : null
      const maxProb = filterMaxProb ? parseFloat(filterMaxProb) : null
      if (minProb !== null && prob < minProb) return false
      if (maxProb !== null && prob > maxProb) return false

      return true
    })
  }, [clients, stages, searchTerm, filterStage, filterMinValue, filterMaxValue, filterMinProb, filterMaxProb, allowedMemberIds])

  // Reset pagination when filters change
  useEffect(() => {
    setFunnelPages({})
  }, [searchTerm, filterStage, filterMinValue, filterMaxValue, filterMinProb, filterMaxProb, sortField, sortDir])

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
  const sortClients = useCallback((arr: Cliente[]) => {
    if (!sortField || !sortDir) return arr
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
  }, [stages, sortField, sortDir])

  // 3-state sort: null → asc → desc → null
  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortField(null)
      setSortDir(null)
    }
  }

  const hasActiveFilters = searchTerm || filterStage !== 'all' || filterMinValue || filterMaxValue || filterMinProb || filterMaxProb

  const clearFilters = () => {
    setSearchTerm('')
    setFilterStage('all')
    setFilterMinValue('')
    setFilterMaxValue('')
    setFilterMinProb('')
    setFilterMaxProb('')
  }

  // Global totals (based on filtered results)
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
    if (isPlanBlocked) return
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
    if (isPlanBlocked) return
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
    if (isPlanBlocked) return
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

  const SortIcon = ({ field }: { field: SortField }) => (
    <svg
      className={`h-3.5 w-3.5 inline ml-1 transition-colors ${
        sortField === field ? 'text-primary-600' : 'text-gray-300 dark:text-slate-600'
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      {sortField === field && sortDir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      ) : sortField === field && sortDir === 'desc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      ) : (
        <>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 14l4 4 4-4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10l4-4 4 4" />
        </>
      )}
    </svg>
  )

  // Pagination helpers
  const getFunnelPage = (funnelId: string) => funnelPages[funnelId] || 0
  const setFunnelPage = (funnelId: string, page: number) => {
    setFunnelPages(prev => ({ ...prev, [funnelId]: page }))
  }

  if (loading) {
    return <div className="p-8 text-center text-neutral-400">Carregando projeção de vendas...</div>
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Projeção de Vendas</h1>
        <p className="text-sm text-neutral-500 mt-1">Visualize e gerencie a expectativa de receita por contato</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6 md:mb-8">
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-neutral-200 p-3 md:p-5">
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
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-neutral-200 p-3 md:p-5">
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
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-neutral-200 p-3 md:p-5">
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

      {/* Filters Bar */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Buscar por nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-surface-dark border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Stage filter */}
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="px-3 py-2 text-sm bg-white dark:bg-surface-dark border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">Todas as etapas</option>
            {stages.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Toggle advanced filters */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-primary-50 border-primary-200 text-primary-700'
                : 'bg-white dark:bg-surface-dark border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            <FunnelIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Filtros</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-primary-500" />
            )}
          </button>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Limpar</span>
            </button>
          )}
        </div>

        {/* Advanced Filters Panel */}
        {showFilters && (
          <div className="bg-white dark:bg-surface-dark border border-neutral-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Valor mín. (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={filterMinValue}
                onChange={(e) => setFilterMinValue(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Valor máx. (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Sem limite"
                value={filterMaxValue}
                onChange={(e) => setFilterMaxValue(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Prob. mín. (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="0"
                value={filterMinProb}
                onChange={(e) => setFilterMinProb(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Prob. máx. (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="100"
                value={filterMaxProb}
                onChange={(e) => setFilterMaxProb(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {eligibleClients.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-neutral-200 rounded-2xl">
          <ChartBarIcon className="w-12 h-12 mx-auto text-neutral-300 mb-4" />
          <h3 className="text-lg font-semibold text-neutral-700 mb-2">
            {hasActiveFilters ? 'Nenhum contato encontrado' : 'Nenhum contato com projeção'}
          </h3>
          <p className="text-sm text-neutral-500 max-w-md mx-auto">
            {hasActiveFilters
              ? 'Tente ajustar os filtros para ver mais resultados.'
              : 'Adicione valor de negócio ou probabilidade aos seus contatos para visualizar a projeção de vendas.'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-4 px-4 py-2 text-sm text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Tables per funnel */}
      {funnels.filter(f => clientsByFunnel[f.id]?.length > 0).map(funnel => {
        const allFunnelClients = sortClients(clientsByFunnel[funnel.id] || [])
        const funnelStages = stages.filter(s => s.funnelId === funnel.id)
        const totalDeal = allFunnelClients.reduce((sum, c) => sum + (c.dealValue || 0), 0)
        const totalExpected = allFunnelClients.reduce((sum, c) => {
          const stage = stages.find(s => s.id === c.funnelStage)
          return sum + ((c.dealValue || 0) * getClientProbability(c, stage) / 100)
        }, 0)

        // Pagination
        const currentPage = getFunnelPage(funnel.id)
        const totalPages = Math.ceil(allFunnelClients.length / ITEMS_PER_PAGE)
        const needsPagination = allFunnelClients.length > ITEMS_PER_PAGE
        const paginatedClients = needsPagination
          ? allFunnelClients.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE)
          : allFunnelClients

        return (
          <div key={funnel.id} className="mb-8">
            {/* Funnel Header */}
            <div className="flex items-center gap-2 md:gap-3 mb-3">
              <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: funnel.color || '#6366f1' }} />
              <h2 className="text-base md:text-lg font-semibold text-neutral-900 truncate">{funnel.name}</h2>
              <span className="text-[10px] md:text-xs bg-neutral-100 text-neutral-600 px-1.5 md:px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                {allFunnelClients.length} contato{allFunnelClients.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {/* Mobile sort selector */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-neutral-500">Ordenar:</span>
                <select
                  value={sortField || ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) {
                      setSortField(null)
                      setSortDir(null)
                    } else {
                      setSortField(val as SortField)
                      setSortDir('asc')
                    }
                  }}
                  className="text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">Padrão</option>
                  <option value="expectedValue">Valor Esperado</option>
                  <option value="dealValue">Valor Negócio</option>
                  <option value="probability">Probabilidade</option>
                  <option value="name">Nome</option>
                  <option value="daysInStage">Dias na Etapa</option>
                  <option value="lastContact">Último Contato</option>
                </select>
                {sortField && (
                  <button
                    onClick={() => {
                      if (sortDir === 'asc') setSortDir('desc')
                      else if (sortDir === 'desc') { setSortField(null); setSortDir(null) }
                      else setSortDir('asc')
                    }}
                    className="p-1 rounded border border-neutral-200 bg-neutral-50"
                    title={sortDir === 'asc' ? 'Crescente' : sortDir === 'desc' ? 'Decrescente' : 'Sem ordenação'}
                  >
                    {sortDir === 'asc' ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                  </button>
                )}
              </div>

              {paginatedClients.map(client => {
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
                  <div key={client.id} className="bg-white dark:bg-surface-dark rounded-xl border border-neutral-200 p-4">
                    {/* Card header: name + expected value */}
                    <div className="flex items-start justify-between mb-3">
                      <Link href={`/contatos/${client.id}`} className="text-primary-600 hover:underline font-semibold text-sm leading-tight flex-1 mr-2">
                        {client.name}
                      </Link>
                      <span className="text-sm font-medium text-emerald-700 whitespace-nowrap">
                        {formatCurrencyShort(expected)}
                      </span>
                    </div>

                    {/* Stage select */}
                    <div className="mb-3">
                      <select
                        defaultValue={client.funnelStage || ''}
                        key={`stage-m-${client.id}-${client.funnelStage ?? ''}`}
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
                          key={`deal-m-${client.id}-${client.dealValue ?? ''}`}
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
                          key={`prob-m-${client.id}-${client.closingProbability ?? ''}`}
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
                  <p className="text-xs text-neutral-500">Esperado: <span className="font-medium text-emerald-700">{formatCurrencyShort(totalExpected)}</span></p>
                </div>
              </div>

              {/* Mobile Pagination */}
              {needsPagination && (
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={allFunnelClients.length}
                  onPageChange={(page) => setFunnelPage(funnel.id, page)}
                />
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block bg-white dark:bg-surface-dark rounded-xl border border-neutral-200 overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-neutral-100 bg-neutral-50/95 backdrop-blur-sm">
                      <th className="group text-left px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('name')}>
                        Nome <SortIcon field="name" />
                      </th>
                      <th className="group text-left px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('stage')}>
                        Etapa <SortIcon field="stage" />
                      </th>
                      <th className="group text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('probability')}>
                        Prob. (%) <SortIcon field="probability" />
                      </th>
                      <th className="group text-right px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('dealValue')}>
                        Valor (R$) <SortIcon field="dealValue" />
                      </th>
                      <th className="group text-right px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('expectedValue')}>
                        Esperado (R$) <SortIcon field="expectedValue" />
                      </th>
                      <th className="group text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('daysInStage')}>
                        Dias na Etapa <SortIcon field="daysInStage" />
                      </th>
                      <th className="group text-center px-4 py-3 font-medium text-neutral-600 cursor-pointer hover:text-neutral-900 select-none" onClick={() => handleSort('lastContact')}>
                        Último Contato <SortIcon field="lastContact" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedClients.map(client => {
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
                          <td className="px-4 py-3 text-xs text-neutral-600">
                            {stage?.name || '-'}
                          </td>
                          <td className="px-4 py-3 text-center text-xs text-neutral-600">
                            {client.closingProbability ?? stage?.probability ?? 0}%
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-neutral-600">
                            {formatCurrency(client.dealValue ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-emerald-700">
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
                  <tfoot className="sticky bottom-0">
                    <tr className="bg-neutral-50 font-medium">
                      <td className="px-4 py-3 text-neutral-700" colSpan={3}>Total</td>
                      <td className="px-4 py-3 text-right text-neutral-700">{formatCurrency(totalDeal)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(totalExpected)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Desktop Pagination */}
              {needsPagination && (
                <div className="border-t border-neutral-200">
                  <PaginationControls
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={allFunnelClients.length}
                    onPageChange={(page) => setFunnelPage(funnel.id, page)}
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  const startItem = currentPage * ITEMS_PER_PAGE + 1
  const endItem = Math.min((currentPage + 1) * ITEMS_PER_PAGE, totalItems)

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 0; i < totalPages; i++) pages.push(i)
    } else {
      pages.push(0)
      if (currentPage > 2) pages.push('ellipsis')
      const start = Math.max(1, currentPage - 1)
      const end = Math.min(totalPages - 2, currentPage + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - 3) pages.push('ellipsis')
      pages.push(totalPages - 1)
    }
    return pages
  }

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-neutral-500">
        {startItem}-{endItem} de {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 0}
          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {getPageNumbers().map((page, i) =>
          page === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-neutral-400 text-xs">...</span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                page === currentPage
                  ? 'bg-primary-600 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {page + 1}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages - 1}
          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
