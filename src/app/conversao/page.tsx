'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  collection,
  onSnapshot,
  collectionGroup,
  query,
  orderBy,
  where,
  getDocs,
} from 'firebase/firestore'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import {
  FunnelIcon,
  ArrowTrendingUpIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClockIcon,
  UsersIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type FunnelStage = {
  id: string
  name: string
  order: number
  funnelId: string
  color?: string
  probability?: number
  maxDays?: number
  countsForMetrics?: boolean
  macroStageId?: string
  conversionType?: 'positive' | 'negative' | 'neutral' | 'final_conversion'
}

type MovementLog = {
  id: string
  clientId: string
  text: string
  author: string
  createdAt: string
  fromStage?: string
  toStage?: string
}

type PeriodType = 'day' | 'week' | 'month'

type Funnel = { id: string; name: string }

type ClientData = {
  id: string
  assignedToName?: string
  icpProfileId?: string
  industry?: string
  leadSource?: string
  leadType?: string
  porte_empresa?: string
  state?: string
}

type SegmentKey = 'assignedToName' | 'icpProfileId' | 'industry' | 'leadSource' | 'leadType' | 'porte_empresa' | 'state'

const SEGMENT_LABELS: Record<SegmentKey, string> = {
  assignedToName: 'Responsavel',
  icpProfileId: 'ICP',
  industry: 'Industria',
  leadSource: 'Origem',
  leadType: 'Tipo Lead',
  porte_empresa: 'Porte',
  state: 'Estado',
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

const parseMovementLog = (text: string): { from: string; to: string } | null => {
  const p1 = /Card movido de (.+) para (.+)/
  const p2 = /Movido em massa de ['"](.+)['"] para ['"](.+)['"]/
  let m = text.match(p1)
  if (m) return { from: m[1], to: m[2] }
  m = text.match(p2)
  if (m) return { from: m[1], to: m[2] }
  return null
}

const getStageByName = (stages: FunnelStage[], name: string): FunnelStage | undefined => {
  const n = name.trim().toLowerCase()
  return stages.find(s => s.name.trim().toLowerCase() === n)
}

const getPeriodKey = (date: Date, pt: PeriodType): string => {
  switch (pt) {
    case 'day':
      return date.toISOString().split('T')[0]
    case 'week': {
      const ws = new Date(date)
      ws.setDate(date.getDate() - date.getDay())
      return ws.toISOString().split('T')[0]
    }
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    default:
      return date.toISOString().split('T')[0]
  }
}

const getPeriodLabel = (key: string, pt: PeriodType): string => {
  switch (pt) {
    case 'day': {
      const d = new Date(key + 'T12:00:00')
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    }
    case 'week': {
      const ws = new Date(key + 'T12:00:00')
      const we = new Date(ws)
      we.setDate(ws.getDate() + 6)
      return `${ws.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${we.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
    }
    case 'month': {
      const [y, mo] = key.split('-').map(Number)
      const d = new Date(y, mo - 1, 1)
      return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    }
    default:
      return key
  }
}

// ═══════════════════════════════════════════════════════════
// CONVERSION TABLE COMPONENT
// ═══════════════════════════════════════════════════════════

function ConversionTable({
  title,
  stages,
  periodKeys,
  periodType,
  getCellData,
  getTotalData,
}: {
  title?: string
  stages: FunnelStage[]
  periodKeys: string[]
  periodType: PeriodType
  getCellData: (stageId: string, periodKey: string) => { rate: number; positive: number; total: number }
  getTotalData: (stageId: string) => { rate: number; positive: number; total: number }
}) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 overflow-hidden">
      {title && (
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left z-10 min-w-[160px]">Etapa</th>
              {periodKeys.map(pk => (
                <th key={pk} className="px-3 py-3 text-center whitespace-nowrap min-w-[90px]">
                  {getPeriodLabel(pk, periodType)}
                </th>
              ))}
              <th className="px-4 py-3 text-center font-bold bg-slate-100 min-w-[90px]">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {stages.map((stage) => {
              const total = getTotalData(stage.id)
              return (
                <tr key={stage.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="sticky left-0 bg-white px-4 py-3 font-medium text-slate-800 z-10">
                    {stage.name}
                  </td>
                  {periodKeys.map(pk => {
                    const cell = getCellData(stage.id, pk)
                    return (
                      <td key={pk} className="px-3 py-3 text-center">
                        <span className={`text-sm font-semibold ${
                          cell.total === 0
                            ? 'text-slate-300'
                            : cell.rate >= 60
                            ? 'text-emerald-600'
                            : cell.rate >= 30
                            ? 'text-amber-600'
                            : 'text-red-600'
                        }`}>
                          {cell.total === 0 ? '-' : `${cell.rate.toFixed(0)}%`}
                        </span>
                        {cell.total > 0 && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {cell.positive}/{cell.total}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center bg-slate-50/60">
                    <span className={`text-sm font-bold ${
                      total.total === 0
                        ? 'text-slate-300'
                        : total.rate >= 60
                        ? 'text-emerald-600'
                        : total.rate >= 30
                        ? 'text-amber-600'
                        : 'text-red-600'
                    }`}>
                      {total.total === 0 ? '-' : `${total.rate.toFixed(1)}%`}
                    </span>
                    {total.total > 0 && (
                      <span className="block text-[10px] text-slate-400 mt-0.5">
                        {total.positive}/{total.total}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function ConversaoPage() {
  const { orgId } = useCrmUser()
  const pageRef = useRef<HTMLDivElement>(null)

  // ── State ──────────────────────────────────────────────
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([])
  const [movementLogs, setMovementLogs] = useState<MovementLog[]>([])
  const [clientDataMap, setClientDataMap] = useState<Map<string, ClientData>>(new Map())
  const [loading, setLoading] = useState(true)
  const [periodType, setPeriodType] = useState<PeriodType>('week')
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    return { start, end }
  })
  const [periodPreset, setPeriodPreset] = useState<'7d' | '30d' | '90d' | 'custom'>('30d')
  const [selectedFunnelId, setSelectedFunnelId] = useState('all')
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey | ''>('')
  const [icpProfiles, setIcpProfiles] = useState<{ id: string; name: string }[]>([])

  // ── Data Loading ───────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(
      query(collection(db, 'funnelStages'), where('orgId', '==', orgId)),
      (snap) => {
        const stages = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as FunnelStage))
          .sort((a, b) => a.order - b.order)
        setFunnelStages(stages)
      }
    )
    return () => unsub()
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    let logsUnsub: (() => void) | undefined

    getDocs(query(collection(db, 'clients'), where('orgId', '==', orgId))).then(clientsSnap => {
      const orgClientIds = new Set<string>()
      const clientMap = new Map<string, ClientData>()
      clientsSnap.docs.forEach(d => {
        orgClientIds.add(d.id)
        const data = d.data()
        clientMap.set(d.id, {
          id: d.id,
          assignedToName: data.assignedToName || undefined,
          icpProfileId: data.icpProfileId || undefined,
          industry: data.industry || undefined,
          leadSource: data.leadSource || undefined,
          leadType: data.leadType || undefined,
          porte_empresa: data.porte_empresa || undefined,
          state: data.state || undefined,
        })
      })
      setClientDataMap(clientMap)

      const logsQuery = query(collectionGroup(db, 'logs'), orderBy('createdAt', 'desc'))
      logsUnsub = onSnapshot(logsQuery, (snap) => {
        const logs: MovementLog[] = []
        snap.docs.forEach((doc) => {
          const data = doc.data()
          const clientId = doc.ref.parent.parent?.id || ''
          if (!orgClientIds.has(clientId)) return
          if (data.fromStageName && data.toStageName) {
            logs.push({
              id: doc.id, clientId,
              text: data.message || data.text || '',
              author: data.author || 'Sistema',
              createdAt: data.createdAt,
              fromStage: data.fromStageName,
              toStage: data.toStageName,
            })
          } else if (data.text && (data.text.includes('movido de') || data.text.includes('Movido em massa'))) {
            const parsed = parseMovementLog(data.text)
            if (parsed) logs.push({ id: doc.id, clientId, text: data.text, author: data.author || 'Sistema', createdAt: data.createdAt, fromStage: parsed.from, toStage: parsed.to })
          } else if (data.message && (data.message.includes('movido de') || data.message.includes('Movido em massa'))) {
            const parsed = parseMovementLog(data.message)
            if (parsed) logs.push({ id: doc.id, clientId, text: data.message, author: data.author || 'Sistema', createdAt: data.createdAt, fromStage: parsed.from, toStage: parsed.to })
          }
        })
        setMovementLogs(logs)
        setLoading(false)
      })
    })

    return () => { if (logsUnsub) logsUnsub() }
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(collection(db, `organizations/${orgId}/funnels`), (snap) => {
      setFunnels(snap.docs.map(doc => ({ id: doc.id, name: (doc.data().name || 'Funil sem nome') as string })))
    })
    return () => unsub()
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'icpProfiles'), where('orgId', '==', orgId), where('isActive', '==', true))
    const unsub = onSnapshot(q, (snap) => {
      setIcpProfiles(snap.docs.map(d => ({ id: d.id, name: (d.data().name || '') as string })))
    })
    return () => unsub()
  }, [orgId])

  // ── Filtered stages by funnel ──────────────────────────
  const activeFunnelStages = useMemo(() => {
    const all = selectedFunnelId === 'all' ? funnelStages : funnelStages.filter(s => s.funnelId === selectedFunnelId)
    return all.filter(s => s.conversionType !== 'negative')
  }, [funnelStages, selectedFunnelId])

  // ── Filtered logs by date ──────────────────────────────
  const filteredLogs = useMemo(() => {
    return movementLogs.filter(log => {
      const d = new Date(log.createdAt)
      return d >= dateRange.start && d <= dateRange.end
    })
  }, [movementLogs, dateRange])

  // ── Period keys (sorted) ───────────────────────────────
  const periodKeys = useMemo(() => {
    const keys = new Set<string>()
    filteredLogs.forEach(log => {
      keys.add(getPeriodKey(new Date(log.createdAt), periodType))
    })
    return Array.from(keys).sort()
  }, [filteredLogs, periodType])

  // ── Build per-period per-stage metrics ─────────────────
  type StageMetric = { entered: number; exitedTotal: number; exitedPositive: number; exitedNegative: number; finalConversions: number }

  const periodStageMetrics = useMemo(() => {
    const result = new Map<string, Map<string, StageMetric>>()

    filteredLogs.forEach(log => {
      const pk = getPeriodKey(new Date(log.createdAt), periodType)
      if (!result.has(pk)) result.set(pk, new Map())
      const periodMap = result.get(pk)!

      const fromStage = getStageByName(funnelStages, log.fromStage || '')
      const toStage = getStageByName(funnelStages, log.toStage || '')

      if (fromStage) {
        if (!periodMap.has(fromStage.id)) periodMap.set(fromStage.id, { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, finalConversions: 0 })
        const m = periodMap.get(fromStage.id)!
        m.exitedTotal++
        if (toStage) {
          if (toStage.conversionType === 'positive' || toStage.conversionType === 'final_conversion') m.exitedPositive++
          else m.exitedNegative++
          if (toStage.conversionType === 'final_conversion') m.finalConversions++
        } else {
          m.exitedNegative++
        }
      }
      if (toStage) {
        if (!periodMap.has(toStage.id)) periodMap.set(toStage.id, { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, finalConversions: 0 })
        periodMap.get(toStage.id)!.entered++
      }
    })

    return result
  }, [filteredLogs, funnelStages, periodType])

  // ── Cell data getters ──────────────────────────────────
  const getCellData = useCallback((stageId: string, periodKey: string) => {
    const m = periodStageMetrics.get(periodKey)?.get(stageId)
    if (!m || m.exitedTotal === 0) return { rate: 0, positive: 0, total: 0 }
    return { rate: (m.exitedPositive / m.exitedTotal) * 100, positive: m.exitedPositive, total: m.exitedTotal }
  }, [periodStageMetrics])

  const getTotalData = useCallback((stageId: string) => {
    let positive = 0, total = 0
    periodStageMetrics.forEach(periodMap => {
      const m = periodMap.get(stageId)
      if (m) { positive += m.exitedPositive; total += m.exitedTotal }
    })
    return { rate: total > 0 ? (positive / total) * 100 : 0, positive, total }
  }, [periodStageMetrics])

  // ── KPI Metrics ────────────────────────────────────────
  const kpis = useMemo(() => {
    let totalPositive = 0, totalExited = 0, totalFinalConversions = 0
    periodStageMetrics.forEach(periodMap => {
      periodMap.forEach(m => {
        totalPositive += m.exitedPositive
        totalExited += m.exitedTotal
        totalFinalConversions += m.finalConversions
      })
    })
    const uniqueLeads = new Set(filteredLogs.map(l => l.clientId)).size
    const rate = totalExited > 0 ? (totalPositive / totalExited) * 100 : 0
    return { rate, uniqueLeads, finalConversions: totalFinalConversions, totalPositive, totalExited }
  }, [periodStageMetrics, filteredLogs])

  // ── Segmented data ─────────────────────────────────────
  const segmentedData = useMemo(() => {
    if (!selectedSegment) return null

    // Group logs by segment value
    const segmentGroups = new Map<string, MovementLog[]>()
    filteredLogs.forEach(log => {
      const client = clientDataMap.get(log.clientId)
      let segValue = client?.[selectedSegment] || 'Nao definido'
      // Resolve ICP name
      if (selectedSegment === 'icpProfileId' && segValue !== 'Nao definido') {
        const icp = icpProfiles.find(p => p.id === segValue)
        segValue = icp?.name || segValue
      }
      if (!segmentGroups.has(segValue)) segmentGroups.set(segValue, [])
      segmentGroups.get(segValue)!.push(log)
    })

    // Build metrics per segment
    const result: { segmentValue: string; periodStageMetrics: Map<string, Map<string, StageMetric>> }[] = []

    segmentGroups.forEach((logs, segValue) => {
      const metrics = new Map<string, Map<string, StageMetric>>()

      logs.forEach(log => {
        const pk = getPeriodKey(new Date(log.createdAt), periodType)
        if (!metrics.has(pk)) metrics.set(pk, new Map())
        const periodMap = metrics.get(pk)!

        const fromStage = getStageByName(funnelStages, log.fromStage || '')
        const toStage = getStageByName(funnelStages, log.toStage || '')

        if (fromStage) {
          if (!periodMap.has(fromStage.id)) periodMap.set(fromStage.id, { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, finalConversions: 0 })
          const m = periodMap.get(fromStage.id)!
          m.exitedTotal++
          if (toStage) {
            if (toStage.conversionType === 'positive' || toStage.conversionType === 'final_conversion') m.exitedPositive++
            else m.exitedNegative++
            if (toStage.conversionType === 'final_conversion') m.finalConversions++
          } else {
            m.exitedNegative++
          }
        }
        if (toStage) {
          if (!periodMap.has(toStage.id)) periodMap.set(toStage.id, { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, finalConversions: 0 })
          periodMap.get(toStage.id)!.entered++
        }
      })

      result.push({ segmentValue: segValue, periodStageMetrics: metrics })
    })

    // Sort by total volume
    result.sort((a, b) => {
      let aTotal = 0, bTotal = 0
      a.periodStageMetrics.forEach(pm => pm.forEach(m => { aTotal += m.exitedTotal }))
      b.periodStageMetrics.forEach(pm => pm.forEach(m => { bTotal += m.exitedTotal }))
      return bTotal - aTotal
    })

    return result
  }, [selectedSegment, filteredLogs, clientDataMap, funnelStages, periodType, icpProfiles])

  // ── Period preset handler ──────────────────────────────
  const handlePeriodPreset = useCallback((preset: '7d' | '30d' | '90d' | 'custom') => {
    setPeriodPreset(preset)
    if (preset === 'custom') return
    const end = new Date()
    const start = new Date()
    switch (preset) {
      case '7d':
        start.setDate(end.getDate() - 7)
        setPeriodType('day')
        break
      case '30d':
        start.setDate(end.getDate() - 30)
        setPeriodType('week')
        break
      case '90d':
        start.setDate(end.getDate() - 90)
        setPeriodType('month')
        break
    }
    setDateRange({ start, end })
  }, [])

  // ── Export Excel ────────────────────────────────────────
  const handleExportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const data = activeFunnelStages.map(stage => {
      const total = getTotalData(stage.id)
      const row: Record<string, string | number> = { 'Etapa': stage.name }
      periodKeys.forEach(pk => {
        const cell = getCellData(stage.id, pk)
        row[getPeriodLabel(pk, periodType)] = cell.total > 0 ? `${cell.rate.toFixed(1)}% (${cell.positive}/${cell.total})` : '-'
      })
      row['Total %'] = total.total > 0 ? `${total.rate.toFixed(1)}%` : '-'
      row['Convertidos'] = total.positive
      row['Total Saidas'] = total.total
      return row
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Conversao')
    XLSX.writeFile(wb, 'conversao-funil.xlsx')
  }, [activeFunnelStages, periodKeys, periodType, getCellData, getTotalData])

  // ═════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Carregando dados do funil...</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={pageRef} className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-6">

      {/* ── HEADER ─────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl text-white shadow-lg shadow-primary-500/25">
              <FunnelIcon className="w-6 h-6" />
            </div>
            Conversao do Funil
          </h1>
          <p className="text-slate-500 text-sm mt-1 ml-[52px]">Acompanhe a conversao por etapa, periodo e segmentacao</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period presets */}
          <div className="flex items-center gap-0.5 bg-white rounded-lg ring-1 ring-slate-200 p-0.5">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => handlePeriodPreset(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  periodPreset === p ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => handlePeriodPreset('custom')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                periodPreset === 'custom' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Custom
            </button>
          </div>

          {/* Custom date inputs */}
          {periodPreset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateRange.start.toISOString().split('T')[0]}
                onChange={e => setDateRange(prev => ({ ...prev, start: new Date(e.target.value) }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
              />
              <span className="text-slate-400 text-xs">a</span>
              <input
                type="date"
                value={dateRange.end.toISOString().split('T')[0]}
                onChange={e => setDateRange(prev => ({ ...prev, end: new Date(e.target.value) }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
              />
              <select
                value={periodType}
                onChange={e => setPeriodType(e.target.value as PeriodType)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
              >
                <option value="day">Dia</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
              </select>
            </div>
          )}

          {/* Funnel selector */}
          {funnels.length > 1 && (
            <select
              value={selectedFunnelId}
              onChange={e => setSelectedFunnelId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white"
            >
              <option value="all">Todos os funis</option>
              {funnels.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}

          {/* Export */}
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <ArrowTrendingUpIcon className="w-4 h-4 text-primary-500" />
            Taxa de Conversao
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-800">{kpis.rate.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-slate-400">{kpis.totalPositive} de {kpis.totalExited} saidas</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <UsersIcon className="w-4 h-4 text-blue-500" />
            Leads Ativos
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-800">{kpis.uniqueLeads}</p>
          <p className="mt-1 text-xs text-slate-400">no periodo selecionado</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
            Conversoes Finais
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-800">{kpis.finalConversions}</p>
          <p className="mt-1 text-xs text-slate-400">chegaram ao final do funil</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <ChartBarIcon className="w-4 h-4 text-amber-500" />
            Periodos
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-800">{periodKeys.length}</p>
          <p className="mt-1 text-xs text-slate-400">{periodType === 'day' ? 'dias' : periodType === 'week' ? 'semanas' : 'meses'} com dados</p>
        </div>
      </div>

      {/* ── MAIN CONVERSION TABLE ─────────────────────── */}
      <ConversionTable
        stages={activeFunnelStages}
        periodKeys={periodKeys}
        periodType={periodType}
        getCellData={getCellData}
        getTotalData={getTotalData}
      />

      {/* ── SEGMENTATION ──────────────────────────────── */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-slate-800">Segmentacao</h2>
          <select
            value={selectedSegment}
            onChange={e => setSelectedSegment(e.target.value as SegmentKey | '')}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 bg-white min-w-[200px]"
          >
            <option value="">Selecione uma segmentacao...</option>
            {(Object.keys(SEGMENT_LABELS) as SegmentKey[]).map(key => (
              <option key={key} value={key}>{SEGMENT_LABELS[key]}</option>
            ))}
          </select>
        </div>

        {!selectedSegment && (
          <p className="text-sm text-slate-400 text-center py-8">
            Selecione uma segmentacao acima para ver tabelas de conversao por grupo.
          </p>
        )}

        {selectedSegment && segmentedData && segmentedData.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">
            Nenhum dado encontrado para esta segmentacao no periodo selecionado.
          </p>
        )}

        {selectedSegment && segmentedData && segmentedData.length > 0 && (
          <div className="space-y-4">
            {segmentedData.map(seg => (
              <ConversionTable
                key={seg.segmentValue}
                title={`${SEGMENT_LABELS[selectedSegment]}: ${seg.segmentValue}`}
                stages={activeFunnelStages}
                periodKeys={periodKeys}
                periodType={periodType}
                getCellData={(stageId, pk) => {
                  const m = seg.periodStageMetrics.get(pk)?.get(stageId)
                  if (!m || m.exitedTotal === 0) return { rate: 0, positive: 0, total: 0 }
                  return { rate: (m.exitedPositive / m.exitedTotal) * 100, positive: m.exitedPositive, total: m.exitedTotal }
                }}
                getTotalData={(stageId) => {
                  let positive = 0, total = 0
                  seg.periodStageMetrics.forEach(pm => {
                    const m = pm.get(stageId)
                    if (m) { positive += m.exitedPositive; total += m.exitedTotal }
                  })
                  return { rate: total > 0 ? (positive / total) * 100 : 0, positive, total }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
