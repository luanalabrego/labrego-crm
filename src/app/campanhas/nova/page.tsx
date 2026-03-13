'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore'
import PlanGate from '@/components/PlanGate'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false })
import { formatDate } from '@/lib/format'
import { leadSourceOptions, leadTypeOptions } from '@/lib/leadSources'
import {
  type CampaignFilters,
  type CampaignType,
  type RecurrenceFrequency,
  CAMPAIGN_TYPE_LABELS,
  RECURRENCE_LABELS,
  TEMPLATE_VARIABLES,
  replaceVariables,
  emptyCampaignFilters,
} from '@/types/campaign'
import type { SavedSegment } from '@/types/campaign'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
  TrashIcon,
  EyeIcon,
  PencilIcon,
  PaperAirplaneIcon,
  ClockIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'

/* ================================= Types ================================= */

type Cliente = {
  id: string
  name: string
  email?: string
  phone?: string
  company?: string
  industry?: string
  leadSource?: string
  leadType?: string
  status?: string
  funnelStage?: string
  assignedTo?: string
  assignedToName?: string
  createdAt?: string
  lastFollowUpAt?: string
  porte_empresa?: string
  estado?: string
  municipio?: string
  tipo?: string
  natureza_juridica?: string
  capital_social?: string | number
}

type Funnel = { id: string; name: string }
type FunnelStage = { id: string; name: string; funnelId?: string; order: number; color?: string }
type OrgMember = { id: string; displayName: string; email: string }

/* ================================= Constants ================================= */

const STEPS = ['Segmentação', 'Composição', 'Envio'] as const

const STATUS_OPTIONS = [
  { value: 'Lead', label: 'Lead' },
  { value: 'Lead-qualificado', label: 'Lead qualificado' },
  { value: 'Ativo', label: 'Ativo' },
  { value: 'Inativo', label: 'Inativo' },
  { value: 'Inatividade longa', label: 'Inatividade longa' },
]

/* ================================= Component ================================= */

function NovasCampanhasContent() {
  const router = useRouter()
  const { orgId, member } = useCrmUser()

  /* ----------------------------- Wizard State -------------------------------- */

  const [currentStep, setCurrentStep] = useState(0)

  /* ------------------- Step 1: Segmentation State ---------------------- */

  const [filters, setFilters] = useState<CampaignFilters>(emptyCampaignFilters())
  const [clients, setClients] = useState<Cliente[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Reference data
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([])

  // Segment modal
  const [showSaveSegment, setShowSaveSegment] = useState(false)
  const [segmentName, setSegmentName] = useState('')
  const [savingSegment, setSavingSegment] = useState(false)

  /* ------------------- Step 2: Composition State ----------------------- */

  const [campaignName, setCampaignName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  /* ------------------- Step 3: Send/Schedule State --------------------- */

  const [sendType, setSendType] = useState<CampaignType>('immediate')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency>('weekly')
  const [recurrenceDayOfWeek, setRecurrenceDayOfWeek] = useState(1)
  const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState(1)
  const [recurrenceTime, setRecurrenceTime] = useState('09:00')
  const [recurrenceStartDate, setRecurrenceStartDate] = useState('')
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /* ==================== Load Reference Data ==================== */

  useEffect(() => {
    if (!orgId) return

    // Load funnels
    const unsubFunnels = onSnapshot(
      collection(db, 'organizations', orgId, 'funnels'),
      (snap) => setFunnels(snap.docs.map((d) => ({ id: d.id, name: (d.data() as { name: string }).name }))),
      (err) => { console.error('Funnels listener error:', err) },
    )

    // Load stages
    const unsubStages = onSnapshot(
      query(collection(db, 'funnelStages'), where('orgId', '==', orgId)),
      (snap) =>
        setStages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FunnelStage, 'id'>) }))
        ),
      (err) => { console.error('Stages listener error:', err) },
    )

    // Load members
    const unsubMembers = onSnapshot(
      collection(db, 'organizations', orgId, 'members'),
      (snap) =>
        setMembers(
          snap.docs.map((d) => ({
            id: d.id,
            displayName: (d.data() as OrgMember).displayName,
            email: (d.data() as OrgMember).email,
          })),
        ),
      (err) => { console.error('Members listener error:', err) },
    )

    // Load saved segments
    const unsubSegments = onSnapshot(
      collection(db, 'organizations', orgId, 'savedSegments'),
      (snap) =>
        setSavedSegments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedSegment, 'id'>) }))),
      (err) => { console.error('Segments listener error:', err) },
    )

    return () => {
      unsubFunnels()
      unsubStages()
      unsubMembers()
      unsubSegments()
    }
  }, [orgId])

  /* ==================== Load Clients Based on Filters ==================== */

  useEffect(() => {
    if (!orgId) return
    setLoadingClients(true)

    // Base query — all clients for this org
    const baseQuery = query(collection(db, 'clients'), where('orgId', '==', orgId))

    const unsub = onSnapshot(
      baseQuery,
      (snap) => {
        let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, 'id'>) }))

        // Client-side filtering (Firestore has limited composite query support)
        if (filters.funnelId) {
          const stageIdsForFunnel = stages.filter((s) => s.funnelId === filters.funnelId).map((s) => s.id)
          items = items.filter((c) => c.funnelStage && stageIdsForFunnel.includes(c.funnelStage))
        }

        if (filters.stageIds?.length) {
          items = items.filter((c) => c.funnelStage && filters.stageIds!.includes(c.funnelStage))
        }

        if (filters.status?.length) {
          items = items.filter((c) => c.status && filters.status!.includes(c.status))
        }

        if (filters.leadSource?.length) {
          items = items.filter((c) => c.leadSource && filters.leadSource!.includes(c.leadSource))
        }

        if (filters.leadType?.length) {
          items = items.filter((c) => c.leadType && filters.leadType!.includes(c.leadType))
        }

        if (filters.industry) {
          const ind = filters.industry.toLowerCase()
          items = items.filter((c) => c.industry?.toLowerCase().includes(ind))
        }

        if (filters.company) {
          const comp = filters.company.toLowerCase()
          items = items.filter((c) => c.company?.toLowerCase().includes(comp))
        }

        if (filters.porteEmpresa?.length) {
          items = items.filter((c) => c.porte_empresa && filters.porteEmpresa!.includes(c.porte_empresa))
        }

        if (filters.estado?.length) {
          items = items.filter((c) => c.estado && filters.estado!.includes(c.estado))
        }

        if (filters.municipio?.length) {
          items = items.filter((c) => c.municipio && filters.municipio!.includes(c.municipio))
        }

        if (filters.tipo?.length) {
          items = items.filter((c) => c.tipo && filters.tipo!.includes(c.tipo))
        }

        if (filters.naturezaJuridica?.length) {
          items = items.filter((c) => c.natureza_juridica && filters.naturezaJuridica!.includes(c.natureza_juridica))
        }

        if (filters.capitalSocialMin != null) {
          items = items.filter((c) => {
            const val = typeof c.capital_social === 'string' ? parseFloat(c.capital_social) : c.capital_social
            return val != null && val >= filters.capitalSocialMin!
          })
        }

        if (filters.capitalSocialMax != null) {
          items = items.filter((c) => {
            const val = typeof c.capital_social === 'string' ? parseFloat(c.capital_social) : c.capital_social
            return val != null && val <= filters.capitalSocialMax!
          })
        }

        if (filters.daysSinceLastContact) {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - filters.daysSinceLastContact)
          const cutoffStr = cutoff.toISOString()
          items = items.filter((c) => !c.lastFollowUpAt || c.lastFollowUpAt < cutoffStr)
        }

        if (filters.daysSinceLastActivity) {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - filters.daysSinceLastActivity)
          const cutoffStr = cutoff.toISOString()
          items = items.filter((c) => !c.lastFollowUpAt || c.lastFollowUpAt < cutoffStr)
        }

        if (filters.assignedTo) {
          items = items.filter((c) => c.assignedTo === filters.assignedTo)
        }

        if (filters.createdAfter) {
          items = items.filter((c) => c.createdAt && c.createdAt >= filters.createdAfter!)
        }

        if (filters.createdBefore) {
          items = items.filter((c) => c.createdAt && c.createdAt <= filters.createdBefore!)
        }

        if (filters.hasEmail) {
          // Don't filter them out, but they can't be selected
        }

        setClients(items)
        setLoadingClients(false)
      },
      (error) => {
        console.error('Error loading clients:', error)
        toast.error('Erro ao carregar contatos')
        setLoadingClients(false)
      },
    )

    return () => unsub()
  }, [orgId, filters, stages])

  /* ==================== Derived State ==================== */

  const selectableClients = useMemo(
    () => clients.filter((c) => c.email && c.email.trim() !== ''),
    [clients],
  )

  const selectedClients = useMemo(
    () => clients.filter((c) => selectedIds.has(c.id)),
    [clients, selectedIds],
  )

  const filteredStages = useMemo(
    () => (filters.funnelId ? stages.filter((s) => s.funnelId === filters.funnelId) : stages),
    [stages, filters.funnelId],
  )

  const previewContact = selectedClients[0] || selectableClients[0]

  /* ==================== Handlers ==================== */

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === selectableClients.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableClients.map((c) => c.id)))
    }
  }, [selectedIds.size, selectableClients])

  const updateFilter = useCallback(<K extends keyof CampaignFilters>(key: K, value: CampaignFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setSelectedIds(new Set())
  }, [])

  const toggleArrayFilter = useCallback((key: keyof CampaignFilters, value: string) => {
    setFilters((prev) => {
      const arr = (prev[key] as string[] | undefined) || []
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
      return { ...prev, [key]: next.length > 0 ? next : undefined }
    })
    setSelectedIds(new Set())
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(emptyCampaignFilters())
    setSelectedIds(new Set())
  }, [])

  const loadSegment = useCallback((seg: SavedSegment) => {
    setFilters(seg.filters)
    setSelectedIds(new Set())
    toast.success(`Segmento "${seg.name}" carregado`)
  }, [])

  const handleSaveSegment = useCallback(async () => {
    if (!orgId || !segmentName.trim()) return
    setSavingSegment(true)
    try {
      await addDoc(collection(db, 'organizations', orgId, 'savedSegments'), {
        orgId,
        name: segmentName.trim(),
        filters,
        createdBy: member?.userId || '',
        createdAt: new Date().toISOString(),
      })
      toast.success('Segmento salvo!')
      setShowSaveSegment(false)
      setSegmentName('')
    } catch (error) {
      console.error('Error saving segment:', error)
      toast.error('Erro ao salvar segmento')
    }
    setSavingSegment(false)
  }, [orgId, segmentName, filters, member])

  const handleDeleteSegment = useCallback(
    async (segId: string) => {
      if (!orgId) return
      try {
        await deleteDoc(doc(db, 'organizations', orgId, 'savedSegments', segId))
        toast.success('Segmento removido')
      } catch (error) {
        console.error('Error deleting segment:', error)
        toast.error('Erro ao remover segmento')
      }
    },
    [orgId],
  )

  const insertVariable = useCallback((varKey: string) => {
    setBody((prev) => prev + varKey)
  }, [])

  /* ==================== Submit ==================== */

  const handleSubmit = useCallback(async () => {
    if (!orgId || selectedIds.size === 0) return
    setSubmitting(true)

    try {
      const recipients = selectedClients
        .filter((c) => c.email)
        .map((c) => ({
          clientId: c.id,
          name: c.name,
          email: c.email!,
          company: c.company || '',
        }))

      // Build campaign data
      const now = new Date().toISOString()
      const campaignData: Record<string, unknown> = {
        orgId,
        name: campaignName,
        subject,
        body,
        bodyPlainText: body.replace(/<[^>]*>/g, ''),
        status: sendType === 'immediate' ? 'sending' : 'scheduled',
        type: sendType,
        filters,
        totalRecipients: recipients.length,
        sentCount: 0,
        failedCount: 0,
        createdBy: member?.userId || '',
        createdByName: member?.displayName || '',
        createdAt: now,
        updatedAt: now,
      }

      if (sendType === 'scheduled') {
        campaignData.scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
      }

      if (sendType === 'recurring') {
        const startDate = recurrenceStartDate || new Date().toISOString().split('T')[0]
        campaignData.recurrence = {
          frequency: recurrenceFreq,
          dayOfWeek: recurrenceDayOfWeek,
          dayOfMonth: recurrenceDayOfMonth,
          timeOfDay: recurrenceTime,
          startDate,
          endDate: recurrenceEndDate || null,
          nextRunAt: new Date(`${startDate}T${recurrenceTime}:00`).toISOString(),
        }
        campaignData.scheduledAt = campaignData.recurrence ? (campaignData.recurrence as Record<string, unknown>).nextRunAt : ''
      }

      // Create campaign
      const campaignRef = await addDoc(
        collection(db, 'organizations', orgId, 'campaigns'),
        campaignData,
      )

      // Add recipients in batches
      const recipientsRef = collection(
        db,
        'organizations',
        orgId,
        'campaigns',
        campaignRef.id,
        'recipients',
      )

      for (const r of recipients) {
        await addDoc(recipientsRef, {
          clientId: r.clientId,
          name: r.name,
          email: r.email,
          company: r.company,
          status: 'pending',
          sentAt: '',
          error: '',
        })
      }

      // For immediate send, trigger the API
      if (sendType === 'immediate') {
        fetch('/api/campaigns/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: campaignRef.id, orgId }),
        }).catch((err) => console.error('Failed to trigger send:', err))
      }

      toast.success(
        sendType === 'immediate'
          ? 'Campanha criada! Envio em andamento...'
          : 'Campanha agendada com sucesso!',
      )
      router.push(`/campanhas/${campaignRef.id}`)
    } catch (error) {
      console.error('Error creating campaign:', error)
      toast.error('Erro ao criar campanha')
    }
    setSubmitting(false)
  }, [
    orgId,
    selectedIds,
    selectedClients,
    campaignName,
    subject,
    body,
    filters,
    sendType,
    scheduledDate,
    scheduledTime,
    recurrenceFreq,
    recurrenceDayOfWeek,
    recurrenceDayOfMonth,
    recurrenceTime,
    recurrenceStartDate,
    recurrenceEndDate,
    member,
    router,
  ])

  /* ==================== Step Validation ==================== */

  const canProceed = useMemo(() => {
    if (currentStep === 0) return selectedIds.size > 0
    if (currentStep === 1) return campaignName.trim() !== '' && subject.trim() !== '' && body.trim() !== ''
    if (currentStep === 2) {
      if (sendType === 'scheduled') return scheduledDate !== '' && scheduledTime !== ''
      if (sendType === 'recurring') return recurrenceTime !== ''
      return true
    }
    return true
  }, [currentStep, selectedIds.size, campaignName, subject, body, sendType, scheduledDate, scheduledTime, recurrenceTime])

  /* ================================= Render ================================= */

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/campanhas')}
          className="rounded-lg p-2 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeftIcon className="h-5 w-5 text-slate-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nova Campanha</h1>
          <p className="text-sm text-slate-500">Segmente, compose e dispare</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                i === currentStep
                  ? 'bg-primary-600 text-white'
                  : i < currentStep
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i < currentStep ? <CheckIcon className="h-4 w-4" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{step}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-8 bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* ==================== Step 1: Segmentation ==================== */}
      {currentStep === 0 && (
        <div className="space-y-4">
          {/* Saved segments */}
          {savedSegments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Segmentos salvos:</span>
              {savedSegments.map((seg) => (
                <div key={seg.id} className="flex items-center gap-1">
                  <button
                    onClick={() => loadSegment(seg)}
                    className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                  >
                    {seg.name}
                  </button>
                  <button
                    onClick={() => handleDeleteSegment(seg.id)}
                    className="rounded-full p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Filters grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Filtros de Segmentação</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSaveSegment(true)}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
                >
                  <BookmarkIcon className="h-3.5 w-3.5" />
                  Salvar segmento
                </button>
                <button
                  onClick={clearFilters}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Funnel */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Funil</label>
                <select
                  value={filters.funnelId || ''}
                  onChange={(e) => {
                    updateFilter('funnelId', e.target.value || undefined)
                    updateFilter('stageIds', undefined)
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Todos os funis</option>
                  {funnels.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Stages (multi-select via chips) */}
              {filteredStages.length > 0 && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Etapas</label>
                  <div className="flex flex-wrap gap-1">
                    {filteredStages
                      .sort((a, b) => a.order - b.order)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => toggleArrayFilter('stageIds', s.id)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            filters.stageIds?.includes(s.id)
                              ? 'bg-primary-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status do contato</label>
                <div className="flex flex-wrap gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleArrayFilter('status', opt.value)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        filters.status?.includes(opt.value)
                          ? 'bg-primary-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lead Source */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Origem do lead</label>
                <div className="flex flex-wrap gap-1">
                  {leadSourceOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleArrayFilter('leadSource', opt.value)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        filters.leadSource?.includes(opt.value)
                          ? 'bg-primary-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lead Type */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de lead</label>
                <div className="flex flex-wrap gap-1">
                  {leadTypeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleArrayFilter('leadType', opt.value)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        filters.leadType?.includes(opt.value)
                          ? 'bg-primary-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Industry */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Segmento</label>
                <input
                  type="text"
                  value={filters.industry || ''}
                  onChange={(e) => updateFilter('industry', e.target.value || undefined)}
                  placeholder="Ex: Tecnologia, Saúde..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Company */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Empresa</label>
                <input
                  type="text"
                  value={filters.company || ''}
                  onChange={(e) => updateFilter('company', e.target.value || undefined)}
                  placeholder="Nome da empresa..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Assigned To */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Responsável</label>
                <select
                  value={filters.assignedTo || ''}
                  onChange={(e) => updateFilter('assignedTo', e.target.value || undefined)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Todos</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName}</option>
                  ))}
                </select>
              </div>

              {/* Estado */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
                <input
                  type="text"
                  value={filters.estado?.join(', ') || ''}
                  onChange={(e) => {
                    const vals = e.target.value.split(',').map((v) => v.trim()).filter(Boolean)
                    updateFilter('estado', vals.length > 0 ? vals : undefined)
                  }}
                  placeholder="SP, RJ, MG..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Município */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Município</label>
                <input
                  type="text"
                  value={filters.municipio?.join(', ') || ''}
                  onChange={(e) => {
                    const vals = e.target.value.split(',').map((v) => v.trim()).filter(Boolean)
                    updateFilter('municipio', vals.length > 0 ? vals : undefined)
                  }}
                  placeholder="São Paulo, Rio..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Capital Social Range */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Capital social</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={filters.capitalSocialMin ?? ''}
                    onChange={(e) => updateFilter('capitalSocialMin', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="Mín"
                    className="w-1/2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    value={filters.capitalSocialMax ?? ''}
                    onChange={(e) => updateFilter('capitalSocialMax', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="Máx"
                    className="w-1/2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Days since last contact */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Sem contato há (dias)</label>
                <input
                  type="number"
                  value={filters.daysSinceLastContact ?? ''}
                  onChange={(e) => updateFilter('daysSinceLastContact', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Ex: 30"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              {/* Created date range */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Criado entre</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={filters.createdAfter || ''}
                    onChange={(e) => updateFilter('createdAfter', e.target.value || undefined)}
                    className="w-1/2 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={filters.createdBefore || ''}
                    onChange={(e) => updateFilter('createdBefore', e.target.value || undefined)}
                    className="w-1/2 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Has email */}
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="hasEmail"
                  checked={filters.hasEmail}
                  onChange={(e) => updateFilter('hasEmail', e.target.checked)}
                  className="rounded border-slate-300 text-primary-600"
                />
                <label htmlFor="hasEmail" className="text-xs font-medium text-slate-600">
                  Apenas com email preenchido
                </label>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700">
                  {clients.length} contatos encontrados
                </span>
                <span className="text-xs text-primary-600 font-medium">
                  {selectedIds.size} selecionados
                </span>
              </div>
              <button
                onClick={toggleSelectAll}
                className="text-xs font-medium text-primary-600 hover:text-primary-800"
              >
                {selectedIds.size === selectableClients.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            {loadingClients ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary-200 border-t-primary-600" />
              </div>
            ) : clients.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                Nenhum contato encontrado com os filtros selecionados
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === selectableClients.length && selectableClients.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-slate-300 text-primary-600"
                        />
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Nome</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 hidden lg:table-cell">Empresa</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 hidden lg:table-cell">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {clients.map((c) => {
                      const hasEmail = c.email && c.email.trim() !== ''
                      return (
                        <tr key={c.id} className={`${!hasEmail ? 'opacity-50' : 'hover:bg-slate-50'}`}>
                          <td className="px-4 py-2">
                            {hasEmail ? (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(c.id)}
                                onChange={() => toggleSelect(c.id)}
                                className="rounded border-slate-300 text-primary-600"
                              />
                            ) : (
                              <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" title="Sem email" />
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm text-slate-900">{c.name}</td>
                          <td className="px-4 py-2 text-sm text-slate-500">
                            {hasEmail ? c.email : <span className="text-amber-500 italic">Sem email</span>}
                          </td>
                          <td className="px-4 py-2 text-sm text-slate-500 hidden lg:table-cell">{c.company || '—'}</td>
                          <td className="px-4 py-2 text-sm text-slate-500 hidden lg:table-cell">{c.leadSource || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== Step 2: Composition ==================== */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            {/* Campaign Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome da campanha</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Ex: Nutrição de leads Q1 2026"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assunto do email</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, 150))}
                placeholder="Assunto do email..."
                maxLength={150}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">{subject.length}/150</p>
            </div>

            {/* Variables */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-500">Inserir variável:</span>
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVariable(v.key)}
                  className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  {v.key}
                </button>
              ))}
            </div>

            {/* Body editor / Preview toggle */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setShowPreview(false)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  !showPreview ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <PencilIcon className="h-3.5 w-3.5" />
                Editar
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  showPreview ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <EyeIcon className="h-3.5 w-3.5" />
                Preview
              </button>
              <Link
                href="/campanhas/editor"
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors ml-auto"
              >
                Editor Visual
              </Link>
            </div>

            {!showPreview ? (
              <div>
                <RichTextEditor
                  value={body}
                  onChange={(html) => setBody(html)}
                  placeholder="Escreva o corpo do email aqui... Use variáveis como {{nome}} e {{empresa}} para personalizar."
                />
                <p className="text-xs text-slate-400 mt-1">
                  Use a toolbar para formatar. Variáveis serão substituídas para cada destinatário.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 p-6 bg-slate-50 min-h-[200px]">
                <p className="text-xs text-slate-400 mb-3">
                  Preview com dados de: <strong>{previewContact?.name || 'Contato'}</strong>
                </p>
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <p className="text-sm font-medium text-slate-700 mb-2">
                    Assunto: {previewContact ? replaceVariables(subject, previewContact as Record<string, unknown>) : subject}
                  </p>
                  <hr className="mb-3" />
                  <div
                    className="text-sm text-slate-600 whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                      __html: previewContact
                        ? replaceVariables(body, previewContact as Record<string, unknown>)
                        : body,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== Step 3: Send / Schedule ==================== */}
      {currentStep === 2 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Resumo da campanha</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Campanha</p>
                <p className="font-medium text-slate-900">{campaignName}</p>
              </div>
              <div>
                <p className="text-slate-500">Assunto</p>
                <p className="font-medium text-slate-900 truncate">{subject}</p>
              </div>
              <div>
                <p className="text-slate-500">Destinatários</p>
                <p className="font-medium text-slate-900">{selectedIds.size}</p>
              </div>
              <div>
                <p className="text-slate-500">Criado por</p>
                <p className="font-medium text-slate-900">{member?.displayName || '—'}</p>
              </div>
            </div>
          </div>

          {/* Send type selection */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Tipo de envio</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                onClick={() => setSendType('immediate')}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  sendType === 'immediate' ? 'border-primary-600 bg-primary-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <PaperAirplaneIcon className="h-5 w-5 text-primary-600 mb-2" />
                <p className="text-sm font-medium text-slate-900">Enviar agora</p>
                <p className="text-xs text-slate-500 mt-1">Disparo imediato para todos os destinatários</p>
              </button>

              <button
                onClick={() => setSendType('scheduled')}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  sendType === 'scheduled' ? 'border-primary-600 bg-primary-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <ClockIcon className="h-5 w-5 text-blue-600 mb-2" />
                <p className="text-sm font-medium text-slate-900">Agendar</p>
                <p className="text-xs text-slate-500 mt-1">Escolha data e hora para o envio</p>
              </button>

              <button
                onClick={() => setSendType('recurring')}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  sendType === 'recurring' ? 'border-primary-600 bg-primary-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <ArrowPathIcon className="h-5 w-5 text-emerald-600 mb-2" />
                <p className="text-sm font-medium text-slate-900">Recorrente</p>
                <p className="text-xs text-slate-500 mt-1">Envio automático periódico</p>
              </button>
            </div>

            {/* Scheduled options */}
            {sendType === 'scheduled' && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Data</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Hora (São Paulo)</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Recurring options */}
            {sendType === 'recurring' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Frequência</label>
                  <select
                    value={recurrenceFreq}
                    onChange={(e) => setRecurrenceFreq(e.target.value as RecurrenceFrequency)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {(Object.entries(RECURRENCE_LABELS) as [RecurrenceFrequency, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                {(recurrenceFreq === 'weekly' || recurrenceFreq === 'biweekly') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Dia da semana</label>
                    <select
                      value={recurrenceDayOfWeek}
                      onChange={(e) => setRecurrenceDayOfWeek(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <option value={1}>Segunda</option>
                      <option value={2}>Terça</option>
                      <option value={3}>Quarta</option>
                      <option value={4}>Quinta</option>
                      <option value={5}>Sexta</option>
                    </select>
                  </div>
                )}

                {recurrenceFreq === 'monthly' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Dia do mês</label>
                    <select
                      value={recurrenceDayOfMonth}
                      onChange={(e) => setRecurrenceDayOfMonth(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Hora</label>
                  <input
                    type="time"
                    value={recurrenceTime}
                    onChange={(e) => setRecurrenceTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Data início</label>
                  <input
                    type="date"
                    value={recurrenceStartDate}
                    onChange={(e) => setRecurrenceStartDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Data término (opcional)</label>
                  <input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Warning */}
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <InformationCircleIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700">
                <p className="font-medium">Limite de envio Gmail</p>
                <p>Até ~500 emails/dia (conta pessoal) ou ~2.000/dia (Google Workspace). Envios em lotes de 20 com intervalo de 2s.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Navigation ==================== */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <button
          onClick={() => (currentStep === 0 ? router.push('/campanhas') : setCurrentStep((s) => s - 1))}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {currentStep === 0 ? 'Cancelar' : 'Voltar'}
        </button>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={() => setCurrentStep((s) => s + 1)}
            disabled={!canProceed}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Próximo
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canProceed || submitting}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Criando...
              </>
            ) : (
              <>
                <PaperAirplaneIcon className="h-4 w-4" />
                {sendType === 'immediate' ? 'Enviar Agora' : 'Agendar Campanha'}
              </>
            )}
          </button>
        )}
      </div>

      {/* Save Segment Modal */}
      {showSaveSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-2xl bg-white p-6 shadow-xl w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-3">Salvar Segmento</h3>
            <input
              type="text"
              value={segmentName}
              onChange={(e) => setSegmentName(e.target.value)}
              placeholder="Nome do segmento..."
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowSaveSegment(false)
                  setSegmentName('')
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveSegment}
                disabled={!segmentName.trim() || savingSegment}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40"
              >
                {savingSegment ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================= Page Export ================================= */

export default function NovaCampanhaPage() {
  return (
    <PlanGate feature="email_automation">
      <NovasCampanhasContent />
    </PlanGate>
  )
}
