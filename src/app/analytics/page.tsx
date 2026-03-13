'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
} from 'firebase/firestore'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import PlanGate from '@/components/PlanGate'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  UsersIcon,
  UserPlusIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  FunnelIcon,
  ChartBarIcon,
  EyeIcon,
  XMarkIcon,
  CurrencyDollarIcon,
  CalculatorIcon,
} from '@heroicons/react/24/outline'
import {
  calcAgingMatrix,
  calcConversionByDimension,
  calcOverviewKPIs,
  calcTemporalEvolution,
  calcDistribution,
  calcTopOpportunities,
  calcBottleneckStages,
  calcFunnelData,
  AGING_BANDS,
  AGING_COLORS,
  CHART_COLORS,
  DIMENSION_LABELS,
  type AgingBand,
  type ConversionDimension,
  type ConversionRow,
  type OverviewKPIs,
  type DistributionItem,
  type OpportunityItem,
  type BottleneckStage,
  type FunnelStageData,
  calcPipelineKPIs,
  calcValueByStage,
  calcFrtKPIs,
} from '@/lib/analyticsCalculations'

/* ═══════════════════════════════════════════════════════════ */
/*  TYPES                                                     */
/* ═══════════════════════════════════════════════════════════ */

type Client = Record<string, unknown> & { id: string }

type FunnelStage = {
  id: string
  name: string
  order: number
  funnelId: string
  probability?: number
  maxDays?: number
  conversionType?: string
}

type Funnel = { id: string; name: string }

type TabId = 'overview' | 'aging' | 'profile' | 'opportunities' | 'conversion'

type PeriodPreset = '7d' | '30d' | '90d' | '12m' | 'custom'

/* ═══════════════════════════════════════════════════════════ */
/*  CONSTANTS                                                 */
/* ═══════════════════════════════════════════════════════════ */

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'aging', label: 'Aging de Contatos' },
  { id: 'profile', label: 'Perfil de Clientes' },
  { id: 'opportunities', label: 'Oportunidades' },
  { id: 'conversion', label: 'Conversão por Parâmetro' },
]

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '12m', label: '12 meses' },
]

const PROFILE_FIELDS: { field: string; label: string; type: 'pie' | 'bar' }[] = [
  { field: 'industry', label: 'Segmento / Indústria', type: 'pie' },
  { field: 'porte_empresa', label: 'Porte da Empresa', type: 'bar' },
  { field: 'leadSource', label: 'Origem do Lead', type: 'bar' },
  { field: 'leadType', label: 'Tipo do Lead', type: 'pie' },
  { field: 'estado', label: 'Estado', type: 'bar' },
  { field: 'tipo', label: 'Tipo de Empresa', type: 'bar' },
  { field: 'natureza_juridica', label: 'Natureza Jurídica', type: 'bar' },
]

/* ═══════════════════════════════════════════════════════════ */
/*  HELPERS                                                   */
/* ═══════════════════════════════════════════════════════════ */

function getPeriodStart(preset: PeriodPreset): string {
  const now = new Date()
  switch (preset) {
    case '7d': now.setDate(now.getDate() - 7); break
    case '30d': now.setDate(now.getDate() - 30); break
    case '90d': now.setDate(now.getDate() - 90); break
    case '12m': now.setFullYear(now.getFullYear() - 1); break
    default: now.setDate(now.getDate() - 30)
  }
  return now.toISOString()
}

function formatPct(val: number): string {
  return val.toFixed(1) + '%'
}

/* ─── Shared export styles (mirrors funil/[funnelId] design) ─── */
function getExcelStyles() {
  const primaryDark = '0BBDD6'
  const headerFontColor = 'FFFFFF'
  const lightBg = 'F0FDFF'
  const borderColor = 'D1D5DB'

  const headerStyle = {
    font: { bold: true, color: { rgb: headerFontColor }, sz: 11, name: 'Calibri' },
    fill: { fgColor: { rgb: primaryDark } },
    alignment: { horizontal: 'center' as const, vertical: 'center' as const, wrapText: true },
    border: {
      top: { style: 'thin' as const, color: { rgb: primaryDark } },
      bottom: { style: 'thin' as const, color: { rgb: primaryDark } },
      left: { style: 'thin' as const, color: { rgb: primaryDark } },
      right: { style: 'thin' as const, color: { rgb: primaryDark } },
    },
  }

  const cellBorder = {
    top: { style: 'thin' as const, color: { rgb: borderColor } },
    bottom: { style: 'thin' as const, color: { rgb: borderColor } },
    left: { style: 'thin' as const, color: { rgb: borderColor } },
    right: { style: 'thin' as const, color: { rgb: borderColor } },
  }

  const cellStyleEven = {
    font: { sz: 10, name: 'Calibri', color: { rgb: '333333' } },
    alignment: { vertical: 'center' as const, wrapText: true },
    border: cellBorder,
  }

  const cellStyleOdd = {
    ...cellStyleEven,
    fill: { fgColor: { rgb: lightBg } },
  }

  return { primaryDark, headerStyle, cellStyleEven, cellStyleOdd }
}

function buildTitleRows(title: string, subtitle?: string) {
  const { primaryDark } = getExcelStyles()
  const titleRow = [{
    v: title,
    s: { font: { bold: true, sz: 14, color: { rgb: primaryDark }, name: 'Calibri' }, alignment: { horizontal: 'left' as const, vertical: 'center' as const } },
  }]
  const dateRow = [{
    v: `Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    s: { font: { sz: 10, color: { rgb: '666666' }, italic: true, name: 'Calibri' }, alignment: { horizontal: 'left' as const } },
  }]
  const subRow = subtitle ? [{
    v: subtitle,
    s: { font: { sz: 10, bold: true, color: { rgb: '444444' }, name: 'Calibri' }, alignment: { horizontal: 'left' as const } },
  }] : null
  return { titleRow, dateRow, subRow }
}

/* ═══════════════════════════════════════════════════════════ */
/*  TOOLTIP                                                   */
/* ═══════════════════════════════════════════════════════════ */

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 text-white rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }} className="flex justify-between gap-4">
          <span>{entry.name}</span>
          <span className="font-medium">{typeof entry.value === 'number' ? entry.value.toLocaleString('pt-BR') : entry.value}</span>
        </p>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                 */
/* ═══════════════════════════════════════════════════════════ */

export default function AnalyticsPage() {
  return (
    <PlanGate feature="ai_reports" showUpgrade>
      <AnalyticsDashboard />
    </PlanGate>
  )
}

function AnalyticsDashboard() {
  const { orgId } = useCrmUser()

  /* ─── State ─── */
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('30d')
  const [selectedFunnel, setSelectedFunnel] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataVersion, setDataVersion] = useState(0)

  /* ─── Data cache ─── */
  const clientsRef = useRef<Client[]>([])
  const stagesRef = useRef<FunnelStage[]>([])
  const funnelsRef = useRef<Funnel[]>([])
  const loadedRef = useRef(false)

  /* ─── Load data ─── */
  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      // Fetch clients (top-level collection filtered by orgId)
      const clientsSnap = await getDocs(
        query(collection(db, 'clients'), where('orgId', '==', orgId))
      )
      clientsRef.current = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Client[]

      // Fetch funnels
      const funnelsSnap = await getDocs(collection(db, 'organizations', orgId, 'funnels'))
      funnelsRef.current = funnelsSnap.docs.map(d => ({ id: d.id, name: d.data().name }))

      // Fetch stages (top-level funnelStages collection filtered by orgId)
      const stagesSnap = await getDocs(
        query(collection(db, 'funnelStages'), where('orgId', '==', orgId), orderBy('order'))
      )
      stagesRef.current = stagesSnap.docs.map(d => ({ id: d.id, ...d.data() } as FunnelStage))
      loadedRef.current = true
    } catch (err) {
      console.error('Failed to load analytics data:', err)
      setError('Falha ao carregar dados de analytics. Tente novamente.')
    } finally {
      setLoading(false)
      setDataVersion(v => v + 1)
    }
  }, [orgId])

  useEffect(() => {
    if (orgId) loadData()
  }, [orgId, loadData])

  /* ─── Filtered data ─── */
  const periodStart = useMemo(() => getPeriodStart(periodPreset), [periodPreset])

  const filteredClients = useMemo(() => {
    let list = clientsRef.current
    if (selectedFunnel !== 'all') {
      const funnelStageIds = new Set(stagesRef.current.filter(s => s.funnelId === selectedFunnel).map(s => s.id))
      list = list.filter(c => funnelStageIds.has(c.funnelStage as string))
    }
    return list
  }, [selectedFunnel, dataVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredStages = useMemo(() => {
    if (selectedFunnel === 'all') return stagesRef.current
    return stagesRef.current.filter(s => s.funnelId === selectedFunnel)
  }, [selectedFunnel, dataVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Export PDF ─── */
  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    const tabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab

    // Header
    doc.setFontSize(22)
    doc.setTextColor(19, 222, 252)
    doc.text('Voxium', 14, 20)
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(`Análises & Insights — ${tabLabel}`, 14, 28)
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 34)

    let yPos = 44

    if (activeTab === 'overview') {
      const kpis = calcOverviewKPIs(filteredClients, periodStart)
      const pipeKpis = calcPipelineKPIs(filteredClients)
      const frtKpis = calcFrtKPIs(filteredClients)
      const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

      doc.setFontSize(14)
      doc.setTextColor(30, 30, 30)
      doc.text('KPIs Gerais', 14, yPos)
      yPos += 6

      autoTable(doc, {
        startY: yPos,
        head: [['Métrica', 'Valor']],
        body: [
          ['Total de Contatos', String(kpis.totalContacts)],
          ['Leads Novos (no período)', String(kpis.newLeads)],
          ['Contatos Ativos', String(kpis.activeCount)],
          ['Contatos Inativos', String(kpis.inactiveCount)],
          ['Taxa de Conversão', `${kpis.conversionRate.toFixed(1)}%`],
          ['Tempo Médio Conversão', `${kpis.avgConversionDays} dias`],
          ['Sem Atividade 30d+', String(kpis.dormant30)],
          ['Sem Atividade 60d+', String(kpis.dormant60)],
          ['Pipeline Total', formatBRL(pipeKpis.totalPipelineValue)],
          ['Ticket Médio', formatBRL(pipeKpis.ticketMedio)],
          ['Negócios com Valor', String(pipeKpis.clientsWithDeal)],
          ['FRT Médio', frtKpis.avgFrtHours < 1 ? `${Math.round(frtKpis.avgFrtHours * 60)}min` : `${frtKpis.avgFrtHours.toFixed(1)}h`],
          ['Sem 1º Contato', String(frtKpis.totalWithoutFrt)],
        ],
        theme: 'striped',
        headStyles: { fillColor: [19, 222, 252] },
      })

      // Value by stage table
      const valueByStage = calcValueByStage(filteredClients, filteredStages)
      if (valueByStage.length > 0) {
         
        const lastY = (doc as any).lastAutoTable?.finalY || yPos + 80
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text('Valor do Pipeline por Etapa', 14, lastY + 10)
        autoTable(doc, {
          startY: lastY + 16,
          head: [['Etapa', 'Valor', 'Negócios']],
          body: valueByStage.map(s => [s.name, formatBRL(s.value), String(s.count)]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
      }

      // FRT by Seller
      if (frtKpis.bySeller.length > 0) {
         
        const lastY2 = (doc as any).lastAutoTable?.finalY || yPos + 120
        if (lastY2 > 240) doc.addPage()
        const startY = lastY2 > 240 ? 20 : lastY2 + 10
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text('First Response Time por Vendedor', 14, startY)
        autoTable(doc, {
          startY: startY + 6,
          head: [['Vendedor', 'FRT Médio', 'Contatos', 'SLA']],
          body: frtKpis.bySeller.map(s => [
            s.seller,
            s.avgFrtHours < 1 ? `${Math.round(s.avgFrtHours * 60)}min` : `${s.avgFrtHours.toFixed(1)}h`,
            String(s.contactCount),
            s.slaColor === 'green' ? 'OK' : s.slaColor === 'yellow' ? 'Atenção' : 'Crítico',
          ]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
      }
    } else if (activeTab === 'aging') {
      const { matrix, stageNames } = calcAgingMatrix(filteredClients, filteredStages)
      const kpis = calcOverviewKPIs(filteredClients, new Date(0).toISOString())

      doc.setFontSize(14)
      doc.setTextColor(30, 30, 30)
      doc.text('Aging de Contatos', 14, yPos)
      yPos += 4
      doc.setFontSize(10)
      doc.text(`Sem atividade 30d+: ${kpis.dormant30} | 60d+: ${kpis.dormant60}`, 14, yPos + 4)
      yPos += 10

      autoTable(doc, {
        startY: yPos,
        head: [['Etapa', ...AGING_BANDS]],
        body: stageNames.map(name => [
          name,
          ...AGING_BANDS.map(band => String(matrix[name]?.[band]?.length || 0)),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [19, 222, 252] },
      })
    } else if (activeTab === 'conversion') {
      const allDimensions = Object.keys(DIMENSION_LABELS) as ConversionDimension[]
      for (const dim of allDimensions) {
        const rows = calcConversionByDimension(filteredClients, dim)
        if (rows.length === 0) continue

        if (yPos > 240) { doc.addPage(); yPos = 20 }
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text(`Conversão por ${DIMENSION_LABELS[dim]}`, 14, yPos)
        yPos += 6

        autoTable(doc, {
          startY: yPos,
          head: [[DIMENSION_LABELS[dim], 'Total', 'Convertidos', 'Taxa (%)', 'Tempo Médio (dias)']],
          body: rows.map(r => [r.dimension, String(r.total), String(r.converted), `${r.rate.toFixed(1)}%`, String(r.avgDays || '—')]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
         
        yPos = ((doc as any).lastAutoTable?.finalY || yPos + 40) + 10
      }
    } else if (activeTab === 'profile') {
      const activeClients = filteredClients.filter(c => c.status === 'Ativo')
      for (const pf of PROFILE_FIELDS) {
        const data = calcDistribution(activeClients, pf.field).slice(0, 15)
        if (data.length === 0) continue

        if (yPos > 240) { doc.addPage(); yPos = 20 }
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text(pf.label, 14, yPos)
        yPos += 6

        autoTable(doc, {
          startY: yPos,
          head: [['Nome', 'Quantidade', 'Percentual (%)']],
          body: data.map(d => [d.name, String(d.value), `${d.percent}%`]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
         
        yPos = ((doc as any).lastAutoTable?.finalY || yPos + 40) + 10
      }
    } else if (activeTab === 'opportunities') {
      const funnelData = calcFunnelData(filteredClients, filteredStages)
      const topOpps = calcTopOpportunities(filteredClients, filteredStages)
      const bottlenecks = calcBottleneckStages(filteredClients, filteredStages)

      // Funnel summary
      if (funnelData.length > 0) {
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text('Funil de Vendas', 14, yPos)
        yPos += 6

        autoTable(doc, {
          startY: yPos,
          head: [['Etapa', 'Contatos', 'Conversão (%)', 'Dias Média']],
          body: funnelData.map((s, i) => [s.name, String(s.count), i > 0 ? `${s.conversionRate.toFixed(1)}%` : '—', String(s.avgDays)]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
         
        yPos = ((doc as any).lastAutoTable?.finalY || yPos + 40) + 10
      }

      // Bottlenecks
      if (bottlenecks.length > 0) {
        if (yPos > 240) { doc.addPage(); yPos = 20 }
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text('Gargalos Identificados', 14, yPos)
        yPos += 6

        autoTable(doc, {
          startY: yPos,
          head: [['Etapa', 'Dias Média', 'Máx Dias', 'Contatos', 'Atrasados']],
          body: bottlenecks.map(b => [b.name, String(b.avgDays), String(b.maxDays), String(b.contactCount), String(b.overdueCount)]),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
         
        yPos = ((doc as any).lastAutoTable?.finalY || yPos + 40) + 10
      }

      // Top opportunities
      if (topOpps.length > 0) {
        if (yPos > 200) { doc.addPage(); yPos = 20 }
        doc.setFontSize(14)
        doc.setTextColor(30, 30, 30)
        doc.text('Top Oportunidades Quentes', 14, yPos)
        yPos += 6

        autoTable(doc, {
          startY: yPos,
          head: [['Nome', 'Empresa', 'Etapa', 'Prob.', 'Dias', 'Status']],
          body: topOpps.slice(0, 50).map(o => [o.name, o.company || '—', o.stage, `${o.probability}%`, String(o.daysInStage), o.isOverdue ? 'Atrasado' : 'No prazo']),
          theme: 'striped',
          headStyles: { fillColor: [19, 222, 252] },
        })
      }
    }

    doc.save(`analytics-${activeTab}-${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [activeTab, filteredClients, filteredStages, periodStart])

  /* ─── Export Excel ─── */
  const handleExportExcel = useCallback(async () => {
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    const styles = getExcelStyles()
    const tabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab

    const buildSheet = (
      headers: string[],
      dataRows: (string | number)[][],
      sheetTitle: string,
      subtitle?: string,
      colWidths?: number[],
    ) => {
      const { titleRow, dateRow, subRow } = buildTitleRows(`Análises — ${sheetTitle}`, subtitle)
      const styledHeaders = headers.map(h => ({ v: h, s: styles.headerStyle }))

      const rows = dataRows.map((row, idx) => {
        const style = idx % 2 === 0 ? styles.cellStyleEven : styles.cellStyleOdd
        const centerStyle = { ...style, alignment: { ...style.alignment, horizontal: 'center' as const } }
        return row.map((cell, ci) => ({ v: cell, s: ci === 0 ? style : centerStyle }))
      })

      const sheetData = subRow
        ? [titleRow, dateRow, subRow, [], styledHeaders, ...rows]
        : [titleRow, dateRow, [], styledHeaders, ...rows]

      const ws = XLSX.utils.aoa_to_sheet(sheetData)

      const mergeRows = subRow ? 3 : 2
      ws['!merges'] = Array.from({ length: mergeRows }, (_, i) => ({
        s: { r: i, c: 0 }, e: { r: i, c: headers.length - 1 },
      }))

      ws['!cols'] = (colWidths || headers.map(() => 20)).map(w => ({ wch: w }))

      ws['!rows'] = [
        { hpt: 30 }, // Title
        { hpt: 18 }, // Date
        ...(subRow ? [{ hpt: 18 }] : []), // Subtitle
        { hpt: 10 }, // Blank spacer
        { hpt: 28 }, // Headers
        ...rows.map(() => ({ hpt: 22 })),
      ]

      return ws
    }

    if (activeTab === 'overview') {
      const kpis = calcOverviewKPIs(filteredClients, periodStart)
      const pipeKpis = calcPipelineKPIs(filteredClients)
      const frtKpis = calcFrtKPIs(filteredClients)
      const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

      const ws = buildSheet(
        ['Métrica', 'Valor'],
        [
          ['Total de Contatos', kpis.totalContacts],
          ['Leads Novos (no período)', kpis.newLeads],
          ['Contatos Ativos', kpis.activeCount],
          ['Contatos Inativos', kpis.inactiveCount],
          ['Taxa de Conversão (%)', `${kpis.conversionRate.toFixed(1)}%`],
          ['Tempo Médio Conversão (dias)', kpis.avgConversionDays],
          ['Sem Atividade 30d+', kpis.dormant30],
          ['Sem Atividade 60d+', kpis.dormant60],
          ['Pipeline Total', formatBRL(pipeKpis.totalPipelineValue)],
          ['Ticket Médio', formatBRL(pipeKpis.ticketMedio)],
          ['Negócios com Valor', pipeKpis.clientsWithDeal],
          ['FRT Médio', frtKpis.avgFrtHours < 1 ? `${Math.round(frtKpis.avgFrtHours * 60)}min` : `${frtKpis.avgFrtHours.toFixed(1)}h`],
          ['Sem 1º Contato', frtKpis.totalWithoutFrt],
        ],
        tabLabel,
        `Total de contatos: ${kpis.totalContacts}`,
        [40, 24],
      )
      XLSX.utils.book_append_sheet(wb, ws, 'Visão Geral')

      // Value by stage sheet
      const valueByStage = calcValueByStage(filteredClients, filteredStages)
      if (valueByStage.length > 0) {
        const ws2 = buildSheet(
          ['Etapa', 'Valor', 'Negócios'],
          valueByStage.map(s => [s.name, formatBRL(s.value), s.count]),
          'Pipeline por Etapa',
          undefined,
          [28, 24, 16],
        )
        XLSX.utils.book_append_sheet(wb, ws2, 'Pipeline por Etapa')
      }

      // FRT sheet
      if (frtKpis.bySeller.length > 0) {
        const ws3 = buildSheet(
          ['Vendedor', 'FRT Médio', 'Contatos', 'SLA'],
          frtKpis.bySeller.map(s => [
            s.seller,
            s.avgFrtHours < 1 ? `${Math.round(s.avgFrtHours * 60)}min` : `${s.avgFrtHours.toFixed(1)}h`,
            s.contactCount,
            s.slaColor === 'green' ? 'OK' : s.slaColor === 'yellow' ? 'Atenção' : 'Crítico',
          ]),
          'FRT por Vendedor',
          `FRT médio geral: ${frtKpis.avgFrtHours < 1 ? `${Math.round(frtKpis.avgFrtHours * 60)}min` : `${frtKpis.avgFrtHours.toFixed(1)}h`}`,
          [28, 16, 14, 14],
        )
        XLSX.utils.book_append_sheet(wb, ws3, 'FRT')
      }
    } else if (activeTab === 'aging') {
      const { matrix, stageNames } = calcAgingMatrix(filteredClients, filteredStages)
      const kpis = calcOverviewKPIs(filteredClients, new Date(0).toISOString())
      const headers = ['Etapa', ...AGING_BANDS]

      const ws = buildSheet(
        headers,
        stageNames.map(name => [
          name,
          ...AGING_BANDS.map(band => matrix[name]?.[band]?.length || 0),
        ]),
        tabLabel,
        `Sem atividade 30d+: ${kpis.dormant30} | 60d+: ${kpis.dormant60}`,
        [24, 12, 12, 12, 12, 12, 12],
      )
      XLSX.utils.book_append_sheet(wb, ws, 'Aging')
    } else if (activeTab === 'conversion') {
      // Export ALL dimensions, each as a separate sheet
      const allDimensions = Object.keys(DIMENSION_LABELS) as ConversionDimension[]
      for (const dim of allDimensions) {
        const rows = calcConversionByDimension(filteredClients, dim)
        if (rows.length === 0) continue

        const dimLabel = DIMENSION_LABELS[dim]
        const ws = buildSheet(
          [dimLabel, 'Total', 'Convertidos', 'Taxa (%)', 'Tempo Médio (dias)'],
          rows.map(r => [r.dimension, r.total, r.converted, `${r.rate.toFixed(1)}%`, r.avgDays || '—']),
          `Conversão — ${dimLabel}`,
          undefined,
          [28, 12, 16, 14, 20],
        )
        // Sheet name max 31 chars
        const sheetName = dimLabel.length > 31 ? dimLabel.slice(0, 31) : dimLabel
        XLSX.utils.book_append_sheet(wb, ws, sheetName)
      }
    } else if (activeTab === 'profile') {
      const activeClients = filteredClients.filter(c => c.status === 'Ativo')
      // Export ALL profile fields, each as a separate sheet
      for (const pf of PROFILE_FIELDS) {
        const data = calcDistribution(activeClients, pf.field)
        if (data.length === 0) continue

        const ws = buildSheet(
          ['Nome', 'Quantidade', 'Percentual (%)'],
          data.map(d => [d.name, d.value, `${d.percent}%`]),
          pf.label,
          `Total de clientes ativos: ${activeClients.length}`,
          [30, 16, 18],
        )
        const sheetName = pf.label.length > 31 ? pf.label.slice(0, 31) : pf.label
        XLSX.utils.book_append_sheet(wb, ws, sheetName)
      }
    } else if (activeTab === 'opportunities') {
      // Funnel data sheet
      const funnelData = calcFunnelData(filteredClients, filteredStages)
      if (funnelData.length > 0) {
        const ws1 = buildSheet(
          ['Etapa', 'Contatos', 'Conversão (%)', 'Dias Média'],
          funnelData.map((s, i) => [s.name, s.count, i > 0 ? `${s.conversionRate.toFixed(1)}%` : '—', s.avgDays]),
          'Funil de Vendas',
          undefined,
          [28, 14, 18, 16],
        )
        XLSX.utils.book_append_sheet(wb, ws1, 'Funil')
      }

      // Bottlenecks sheet
      const bottlenecks = calcBottleneckStages(filteredClients, filteredStages)
      if (bottlenecks.length > 0) {
        const ws2 = buildSheet(
          ['Etapa', 'Dias Média', 'Máx Dias', 'Contatos', 'Atrasados'],
          bottlenecks.map(b => [b.name, b.avgDays, b.maxDays, b.contactCount, b.overdueCount]),
          'Gargalos',
          undefined,
          [28, 14, 14, 14, 14],
        )
        XLSX.utils.book_append_sheet(wb, ws2, 'Gargalos')
      }

      // Top opportunities sheet
      const items = calcTopOpportunities(filteredClients, filteredStages)
      if (items.length > 0) {
        const ws3 = buildSheet(
          ['Nome', 'Empresa', 'Etapa', 'Probabilidade', 'Dias na Etapa', 'Máx Dias', 'Status'],
          items.slice(0, 50).map(o => [o.name, o.company || '—', o.stage, `${o.probability}%`, o.daysInStage, o.maxDays, o.isOverdue ? 'Atrasado' : 'No prazo']),
          'Top Oportunidades',
          `${items.length} oportunidades quentes identificadas`,
          [28, 24, 20, 16, 16, 14, 14],
        )
        XLSX.utils.book_append_sheet(wb, ws3, 'Oportunidades')
      }
    }

    XLSX.writeFile(wb, `analytics-${activeTab}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [activeTab, filteredClients, filteredStages, periodStart])

  /* ─── Render ─── */
  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-4 md:p-8">
        <LoadingSkeleton />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Análises & Insights</h1>
            <p className="text-sm text-slate-500 mt-1">Dashboards analíticos para tomada de decisão</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
              <ArrowPathIcon className="w-4 h-4" />
              Atualizar
            </button>
            <button onClick={handleExportPDF} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
              <ArrowDownTrayIcon className="w-4 h-4" />
              PDF
            </button>
            <button onClick={handleExportExcel} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-xl hover:bg-primary-100 transition-colors">
              <ArrowDownTrayIcon className="w-4 h-4" />
              Excel
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
            {PERIOD_OPTIONS.map(p => (
              <button key={p.value} onClick={() => setPeriodPreset(p.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${periodPreset === p.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {p.label}
              </button>
            ))}
          </div>

          <select value={selectedFunnel} onChange={e => setSelectedFunnel(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
            <option value="all">Todos os Funis</option>
            {funnelsRef.current.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === tab.id ? 'bg-primary-50 text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div id="analytics-content" className="p-4 md:p-8">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : filteredClients.length === 0 ? (
          <EmptyState
            hasFunnels={funnelsRef.current.length > 0}
            onRetry={loadData}
          />
        ) : (
          <>
            {activeTab === 'overview' && <OverviewTab clients={filteredClients} stages={filteredStages} periodStart={periodStart} />}
            {activeTab === 'aging' && <AgingTab clients={filteredClients} stages={filteredStages} />}
            {activeTab === 'profile' && <ProfileTab clients={filteredClients} />}
            {activeTab === 'opportunities' && <OpportunitiesTab clients={filteredClients} stages={filteredStages} />}
            {activeTab === 'conversion' && <ConversionTab clients={filteredClients} />}
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  LOADING SKELETON                                          */
/* ═══════════════════════════════════════════════════════════ */

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 h-28 border border-slate-100" />
        ))}
      </div>
      <div className="bg-white rounded-2xl p-6 h-80 border border-slate-100" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  ERROR STATE                                                */
/* ═══════════════════════════════════════════════════════════ */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="bg-red-50 rounded-full p-4 mb-4">
        <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">Erro ao carregar dados</h3>
      <p className="text-sm text-slate-500 mb-6 text-center max-w-md">{message}</p>
      <button onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/80 transition-colors">
        <ArrowPathIcon className="w-4 h-4" />
        Tentar novamente
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  EMPTY STATE                                                */
/* ═══════════════════════════════════════════════════════════ */

function EmptyState({ hasFunnels, onRetry }: { hasFunnels: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="bg-slate-100 rounded-full p-4 mb-4">
        <ChartBarIcon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        {hasFunnels ? 'Nenhum contato encontrado' : 'Configure um funil para ver analytics completo'}
      </h3>
      <p className="text-sm text-slate-500 mb-6 text-center max-w-md">
        {hasFunnels
          ? 'Adicione contatos ao CRM para visualizar métricas e insights do funil de vendas.'
          : 'Acesse Configurações > Funis para criar seu primeiro funil de vendas e começar a acompanhar seus contatos.'}
      </p>
      <button onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
        <ArrowPathIcon className="w-4 h-4" />
        Atualizar
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  OVERVIEW TAB                                              */
/* ═══════════════════════════════════════════════════════════ */

function OverviewTab({ clients, stages, periodStart }: { clients: Client[]; stages: FunnelStage[]; periodStart: string }) {
  const kpis = useMemo(() => calcOverviewKPIs(clients, periodStart), [clients, periodStart])
  const pipelineKPIs = useMemo(() => calcPipelineKPIs(clients), [clients])
  const valueByStage = useMemo(() => calcValueByStage(clients, stages), [clients, stages])
  const frtKPIs = useMemo(() => calcFrtKPIs(clients), [clients])
  const temporal = useMemo(() => calcTemporalEvolution(clients, periodStart, new Date().toISOString()), [clients, periodStart])

  const formatBRL = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

  const kpiCards: { label: string; value: string | number; sub?: string; icon: typeof UsersIcon; color: string }[] = [
    { label: 'Total de Contatos', value: kpis.totalContacts, icon: UsersIcon, color: 'text-primary-600 bg-primary-50' },
    { label: 'Leads Novos', value: kpis.newLeads, sub: 'no período', icon: UserPlusIcon, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Contatos Ativos', value: kpis.activeCount, sub: `${kpis.inactiveCount} inativos`, icon: CheckCircleIcon, color: 'text-blue-600 bg-blue-50' },
    { label: 'Taxa de Conversão', value: formatPct(kpis.conversionRate), icon: ArrowTrendingUpIcon, color: 'text-primary-600 bg-primary-50' },
    { label: 'Pipeline Total', value: formatBRL(pipelineKPIs.totalPipelineValue), sub: `${pipelineKPIs.clientsWithDeal} negócios`, icon: CurrencyDollarIcon, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Ticket Médio', value: formatBRL(pipelineKPIs.ticketMedio), sub: pipelineKPIs.clientsWithDeal > 0 ? `de ${pipelineKPIs.clientsWithDeal} contatos` : 'sem dados', icon: CalculatorIcon, color: 'text-amber-600 bg-amber-50' },
  ]

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiCards.map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className={`p-2 rounded-xl ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{typeof card.value === 'number' ? card.value.toLocaleString('pt-BR') : card.value}</p>
            <p className="text-xs text-slate-500 mt-1">{card.label}</p>
            {card.sub && <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Value by Stage Chart */}
      {valueByStage.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Valor do Pipeline por Etapa</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={valueByStage}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={80} tickFormatter={v => formatBRL(v)} />
              <RechartsTooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const val = payload[0].value as number
                const item = valueByStage.find(s => s.name === label)
                return (
                  <div className="bg-slate-800 text-white rounded-lg px-3 py-2 text-xs shadow-lg">
                    <p className="font-medium mb-1">{label}</p>
                    <p className="text-emerald-400">{formatBRL(val)}</p>
                    {item && <p className="text-slate-300">{item.count} negócio{item.count !== 1 ? 's' : ''}</p>}
                  </div>
                )
              }} />
              <Bar dataKey="value" name="Valor" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Temporal Chart */}
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Evolução Temporal</h3>
        {temporal.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">Sem dados no período selecionado</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={temporal}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => {
                const d = new Date(v + 'T00:00:00')
                return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
              }} />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={40} />
              <RechartsTooltip content={<ChartTooltip />} />
              <Legend />
              <Line type="monotone" dataKey="newLeads" name="Novos Leads" stroke="#13DEFC" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="converted" name="Convertidos" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="lost" name="Perdidos" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* FRT by Seller */}
      {frtKPIs.bySeller.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">First Response Time por Vendedor</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {'< 2h'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 2-8h</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {'> 8h'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mb-4 text-sm">
            <span className="text-slate-500">FRT médio geral:</span>
            <span className={`font-bold ${frtKPIs.avgFrtHours <= 2 ? 'text-emerald-600' : frtKPIs.avgFrtHours <= 8 ? 'text-amber-600' : 'text-red-600'}`}>
              {frtKPIs.avgFrtHours < 1 ? `${Math.round(frtKPIs.avgFrtHours * 60)}min` : `${frtKPIs.avgFrtHours.toFixed(1)}h`}
            </span>
            {frtKPIs.totalWithoutFrt > 0 && (
              <span className="text-red-500 text-xs">({frtKPIs.totalWithoutFrt} sem 1º contato)</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={Math.max(200, frtKPIs.bySeller.length * 45)}>
            <BarChart data={frtKPIs.bySeller} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${v}h`} />
              <YAxis type="category" dataKey="seller" tick={{ fontSize: 11 }} stroke="#94a3b8" width={120} />
              <RechartsTooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const data = payload[0].payload as { seller: string; avgFrtHours: number; contactCount: number }
                return (
                  <div className="bg-slate-800 text-white rounded-lg px-3 py-2 text-xs shadow-lg">
                    <p className="font-medium">{data.seller}</p>
                    <p>FRT médio: {data.avgFrtHours < 1 ? `${Math.round(data.avgFrtHours * 60)}min` : `${data.avgFrtHours.toFixed(1)}h`}</p>
                    <p>{data.contactCount} contato{data.contactCount !== 1 ? 's' : ''}</p>
                  </div>
                )
              }} />
              <Bar dataKey="avgFrtHours" name="FRT Médio (h)" radius={[0, 6, 6, 0]}>
                {frtKPIs.bySeller.map((entry, i) => (
                  <Cell key={i} fill={entry.slaColor === 'green' ? '#10b981' : entry.slaColor === 'yellow' ? '#f59e0b' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  AGING TAB                                                 */
/* ═══════════════════════════════════════════════════════════ */

function AgingTab({ clients, stages }: { clients: Client[]; stages: FunnelStage[] }) {
  const [agingView, setAgingView] = useState<'heatmap' | 'creation'>('heatmap')
  const [modalClients, setModalClients] = useState<Client[] | null>(null)
  const [modalTitle, setModalTitle] = useState('')

  const { matrix, stageNames } = useMemo(() => calcAgingMatrix(clients, stages), [clients, stages])
  const kpis = useMemo(() => calcOverviewKPIs(clients, new Date(0).toISOString()), [clients])

  // Aging by creation month
  const creationData = useMemo(() => {
    const grouped = new Map<string, { month: string; Lead: number; Ativo: number; Inativo: number; Outro: number }>()
    for (const c of clients) {
      const created = c.createdAt as string | undefined
      if (!created) continue
      const month = created.slice(0, 7)
      if (!grouped.has(month)) grouped.set(month, { month, Lead: 0, Ativo: 0, Inativo: 0, Outro: 0 })
      const g = grouped.get(month)!
      const status = c.status as string | undefined
      if (status === 'Ativo') g.Ativo++
      else if (status === 'Inativo' || status === 'Inatividade longa') g.Inativo++
      else if (status === 'Lead' || status === 'Lead-qualificado') g.Lead++
      else g.Outro++
    }
    return Array.from(grouped.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12)
  }, [clients])

  const handleCellClick = (stageName: string, band: AgingBand) => {
    const list = matrix[stageName]?.[band] || []
    if (list.length === 0) return
    setModalClients(list as Client[])
    setModalTitle(`${stageName} — ${band}`)
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{kpis.dormant30} contatos sem atividade há 30+ dias</p>
            <p className="text-xs text-amber-600 mt-1">Podem estar esfriando no funil</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">{kpis.dormant60} contatos sem atividade há 60+ dias</p>
            <p className="text-xs text-red-600 mt-1">Risco alto de perda</p>
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex bg-slate-100 rounded-lg p-1 gap-1 w-fit">
        <button onClick={() => setAgingView('heatmap')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${agingView === 'heatmap' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Heatmap por Etapa
        </button>
        <button onClick={() => setAgingView('creation')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${agingView === 'creation' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Por Data de Criação
        </button>
      </div>

      {agingView === 'heatmap' ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left p-4 font-semibold text-slate-600">Etapa</th>
                {AGING_BANDS.map(band => (
                  <th key={band} className="p-4 text-center font-semibold text-slate-600">{band}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stageNames.map(name => (
                <tr key={name} className="border-b border-slate-50">
                  <td className="p-4 font-medium text-slate-700">{name}</td>
                  {AGING_BANDS.map(band => {
                    const count = matrix[name]?.[band]?.length || 0
                    return (
                      <td key={band} className="p-2 text-center">
                        <button
                          onClick={() => handleCellClick(name, band)}
                          disabled={count === 0}
                          className={`w-full py-2 px-3 rounded-lg text-sm font-semibold transition-all ${count > 0 ? `${AGING_COLORS[band]} cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-primary-300` : 'text-slate-300'}`}>
                          {count || '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Leads por Mês de Criação × Status Atual</h3>
          {creationData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-12">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={creationData}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={40} />
                <RechartsTooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="Lead" name="Lead" stackId="a" fill="#3CD4F5" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Ativo" name="Ativo" stackId="a" fill="#10b981" />
                <Bar dataKey="Inativo" name="Inativo" stackId="a" fill="#ef4444" />
                <Bar dataKey="Outro" name="Outro" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Modal */}
      {modalClients && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalClients(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">{modalTitle} ({modalClients.length})</h3>
              <button onClick={() => setModalClients(null)} className="p-1 rounded-lg hover:bg-slate-100">
                <XMarkIcon className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="space-y-2">
              {modalClients.slice(0, 50).map(c => (
                <a key={c.id} href={`/contatos/${c.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 border border-slate-100 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{c.name as string || 'Sem nome'}</p>
                    <p className="text-xs text-slate-400">{c.company as string || ''}</p>
                  </div>
                  <span className="text-xs text-slate-500">{c.status as string || '—'}</span>
                </a>
              ))}
              {modalClients.length > 50 && (
                <p className="text-xs text-slate-400 text-center pt-2">E mais {modalClients.length - 50} contatos...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  PROFILE TAB                                               */
/* ═══════════════════════════════════════════════════════════ */

function ProfileTab({ clients }: { clients: Client[] }) {
  const [compareMode, setCompareMode] = useState(false)

  const activeClients = useMemo(() => clients.filter(c => c.status === 'Ativo'), [clients])
  const pipelineClients = useMemo(() => clients.filter(c => c.status !== 'Ativo'), [clients])

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600 font-medium">Comparar com pipeline</span>
        <button onClick={() => setCompareMode(!compareMode)}
          className={`relative w-11 h-6 rounded-full transition-colors ${compareMode ? 'bg-primary-500' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${compareMode ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {PROFILE_FIELDS.map(pf => (
          <ProfileChart
            key={pf.field}
            field={pf.field}
            label={pf.label}
            type={pf.type}
            activeClients={activeClients}
            pipelineClients={pipelineClients}
            compareMode={compareMode}
          />
        ))}
      </div>
    </div>
  )
}

function ProfileChart({ field, label, type, activeClients, pipelineClients, compareMode }: {
  field: string; label: string; type: 'pie' | 'bar'; activeClients: Client[]; pipelineClients: Client[]; compareMode: boolean
}) {
  const activeData = useMemo(() => calcDistribution(activeClients, field).slice(0, 10), [activeClients, field])
  const pipelineData = useMemo(() => calcDistribution(pipelineClients, field).slice(0, 10), [pipelineClients, field])

  if (type === 'pie') {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">{label}</h3>
        <div className={`${compareMode ? 'grid grid-cols-2 gap-4' : ''}`}>
          <div>
            {compareMode && <p className="text-xs text-slate-400 mb-2 text-center">Clientes Ativos</p>}
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={activeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {activeData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <RechartsTooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {compareMode && (
            <div>
              <p className="text-xs text-slate-400 mb-2 text-center">Pipeline</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pipelineData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {pipelineData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-3">
          {activeData.map((d, i) => (
            <span key={d.name} className="inline-flex items-center gap-1 text-xs text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              {d.name} ({d.percent}%)
            </span>
          ))}
        </div>
      </div>
    )
  }

  // Horizontal bar chart
  const barData = compareMode
    ? activeData.map((d, i) => ({ name: d.name, Ativos: d.value, Pipeline: pipelineData[i]?.value || 0 }))
    : activeData.map(d => ({ name: d.name, value: d.value }))

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{label}</h3>
      {barData.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-12">Sem dados</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 36)}>
          <BarChart data={barData} layout="vertical" margin={{ left: 0 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="#94a3b8" width={120} />
            <RechartsTooltip content={<ChartTooltip />} />
            {compareMode ? (
              <>
                <Bar dataKey="Ativos" fill="#06B3D4" radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey="Pipeline" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={14} />
                <Legend />
              </>
            ) : (
              <Bar dataKey="value" name="Quantidade" fill="#06B3D4" radius={[0, 4, 4, 0]} barSize={18} />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  OPPORTUNITIES TAB                                         */
/* ═══════════════════════════════════════════════════════════ */

function OpportunitiesTab({ clients, stages }: { clients: Client[]; stages: FunnelStage[] }) {
  const funnelData = useMemo(() => calcFunnelData(clients, stages), [clients, stages])
  const topOpps = useMemo(() => calcTopOpportunities(clients, stages).slice(0, 20), [clients, stages])
  const bottlenecks = useMemo(() => calcBottleneckStages(clients, stages), [clients, stages])

  return (
    <div className="space-y-6">
      {/* Funnel visual */}
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Funil de Vendas</h3>
        {funnelData.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Nenhuma etapa configurada</p>
        ) : (
          <div className="space-y-3">
            {funnelData.map((stage, i) => {
              const maxCount = Math.max(...funnelData.map(s => s.count), 1)
              const width = Math.max(20, (stage.count / maxCount) * 100)
              return (
                <div key={stage.name} className="flex items-center gap-4">
                  <div className="w-32 shrink-0 text-right">
                    <p className="text-sm font-medium text-slate-700">{stage.name}</p>
                    <p className="text-xs text-slate-400">{stage.avgDays}d média</p>
                  </div>
                  <div className="flex-1 relative">
                    <div className="h-10 rounded-lg overflow-hidden bg-slate-50">
                      <div className="h-full rounded-lg flex items-center px-3 transition-all" style={{ width: `${width}%`, backgroundColor: stage.color }}>
                        <span className="text-white text-sm font-semibold drop-shadow">{stage.count}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right">
                    {i > 0 && (
                      <span className="text-xs font-medium text-slate-500">{formatPct(stage.conversionRate)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bottlenecks */}
      {bottlenecks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bottlenecks.map(bn => (
            <div key={bn.name} className="bg-red-50 border border-red-200 rounded-2xl p-5">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Gargalo: {bn.name}</p>
                  <p className="text-xs text-red-600 mt-1">{bn.overdueCount} de {bn.contactCount} contatos estão há mais de {bn.maxDays} dias</p>
                  <p className="text-xs text-red-500 mt-0.5">Média: {bn.avgDays}d (máx: {bn.maxDays}d)</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Opportunities */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Top Oportunidades Quentes</h3>
          <p className="text-xs text-slate-400 mt-1">Contatos em etapas com probabilidade &gt;50%, ordenados por urgência</p>
        </div>
        {topOpps.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Nenhuma oportunidade quente no momento</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-left p-3 font-medium">Nome</th>
                  <th className="text-left p-3 font-medium">Empresa</th>
                  <th className="text-left p-3 font-medium">Etapa</th>
                  <th className="text-center p-3 font-medium">Prob.</th>
                  <th className="text-center p-3 font-medium">Dias</th>
                  <th className="text-center p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {topOpps.map(opp => (
                  <tr key={opp.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="p-3">
                      <a href={`/contatos/${opp.id}`} className="text-primary-600 hover:text-primary-800 font-medium">{opp.name}</a>
                    </td>
                    <td className="p-3 text-slate-600">{opp.company || '—'}</td>
                    <td className="p-3 text-slate-600">{opp.stage}</td>
                    <td className="p-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">{opp.probability}%</span>
                    </td>
                    <td className="p-3 text-center text-slate-600">{opp.daysInStage}d</td>
                    <td className="p-3 text-center">
                      {opp.isOverdue ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">Atrasado</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">No prazo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  CONVERSION TAB                                            */
/* ═══════════════════════════════════════════════════════════ */

function ConversionTab({ clients }: { clients: Client[] }) {
  const [dimension, setDimension] = useState<ConversionDimension>('leadSource')
  const [drillDimValue, setDrillDimValue] = useState<string | null>(null)

  const rows = useMemo(() => calcConversionByDimension(clients, dimension), [clients, dimension])

  const chartData = useMemo(() =>
    rows.slice(0, 15).map(r => ({ name: r.dimension, Total: r.total, Convertidos: r.converted, rate: r.rate })),
    [rows]
  )

  // Drill-down: clients for selected dimension value
  const drillClients = useMemo(() => {
    if (!drillDimValue) return []
    return clients.filter(c => {
      const val = (c[dimension] as string) || 'Não informado'
      return val === drillDimValue
    })
  }, [clients, dimension, drillDimValue])

  const drillStageDistribution = useMemo(() => {
    if (drillClients.length === 0) return []
    return calcDistribution(drillClients, 'funnelStage').slice(0, 10)
  }, [drillClients])

  return (
    <div className="space-y-6">
      {/* Dimension Selector */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DIMENSION_LABELS) as ConversionDimension[]).map(dim => (
          <button key={dim} onClick={() => { setDimension(dim); setDrillDimValue(null) }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dimension === dim ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
            {DIMENSION_LABELS[dim]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Conversão por {DIMENSION_LABELS[dimension]}</h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">Sem dados para esta dimensão</p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} angle={-30} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={40} />
              <RechartsTooltip content={<ChartTooltip />} />
              <Legend />
              <Bar dataKey="Total" name="Total" fill="#c7d2fe" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data) => { if (data?.name) setDrillDimValue(data.name as string) }} />
              <Bar dataKey="Convertidos" name="Convertidos" fill="#06B3D4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Detalhamento por {DIMENSION_LABELS[dimension]}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="text-left p-3 font-medium">{DIMENSION_LABELS[dimension]}</th>
                <th className="text-center p-3 font-medium">Total</th>
                <th className="text-center p-3 font-medium">Convertidos</th>
                <th className="text-center p-3 font-medium">Taxa (%)</th>
                <th className="text-center p-3 font-medium">Tempo Médio (dias)</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.dimension} className={`border-b border-slate-50 hover:bg-slate-50/50 ${drillDimValue === r.dimension ? 'bg-primary-50/30' : ''}`}>
                  <td className="p-3 font-medium text-slate-700">{r.dimension}</td>
                  <td className="p-3 text-center text-slate-600">{r.total}</td>
                  <td className="p-3 text-center text-slate-600">{r.converted}</td>
                  <td className="p-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.rate >= 20 ? 'bg-emerald-50 text-emerald-700' : r.rate >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {formatPct(r.rate)}
                    </span>
                  </td>
                  <td className="p-3 text-center text-slate-600">{r.avgDays || '—'}</td>
                  <td className="p-3">
                    <button onClick={() => setDrillDimValue(drillDimValue === r.dimension ? null : r.dimension)}
                      className="text-primary-600 hover:text-primary-800 text-xs font-medium">
                      {drillDimValue === r.dimension ? 'Fechar' : 'Detalhar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down panel */}
      {drillDimValue && drillClients.length > 0 && (
        <div className="bg-white rounded-2xl border border-primary-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-primary-100 bg-primary-50/30 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-primary-900">Drill-down: {drillDimValue}</h3>
              <p className="text-xs text-primary-600 mt-0.5">{drillClients.length} contatos</p>
            </div>
            <button onClick={() => setDrillDimValue(null)} className="p-1 rounded-lg hover:bg-primary-100">
              <XMarkIcon className="w-5 h-5 text-primary-500" />
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Mini funnel */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Distribuição por Etapa</h4>
              {drillStageDistribution.length === 0 ? (
                <p className="text-xs text-slate-400">Sem dados de etapa</p>
              ) : (
                <div className="space-y-2">
                  {drillStageDistribution.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-24 text-xs text-slate-600 truncate">{d.name}</div>
                      <div className="flex-1 h-5 bg-slate-50 rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${d.percent}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <span className="text-xs text-slate-500 w-12 text-right">{d.value} ({d.percent}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Contact list */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Contatos</h4>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {drillClients.slice(0, 30).map(c => (
                  <a key={c.id} href={`/contatos/${c.id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-xs">
                    <span className="text-slate-700 font-medium">{c.name as string || 'Sem nome'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${c.status === 'Ativo' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {c.status as string || '—'}
                    </span>
                  </a>
                ))}
                {drillClients.length > 30 && (
                  <p className="text-xs text-slate-400 text-center pt-1">E mais {drillClients.length - 30}...</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
