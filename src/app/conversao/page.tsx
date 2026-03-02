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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  FunnelIcon,
  ArrowTrendingUpIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LightBulbIcon,
  ClockIcon,
  UsersIcon,
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

type PeriodType = 'day' | 'week' | 'month' | 'year'

type ConversionData = {
  period: string
  periodStart: Date
  periodEnd: Date
  stageMetrics: {
    [stageId: string]: {
      entered: number
      exitedTotal: number
      exitedPositive: number
      exitedNegative: number
      conversionRate: number
      finalConversions: number
    }
  }
  totalFinalConversions: number
  overallConversionRate: number
}

type Insight = {
  type: 'bottleneck' | 'slow' | 'declining'
  stageId: string
  stageName: string
  title: string
  description: string
  impact: number
}

type Funnel = { id: string; name: string }

// ═══════════════════════════════════════════════════════════
// CONSTANTS & HELPERS (preserved from original)
// ═══════════════════════════════════════════════════════════

const stageColorOptions = [
  { name: 'Azul', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', gradient: 'from-blue-500 to-blue-600', fill: '#3b82f6' },
  { name: 'Ciano', bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200', gradient: 'from-cyan-500 to-cyan-600', fill: '#06b6d4' },
  { name: 'Verde', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', gradient: 'from-emerald-500 to-emerald-600', fill: '#10b981' },
  { name: 'Amarelo', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', gradient: 'from-amber-500 to-amber-600', fill: '#f59e0b' },
  { name: 'Laranja', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', gradient: 'from-orange-500 to-orange-600', fill: '#f97316' },
  { name: 'Roxo', bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-200', gradient: 'from-primary-500 to-primary-600', fill: '#8b5cf6' },
  { name: 'Rosa', bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-200', gradient: 'from-pink-500 to-pink-600', fill: '#ec4899' },
  { name: 'Vermelho', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', gradient: 'from-red-500 to-red-600', fill: '#ef4444' },
  { name: 'Cinza', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', gradient: 'from-slate-500 to-slate-600', fill: '#64748b' },
  { name: 'Teal', bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200', gradient: 'from-teal-500 to-teal-600', fill: '#14b8a6' },
]

const getColorByIndex = (index: number) => stageColorOptions[index % stageColorOptions.length]

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

const getPeriodLabel = (date: Date, pt: PeriodType): string => {
  switch (pt) {
    case 'day':
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    case 'week': {
      const ws = new Date(date)
      ws.setDate(date.getDate() - date.getDay())
      const we = new Date(ws)
      we.setDate(ws.getDate() + 6)
      return `${ws.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - ${we.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
    }
    case 'month':
      return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    case 'year':
      return date.getFullYear().toString()
    default:
      return date.toLocaleDateString('pt-BR')
  }
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
    case 'year':
      return date.getFullYear().toString()
    default:
      return date.toISOString().split('T')[0]
  }
}

const getPeriodBounds = (key: string, pt: PeriodType): { start: Date; end: Date } => {
  let start: Date, end: Date
  switch (pt) {
    case 'day':
      start = new Date(key)
      end = new Date(key)
      end.setHours(23, 59, 59, 999)
      break
    case 'week':
      start = new Date(key)
      end = new Date(start)
      end.setDate(start.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      break
    case 'month': {
      const [y, mo] = key.split('-').map(Number)
      start = new Date(y, mo - 1, 1)
      end = new Date(y, mo, 0, 23, 59, 59, 999)
      break
    }
    case 'year': {
      const yr = parseInt(key)
      start = new Date(yr, 0, 1)
      end = new Date(yr, 11, 31, 23, 59, 59, 999)
      break
    }
    default:
      start = new Date(key)
      end = new Date(key)
  }
  return { start, end }
}

function computeStageTotals(
  logs: MovementLog[],
  stages: FunnelStage[],
  startDate: Date,
  endDate: Date
) {
  const filtered = logs.filter(log => {
    const d = new Date(log.createdAt)
    return d >= startDate && d <= endDate
  })

  const metrics: Record<string, { entered: number; exitedTotal: number; exitedPositive: number; exitedNegative: number; conversionRate: number; finalConversions: number }> = {}
  stages.forEach(s => {
    metrics[s.id] = { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, conversionRate: 0, finalConversions: 0 }
  })

  filtered.forEach(log => {
    const from = getStageByName(stages, log.fromStage || '')
    const to = getStageByName(stages, log.toStage || '')
    if (from && metrics[from.id]) {
      metrics[from.id].exitedTotal++
      if (to) {
        if (to.conversionType === 'positive' || to.conversionType === 'final_conversion') {
          metrics[from.id].exitedPositive++
        } else {
          metrics[from.id].exitedNegative++
        }
        if (to.conversionType === 'final_conversion') {
          metrics[from.id].finalConversions++
        }
      } else {
        metrics[from.id].exitedNegative++
      }
    }
    if (to && metrics[to.id]) {
      metrics[to.id].entered++
    }
  })

  Object.values(metrics).forEach(m => {
    if (m.exitedTotal > 0) m.conversionRate = (m.exitedPositive / m.exitedTotal) * 100
  })

  return metrics
}

// ═══════════════════════════════════════════════════════════
// CHART TOOLTIP
// ═══════════════════════════════════════════════════════════

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-slate-200">
          {entry.name === 'rate' ? 'Taxa' : 'Média Móvel'}: {Number(entry.value).toFixed(1)}%
        </p>
      ))}
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
  const [loading, setLoading] = useState(true)
  const [periodType, setPeriodType] = useState<PeriodType>('week')
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    return { start, end }
  })
  const [periodPreset, setPeriodPreset] = useState<'7d' | '30d' | '90d' | '12m' | 'custom'>('30d')
  const [selectedFunnelId, setSelectedFunnelId] = useState('all')
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [showExportMenu, setShowExportMenu] = useState(false)

  // ── Data Loading (preserved) ───────────────────────────
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

    // Load org client IDs to filter cross-org data from collectionGroup
    getDocs(query(collection(db, 'clients'), where('orgId', '==', orgId))).then(clientsSnap => {
      const orgClientIds = new Set(clientsSnap.docs.map(d => d.id))

      const logsQuery = query(collectionGroup(db, 'logs'), orderBy('createdAt', 'desc'))
      logsUnsub = onSnapshot(logsQuery, (snap) => {
        const logs: MovementLog[] = []
        snap.docs.forEach((doc) => {
          const data = doc.data()
          const clientId = doc.ref.parent.parent?.id || ''
          if (!orgClientIds.has(clientId)) return // Skip clients from other orgs
          if (data.fromStageName && data.toStageName) {
            logs.push({
              id: doc.id,
              clientId,
              text: data.message || data.text || `Card movido de ${data.fromStageName} para ${data.toStageName}`,
              author: data.author || 'Sistema',
              createdAt: data.createdAt,
              fromStage: data.fromStageName,
              toStage: data.toStageName,
            })
          } else if (data.text && (data.text.includes('movido de') || data.text.includes('Movido em massa'))) {
            const parsed = parseMovementLog(data.text)
            if (parsed) {
              logs.push({ id: doc.id, clientId, text: data.text, author: data.author || 'Sistema', createdAt: data.createdAt, fromStage: parsed.from, toStage: parsed.to })
            }
          } else if (data.message && (data.message.includes('movido de') || data.message.includes('Movido em massa'))) {
            const parsed = parseMovementLog(data.message)
            if (parsed) {
              logs.push({ id: doc.id, clientId, text: data.message, author: data.author || 'Sistema', createdAt: data.createdAt, fromStage: parsed.from, toStage: parsed.to })
            }
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

  // ── Filtered stages by funnel ──────────────────────────
  const activeFunnelStages = useMemo(() => {
    if (selectedFunnelId === 'all') return funnelStages
    return funnelStages.filter(s => s.funnelId === selectedFunnelId)
  }, [funnelStages, selectedFunnelId])

  // ── Core calculation: conversion data per period (preserved) ──
  const conversionData = useMemo(() => {
    if (activeFunnelStages.length === 0 || movementLogs.length === 0) return []

    const filteredLogs = movementLogs.filter((log) => {
      const logDate = new Date(log.createdAt)
      return logDate >= dateRange.start && logDate <= dateRange.end
    })

    const periodMap = new Map<string, MovementLog[]>()
    filteredLogs.forEach((log) => {
      const key = getPeriodKey(new Date(log.createdAt), periodType)
      if (!periodMap.has(key)) periodMap.set(key, [])
      periodMap.get(key)!.push(log)
    })

    const result: ConversionData[] = []
    periodMap.forEach((logs, periodKey) => {
      const bounds = getPeriodBounds(periodKey, periodType)
      const stageMetrics: ConversionData['stageMetrics'] = {}
      activeFunnelStages.forEach((stage) => {
        stageMetrics[stage.id] = { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, conversionRate: 0, finalConversions: 0 }
      })

      logs.forEach((log) => {
        const fromStage = getStageByName(activeFunnelStages, log.fromStage || '')
        const toStage = getStageByName(activeFunnelStages, log.toStage || '')
        if (fromStage) {
          stageMetrics[fromStage.id].exitedTotal++
          if (toStage) {
            if (toStage.conversionType === 'positive' || toStage.conversionType === 'final_conversion') {
              stageMetrics[fromStage.id].exitedPositive++
            } else {
              stageMetrics[fromStage.id].exitedNegative++
            }
            if (toStage.conversionType === 'final_conversion') {
              stageMetrics[fromStage.id].finalConversions++
            }
          } else {
            stageMetrics[fromStage.id].exitedNegative++
          }
        }
        if (toStage) stageMetrics[toStage.id].entered++
      })

      let totalFinalConversions = 0
      let totalEntered = 0
      activeFunnelStages.forEach((stage) => {
        const m = stageMetrics[stage.id]
        if (m.exitedTotal > 0) m.conversionRate = (m.exitedPositive / m.exitedTotal) * 100
        totalFinalConversions += m.finalConversions
        if (stage.conversionType !== 'negative' && stage.conversionType !== 'final_conversion') {
          totalEntered += m.entered
        }
      })

      result.push({
        period: getPeriodLabel(bounds.start, periodType),
        periodStart: bounds.start,
        periodEnd: bounds.end,
        stageMetrics,
        totalFinalConversions,
        overallConversionRate: totalEntered > 0 ? (totalFinalConversions / totalEntered) * 100 : 0,
      })
    })

    result.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())
    return result
  }, [activeFunnelStages, movementLogs, periodType, dateRange])

  // ── Totals across all periods (preserved) ──────────────
  const totals = useMemo(() => {
    const stageMetrics: Record<string, { entered: number; exitedTotal: number; exitedPositive: number; exitedNegative: number; conversionRate: number }> = {}
    activeFunnelStages.forEach((s) => {
      stageMetrics[s.id] = { entered: 0, exitedTotal: 0, exitedPositive: 0, exitedNegative: 0, conversionRate: 0 }
    })
    conversionData.forEach((data) => {
      Object.entries(data.stageMetrics).forEach(([stageId, m]) => {
        if (stageMetrics[stageId]) {
          stageMetrics[stageId].entered += m.entered
          stageMetrics[stageId].exitedTotal += m.exitedTotal
          stageMetrics[stageId].exitedPositive += m.exitedPositive
          stageMetrics[stageId].exitedNegative += m.exitedNegative
        }
      })
    })
    Object.values(stageMetrics).forEach((m) => {
      if (m.exitedTotal > 0) m.conversionRate = (m.exitedPositive / m.exitedTotal) * 100
    })
    return stageMetrics
  }, [conversionData, activeFunnelStages])

  // ── Visual funnel data (preserved) ─────────────────────
  const funnelVisualStages = useMemo(() => activeFunnelStages.filter(s => s.conversionType !== 'negative'), [activeFunnelStages])

  const funnelVisualData = useMemo(() => {
    return funnelVisualStages.map((stage) => {
      const metrics = totals[stage.id]
      return {
        stage,
        volume: metrics?.entered || 0,
        conversionRate: metrics?.conversionRate || 0,
        color: getColorByIndex(parseInt(stage.color || '0')),
      }
    })
  }, [funnelVisualStages, totals])

  // ── Previous period comparison ─────────────────────────
  const previousTotals = useMemo(() => {
    const duration = dateRange.end.getTime() - dateRange.start.getTime()
    const prevEnd = new Date(dateRange.start.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - duration)
    return computeStageTotals(movementLogs, activeFunnelStages, prevStart, prevEnd)
  }, [movementLogs, activeFunnelStages, dateRange])

  // ── Stage average days ─────────────────────────────────
  const stageAvgDays = useMemo(() => {
    const result: Record<string, number> = {}
    if (activeFunnelStages.length === 0) return result

    const filtered = movementLogs.filter(log => {
      const d = new Date(log.createdAt)
      return d >= dateRange.start && d <= dateRange.end
    })

    const clientLogs = new Map<string, MovementLog[]>()
    filtered.forEach(log => {
      if (!clientLogs.has(log.clientId)) clientLogs.set(log.clientId, [])
      clientLogs.get(log.clientId)!.push(log)
    })

    activeFunnelStages.forEach(stage => {
      const durations: number[] = []
      const sName = stage.name.trim().toLowerCase()

      clientLogs.forEach(logs => {
        const sorted = [...logs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].toStage && sorted[i].toStage!.trim().toLowerCase() === sName) {
            const entryTime = new Date(sorted[i].createdAt).getTime()
            for (let j = i + 1; j < sorted.length; j++) {
              if (sorted[j].fromStage && sorted[j].fromStage!.trim().toLowerCase() === sName) {
                const days = (new Date(sorted[j].createdAt).getTime() - entryTime) / (1000 * 60 * 60 * 24)
                if (days >= 0 && days < 365) durations.push(days)
                break
              }
            }
          }
        }
      })

      result[stage.id] = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    })
    return result
  }, [movementLogs, activeFunnelStages, dateRange])

  // ── Derived KPI values ─────────────────────────────────
  const totalFinalConversions = conversionData.reduce((acc, d) => acc + d.totalFinalConversions, 0)
  const avgConversionRate = conversionData.length > 0
    ? conversionData.reduce((acc, d) => acc + d.overallConversionRate, 0) / conversionData.length
    : 0
  const maxEntriesInFunnel = Math.max(...funnelVisualData.map(d => totals[d.stage.id]?.entered || 0), 1)

  const uniqueLeadsInPeriod = useMemo(() => {
    const ids = new Set<string>()
    movementLogs.forEach(log => {
      const d = new Date(log.createdAt)
      if (d >= dateRange.start && d <= dateRange.end) ids.add(log.clientId)
    })
    return ids.size
  }, [movementLogs, dateRange])

  const avgConversionDays = useMemo(() => {
    const vals = Object.values(stageAvgDays).filter(v => v > 0)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : 0
  }, [stageAvgDays])

  // ── Previous period KPI comparisons ────────────────────
  const prevTotalConversions = useMemo(() => Object.values(previousTotals).reduce((acc, m) => acc + m.finalConversions, 0), [previousTotals])
  const prevAvgRate = useMemo(() => {
    const rates = Object.values(previousTotals).filter(m => m.exitedTotal > 0).map(m => m.conversionRate)
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
  }, [previousTotals])
  const prevUniqueLeads = useMemo(() => {
    const duration = dateRange.end.getTime() - dateRange.start.getTime()
    const prevEnd = new Date(dateRange.start.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - duration)
    const ids = new Set<string>()
    movementLogs.forEach(log => {
      const d = new Date(log.createdAt)
      if (d >= prevStart && d <= prevEnd) ids.add(log.clientId)
    })
    return ids.size
  }, [movementLogs, dateRange])

  // ── Stage health indicators ────────────────────────────
  const stageHealth = useMemo(() => {
    const result: Record<string, 'green' | 'yellow' | 'red'> = {}
    const rates = funnelVisualData.map(d => totals[d.stage.id]?.conversionRate || 0).filter(r => r > 0)
    const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0

    funnelVisualData.forEach(item => {
      const rate = totals[item.stage.id]?.conversionRate || 0
      if (rate > avgRate * 1.1) result[item.stage.id] = 'green'
      else if (rate >= avgRate * 0.9) result[item.stage.id] = 'yellow'
      else result[item.stage.id] = 'red'
    })
    return { health: result, avgRate }
  }, [funnelVisualData, totals])

  // ── "Onde Atuar" Insights ──────────────────────────────
  const insights = useMemo(() => {
    const result: Insight[] = []
    const avgRate = stageHealth.avgRate

    // 1. Biggest bottleneck (lowest conversion rate with volume)
    let worstRate = Infinity
    let worstStage: (typeof funnelVisualData)[0] | null = null
    funnelVisualData.forEach(item => {
      const m = totals[item.stage.id]
      if (m && m.exitedTotal > 0 && m.conversionRate < worstRate) {
        worstRate = m.conversionRate
        worstStage = item
      }
    })
    if (worstStage && worstRate < avgRate) {
      const ws = worstStage as (typeof funnelVisualData)[0]
      const dropOff = 100 - worstRate
      result.push({
        type: 'bottleneck',
        stageId: ws.stage.id,
        stageName: ws.stage.name,
        title: 'Maior gargalo',
        description: `A etapa "${ws.stage.name}" está perdendo ${dropOff.toFixed(0)}% dos leads. É o principal ponto de atrito do funil.`,
        impact: dropOff * (totals[ws.stage.id]?.exitedTotal || 1),
      })
    }

    // 2. Slowest stage
    let slowestDays = 0
    let slowestStage: FunnelStage | null = null
    funnelVisualStages.forEach(stage => {
      const days = stageAvgDays[stage.id] || 0
      if (days > slowestDays) {
        slowestDays = days
        slowestStage = stage
      }
    })
    if (slowestStage && slowestDays > 0) {
      const ss = slowestStage as FunnelStage
      result.push({
        type: 'slow',
        stageId: ss.id,
        stageName: ss.name,
        title: 'Etapa mais lenta',
        description: `Leads ficam em média ${slowestDays.toFixed(1)} dias em "${ss.name}". Considere acelerar o processo nesta etapa.`,
        impact: slowestDays * (totals[ss.id]?.entered || 1),
      })
    }

    // 3. Recent decline (current vs previous period)
    let biggestDecline = 0
    let decliningStage: FunnelStage | null = null
    funnelVisualStages.forEach(stage => {
      const curr = totals[stage.id]?.conversionRate || 0
      const prev = previousTotals[stage.id]?.conversionRate || 0
      const decline = prev - curr
      if (decline > biggestDecline && prev > 0) {
        biggestDecline = decline
        decliningStage = stage
      }
    })
    if (decliningStage && biggestDecline > 5) {
      const ds = decliningStage as FunnelStage
      result.push({
        type: 'declining',
        stageId: ds.id,
        stageName: ds.name,
        title: 'Piora recente',
        description: `A taxa de "${ds.name}" caiu ${biggestDecline.toFixed(0)}pp comparado ao período anterior. Investigue as causas.`,
        impact: biggestDecline * (totals[ds.id]?.entered || 1),
      })
    }

    result.sort((a, b) => b.impact - a.impact)
    return result.slice(0, 3)
  }, [funnelVisualData, funnelVisualStages, totals, previousTotals, stageAvgDays, stageHealth.avgRate])

  // ── Time series for AreaChart ──────────────────────────
  const getStageTimeSeries = useCallback((stageId: string) => {
    const sorted = [...conversionData].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
    const rates = sorted.map(d => d.stageMetrics[stageId]?.conversionRate || 0)

    return sorted.map((d, i) => {
      const windowStart = Math.max(0, i - 2)
      const windowSlice = rates.slice(windowStart, i + 1)
      const movingAvg = windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length

      return {
        period: d.period,
        rate: rates[i],
        movingAvg: Number(movingAvg.toFixed(1)),
      }
    })
  }, [conversionData])

  // ── Period preset handler ──────────────────────────────
  const handlePeriodPreset = useCallback((preset: '7d' | '30d' | '90d' | '12m' | 'custom') => {
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
        setPeriodType('week')
        break
      case '12m':
        start.setMonth(end.getMonth() - 12)
        setPeriodType('month')
        break
    }
    setDateRange({ start, end })
  }, [])

  // ── Export handlers ────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    setShowExportMenu(false)
    const element = pageRef.current
    if (!element) return
    const [html2canvas, jsPDFModule] = await Promise.all([
      import('html2canvas-pro').then(m => m.default),
      import('jspdf').then(m => m.default),
    ])
    const canvas = await html2canvas(element, { scale: 2, useCORS: true })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDFModule('p', 'mm', 'a4')
    const imgWidth = 210
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)
    pdf.save('conversao-funil.pdf')
  }, [])

  const handleExportExcel = useCallback(async () => {
    setShowExportMenu(false)
    const XLSX = await import('xlsx')
    const data = funnelVisualData.map(item => {
      const m = totals[item.stage.id]
      return {
        'Etapa': item.stage.name,
        'Entradas': m?.entered || 0,
        'Saídas': m?.exitedTotal || 0,
        'Convertidos': m?.exitedPositive || 0,
        'Perdidos': m?.exitedNegative || 0,
        'Taxa (%)': (m?.conversionRate || 0).toFixed(1),
        'Tempo Médio (dias)': (stageAvgDays[item.stage.id] || 0).toFixed(1),
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Conversão')
    XLSX.writeFile(wb, 'conversao-funil.xlsx')
  }, [funnelVisualData, totals, stageAvgDays])

  const toggleExpanded = useCallback((stageId: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }, [])

  // ── Diff helper ────────────────────────────────────────
  const DiffBadge = ({ current, previous, suffix = '%', invert = false }: { current: number; previous: number; suffix?: string; invert?: boolean }) => {
    if (previous === 0 && current === 0) return null
    const diff = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0
    const isPositive = invert ? diff < 0 : diff > 0
    if (Math.abs(diff) < 0.5) return null
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
        {isPositive ? '↑' : '↓'} {Math.abs(diff).toFixed(1)}{suffix}
      </span>
    )
  }

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
            Conversão do Funil
          </h1>
          <p className="text-slate-500 text-sm mt-1 ml-[52px]">Identifique gaps e otimize cada etapa do seu pipeline</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Period toggle */}
          <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
            {(['7d', '30d', '90d', '12m'] as const).map(p => (
              <button
                key={p}
                onClick={() => handlePeriodPreset(p)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${periodPreset === p ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => handlePeriodPreset('custom')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${periodPreset === 'custom' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
            >
              Custom
            </button>
          </div>

          {/* Custom date range */}
          {periodPreset === 'custom' && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <input
                type="date"
                value={dateRange.start.toISOString().split('T')[0]}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: new Date(e.target.value) }))}
                className="text-sm text-slate-700 bg-transparent focus:outline-none w-28"
              />
              <span className="text-slate-300">→</span>
              <input
                type="date"
                value={dateRange.end.toISOString().split('T')[0]}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: new Date(e.target.value) }))}
                className="text-sm text-slate-700 bg-transparent focus:outline-none w-28"
              />
            </div>
          )}

          {/* Funnel selector */}
          {funnels.length > 0 && (
            <select
              value={selectedFunnelId}
              onChange={(e) => setSelectedFunnelId(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <option value="all">Todos os funis</option>
              {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Exportar
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl border border-slate-200 shadow-lg z-20 py-1 w-36">
                <button onClick={handleExportPDF} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">PDF</button>
                <button onClick={handleExportExcel} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Excel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI CARDS ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Taxa de Conversão */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <ArrowTrendingUpIcon className="w-4 h-4 text-slate-400" />
            <p className="text-sm text-slate-500 font-medium">Taxa de Conversão</p>
          </div>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-slate-900">{avgConversionRate.toFixed(1)}%</p>
            <DiffBadge current={avgConversionRate} previous={prevAvgRate} suffix="pp" />
          </div>
        </div>

        {/* Leads Movimentados */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <UsersIcon className="w-4 h-4 text-slate-400" />
            <p className="text-sm text-slate-500 font-medium">Leads Ativos</p>
          </div>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-slate-900">{uniqueLeadsInPeriod}</p>
            <DiffBadge current={uniqueLeadsInPeriod} previous={prevUniqueLeads} />
          </div>
        </div>

        {/* Conversões */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircleIcon className="w-4 h-4 text-slate-400" />
            <p className="text-sm text-slate-500 font-medium">Conversões</p>
          </div>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-slate-900">{totalFinalConversions}</p>
            <DiffBadge current={totalFinalConversions} previous={prevTotalConversions} />
          </div>
        </div>

        {/* Tempo Médio */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <ClockIcon className="w-4 h-4 text-slate-400" />
            <p className="text-sm text-slate-500 font-medium">Tempo Médio</p>
          </div>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-slate-900">{avgConversionDays > 0 ? `${avgConversionDays.toFixed(1)}d` : 'N/D'}</p>
          </div>
        </div>
      </div>

      {/* ── VERTICAL FUNNEL ────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-primary-600" />
              Funil de Conversão
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Largura proporcional ao volume. Drop-off entre etapas.</p>
          </div>
        </div>

        {funnelVisualData.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <FunnelIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>Configure as etapas do funil para visualizar a conversão</p>
          </div>
        ) : (
          <div className="p-6 md:p-8">
            <div className="max-w-2xl mx-auto space-y-0">
              {funnelVisualData.map((item, index) => {
                const metrics = totals[item.stage.id]
                const entries = metrics?.entered || 0
                const barWidthPercent = Math.max((entries / maxEntriesInFunnel) * 100, 15)
                const convRate = metrics?.conversionRate || 0
                const isLast = index === funnelVisualData.length - 1
                const nextItem = !isLast ? funnelVisualData[index + 1] : null
                const nextEntries = nextItem ? (totals[nextItem.stage.id]?.entered || 0) : 0
                const passThrough = entries > 0 ? ((nextEntries / entries) * 100) : 0
                const dropOff = entries > 0 ? (((entries - nextEntries) / entries) * 100) : 0
                const isGap = convRate > 0 && convRate < stageHealth.avgRate * 0.5

                return (
                  <div key={item.stage.id}>
                    {/* Stage bar */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`relative group transition-all duration-500 ease-out ${isGap ? 'ring-2 ring-amber-400/50 rounded-xl' : ''}`}
                        style={{ width: `${barWidthPercent}%`, minWidth: '120px' }}
                      >
                        <div className={`h-14 rounded-xl bg-gradient-to-r ${item.color.gradient} flex items-center justify-between px-4 shadow-sm`}>
                          <span className="font-semibold text-white text-sm truncate mr-2">{item.stage.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-white/70 text-xs">{entries}</span>
                            <span className="text-white font-bold text-sm">{convRate.toFixed(0)}%</span>
                            {isGap && <ExclamationTriangleIcon className="w-4 h-4 text-amber-200" />}
                          </div>
                        </div>

                        {/* Tooltip */}
                        <div className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full z-20 bg-slate-800 text-white rounded-xl p-3 text-xs shadow-lg w-52 pointer-events-none">
                          <p className="font-semibold mb-2">{item.stage.name}</p>
                          <div className="space-y-1">
                            <div className="flex justify-between"><span className="text-slate-300">Entradas</span><span>{entries}</span></div>
                            <div className="flex justify-between"><span className="text-emerald-300">Saídas positivas</span><span>{metrics?.exitedPositive || 0}</span></div>
                            <div className="flex justify-between"><span className="text-red-300">Saídas negativas</span><span>{metrics?.exitedNegative || 0}</span></div>
                            <div className="flex justify-between"><span className="text-slate-300">Tempo médio</span><span>{(stageAvgDays[item.stage.id] || 0).toFixed(1)}d</span></div>
                          </div>
                          {isGap && (
                            <p className="mt-2 text-amber-300 text-[10px]">
                              Esta etapa tem taxa {((stageHealth.avgRate - convRate) / stageHealth.avgRate * 100).toFixed(0)}% abaixo da média.
                            </p>
                          )}
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-slate-800" />
                        </div>
                      </div>
                    </div>

                    {/* Drop-off connector */}
                    {!isLast && (
                      <div className="flex flex-col items-center py-1">
                        <div className="w-0.5 h-3 bg-slate-200" />
                        <div className="flex items-center gap-3 py-1">
                          <span className="text-xs font-medium text-emerald-600">{passThrough.toFixed(0)}% avançaram</span>
                          <span className="text-xs text-red-400">{dropOff.toFixed(0)}% saíram</span>
                        </div>
                        <div className="w-0.5 h-3 bg-slate-200" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── STAGE DETAIL CARDS ─────────────────────────── */}
      {funnelVisualData.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
            <ChartBarIcon className="w-5 h-5 text-primary-600" />
            Detalhamento por Etapa
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {funnelVisualData.map((item) => {
              const metrics = totals[item.stage.id]
              const prevMetrics = previousTotals[item.stage.id]
              const rate = metrics?.conversionRate || 0
              const health = stageHealth.health[item.stage.id] || 'yellow'
              const isExpanded = expandedStages.has(item.stage.id)
              const days = stageAvgDays[item.stage.id] || 0

              const healthDotColor = health === 'green' ? 'bg-emerald-500' : health === 'yellow' ? 'bg-amber-400' : 'bg-red-500'

              return (
                <div
                  key={item.stage.id}
                  id={`stage-${item.stage.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
                  onClick={() => toggleExpanded(item.stage.id)}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${healthDotColor}`} />
                      <div className={`w-3 h-3 rounded-sm bg-gradient-to-r ${item.color.gradient}`} />
                      <h3 className="font-semibold text-slate-800">{item.stage.name}</h3>
                    </div>
                    {isExpanded
                      ? <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                      : <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                    }
                  </div>

                  {/* 3 Metrics */}
                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Entradas</p>
                      <p className="text-xl font-bold text-slate-800">{metrics?.entered || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Conversão</p>
                      <div className="flex items-end gap-1.5">
                        <p className="text-xl font-bold text-slate-800">{rate.toFixed(0)}%</p>
                        {prevMetrics && <DiffBadge current={rate} previous={prevMetrics.conversionRate} suffix="pp" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Tempo médio</p>
                      <p className="text-xl font-bold text-slate-800">{days > 0 ? `${days.toFixed(1)}d` : 'N/D'}</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-2 rounded-full bg-gradient-to-r ${item.color.gradient} transition-all duration-500`}
                      style={{ width: `${Math.max(rate, 2)}%` }}
                    />
                  </div>

                  {/* Expandable AreaChart */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                      <p className="text-xs text-slate-400 mb-2">Evolução da taxa de conversão</p>
                      {conversionData.length > 1 ? (
                        <ResponsiveContainer width="100%" height={160}>
                          <AreaChart data={getStageTimeSeries(item.stage.id)}>
                            <defs>
                              <linearGradient id={`grad-${item.stage.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={item.color.fill} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={item.color.fill} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" domain={[0, 100]} width={30} />
                            <RechartsTooltip content={<ChartTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="rate"
                              name="rate"
                              stroke={item.color.fill}
                              fill={`url(#grad-${item.stage.id})`}
                              strokeWidth={2}
                            />
                            <Area
                              type="monotone"
                              dataKey="movingAvg"
                              name="movingAvg"
                              stroke={item.color.fill}
                              fill="none"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              opacity={0.5}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-6">Dados insuficientes para gráfico de evolução</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── ONDE ATUAR (INSIGHTS) ──────────────────────── */}
      {insights.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
            <LightBulbIcon className="w-5 h-5 text-amber-500" />
            Onde Atuar
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {insights.map((insight, i) => {
              const borderColor = insight.type === 'bottleneck' ? 'border-l-red-500' : insight.type === 'slow' ? 'border-l-amber-500' : 'border-l-blue-500'
              const iconColor = insight.type === 'bottleneck' ? 'text-red-500' : insight.type === 'slow' ? 'text-amber-500' : 'text-blue-500'
              const Icon = insight.type === 'bottleneck' ? FunnelIcon : insight.type === 'slow' ? ClockIcon : ArrowTrendingUpIcon

              return (
                <div key={i} className={`bg-white rounded-xl border border-slate-200 border-l-4 ${borderColor} p-5 shadow-sm`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                    <h3 className="text-sm font-bold text-slate-800">{insight.title}</h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">{insight.description}</p>
                  <button
                    onClick={() => document.getElementById(`stage-${insight.stageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className="text-xs text-primary-600 font-medium hover:text-primary-700 transition-colors"
                  >
                    Ver etapa →
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
