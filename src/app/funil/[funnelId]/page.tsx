'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  DragDropContext,
  Droppable,
  DropResult,
} from '@hello-pangea/dnd'
import { KanbanCard, UnassignedCard, TableRow, Pagination, ActivityLogView, formatCurrencyShort } from '../components'
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  deleteField,
  getDocs,
  setDoc,
  query,
  orderBy,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db, storage } from '@/lib/firebaseClient'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { useCredits } from '@/hooks/useCredits'
import type { OrgMember } from '@/types/organization'
import { usePermissions } from '@/hooks/usePermissions'
import { useVisibleStages } from '@/hooks/useVisibleStages'
import { leadSourceOptions, leadSourceIcons, leadTypeOptions } from '@/lib/leadSources'
import { formatWhatsAppNumber, maskPhone, maskDocument } from '@/lib/format'
import AudioPlayer from '@/components/AudioPlayer'
import RichTextEditor from '@/components/RichTextEditor'
import {
  Cross2Icon,
  PlusIcon,
  GearIcon,
  CheckIcon,
  Pencil1Icon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  EnvelopeClosedIcon,
  PersonIcon,
  ClockIcon,
  ChatBubbleIcon,
  ExclamationTriangleIcon,
  MobileIcon,
} from '@radix-ui/react-icons'
import {
  BuildingOfficeIcon,
  PhoneIcon,
  ChartBarIcon,
  UserGroupIcon,
  DocumentTextIcon,
  SparklesIcon,
  ArrowTrendingUpIcon,
  TableCellsIcon,
  CalendarDaysIcon,
  Squares2X2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  UserPlusIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  VideoCameraIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowsRightLeftIcon,
  UsersIcon,
  CurrencyDollarIcon,
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  BoltIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'

// Types
type Cliente = {
  id: string
  name: string
  phone: string
  company?: string
  email?: string
  industry?: string
  document?: string
  description?: string
  birthday?: string
  returnAlert?: string
  photoUrl?: string
  leadSource?: string
  leadType?: 'Inbound' | 'Outbound' // Tipo de lead: Inbound ou Outbound
  funnelStage?: string
  funnelStageUpdatedAt?: string
  firstContactAt?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  lastFollowUpAt?: string
  needsDetail?: string
  scheduledReturn?: string // Data agendada para retorno
  partners?: string // Lista de sócios separados por vírgula
  // Cadence tracking
  currentCadenceStepId?: string // ID do step atual na cadência
  lastCadenceActionAt?: string // Quando a última ação de cadência foi executada
  lastCadenceStepResponded?: boolean // Se o cliente respondeu ao último step
  // CNPJ Biz fields
  capital_social?: string | number
  porte_empresa?: string
  municipio?: string
  estado?: string
  tipo?: string
  natureza_juridica?: string
  situacao?: string
  // Cost center
  costCenterId?: string
  // Ownership
  assignedTo?: string
  assignedToName?: string
  assignedAt?: string
  // ICP
  icpProfileId?: string
  // Deal value
  dealValue?: number
  closingProbability?: number  // Probabilidade individual de fechamento (0-100)
}

type FunnelStage = {
  id: string
  name: string
  order: number
  funnelId: string
  color?: string
  probability?: number // Probabilidade de fechamento (0-100)
  maxDays?: number // Prazo máximo em dias
  countsForMetrics?: boolean // Se conta para métricas de tempo/atraso
  macroStageId?: string // ID da macro etapa (grupo) a qual pertence
  conversionType?: 'positive' | 'negative' | 'neutral' | 'final_conversion' // Tipo de conversão para métricas de funil
  isProspectionStage?: boolean // Marcar como etapa de início da prospecção
}

type MacroStage = {
  id: string
  name: string
  order: number
  color?: string // Cor da borda do grupo
}

type CadenceStep = {
  id: string
  stageId: string
  order: number
  name: string
  contactMethod: 'whatsapp' | 'email' | 'phone' | 'meeting'
  daysAfterPrevious: number
  objective?: string
  messageTemplate?: string
  isActive: boolean
  parentStepId?: string | null
  condition?: 'responded' | 'not_responded' | null
}

type FollowUpType = 'note' | 'whatsapp' | 'email' | 'call'

type FollowUp = {
  id: string
  text?: string
  author?: string
  createdAt: string
  source?: 'followup' | 'log'
  type?: FollowUpType
  recordingUrl?: string
}

type CostCenter = {
  id: string
  code: number
  name: string
}

type ViewMode = 'kanban' | 'table' | 'calendar' | 'activity'
type CalendarView = 'day' | 'week' | 'month'

type ContactToday = Cliente & {
  stageName: string
  stageColor: typeof stageColorOptions[0]
  daysInStage: number | null
  daysSinceLastFollowUp: number | null
  isOverdue: boolean
  isDueToday: boolean
  maxDays: number
  isScheduledReturn?: boolean // Indica se é um retorno agendado
  // Cadence info
  currentStep?: CadenceStep | null
  nextStepDueIn?: number | null // Days until next step is due
}

type TableSortKey = 'name' | 'status' | 'stageName' | 'currentStep' | 'daysInStage' | 'daysSinceLastFollowUp'

type TableSortConfig = {
  key: TableSortKey | null
  direction: 'asc' | 'desc'
}

type TableColumnFilters = {
  [key: string]: string
}

// Helper to get effective probability: individual override or stage default
function getClientProbability(client: { closingProbability?: number }, stage?: { probability?: number }): number {
  if (client.closingProbability != null) return client.closingProbability
  return stage?.probability ?? 0
}

// Stage colors
const stageColorOptions = [
  { name: 'Azul', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', gradient: 'from-blue-500 to-blue-600' },
  { name: 'Ciano', bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200', gradient: 'from-cyan-500 to-cyan-600' },
  { name: 'Verde', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', gradient: 'from-emerald-500 to-emerald-600' },
  { name: 'Amarelo', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', gradient: 'from-amber-500 to-amber-600' },
  { name: 'Laranja', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', gradient: 'from-orange-500 to-orange-600' },
  { name: 'Roxo', bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-200', gradient: 'from-primary-500 to-primary-600' },
  { name: 'Rosa', bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-200', gradient: 'from-pink-500 to-pink-600' },
  { name: 'Vermelho', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', gradient: 'from-red-500 to-red-600' },
  { name: 'Cinza', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', gradient: 'from-slate-500 to-slate-600' },
  { name: 'Teal', bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200', gradient: 'from-teal-500 to-teal-600' },
]

// Helper functions
const calculateDaysSince = (dateString?: string): number | null => {
  if (!dateString) return null
  const date = new Date(dateString)
  // Validate that the date is valid
  if (isNaN(date.getTime())) return null
  const now = new Date()
  const diffTime = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays >= 0 ? diffDays : null
}

const formatDays = (days: number | null): string => {
  if (days === null) return '-'
  if (days === 0) return 'Hoje'
  if (days === 1) return '1 dia'
  return `${days} dias`
}

const getColorByIndex = (index: number) => {
  if (isNaN(index)) return stageColorOptions[0]
  return stageColorOptions[index % stageColorOptions.length]
}

export default function FunilDetailPage() {
  const router = useRouter()
  const params = useParams()
  const funnelId = params.funnelId as string
  const { userEmail, orgId, member } = useCrmUser()
  const credits = useCredits(orgId || undefined)
  const { viewScope, can } = usePermissions()
  const { filterStages } = useVisibleStages(funnelId)

  // Responsible filter (admin/manager)
  const [filterAssignedTo, setFilterAssignedTo] = useState<string>('')

  // Period filter
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportDateFrom, setReportDateFrom] = useState<string>('')
  const [reportDateTo, setReportDateTo] = useState<string>('')

  // Export states
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  // Automation status
  const [autoConfig, setAutoConfig] = useState<{
    enabled: boolean
    lastCronRunAt?: string
    lastCronStats?: { enrolled: number; processed: number; success: number; failed: number; todayActions: number; maxActionsPerDay: number }
  } | null>(null)
  const [activeQueue, setActiveQueue] = useState<{ totalItems: number; completedItems: number; activeCallsCount: number; failedItems?: number } | null>(null)
  const [showAutoPanel, setShowAutoPanel] = useState(false)

  // Funnel metadata
  const [funnelName, setFunnelName] = useState<string>('')
  const [funnelColor, setFunnelColor] = useState<string>('#4f46e5')
  const [funnelNotFound, setFunnelNotFound] = useState(false)

  // Data state
  const [clients, setClients] = useState<Cliente[]>([])
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([])
  const [macroStages, setMacroStages] = useState<MacroStage[]>([])
  const [cadenceSteps, setCadenceSteps] = useState<CadenceStep[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [icpProfiles, setIcpProfiles] = useState<{ id: string; name: string; color: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Load funnel metadata and verify access
  useEffect(() => {
    if (!orgId || !funnelId) return
    const funnelRef = collection(db, 'organizations', orgId, 'funnels')
    const unsub = onSnapshot(funnelRef, (snap) => {
      const funnel = snap.docs.find(d => d.id === funnelId)
      if (!funnel) {
        setFunnelNotFound(true)
        setLoading(false)
        return
      }
      const data = funnel.data()
      // Check visibility
      const visibleTo = (data.visibleTo || []) as string[]
      if (visibleTo.length > 0 && member?.id && !visibleTo.includes(member.id)) {
        setFunnelNotFound(true)
        setLoading(false)
        return
      }
      setFunnelName(data.name || 'Funil')
      setFunnelColor(data.color || '#4f46e5')
      setFunnelNotFound(false)
    })
    return () => unsub()
  }, [orgId, funnelId, member?.id])

  // Load ICP profiles for this org
  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'icpProfiles'), where('orgId', '==', orgId), where('isActive', '==', true))
    const unsub = onSnapshot(q, (snap) => {
      setIcpProfiles(snap.docs.map(d => ({ id: d.id, name: d.data().name as string, color: d.data().color as string })))
    })
    return () => unsub()
  }, [orgId])

  // Build ICP lookup map
  const icpMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {}
    for (const icp of icpProfiles) {
      map[icp.id] = { name: icp.name, color: icp.color }
    }
    return map
  }, [icpProfiles])

  // UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [calendarView, setCalendarView] = useState<CalendarView>('week')
  const [calendarDate, setCalendarDate] = useState(new Date())

  // Quick follow-up modal state
  const [quickFollowUpClient, setQuickFollowUpClient] = useState<Cliente | null>(null)
  const [quickFollowUpText, setQuickFollowUpText] = useState('')
  const [savingQuickFollowUp, setSavingQuickFollowUp] = useState(false)

  // Quick stage change state
  const [changingStageClient, setChangingStageClient] = useState<Cliente | null>(null)
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false)
  const [funnelDropdownOpen, setFunnelDropdownOpen] = useState(false)
  const [funnelDropdownStep, setFunnelDropdownStep] = useState<'funnels' | 'stages'>('funnels')

  // Schedule return modal state
  const [schedulingReturnClient, setSchedulingReturnClient] = useState<Cliente | null>(null)
  const [selectedReturnDate, setSelectedReturnDate] = useState('')
  const [savingReturn, setSavingReturn] = useState(false)

  // WhatsApp & Email modal state
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [whatsappMessage, setWhatsappMessage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailTemplates, setEmailTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([])
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Table sort and filter state
  const [tableSortConfig, setTableSortConfig] = useState<TableSortConfig>({ key: null, direction: 'desc' })
  const [tableColumnFilters, setTableColumnFilters] = useState<TableColumnFilters>({})
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null)

  // Pagination state - one page per stage column + table
  const [stagePages, setStagePages] = useState<Record<string, number>>({})
  const [stageTablePages, setStageTablePages] = useState<Record<string, number>>({})
  const ITEMS_PER_PAGE = 20
  const ITEMS_PER_STAGE_TABLE = 10

  // Settings state
  const [editingStage, setEditingStage] = useState<FunnelStage | null>(null)
  const [newStageName, setNewStageName] = useState('')
  const [newStageProbability, setNewStageProbability] = useState(50)
  const [newStageMaxDays, setNewStageMaxDays] = useState(7)
  const [newStageColor, setNewStageColor] = useState(0)
  const [newStageCountsForMetrics, setNewStageCountsForMetrics] = useState(true)
  const [newStageMacroStageId, setNewStageMacroStageId] = useState<string>('')
  const [newStageConversionType, setNewStageConversionType] = useState<'positive' | 'negative' | 'neutral' | 'final_conversion'>('neutral')
  const [savingStage, setSavingStage] = useState(false)
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null)

  // Macro Stage settings state
  const [editingMacroStage, setEditingMacroStage] = useState<MacroStage | null>(null)
  const [newMacroStageName, setNewMacroStageName] = useState('')
  const [newMacroStageColor, setNewMacroStageColor] = useState(0)
  const [savingMacroStage, setSavingMacroStage] = useState(false)
  const [deletingMacroStageId, setDeletingMacroStageId] = useState<string | null>(null)


  
  // Sorting state for kanban columns
  const [sortDirection, setSortDirection] = useState<Record<string, 'asc' | 'desc'>>({})
  const [sortType, setSortType] = useState<Record<string, 'stageTime' | 'lastContact'>>({})
  const [sortMenuOpen, setSortMenuOpen] = useState<string | null>(null)

  // Actions menu state
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)

  // Bulk move modal state
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false)
  const [bulkMoveFromStage, setBulkMoveFromStage] = useState<string>('')
  const [bulkMoveToStage, setBulkMoveToStage] = useState<string>('')
  const [bulkMoveFilters, setBulkMoveFilters] = useState({
    capitalSocialMin: 0,
    capitalSocialMax: 0,
    porteEmpresa: [] as string[],
    municipio: '',
    tipo: '',
    naturezaJuridica: '',
    estado: '',
    costCenterId: '',
  })
  const [executingBulkMove, setExecutingBulkMove] = useState(false)
  const [showBulkMoveConfirm, setShowBulkMoveConfirm] = useState(false)

  // Bulk cost center change modal state
  const [showBulkCostCenterModal, setShowBulkCostCenterModal] = useState(false)
  const [bulkCostCenterStage, setBulkCostCenterStage] = useState<string>('')
  const [bulkCostCenterId, setBulkCostCenterId] = useState<string>('')
  const [executingBulkCostCenter, setExecutingBulkCostCenter] = useState(false)

  // Cross-funnel transfer state (Story 15.3)
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [showCrossFunnelModal, setShowCrossFunnelModal] = useState(false)
  const [crossFunnelTarget, setCrossFunnelTarget] = useState<string>('')
  const [crossFunnelTargetStage, setCrossFunnelTargetStage] = useState<string>('')
  const [crossFunnelStages, setCrossFunnelStages] = useState<{ id: string; name: string; order: number }[]>([])
  const [executingCrossFunnel, setExecutingCrossFunnel] = useState(false)

  // Move client to another funnel state (Story 21.2)
  const [moveFunnelTarget, setMoveFunnelTarget] = useState<string>('')
  const [moveFunnelStage, setMoveFunnelStage] = useState<string>('')
  const [moveFunnelStages, setMoveFunnelStages] = useState<{ id: string; name: string; order: number }[]>([])
  const [movingFunnel, setMovingFunnel] = useState(false)

  // Advanced filters state
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState({
    capitalSocialMin: 0,
    capitalSocialMax: 0,
    porteEmpresa: [] as string[],
    municipio: '',
    tipo: '',
    naturezaJuridica: '',
    estado: '',
    situacao: '',
    leadSource: '',
    leadType: '' as '' | 'Inbound' | 'Outbound',
    funnelStage: '',
    industry: '',
    costCenterId: '',
  })

  // Cadence action modal state
  const [cadenceActionClient, setCadenceActionClient] = useState<ContactToday | null>(null)
  const [executingCadenceAction, setExecutingCadenceAction] = useState(false)
  const [showResponseModal, setShowResponseModal] = useState(false)
  const [respondedClient, setRespondedClient] = useState<ContactToday | null>(null)

  // Client detail panel state
  const [clientFollowUps, setClientFollowUps] = useState<FollowUp[]>([])
  const [loadingFollowUps, setLoadingFollowUps] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [contactComments, setContactComments] = useState('')
  const [editingComments, setEditingComments] = useState(false)
  const [logFilter, setLogFilter] = useState<string>('all')

  // Call contact state
  const [showCallConfirm, setShowCallConfirm] = useState(false)
  const [callingContact, setCallingContact] = useState(false)
  const pendingCallConfirmRef = useRef(false)

  // Proposals by client (Story 11.2)
  const [proposalsByClient, setProposalsByClient] = useState<Record<string, { total: number; status: string; count: number }>>({})

  // Client proposals for lateral panel (Story 11.3)
  const [clientProposals, setClientProposals] = useState<Array<{ id: string; number?: number; projectName?: string; status?: string; total?: number; createdAt?: string }>>([])
  const [loadingProposals, setLoadingProposals] = useState(false)

  // Team members for responsible selector (Story 11.4)
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [showResponsibleDropdown, setShowResponsibleDropdown] = useState(false)

  // Active call status polling state
  const [activeCallStatus, setActiveCallStatus] = useState<{
    clientName: string
    clientId: string
    callId: string
    status: 'initiating' | 'queued' | 'ringing' | 'in-progress' | 'forwarding' | 'ended' | 'completed' | 'error'
    callStatus?: string
    resultado?: string
    duration?: number
    startedAt?: number
  } | null>(null)

  // New contact modal state
  const emptyContactForm = {
    name: '',
    phone: '',
    company: '',
    email: '',
    industry: '',
    document: '',
    description: '',
    birthday: '',
    returnAlert: '',
    leadSource: '',
    leadType: '',
    photoUrl: '',
    costCenterId: '',
  }
  const [showNewContactModal, setShowNewContactModal] = useState(false)
  const [newContactForm, setNewContactForm] = useState(emptyContactForm)
  const [newContactPhotoFile, setNewContactPhotoFile] = useState<File | null>(null)
  const [newContactPhotoPreview, setNewContactPhotoPreview] = useState<string | null>(null)
  const [savingNewContact, setSavingNewContact] = useState(false)
  const [newContactPartners, setNewContactPartners] = useState<string[]>([])
  const [newPartnerInput, setNewPartnerInput] = useState('')
  const [newContactErrors, setNewContactErrors] = useState<Record<string, string>>({})

  // Force cadence modal
  const [forceCadenceStageId, setForceCadenceStageId] = useState<string | null>(null)
  const [forceCadenceLimit, setForceCadenceLimit] = useState(10)
  const [forcingCadence, setForcingCadence] = useState(false)

  // Load clients for this funnel
  useEffect(() => {
    if (!orgId || !funnelId) return
    const unsub = onSnapshot(query(collection(db, 'clients'), where('orgId', '==', orgId), where('funnelId', '==', funnelId)), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Cliente[]
      setClients(data)
      setLoading(false)
    })
    return () => unsub()
  }, [orgId, funnelId])

  // Load funnel stages filtered by funnelId
  useEffect(() => {
    if (!orgId || !funnelId) return
    const unsub = onSnapshot(
      query(collection(db, 'funnelStages'), where('orgId', '==', orgId), where('funnelId', '==', funnelId), orderBy('order', 'asc')),
      (snap) => {
        const stages = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FunnelStage[]
        setFunnelStages(stages)
      }
    )
    return () => unsub()
  }, [orgId, funnelId])

  // Load macro stages
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'macroStages'), where('orgId', '==', orgId)), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MacroStage[]
      setMacroStages(data.sort((a, b) => a.order - b.order))
    })
    return () => unsub()
  }, [orgId])

  // Load cadence steps
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'cadenceSteps'), where('orgId', '==', orgId)), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CadenceStep[]
      setCadenceSteps(data.sort((a, b) => a.order - b.order))
    })
    return () => unsub()
  }, [orgId])

  // Load automation config
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(doc(db, 'organizations', orgId, 'automationConfig', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setAutoConfig({
          enabled: !!data.enabled,
          lastCronRunAt: (data.lastCronRunAt as string) || undefined,
          lastCronStats: data.lastCronStats ? data.lastCronStats as { enrolled: number; processed: number; success: number; failed: number; todayActions: number; maxActionsPerDay: number } : undefined,
        })
      } else {
        setAutoConfig({ enabled: false })
      }
    })
    return () => unsub()
  }, [orgId])

  // Load active call queue
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(
      query(collection(db, 'callQueues'), where('orgId', '==', orgId), where('status', '==', 'running')),
      (snap) => {
        if (snap.empty) {
          setActiveQueue(null)
        } else {
          const queueData = snap.docs[0].data()
          setActiveQueue({
            totalItems: (queueData.totalItems as number) || 0,
            completedItems: (queueData.completedItems as number) || 0,
            activeCallsCount: (queueData.activeCallsCount as number) || 0,
            failedItems: (queueData.failedItems as number) || 0,
          })
        }
      }
    )
    return () => unsub()
  }, [orgId])

  // Load cost centers
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'organizations', orgId, 'costCenters')), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CostCenter[]
      setCostCenters(data.sort((a, b) => a.code - b.code))
    })
    return () => unsub()
  }, [orgId])

  // Load proposals grouped by clientId (Story 11.2)
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'proposals'), where('orgId', '==', orgId)), (snap) => {
      const grouped: Record<string, { total: number; status: string; count: number; createdAt: string }> = {}
      snap.docs.forEach(d => {
        const data = d.data()
        const cid = data.clientId as string
        if (!cid) return
        const createdAt = data.createdAt as string || ''
        if (!grouped[cid]) {
          grouped[cid] = { total: data.total || 0, status: data.status || 'Pendente', count: 1, createdAt }
        } else {
          grouped[cid].count++
          // Keep most recent proposal data
          if (createdAt > grouped[cid].createdAt) {
            grouped[cid].total = data.total || 0
            grouped[cid].status = data.status || 'Pendente'
            grouped[cid].createdAt = createdAt
          }
        }
      })
      setProposalsByClient(grouped)
    })
    return () => unsub()
  }, [orgId])

  // Load active org members (Story 11.4)
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(
      query(collection(db, 'organizations', orgId, 'members'), where('status', '==', 'active')),
      (snap) => {
        const members = snap.docs.map(d => ({ id: d.id, ...d.data() })) as OrgMember[]
        setOrgMembers(members)
      }
    )
    return () => unsub()
  }, [orgId])

  // Count today's follow-ups - optimized to use lastFollowUpAt from clients
  // This avoids making N queries to the database
  const todayFollowUpsCountMemo = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return clients.filter((client) => {
      if (!client.lastFollowUpAt) return false
      const lastFollowUp = new Date(client.lastFollowUpAt)
      return lastFollowUp >= today
    }).length
  }, [clients])

  // NOTE: lastFollowUpAt field on client is now updated on every follow-up/log creation,
  // so we no longer need to fetch interactions separately - it's instant!

  // Reset pagination when search term changes
  useEffect(() => {
    setStagePages({})
    setStageTablePages({})
  }, [searchTerm])

  // Load follow-ups when client is selected
  useEffect(() => {
    if (!selectedClient) {
      setClientFollowUps([])
      return
    }

    const loadFollowUps = async () => {
      setLoadingFollowUps(true)
      try {
        // Buscar followups e logs em paralelo
        const [followupsSnap, logsSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'clients', selectedClient.id, 'followups'),
            orderBy('createdAt', 'desc')
          )),
          getDocs(query(
            collection(db, 'clients', selectedClient.id, 'logs'),
            orderBy('createdAt', 'desc')
          )),
        ])

        // Mapear followups com source e type
        const followupsData: FollowUp[] = followupsSnap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            text: data.text || data.message || '',
            author: data.author || data.email || 'Sistema',
            createdAt: data.createdAt,
            source: 'followup' as const,
            type: (data.type as FollowUpType) || undefined,
            recordingUrl: data.recordingUrl || undefined,
          }
        })

        // Mapear logs com source
        const logsData: FollowUp[] = logsSnap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            text: data.text || data.message || '',
            author: data.author || data.email || 'Sistema',
            createdAt: data.createdAt,
            source: 'log' as const,
          }
        })

        // Mesclar e ordenar por data (mais novo primeiro)
        const allData = [...followupsData, ...logsData].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )

        setClientFollowUps(allData)
      } catch (error) {
        console.error('Error loading follow-ups:', error)
      } finally {
        setLoadingFollowUps(false)
      }
    }

    loadFollowUps()
    setContactComments(selectedClient.needsDetail || '')
    setCallingContact(false)
    if (pendingCallConfirmRef.current) {
      setShowCallConfirm(true)
      pendingCallConfirmRef.current = false
    } else {
      setShowCallConfirm(false)
    }
  }, [selectedClient])

  // Load email templates
  useEffect(() => {
    if (!showEmailModal || !orgId) return
    const loadTemplates = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'organizations', orgId, 'emailTemplates'),
          orderBy('createdAt', 'desc')
        ))
        setEmailTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; subject: string; body: string })))
      } catch {
        setEmailTemplates([])
      }
    }
    loadTemplates()
  }, [showEmailModal, orgId])

  // Load proposals for selected client (Story 11.3)
  useEffect(() => {
    if (!selectedClient) {
      setClientProposals([])
      return
    }
    setLoadingProposals(true)
    const q = query(
      collection(db, 'proposals'),
      where('clientId', '==', selectedClient.id),
      where('orgId', '==', orgId),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, (snap) => {
      setClientProposals(snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; number?: number; projectName?: string; status?: string; total?: number; createdAt?: string })))
      setLoadingProposals(false)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id])

  // Get stage color
  const getStageColor = useCallback((stageId?: string) => {
    if (!stageId) return stageColorOptions[8] // Slate
    const stage = funnelStages.find((s) => s.id === stageId)
    if (!stage) return stageColorOptions[8]
    const colorIndex = stage.color ? parseInt(stage.color) : 0
    return stageColorOptions[colorIndex] || stageColorOptions[0]
  }, [funnelStages])

  // Count active advanced filters
  const activeAdvancedFiltersCount = useMemo(() => {
    let count = 0
    if (advancedFilters.capitalSocialMin > 0 || advancedFilters.capitalSocialMax > 0) count++
    if (advancedFilters.porteEmpresa.length > 0) count++
    if (advancedFilters.municipio) count++
    if (advancedFilters.tipo) count++
    if (advancedFilters.naturezaJuridica) count++
    if (advancedFilters.estado) count++
    if (advancedFilters.situacao) count++
    if (advancedFilters.leadSource) count++
    if (advancedFilters.leadType) count++
    if (advancedFilters.funnelStage) count++
    if (advancedFilters.industry) count++
    if (advancedFilters.costCenterId) count++
    return count
  }, [advancedFilters])

  // Clear all advanced filters
  const clearAdvancedFilters = useCallback(() => {
    setAdvancedFilters({
      capitalSocialMin: 0,
      capitalSocialMax: 0,
      porteEmpresa: [],
      municipio: '',
      tipo: '',
      naturezaJuridica: '',
      estado: '',
      situacao: '',
      leadSource: '',
      leadType: '',
      funnelStage: '',
      industry: '',
      costCenterId: '',
    })
  }, [])

  // Filter clients by search and advanced filters
  const filteredClients = useMemo(() => {
    let result = clients

    // Apply viewScope filter: sellers see only their leads
    if (viewScope === 'own' && member?.id) {
      result = result.filter((c) => c.assignedTo === member.id)
    }

    // Apply responsible filter (admin/manager dropdown)
    if (filterAssignedTo) {
      if (filterAssignedTo === '__none__') {
        result = result.filter((c) => !c.assignedTo)
      } else {
        result = result.filter((c) => c.assignedTo === filterAssignedTo)
      }
    }

    // Period filter moved to Report Modal (reportDateFrom/reportDateTo)

    // Apply text search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter((c) => {
        // Basic contact info
        if (c.name?.toLowerCase().includes(term)) return true
        if (c.company?.toLowerCase().includes(term)) return true
        if (c.phone?.toLowerCase().includes(term)) return true
        if (c.email?.toLowerCase().includes(term)) return true

        // Document (CNPJ/CPF)
        if (c.document?.toLowerCase().includes(term)) return true

        // Partners (sócios)
        if (c.partners?.toLowerCase().includes(term)) return true

        // Industry and location
        if (c.industry?.toLowerCase().includes(term)) return true
        if (c.municipio?.toLowerCase().includes(term)) return true
        if (c.estado?.toLowerCase().includes(term)) return true

        // Lead source and description
        if (c.leadSource?.toLowerCase().includes(term)) return true
        if (c.description?.toLowerCase().includes(term)) return true
        if (c.needsDetail?.toLowerCase().includes(term)) return true

        // Company details
        if (c.porte_empresa?.toLowerCase().includes(term)) return true
        if (c.natureza_juridica?.toLowerCase().includes(term)) return true
        if (c.tipo?.toLowerCase().includes(term)) return true

        return false
      })
    }

    // Apply advanced filters
    if (activeAdvancedFiltersCount > 0) {
      result = result.filter((c) => {
        // Capital social range filter
        if (advancedFilters.capitalSocialMin > 0 || advancedFilters.capitalSocialMax > 0) {
          const capitalSocial = Number(c.capital_social || 0)
          if (advancedFilters.capitalSocialMin > 0 && capitalSocial < advancedFilters.capitalSocialMin) {
            return false
          }
          if (advancedFilters.capitalSocialMax > 0 && capitalSocial > advancedFilters.capitalSocialMax) {
            return false
          }
        }

        // Porte empresa filter (multi-select)
        if (advancedFilters.porteEmpresa.length > 0) {
          if (!c.porte_empresa || !advancedFilters.porteEmpresa.includes(c.porte_empresa)) {
            return false
          }
        }

        // Municipio filter
        if (advancedFilters.municipio && c.municipio !== advancedFilters.municipio) {
          return false
        }

        // Estado filter
        if (advancedFilters.estado && c.estado !== advancedFilters.estado) {
          return false
        }

        // Tipo filter
        if (advancedFilters.tipo && c.tipo !== advancedFilters.tipo) {
          return false
        }

        // Natureza juridica filter
        if (advancedFilters.naturezaJuridica && c.natureza_juridica !== advancedFilters.naturezaJuridica) {
          return false
        }

        // Situacao filter
        if (advancedFilters.situacao && c.situacao !== advancedFilters.situacao) {
          return false
        }

        // Lead source filter
        if (advancedFilters.leadSource && c.leadSource !== advancedFilters.leadSource) {
          return false
        }

        // Lead type filter
        if (advancedFilters.leadType && c.leadType !== advancedFilters.leadType) {
          return false
        }

        // Funnel stage filter
        if (advancedFilters.funnelStage) {
          if (advancedFilters.funnelStage === 'unassigned') {
            if (c.funnelStage) return false
          } else {
            if (c.funnelStage !== advancedFilters.funnelStage) return false
          }
        }

        // Industry filter
        if (advancedFilters.industry && c.industry !== advancedFilters.industry) {
          return false
        }

        // Cost center filter
        if (advancedFilters.costCenterId && c.costCenterId !== advancedFilters.costCenterId) {
          return false
        }

        return true
      })
    }

    return result
  }, [clients, searchTerm, advancedFilters, activeAdvancedFiltersCount, viewScope, member?.id, filterAssignedTo])

  // Apply funnelAccess stage filter
  const visibleFunnelStages = useMemo(() => filterStages(funnelStages), [funnelStages, filterStages])

  // Group clients by stage
  const clientsByStageUnsorted = useMemo(() => {
    const grouped: Record<string, Cliente[]> = {}
    const visibleStageIds = new Set(visibleFunnelStages.map(s => s.id))
    visibleFunnelStages.forEach((stage) => {
      grouped[stage.id] = filteredClients.filter((c) => c.funnelStage === stage.id)
    })
    // Add unassigned — only show contacts not in any visible stage
    grouped['unassigned'] = filteredClients.filter((c) => !c.funnelStage || !visibleStageIds.has(c.funnelStage))
    return grouped
  }, [filteredClients, visibleFunnelStages])

  // Organize stages by macro stage for visual grouping
  const stageGroups = useMemo(() => {
    type StageGroup = {
      macroStage: MacroStage | null
      stages: FunnelStage[]
    }
    const groups: StageGroup[] = []
    const usedStageIds = new Set<string>()

    // First, group stages by their macro stage (in macro stage order)
    macroStages.forEach((macroStage) => {
      const stagesInMacro = funnelStages.filter(s => s.macroStageId === macroStage.id)
      if (stagesInMacro.length > 0) {
        groups.push({ macroStage, stages: stagesInMacro })
        stagesInMacro.forEach(s => usedStageIds.add(s.id))
      }
    })

    // Then add stages without macro stage as individual groups
    funnelStages.forEach((stage) => {
      if (!usedStageIds.has(stage.id)) {
        groups.push({ macroStage: null, stages: [stage] })
      }
    })

    return groups
  }, [funnelStages, macroStages])

  // Apply sorting to clients by stage
  const clientsByStage = useMemo(() => {
    const sorted: Record<string, Cliente[]> = {}
    Object.entries(clientsByStageUnsorted).forEach(([stageId, stageClients]) => {
      const direction = sortDirection[stageId]
      const type = sortType[stageId]

      if (!direction) {
        sorted[stageId] = stageClients
        return
      }

      sorted[stageId] = [...stageClients].sort((a, b) => {
        let aTime: number
        let bTime: number

        if (type === 'lastContact') {
          const aDate = a.lastFollowUpAt ? new Date(a.lastFollowUpAt).getTime() : 0
          const bDate = b.lastFollowUpAt ? new Date(b.lastFollowUpAt).getTime() : 0
          // Handle invalid dates (NaN) by treating them as 0
          aTime = isNaN(aDate) ? 0 : aDate
          bTime = isNaN(bDate) ? 0 : bDate
        } else {
          const aDate = a.funnelStageUpdatedAt ? new Date(a.funnelStageUpdatedAt).getTime() : 0
          const bDate = b.funnelStageUpdatedAt ? new Date(b.funnelStageUpdatedAt).getTime() : 0
          aTime = isNaN(aDate) ? 0 : aDate
          bTime = isNaN(bDate) ? 0 : bDate
        }

        return direction === 'asc' ? aTime - bTime : bTime - aTime
      })
    })
    return sorted
  }, [clientsByStageUnsorted, sortDirection, sortType])

  // Calculate stage stats
  const stageStats = useMemo(() => {
    const stats: Record<string, { count: number; avgDays: number; overdueCount: number; totalValue: number }> = {}

    funnelStages.forEach((stage) => {
      const stageClients = clientsByStage[stage.id] || []
      const daysArray = stageClients
        .map((c) => calculateDaysSince(c.funnelStageUpdatedAt))
        .filter((d): d is number => d !== null)

      const avgDays = daysArray.length > 0
        ? Math.round(daysArray.reduce((a, b) => a + b, 0) / daysArray.length)
        : 0

      const overdueCount = stage.maxDays
        ? stageClients.filter((c) => {
            const days = calculateDaysSince(c.funnelStageUpdatedAt)
            return days !== null && days > stage.maxDays!
          }).length
        : 0

      stats[stage.id] = {
        count: stageClients.length,
        avgDays,
        overdueCount,
        totalValue: stageClients.length * (stage.probability || 0),
      }
    })

    return stats
  }, [clientsByStage, funnelStages])

  // Calculate global metrics (only stages that count for metrics)
  const globalMetrics = useMemo(() => {
    let totalContacts = 0
    let weightedTotal = 0
    let totalOverdue = 0
    let totalInMetricStages = 0
    let totalDaysSum = 0
    let totalClientsWithDays = 0
    let totalPipelineValue = 0
    let totalExpectedValue = 0

    funnelStages.forEach((stage) => {
      const stats = stageStats[stage.id]
      const count = stats?.count || 0
      totalContacts += count

      // Use individual probability overrides for weighted calculation
      const stageClients = clientsByStage[stage.id] || []
      stageClients.forEach((c) => {
        weightedTotal += getClientProbability(c, stage) / 100
      })

      // Only count metrics for stages that have countsForMetrics enabled
      if (stage.countsForMetrics !== false) {
        totalOverdue += stats?.overdueCount || 0
        totalInMetricStages += count

        // Calculate days for this stage
        stageClients.forEach((client) => {
          const days = calculateDaysSince(client.funnelStageUpdatedAt)
          if (days !== null) {
            totalDaysSum += days
            totalClientsWithDays++
          }
        })

        // Financial KPIs (use individual probability if available)
        stageClients.forEach((c) => {
          totalPipelineValue += c.dealValue || 0
          const prob = getClientProbability(c, stage)
          totalExpectedValue += ((c.dealValue || 0) * prob) / 100
        })
      }
    })

    const avgDaysInFunnel = totalClientsWithDays > 0
      ? Math.round(totalDaysSum / totalClientsWithDays)
      : 0

    const overduePercent = totalInMetricStages > 0
      ? Math.round((totalOverdue / totalInMetricStages) * 100)
      : 0

    return {
      totalContacts,
      weightedProbability: totalContacts > 0 ? Math.round((weightedTotal / totalContacts) * 100) : 0,
      totalOverdue,
      overduePercent,
      avgDaysInFunnel,
      totalInMetricStages,
      totalPipelineValue,
      totalExpectedValue,
    }
  }, [funnelStages, stageStats, clientsByStage])

  // Bulk move filter options
  const bulkMoveFilterOptions = useMemo(() => {
    const porteOptions = Array.from(new Set(clients.map(c => c.porte_empresa).filter(Boolean))) as string[]
    const municipioOptions = Array.from(new Set(clients.map(c => c.municipio).filter(Boolean))) as string[]
    const tipoOptions = Array.from(new Set(clients.map(c => c.tipo).filter(Boolean))) as string[]
    const naturezaJuridicaOptions = Array.from(new Set(clients.map(c => c.natureza_juridica).filter(Boolean))) as string[]
    const estadoOptions = Array.from(new Set(clients.map(c => c.estado).filter(Boolean))) as string[]
    const maxCapitalSocial = clients.reduce((max, c) => {
      const val = Number(c.capital_social || 0)
      return val > max ? val : max
    }, 0)

    return {
      porteOptions: porteOptions.sort(),
      municipioOptions: municipioOptions.sort(),
      tipoOptions: tipoOptions.sort(),
      naturezaJuridicaOptions: naturezaJuridicaOptions.sort(),
      estadoOptions: estadoOptions.sort(),
      maxCapitalSocial,
    }
  }, [clients])

  // Advanced filter options (dynamic from client data)
  const advancedFilterOptions = useMemo(() => {
    const porteOptions = Array.from(new Set(clients.map(c => c.porte_empresa).filter(Boolean))) as string[]
    const municipioOptions = Array.from(new Set(clients.map(c => c.municipio).filter(Boolean))) as string[]
    const tipoOptions = Array.from(new Set(clients.map(c => c.tipo).filter(Boolean))) as string[]
    const naturezaJuridicaOptions = Array.from(new Set(clients.map(c => c.natureza_juridica).filter(Boolean))) as string[]
    const estadoOptions = Array.from(new Set(clients.map(c => c.estado).filter(Boolean))) as string[]
    const situacaoOptions = Array.from(new Set(clients.map(c => c.situacao).filter(Boolean))) as string[]
    const industryOptions = Array.from(new Set(clients.map(c => c.industry).filter(Boolean))) as string[]
    const leadSourceOptions = Array.from(new Set(clients.map(c => c.leadSource).filter(Boolean))) as string[]
    const maxCapitalSocial = clients.reduce((max, c) => {
      const val = Number(c.capital_social || 0)
      return val > max ? val : max
    }, 0)

    return {
      porteOptions: porteOptions.sort(),
      municipioOptions: municipioOptions.sort(),
      tipoOptions: tipoOptions.sort(),
      naturezaJuridicaOptions: naturezaJuridicaOptions.sort(),
      estadoOptions: estadoOptions.sort(),
      situacaoOptions: situacaoOptions.sort(),
      industryOptions: industryOptions.sort(),
      leadSourceOptions: leadSourceOptions.sort(),
      maxCapitalSocial,
    }
  }, [clients])

  // Filtered clients for bulk move
  const bulkMoveFilteredClients = useMemo(() => {
    if (!bulkMoveFromStage) return []

    return clients.filter((client) => {
      // Must be in the selected "from" stage
      if (bulkMoveFromStage === 'unassigned') {
        if (client.funnelStage) return false
      } else {
        if (client.funnelStage !== bulkMoveFromStage) return false
      }

      // Capital social range filter
      if (bulkMoveFilters.capitalSocialMax > 0) {
        const capitalSocial = Number(client.capital_social || 0)
        if (capitalSocial < bulkMoveFilters.capitalSocialMin || capitalSocial > bulkMoveFilters.capitalSocialMax) {
          return false
        }
      }

      // Porte empresa filter (multi-select)
      if (bulkMoveFilters.porteEmpresa.length > 0) {
        if (!client.porte_empresa || !bulkMoveFilters.porteEmpresa.includes(client.porte_empresa)) {
          return false
        }
      }

      // Municipio filter
      if (bulkMoveFilters.municipio && client.municipio !== bulkMoveFilters.municipio) {
        return false
      }

      // Tipo filter
      if (bulkMoveFilters.tipo && client.tipo !== bulkMoveFilters.tipo) {
        return false
      }

      // Natureza juridica filter
      if (bulkMoveFilters.naturezaJuridica && client.natureza_juridica !== bulkMoveFilters.naturezaJuridica) {
        return false
      }

      // Estado filter
      if (bulkMoveFilters.estado && client.estado !== bulkMoveFilters.estado) {
        return false
      }

      // Cost center filter
      if (bulkMoveFilters.costCenterId) {
        if (bulkMoveFilters.costCenterId === 'none') {
          // Filter for clients without cost center
          if (client.costCenterId) return false
        } else {
          // Filter for specific cost center
          if (client.costCenterId !== bulkMoveFilters.costCenterId) return false
        }
      }

      return true
    })
  }, [clients, bulkMoveFromStage, bulkMoveFilters])

  // Helper to get current cadence step for a client
  const getCurrentCadenceStep = useCallback((client: Cliente, stageId: string): CadenceStep | null => {
    const stageSteps = cadenceSteps.filter(s => s.stageId === stageId)
    if (stageSteps.length === 0) return null

    // If client has a current step, use it
    if (client.currentCadenceStepId) {
      const currentStep = stageSteps.find(s => s.id === client.currentCadenceStepId)
      if (currentStep) return currentStep
    }

    // Otherwise, find the first root step (no parent)
    const rootSteps = stageSteps.filter(s => !s.parentStepId).sort((a, b) => a.order - b.order)
    return rootSteps[0] || null
  }, [cadenceSteps])

  // Helper to get next step after completing current one
  const getNextCadenceStep = useCallback((currentStep: CadenceStep, responded: boolean): CadenceStep | null => {
    const stageSteps = cadenceSteps.filter(s => s.stageId === currentStep.stageId)

    // Find child step based on response
    const condition = responded ? 'responded' : 'not_responded'
    const childStep = stageSteps.find(s => s.parentStepId === currentStep.id && s.condition === condition)

    if (childStep) return childStep

    // If no conditional child, find next root step
    const rootSteps = stageSteps.filter(s => !s.parentStepId).sort((a, b) => a.order - b.order)
    const currentIndex = rootSteps.findIndex(s => s.id === currentStep.id)
    if (currentIndex >= 0 && currentIndex < rootSteps.length - 1) {
      return rootSteps[currentIndex + 1]
    }

    return null
  }, [cadenceSteps])

  // Contacts to contact today (based on cadence steps timing) - Raw list
  const contactsTodayRaw = useMemo(() => {
    const contacts: ContactToday[] = []
    const addedClientIds = new Set<string>()

    // First, add all clients with scheduled returns for today or overdue that haven't been contacted yet
    filteredClients.forEach((client) => {
      if (!client.scheduledReturn) return

      const returnDate = new Date(client.scheduledReturn)
      const today = new Date()
      returnDate.setHours(0, 0, 0, 0)
      today.setHours(0, 0, 0, 0)

      const isOverdue = returnDate < today
      const isDueToday = returnDate.getTime() === today.getTime()

      // Only add if return is today or overdue
      if (!isOverdue && !isDueToday) return

      // Check if the scheduled return has already been completed
      // If lastFollowUpAt is after scheduledReturn, the contact was already made
      if (client.lastFollowUpAt) {
        const lastFollowUpDate = new Date(client.lastFollowUpAt)
        lastFollowUpDate.setHours(0, 0, 0, 0)
        if (lastFollowUpDate >= returnDate) {
          // Already contacted after the scheduled date, skip
          return
        }
      }

      const color = stageColorOptions[3] // Amber for scheduled returns

      contacts.push({
        ...client,
        stageName: 'Agendamento',
        stageColor: color,
        daysInStage: calculateDaysSince(client.funnelStageUpdatedAt),
        daysSinceLastFollowUp: calculateDaysSince(client.lastFollowUpAt),
        isOverdue,
        isDueToday,
        maxDays: 0,
        isScheduledReturn: true,
        currentStep: null,
      })
      addedClientIds.add(client.id)
    })

    // Then add based on cadence steps timing
    funnelStages.forEach((stage) => {
      // Only include stages that count for metrics
      if (stage.countsForMetrics === false) return

      const stageClients = clientsByStage[stage.id] || []
      const color = getColorByIndex(parseInt(stage.color || '0'))

      stageClients.forEach((client) => {
        // Skip if already added via scheduled return
        if (addedClientIds.has(client.id)) return

        const daysInStage = calculateDaysSince(client.funnelStageUpdatedAt)
        const daysSinceLastFollowUp = calculateDaysSince(client.lastFollowUpAt)

        // Get current cadence step for this client
        const currentStep = getCurrentCadenceStep(client, stage.id)

        // Determine timing based on cadence step or fall back to stage maxDays
        const stepDays = currentStep?.daysAfterPrevious ?? stage.maxDays ?? 7
        const maxDays = stepDays

        // Calculate based on time since last contact
        const isOverdue = daysSinceLastFollowUp !== null && daysSinceLastFollowUp > maxDays
        const isDueToday = daysSinceLastFollowUp !== null && daysSinceLastFollowUp === maxDays

        if (isOverdue || isDueToday) {
          contacts.push({
            ...client,
            stageName: stage.name,
            stageColor: color,
            daysInStage,
            daysSinceLastFollowUp,
            isOverdue,
            isDueToday,
            maxDays,
            currentStep,
          })
        }
      })
    })

    return contacts
  }, [funnelStages, clientsByStage, filteredClients, getCurrentCadenceStep])

  // Filtered and sorted contacts for table view
  const contactsToday = useMemo(() => {
    let result = [...contactsTodayRaw]

    // Apply column filters
    Object.entries(tableColumnFilters).forEach(([key, value]) => {
      if (value) {
        result = result.filter((contact) => {
          let fieldValue: string
          if (key === 'status') {
            fieldValue = contact.isOverdue ? 'atrasado' : 'vence hoje'
          } else if (key === 'stageName') {
            fieldValue = contact.stageName
          } else if (key === 'name') {
            fieldValue = contact.name || ''
          } else {
            fieldValue = String((contact as Record<string, unknown>)[key] || '')
          }
          return fieldValue.toLowerCase().includes(value.toLowerCase())
        })
      }
    })

    // Apply sorting
    if (tableSortConfig.key) {
      result.sort((a, b) => {
        let aVal: string | number | null
        let bVal: string | number | null

        switch (tableSortConfig.key) {
          case 'name':
            aVal = a.name || ''
            bVal = b.name || ''
            break
          case 'status':
            // Overdue comes before due today in asc
            aVal = a.isOverdue ? 0 : 1
            bVal = b.isOverdue ? 0 : 1
            break
          case 'stageName':
            aVal = a.stageName || ''
            bVal = b.stageName || ''
            break
          case 'currentStep':
            aVal = a.currentStep?.order ?? 999
            bVal = b.currentStep?.order ?? 999
            break
          case 'daysInStage':
            aVal = a.daysInStage
            bVal = b.daysInStage
            break
          case 'daysSinceLastFollowUp':
            aVal = a.daysSinceLastFollowUp
            bVal = b.daysSinceLastFollowUp
            break
          default:
            return 0
        }

        // Handle null values (put them at the end)
        if (aVal === null && bVal === null) return 0
        if (aVal === null) return 1
        if (bVal === null) return -1

        if (aVal < bVal) return tableSortConfig.direction === 'asc' ? -1 : 1
        if (aVal > bVal) return tableSortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    } else {
      // Default sort: overdue first, then by days since last contact (descending)
      result.sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1
        if (!a.isOverdue && b.isOverdue) return 1
        return (b.daysSinceLastFollowUp || 0) - (a.daysSinceLastFollowUp || 0)
      })
    }

    return result
  }, [contactsTodayRaw, tableColumnFilters, tableSortConfig])

  // Group contacts by stage for table view
  const contactsTodayByStage = useMemo(() => {
    const grouped: Record<string, { stageName: string; stageColor: typeof stageColorOptions[0]; contacts: ContactToday[]; order: number }> = {}

    contactsToday.forEach((contact) => {
      const stageKey = contact.stageName
      if (!grouped[stageKey]) {
        // Find stage order for proper sorting
        const stage = funnelStages.find(s => s.name === contact.stageName)
        grouped[stageKey] = {
          stageName: contact.stageName,
          stageColor: contact.stageColor,
          contacts: [],
          order: stage?.order ?? (contact.isScheduledReturn ? -1 : 999) // Scheduled returns first
        }
      }
      grouped[stageKey].contacts.push(contact)
    })

    // Sort by stage order
    return Object.values(grouped).sort((a, b) => a.order - b.order)
  }, [contactsToday, funnelStages])

  // Paginated contacts by stage for table view
  const paginatedContactsTodayByStage = useMemo(() => {
    return contactsTodayByStage.map((stageData) => {
      const currentPage = stageTablePages[stageData.stageName] || 1
      const totalPages = Math.ceil(stageData.contacts.length / ITEMS_PER_STAGE_TABLE)
      const startIndex = (currentPage - 1) * ITEMS_PER_STAGE_TABLE

      return {
        ...stageData,
        paginatedContacts: stageData.contacts.slice(startIndex, startIndex + ITEMS_PER_STAGE_TABLE),
        totalPages,
        currentPage,
        totalContacts: stageData.contacts.length,
      }
    })
  }, [contactsTodayByStage, stageTablePages])

  // Paginated clients by stage for Kanban
  const paginatedClientsByStage = useMemo(() => {
    const result: Record<string, { clients: Cliente[]; totalPages: number; currentPage: number }> = {}

    Object.entries(clientsByStage).forEach(([stageId, clients]) => {
      const currentPage = stagePages[stageId] || 1
      const totalPages = Math.ceil(clients.length / ITEMS_PER_PAGE)
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE

      result[stageId] = {
        clients: clients.slice(startIndex, startIndex + ITEMS_PER_PAGE),
        totalPages,
        currentPage,
      }
    })

    return result
  }, [clientsByStage, stagePages])


  // Get all contacts with their due dates for calendar
  const contactsWithDueDates = useMemo(() => {
    const contacts: (ContactToday & { dueDate: Date })[] = []
    const addedClientIds = new Set<string>()

    // First, add all clients with scheduled returns
    filteredClients.forEach((client) => {
      if (!client.scheduledReturn) return

      const returnDate = new Date(client.scheduledReturn)
      const stage = funnelStages.find((s) => s.id === client.funnelStage)
      const color = stage ? getColorByIndex(parseInt(stage.color || '0')) : stageColorOptions[3] // Amber for returns

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      returnDate.setHours(0, 0, 0, 0)

      const isOverdue = returnDate < today
      const isDueToday = returnDate.getTime() === today.getTime()

      contacts.push({
        ...client,
        stageName: stage?.name || 'Agendamento',
        stageColor: color,
        daysInStage: calculateDaysSince(client.funnelStageUpdatedAt),
        daysSinceLastFollowUp: calculateDaysSince(client.lastFollowUpAt),
        isOverdue,
        isDueToday,
        maxDays: 0,
        dueDate: new Date(client.scheduledReturn),
        isScheduledReturn: true,
      })
      addedClientIds.add(client.id)
    })

    // Then add stage-based due dates (excluding clients already added with scheduled returns)
    funnelStages.forEach((stage) => {
      if (stage.countsForMetrics === false) return

      const stageClients = clientsByStage[stage.id] || []
      const color = getColorByIndex(parseInt(stage.color || '0'))

      stageClients.forEach((client) => {
        // Skip if already added via scheduled return
        if (addedClientIds.has(client.id)) return
        if (!client.funnelStageUpdatedAt) return

        const stageDate = new Date(client.funnelStageUpdatedAt)
        const maxDays = stage.maxDays || 7
        const dueDate = new Date(stageDate)
        dueDate.setDate(dueDate.getDate() + maxDays)

        const daysInStage = calculateDaysSince(client.funnelStageUpdatedAt)
        const daysSinceLastFollowUp = calculateDaysSince(client.lastFollowUpAt)
        const isOverdue = daysInStage !== null && daysInStage > maxDays
        const isDueToday = daysInStage !== null && daysInStage === maxDays

        contacts.push({
          ...client,
          stageName: stage.name,
          stageColor: color,
          daysInStage,
          daysSinceLastFollowUp,
          isOverdue,
          isDueToday,
          maxDays,
          dueDate,
        })
      })
    })

    return contacts
  }, [funnelStages, clientsByStage, filteredClients])

  // Handle drag and drop
  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result

    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return
    }

    const newStageId = destination.droppableId === 'unassigned' ? null : destination.droppableId
    const now = new Date().toISOString()

    // Get stage names for log
    const fromStage = source.droppableId === 'unassigned'
      ? 'Não atribuído'
      : funnelStages.find(s => s.id === source.droppableId)?.name || 'Desconhecido'
    const toStage = destination.droppableId === 'unassigned'
      ? 'Não atribuído'
      : funnelStages.find(s => s.id === destination.droppableId)?.name || 'Desconhecido'

    try {
      // Build update data
      const updateData: Record<string, unknown> = {
        funnelStage: newStageId,
        funnelId: newStageId ? funnelId : '',
        funnelStageUpdatedAt: now,
        lastFollowUpAt: now,
        updatedAt: now,
        closingProbability: deleteField(), // Reset individual probability on stage change (Story 21.2)
      }

      // If moving to "Primeiro Contato realizado" stage, set firstContactAt
      if (toStage.toLowerCase().includes('primeiro contato')) {
        const client = clients.find(c => c.id === draggableId)
        // Only set if not already set
        if (!client?.firstContactAt) {
          updateData.firstContactAt = now
        }
      }

      // Auto-enroll in cadence if target stage has cadence steps
      if (newStageId) {
        const stageSteps = cadenceSteps
          .filter(s => s.stageId === newStageId && s.isActive && !s.parentStepId)
          .sort((a, b) => a.order - b.order)
        if (stageSteps.length > 0) {
          updateData.currentCadenceStepId = stageSteps[0].id
          updateData.lastCadenceActionAt = now
          updateData.lastCadenceStepResponded = false
        } else {
          // Clear cadence if target stage has no steps
          updateData.currentCadenceStepId = ''
          updateData.lastCadenceStepResponded = false
        }
      }

      await updateDoc(doc(db, 'clients', draggableId), updateData as any)

      // Create audit log for stage change
      const authorName = member?.displayName || userEmail || 'Sistema'
      await addDoc(collection(db, 'clients', draggableId, 'logs'), {
        action: 'stage_change',
        message: `Etapa alterada de ${fromStage} para ${toStage}`,
        text: `Card movido de ${fromStage} para ${toStage}`,
        type: 'audit',
        author: authorName,
        authorId: member?.id || '',
        orgId,
        metadata: {
          fromStageId: source.droppableId,
          toStageId: destination.droppableId,
          fromStageName: fromStage,
          toStageName: toStage,
          funnelId: funnelId || '',
        },
        createdAt: now,
      })

      } catch (error) {
      console.error('Error updating client stage:', error)
    }
  }

  // Add new stage
  const handleAddStage = async () => {
    if (!newStageName.trim()) return
    setSavingStage(true)
    try {
      const stageData: Record<string, unknown> = {
        name: newStageName.trim(),
        order: funnelStages.length,
        color: String(newStageColor),
        probability: newStageProbability,
        maxDays: newStageMaxDays,
        countsForMetrics: newStageCountsForMetrics,
        conversionType: newStageConversionType,
        orgId,
        funnelId,
      }
      if (newStageMacroStageId) {
        stageData.macroStageId = newStageMacroStageId
      }
      await addDoc(collection(db, 'funnelStages'), stageData)
      setNewStageName('')
      setNewStageProbability(50)
      setNewStageMaxDays(7)
      setNewStageColor(0)
      setNewStageCountsForMetrics(true)
      setNewStageMacroStageId('')
      setNewStageConversionType('neutral')
    } catch (error) {
      console.error('Error adding stage:', error)
    } finally {
      setSavingStage(false)
    }
  }

  // Update stage
  const handleUpdateStage = async () => {
    if (!editingStage) return
    setSavingStage(true)
    try {
      await updateDoc(doc(db, 'funnelStages', editingStage.id), {
        name: editingStage.name,
        probability: editingStage.probability || 0,
        maxDays: editingStage.maxDays || 7,
        color: editingStage.color || '0',
        countsForMetrics: editingStage.countsForMetrics !== false,
        macroStageId: editingStage.macroStageId || deleteField(),
        conversionType: editingStage.conversionType || 'neutral',
        isProspectionStage: editingStage.isProspectionStage || false,
        funnelId,
      })
      setEditingStage(null)
    } catch (error) {
      console.error('Error updating stage:', error)
    } finally {
      setSavingStage(false)
    }
  }

  // Delete stage
  const handleDeleteStage = async (stageId: string) => {
    try {
      // Move all clients from this stage to unassigned
      const clientsInStage = clients.filter((c) => c.funnelStage === stageId)
      for (const client of clientsInStage) {
        await updateDoc(doc(db, 'clients', client.id), {
          funnelStage: null,
          funnelId: '',
          funnelStageUpdatedAt: new Date().toISOString(),
        })
      }
      await deleteDoc(doc(db, 'funnelStages', stageId))
      setDeletingStageId(null)
    } catch (error) {
      console.error('Error deleting stage:', error)
    }
  }

  // Reorder stages
  const handleReorderStage = async (stageId: string, direction: 'up' | 'down') => {
    const currentIndex = funnelStages.findIndex((s) => s.id === stageId)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= funnelStages.length) return

    const currentStage = funnelStages[currentIndex]
    const swapStage = funnelStages[newIndex]

    try {
      await Promise.all([
        updateDoc(doc(db, 'funnelStages', currentStage.id), { order: newIndex }),
        updateDoc(doc(db, 'funnelStages', swapStage.id), { order: currentIndex }),
      ])
    } catch (error) {
      console.error('Error reordering stages:', error)
    }
  }

  // Add new macro stage
  const handleAddMacroStage = async () => {
    if (!newMacroStageName.trim()) return
    setSavingMacroStage(true)
    try {
      await addDoc(collection(db, 'macroStages'), {
        name: newMacroStageName.trim(),
        order: macroStages.length,
        color: String(newMacroStageColor),
        orgId,
      })
      setNewMacroStageName('')
      setNewMacroStageColor(0)
    } catch (error) {
      console.error('Error adding macro stage:', error)
    } finally {
      setSavingMacroStage(false)
    }
  }

  // Update macro stage
  const handleUpdateMacroStage = async () => {
    if (!editingMacroStage) return
    setSavingMacroStage(true)
    try {
      await updateDoc(doc(db, 'macroStages', editingMacroStage.id), {
        name: editingMacroStage.name,
        color: editingMacroStage.color || '0',
      })
      setEditingMacroStage(null)
    } catch (error) {
      console.error('Error updating macro stage:', error)
    } finally {
      setSavingMacroStage(false)
    }
  }

  // Delete macro stage
  const handleDeleteMacroStage = async (macroStageId: string) => {
    try {
      // Remove macroStageId from all stages that belong to this macro stage
      const stagesInMacro = funnelStages.filter((s) => s.macroStageId === macroStageId)
      for (const stage of stagesInMacro) {
        await updateDoc(doc(db, 'funnelStages', stage.id), {
          macroStageId: deleteField(),
        })
      }
      await deleteDoc(doc(db, 'macroStages', macroStageId))
      setDeletingMacroStageId(null)
    } catch (error) {
      console.error('Error deleting macro stage:', error)
    }
  }

  // Reorder macro stages
  const handleReorderMacroStage = async (macroStageId: string, direction: 'up' | 'down') => {
    const currentIndex = macroStages.findIndex((s) => s.id === macroStageId)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= macroStages.length) return

    const currentMacroStage = macroStages[currentIndex]
    const swapMacroStage = macroStages[newIndex]

    try {
      await Promise.all([
        updateDoc(doc(db, 'macroStages', currentMacroStage.id), { order: newIndex }),
        updateDoc(doc(db, 'macroStages', swapMacroStage.id), { order: currentIndex }),
      ])
    } catch (error) {
      console.error('Error reordering macro stages:', error)
    }
  }

  // Save new contact
  const handleSaveNewContact = async () => {
    const errors: Record<string, string> = {}
    if (!newContactForm.name.trim()) {
      errors.name = 'Nome é obrigatório'
    }
    if (!newContactForm.phone.trim()) {
      errors.phone = 'Telefone é obrigatório'
    } else if (newContactForm.phone.replace(/\D/g, '').length < 10) {
      errors.phone = 'Telefone deve ter pelo menos 10 dígitos'
    }
    if (newContactForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newContactForm.email.trim())) {
      errors.email = 'E-mail inválido'
    }
    if (newContactForm.document.trim()) {
      const docDigits = newContactForm.document.replace(/\D/g, '').length
      if (docDigits !== 11 && docDigits !== 14) {
        errors.document = 'CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos'
      }
    }
    if (Object.keys(errors).length > 0) {
      setNewContactErrors(errors)
      return
    }
    setNewContactErrors({})

    setSavingNewContact(true)
    try {
      let photoUrl = newContactForm.photoUrl

      // Upload photo if new
      if (newContactPhotoFile) {
        const ext = newContactPhotoFile.name.split('.').pop()
        const photoRef = ref(storage, `client-photos/${Date.now()}.${ext}`)
        await uploadBytes(photoRef, newContactPhotoFile)
        photoUrl = await getDownloadURL(photoRef)
      }

      const clientData = {
        name: newContactForm.name.trim(),
        phone: newContactForm.phone.trim(),
        company: newContactForm.company.trim() || null,
        email: newContactForm.email.trim() || null,
        industry: newContactForm.industry.trim() || null,
        document: newContactForm.document.trim() || null,
        description: newContactForm.description.trim() || null,
        birthday: newContactForm.birthday || null,
        returnAlert: newContactForm.returnAlert || null,
        leadSource: newContactForm.leadSource || null,
        leadType: newContactForm.leadType || null,
        photoUrl: photoUrl || null,
        costCenterId: newContactForm.costCenterId || null,
        partners: newContactPartners.length > 0 ? newContactPartners.join(', ') : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        orgId,
        funnelId,
      }

      const newRef = doc(collection(db, 'clients'))
      await setDoc(newRef, clientData)

      setShowNewContactModal(false)
      setNewContactForm(emptyContactForm)
      setNewContactPhotoFile(null)
      setNewContactPhotoPreview(null)
      setNewContactPartners([])
      setNewPartnerInput('')
      setNewContactErrors({})
      toast.success('Contato adicionado com sucesso!')
    } catch (error) {
      console.error('Erro ao salvar:', error)
      toast.error('Erro ao salvar contato. Tente novamente.')
    } finally {
      setSavingNewContact(false)
    }
  }

  // Save note
  const handleSaveNote = async () => {
    if (!selectedClient || !newNote.trim()) return
    setSavingNote(true)
    try {
      const now = new Date().toISOString()
      await addDoc(collection(db, 'clients', selectedClient.id, 'followups'), {
        text: newNote.trim(),
        author: userEmail || 'Usuário',
        createdAt: now,
        type: 'note',
        orgId,
      })
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        lastFollowUpAt: now,
        updatedAt: now,
      })
      setClientFollowUps((prev) => [
        { id: Date.now().toString(), text: newNote.trim(), author: userEmail || 'Usuário', createdAt: now },
        ...prev,
      ])
      setNewNote('')
    } catch (error) {
      console.error('Error saving note:', error)
    } finally {
      setSavingNote(false)
    }
  }

  // Send WhatsApp message from detail panel
  const handleSendWhatsAppMessage = async () => {
    if (!selectedClient?.phone || !whatsappMessage.trim()) return
    setSendingWhatsApp(true)
    try {
      const response = await fetch('/api/extension/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedClient.phone,
          message: whatsappMessage,
          channel: 'whatsapp',
        }),
      })
      if (response.ok) {
        await addDoc(collection(db, 'clients', selectedClient.id, 'followups'), {
          text: `WhatsApp enviado: ${whatsappMessage}`,
          author: userEmail || 'Sistema',
          createdAt: new Date().toISOString(),
          source: 'followup',
          type: 'whatsapp',
          orgId,
        })
        toast.success('WhatsApp enviado com sucesso!')
        setShowWhatsAppModal(false)
        setWhatsappMessage('')
      } else {
        toast.error('Erro ao enviar WhatsApp')
      }
    } catch {
      toast.error('Erro ao enviar WhatsApp')
    } finally {
      setSendingWhatsApp(false)
    }
  }

  // Send Email from detail panel
  const handleSendEmailMessage = async () => {
    if (!selectedClient?.email || !emailSubject.trim() || !emailBody.trim()) return
    setSendingEmail(true)
    try {
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedClient.email,
          subject: emailSubject,
          body: emailBody,
          orgId,
        }),
      })
      if (response.ok) {
        await addDoc(collection(db, 'clients', selectedClient.id, 'followups'), {
          text: `Email enviado: ${emailSubject}`,
          author: userEmail || 'Sistema',
          createdAt: new Date().toISOString(),
          source: 'followup',
          type: 'email',
          orgId,
        })
        toast.success('Email enviado com sucesso!')
        setShowEmailModal(false)
        setEmailSubject('')
        setEmailBody('')
      } else {
        toast.error('Erro ao enviar email')
      }
    } catch {
      toast.error('Erro ao enviar email')
    } finally {
      setSendingEmail(false)
    }
  }

  // Get clients filtered by report date range (uses kanban filters + report dates)
  const getReportClients = useCallback(() => {
    let result = filteredClients
    if (reportDateFrom) {
      const from = new Date(reportDateFrom)
      from.setHours(0, 0, 0, 0)
      result = result.filter((c) => {
        const created = c.createdAt ? new Date(c.createdAt) : null
        return created && created >= from
      })
    }
    if (reportDateTo) {
      const to = new Date(reportDateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter((c) => {
        const created = c.createdAt ? new Date(c.createdAt) : null
        return created && created <= to
      })
    }
    return result
  }, [filteredClients, reportDateFrom, reportDateTo])

  // Export to Excel
  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      const XLSX = await import('xlsx-js-style')
      const exportClients = getReportClients()

      // App primary color: #13DEFC (cyan)
      const primaryColor = '13DEFC'
      const primaryDark = '0BBDD6'
      const headerFontColor = 'FFFFFF'
      const lightBg = 'F0FDFF'
      const borderColor = 'D1D5DB'

      const headers = [
        'Nome',
        'Empresa',
        'Telefone',
        'Email',
        'Etapa',
        'Responsável',
        'Dias na Etapa',
        'Último Follow-up',
        'Status',
        'Data Cadastro',
      ]

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

      // Build title row
      const titleRow = [
        {
          v: `Relatório do Funil: ${funnelName}`,
          s: {
            font: { bold: true, sz: 14, color: { rgb: primaryDark }, name: 'Calibri' },
            alignment: { horizontal: 'left' as const, vertical: 'center' as const },
          },
        },
      ]

      const dateRow = [
        {
          v: `Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
          s: {
            font: { sz: 10, color: { rgb: '666666' }, italic: true, name: 'Calibri' },
            alignment: { horizontal: 'left' as const },
          },
        },
      ]

      const totalRow = [
        {
          v: `Total de contatos: ${exportClients.length}`,
          s: {
            font: { sz: 10, bold: true, color: { rgb: '444444' }, name: 'Calibri' },
            alignment: { horizontal: 'left' as const },
          },
        },
      ]

      // Build header row with styles
      const styledHeaders = headers.map((h) => ({ v: h, s: headerStyle }))

      // Build data rows with alternating colors
      const rows = exportClients.map((c, idx) => {
        const style = idx % 2 === 0 ? cellStyleEven : cellStyleOdd
        const centerStyle = { ...style, alignment: { ...style.alignment, horizontal: 'center' as const } }
        return [
          { v: c.name || '', s: style },
          { v: c.company || '', s: style },
          { v: c.phone || '', s: centerStyle },
          { v: c.email || '', s: style },
          { v: funnelStages.find((st) => st.id === c.funnelStage)?.name || '', s: centerStyle },
          { v: c.assignedToName || 'Sem responsável', s: centerStyle },
          {
            v: c.funnelStageUpdatedAt
              ? Math.floor((Date.now() - new Date(c.funnelStageUpdatedAt).getTime()) / 86400000)
              : '',
            s: centerStyle,
          },
          {
            v: c.lastFollowUpAt ? new Date(c.lastFollowUpAt).toLocaleDateString('pt-BR') : '',
            s: centerStyle,
          },
          { v: c.status || '', s: centerStyle },
          {
            v: c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '',
            s: centerStyle,
          },
        ]
      })

      // Assemble sheet: title + date + total + blank + headers + data
      const sheetData = [titleRow, dateRow, totalRow, [], styledHeaders, ...rows]
      const ws = XLSX.utils.aoa_to_sheet(sheetData)

      // Merge title row across all columns
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
      ]

      // Set column widths for good readability
      ws['!cols'] = [
        { wch: 28 }, // Nome
        { wch: 24 }, // Empresa
        { wch: 18 }, // Telefone
        { wch: 30 }, // Email
        { wch: 20 }, // Etapa
        { wch: 22 }, // Responsável
        { wch: 14 }, // Dias na Etapa
        { wch: 18 }, // Último Follow-up
        { wch: 14 }, // Status
        { wch: 16 }, // Data Cadastro
      ]

      // Set row heights
      ws['!rows'] = [
        { hpt: 30 }, // Title
        { hpt: 18 }, // Date
        { hpt: 18 }, // Total
        { hpt: 10 }, // Blank spacer
        { hpt: 28 }, // Headers
        ...rows.map(() => ({ hpt: 22 })),
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Contatos')
      XLSX.writeFile(wb, `relatorio_${funnelName}_${new Date().toISOString().split('T')[0]}.xlsx`)
      toast.success('Relatório Excel exportado com sucesso')
    } catch (error) {
      console.error('Erro ao exportar Excel:', error)
      toast.error('Erro ao exportar relatório')
    } finally {
      setExportingExcel(false)
    }
  }

  // Generate PDF summary
  const handleGeneratePdf = async () => {
    setExportingPdf(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const exportClients = getReportClients()

      const doc = new jsPDF()

      // Header
      doc.setFontSize(22)
      doc.setTextColor(19, 222, 252)
      doc.text('Voxium', 14, 20)
      doc.setFontSize(10)
      doc.setTextColor(100, 100, 100)
      doc.text(`Funil: ${funnelName}`, 14, 28)
      if (reportDateFrom || reportDateTo) {
        doc.text(`Período: ${reportDateFrom || '...'} a ${reportDateTo || '...'}`, 14, 34)
      }
      doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, reportDateFrom || reportDateTo ? 40 : 34)

      // KPIs
      const totalContatos = exportClients.length
      const stageBreakdown: Record<string, number> = {}
      exportClients.forEach((c) => {
        const stageName = funnelStages.find((s) => s.id === c.funnelStage)?.name || 'Sem etapa'
        stageBreakdown[stageName] = (stageBreakdown[stageName] || 0) + 1
      })

      let yPos = reportDateFrom || reportDateTo ? 50 : 44
      doc.setFontSize(14)
      doc.setTextColor(30, 30, 30)
      doc.text('Resumo', 14, yPos)
      yPos += 8

      doc.setFontSize(10)
      doc.text(`Total de contatos: ${totalContatos}`, 14, yPos)
      yPos += 6

      // Stage breakdown table
      const stageRows = Object.entries(stageBreakdown).map(([stage, count]) => [
        stage,
        String(count),
        `${totalContatos > 0 ? Math.round((count / totalContatos) * 100) : 0}%`,
      ])

      autoTable(doc, {
        startY: yPos + 4,
        head: [['Etapa', 'Contatos', '%']],
        body: stageRows,
        theme: 'striped',
        headStyles: { fillColor: [19, 222, 252] },
      })

      doc.save(`resumo_${funnelName}_${new Date().toISOString().split('T')[0]}.pdf`)
      toast.success('Resumo PDF gerado com sucesso')
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      toast.error('Erro ao gerar resumo PDF')
    } finally {
      setExportingPdf(false)
    }
  }

  // Save sales speech
  const handleSaveComments = async () => {
    if (!selectedClient) return
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        needsDetail: contactComments,
        updatedAt: new Date().toISOString(),
      })
      setEditingComments(false)
    } catch (error) {
      console.error('Error saving speech:', error)
    }
  }

  // Assign responsible member (Story 11.4)
  const handleAssignResponsible = async (memberId: string, memberName: string) => {
    if (!selectedClient) return
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        assignedTo: memberId || '',
        assignedToName: memberName || '',
        assignedAt: memberId ? new Date().toISOString() : '',
        updatedAt: new Date().toISOString(),
      })
      setSelectedClient({ ...selectedClient, assignedTo: memberId || undefined, assignedToName: memberName || undefined, assignedAt: memberId ? new Date().toISOString() : undefined })
      setShowResponsibleDropdown(false)
    } catch (error) {
      console.error('Error assigning responsible:', error)
    }
  }

  const canEditResponsible = member?.role === 'admin' || member?.role === 'manager' || member?.permissions?.actions?.canEditContacts || member?.permissions?.actions?.canTransferLeads

  // Update cost center
  const handleUpdateCostCenter = async (costCenterId: string | null) => {
    if (!selectedClient) return
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        costCenterId: costCenterId || deleteField(),
        updatedAt: new Date().toISOString(),
      })
      setSelectedClient({ ...selectedClient, costCenterId: costCenterId || undefined })
      toast.success('Centro de custos atualizado')
    } catch (error) {
      console.error('Error updating cost center:', error)
      toast.error('Erro ao atualizar centro de custos')
    }
  }

  // Update deal value
  const handleUpdateDealValue = async (value: number | null) => {
    if (!selectedClient) return
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        dealValue: value !== null ? value : deleteField(),
        updatedAt: new Date().toISOString(),
      })
      setSelectedClient({ ...selectedClient, dealValue: value ?? undefined })
      toast.success('Valor do negócio atualizado')
    } catch (error) {
      console.error('Error updating deal value:', error)
      toast.error('Erro ao atualizar valor do negócio')
    }
  }

  // Update closing probability (Story 21.2)
  const handleUpdateProbability = async (value: number | null) => {
    if (!selectedClient) return
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), {
        closingProbability: value !== null ? value : deleteField(),
        updatedAt: new Date().toISOString(),
      })
      setSelectedClient({ ...selectedClient, closingProbability: value ?? undefined })
      toast.success(value !== null ? 'Probabilidade atualizada' : 'Probabilidade resetada para padrão da etapa')
    } catch (error) {
      console.error('Error updating probability:', error)
      toast.error('Erro ao atualizar probabilidade')
    }
  }

  // Move client to another funnel (Story 21.2, updated Story 24.1 — inline dropdown)
  const handleMoveToFunnel = async (targetFunnelOverride?: string, targetStageOverride?: string) => {
    if (!selectedClient) return
    const targetFunnel = targetFunnelOverride || moveFunnelTarget
    const targetStage = targetStageOverride || moveFunnelStage
    if (!targetFunnel || !targetStage) return
    const targetFunnelName = allOrgFunnels.find(f => f.id === targetFunnel)?.name || 'Funil destino'
    const targetStageName = moveFunnelStages.find(s => s.id === targetStage)?.name || 'Etapa destino'
    setMovingFunnel(true)
    try {
      const now = new Date().toISOString()

      await updateDoc(doc(db, 'clients', selectedClient.id), {
        funnelId: targetFunnel,
        funnelStage: targetStage,
        funnelStageUpdatedAt: now,
        updatedAt: now,
        // Clear cadence fields
        currentCadenceStepId: deleteField(),
        lastCadenceActionAt: deleteField(),
        lastCadenceStepResponded: deleteField(),
        // Reset individual probability
        closingProbability: deleteField(),
      })

      // Add log
      const authorName = member?.displayName || userEmail || 'Sistema'
      await addDoc(collection(db, 'clients', selectedClient.id, 'logs'), {
        action: 'funnel_transfer',
        message: `Movido para funil ${targetFunnelName} → etapa ${targetStageName}`,
        text: `Cliente movido para funil ${targetFunnelName} → etapa ${targetStageName}`,
        type: 'audit',
        orgId,
        author: authorName,
        authorId: member?.id || '',
        metadata: {
          fromFunnelId: funnelId,
          toFunnelId: targetFunnel,
          toStageId: targetStage,
          toFunnelName: targetFunnelName,
          toStageName: targetStageName,
        },
        createdAt: now,
      })

      toast.success(`Cliente movido para ${targetFunnelName} → ${targetStageName}`)
      setSelectedClient(null)
      setMoveFunnelTarget('')
      setMoveFunnelStage('')
    } catch (error) {
      console.error('Error moving client to funnel:', error)
      toast.error('Erro ao mover cliente para outro funil')
    } finally {
      setMovingFunnel(false)
      setFunnelDropdownOpen(false)
      setFunnelDropdownStep('funnels')
    }
  }

  // Quick follow-up from table
  const handleQuickFollowUp = async () => {
    if (!quickFollowUpClient || !quickFollowUpText.trim()) return
    setSavingQuickFollowUp(true)
    try {
      const now = new Date().toISOString()
      await addDoc(collection(db, 'clients', quickFollowUpClient.id, 'followups'), {
        text: quickFollowUpText.trim(),
        author: userEmail || 'Usuário',
        createdAt: now,
        type: 'note',
        orgId,
      })
      await updateDoc(doc(db, 'clients', quickFollowUpClient.id), {
        lastFollowUpAt: now,
        updatedAt: now,
      })
      setQuickFollowUpClient(null)
      setQuickFollowUpText('')
    } catch (error) {
      console.error('Error saving quick follow-up:', error)
    } finally {
      setSavingQuickFollowUp(false)
    }
  }

  // Quick stage change from table
  const handleQuickStageChange = async (clientId: string, newStageId: string | null) => {
    try {
      const now = new Date().toISOString()
      const updateData: Record<string, unknown> = {
        funnelStage: newStageId,
        funnelId: newStageId ? funnelId : '',
        funnelStageUpdatedAt: now,
        updatedAt: now,
      }

      // Auto-enroll in cadence if target stage has cadence steps
      if (newStageId) {
        const stageSteps = cadenceSteps
          .filter(s => s.stageId === newStageId && s.isActive && !s.parentStepId)
          .sort((a, b) => a.order - b.order)
        if (stageSteps.length > 0) {
          updateData.currentCadenceStepId = stageSteps[0].id
          updateData.lastCadenceActionAt = now
          updateData.lastCadenceStepResponded = false
        } else {
          updateData.currentCadenceStepId = ''
        }
      }

      await updateDoc(doc(db, 'clients', clientId), updateData as any)
      setChangingStageClient(null)
    } catch (error) {
      console.error('Error changing stage:', error)
    }
  }

  // Schedule return for client
  const handleScheduleReturn = async () => {
    if (!schedulingReturnClient || !selectedReturnDate) return
    setSavingReturn(true)
    try {
      // Use T12:00:00 to create date in local timezone at noon, preserving the selected date
      const returnDate = new Date(selectedReturnDate + 'T12:00:00')
      const now = new Date().toISOString()
      const scheduledReturnISO = returnDate.toISOString()

      await updateDoc(doc(db, 'clients', schedulingReturnClient.id), {
        scheduledReturn: scheduledReturnISO,
        lastFollowUpAt: now,
        updatedAt: now,
      })

      // Also add a log entry
      await addDoc(collection(db, 'clients', schedulingReturnClient.id, 'logs'), {
        text: `Agendamento para ${returnDate.toLocaleDateString('pt-BR')}`,
        author: 'Sistema',
        createdAt: now,
        orgId,
      })

      // Update selectedClient state to reflect the change immediately
      if (selectedClient && selectedClient.id === schedulingReturnClient.id) {
        setSelectedClient({ ...selectedClient, scheduledReturn: scheduledReturnISO })
      }

      setSchedulingReturnClient(null)
      setSelectedReturnDate('')
    } catch (error) {
      console.error('Error scheduling return:', error)
    } finally {
      setSavingReturn(false)
    }
  }

  // Remove scheduled return
  const handleRemoveScheduledReturn = async (clientId: string) => {
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        scheduledReturn: deleteField(),
        updatedAt: new Date().toISOString(),
      })
      // Update selectedClient state to reflect the change immediately
      if (selectedClient && selectedClient.id === clientId) {
        setSelectedClient({ ...selectedClient, scheduledReturn: undefined })
      }
    } catch (error) {
      console.error('Error removing scheduled return:', error)
    }
  }

  // Poll VAPI call status until it ends, then CRM is updated server-side
  const pollCallResult = useCallback(async (callId: string, client: Cliente) => {
    console.log(`[POLL] Iniciando polling para call ${callId}, cliente ${client.name} (${client.id})`)

    const phones = (client.phone || '').split(/[,;\/\n]+/).map(p => p.trim()).filter(Boolean)
      .map(p => { const d = p.replace(/\D/g, ''); return d.length >= 10 ? (d.startsWith('55') ? `+${d}` : `+55${d}`) : '' })
      .filter(Boolean)
    const params = new URLSearchParams({
      callId,
      clientId: client.id,
      prospectName: client.name || '',
      prospectCompany: client.company || '',
      phones: phones.join(','),
      phoneIndex: '0',
    })

    console.log(`[POLL] Params:`, Object.fromEntries(params.entries()))

    // Iniciar status ativo na UI
    setActiveCallStatus({
      clientName: client.name || 'Contato',
      clientId: client.id,
      callId,
      status: 'initiating',
      startedAt: Date.now(),
    })

    const maxPolls = 90 // 15 minutos
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 10000)) // 10s entre polls
      try {
        console.log(`[POLL] Poll ${i + 1}/${maxPolls} para call ${callId}...`)
        const res = await fetch(`/api/vapi/poll-call?${params.toString()}`, {
          headers: {
            ...(userEmail ? { 'x-user-email': userEmail } : {}),
            ...(orgId ? { 'x-org-id': orgId } : {}),
          },
        })
        const data = await res.json()
        console.log(`[POLL] Resposta poll ${i + 1}:`, data)

        if (data.status === 'in_progress') {
          // Atualizar status na UI a cada poll
          setActiveCallStatus(prev => prev ? {
            ...prev,
            callId: params.get('callId') || callId,
            status: data.callStatus || 'in-progress',
            callStatus: data.callStatus,
          } : null)
          continue
        }

        if (data.status === 'retry') {
          console.log(`[POLL] Retry: nova call ${data.newCallId}, phoneIndex ${data.phoneIndex}`)
          params.set('callId', data.newCallId)
          params.set('phoneIndex', String(data.phoneIndex))
          // Atualizar UI com info do retry
          setActiveCallStatus(prev => prev ? {
            ...prev,
            callId: data.newCallId,
            status: 'ringing',
            callStatus: `Tentando telefone ${data.phoneIndex + 1}...`,
          } : null)
          continue
        }

        if (data.status === 'completed') {
          console.log(`[POLL] Concluído! Resultado: ${data.resultado}`)
          setActiveCallStatus(prev => prev ? {
            ...prev,
            status: 'completed',
            resultado: data.resultado,
            duration: data.duration,
          } : null)
          toast.success(`Resultado registrado: ${data.resultado}`)
          // Manter visível por 8s e depois limpar
          setTimeout(() => setActiveCallStatus(null), 8000)
          return
        }

        if (data.status === 'error') {
          console.error('[POLL] Erro:', data.message)
          setActiveCallStatus(prev => prev ? {
            ...prev,
            status: 'error',
            resultado: data.message,
          } : null)
          toast.error(`Erro ao processar resultado da ligação: ${data.message}`)
          setTimeout(() => setActiveCallStatus(null), 8000)
          return
        }
      } catch (err) {
        console.error(`[POLL] Erro no fetch (poll ${i + 1}):`, err)
      }
    }
    console.warn('[POLL] Timeout: polling encerrado sem resultado')
    setActiveCallStatus(null)
  }, [])

  // Handle call contact via voice agent
  const handleCallContact = async () => {
    if (!selectedClient || callingContact) return
    setCallingContact(true)
    // Mostrar status imediatamente enquanto a API responde
    setActiveCallStatus({
      clientName: selectedClient.name || 'Contato',
      clientId: selectedClient.id,
      callId: '',
      status: 'initiating',
      startedAt: Date.now(),
    })
    try {
      const res = await fetch('/api/call-routing/call-contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userEmail ? { 'x-user-email': userEmail } : {}),
          ...(orgId ? { 'x-org-id': orgId } : {}),
        },
        body: JSON.stringify({
          clientId: selectedClient.id,
          name: selectedClient.name,
          phone: selectedClient.phone,
          company: selectedClient.company,
          industry: selectedClient.industry,
          orgId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao iniciar ligação')
      }
      toast.success(`Ligação iniciada para ${selectedClient.name}`)
      setShowCallConfirm(false)

      // Iniciar polling em background para capturar resultado da ligação
      console.log(`[CALL] Ligação iniciada: ${data.callId}. Iniciando polling...`)
      pollCallResult(data.callId, selectedClient)
    } catch (error) {
      console.error('Error calling contact:', error)
      toast.error(String(error instanceof Error ? error.message : 'Erro ao iniciar ligação'))
      setActiveCallStatus(null)
    } finally {
      setCallingContact(false)
    }
  }

  // Clear all table filters - memoized
  const clearTableFilters = useCallback(() => {
    setTableColumnFilters({})
    setActiveFilterColumn(null)
    setStageTablePages({})
  }, [])

  // Reset bulk move modal
  const resetBulkMoveModal = useCallback(() => {
    setShowBulkMoveModal(false)
    setShowBulkMoveConfirm(false)
    setExecutingBulkMove(false)
    setBulkMoveFromStage('')
    setBulkMoveToStage('')
    setBulkMoveFilters({
      capitalSocialMin: 0,
      capitalSocialMax: 0,
      porteEmpresa: [],
      municipio: '',
      tipo: '',
      naturezaJuridica: '',
      estado: '',
      costCenterId: '',
    })
  }, [])

  // Execute bulk move
  const executeBulkMove = useCallback(async () => {
    if (!bulkMoveToStage || bulkMoveFilteredClients.length === 0) return

    setExecutingBulkMove(true)
    const now = new Date().toISOString()
    const toStageName = funnelStages.find(s => s.id === bulkMoveToStage)?.name || 'Nova etapa'
    const fromStageName = funnelStages.find(s => s.id === bulkMoveFromStage)?.name || 'Etapa anterior'

    try {
      // Find first cadence step for the target stage
      const targetStageSteps = cadenceSteps
        .filter(s => s.stageId === bulkMoveToStage && s.isActive && !s.parentStepId)
        .sort((a, b) => a.order - b.order)
      const firstCadenceStep = targetStageSteps[0] || null

      // Update all filtered clients
      const updatePromises = bulkMoveFilteredClients.map(async (client) => {
        const updateData: Record<string, unknown> = {
          funnelStage: bulkMoveToStage,
          funnelId,
          funnelStageUpdatedAt: now,
          updatedAt: now,
        }
        // Auto-enroll in cadence
        if (firstCadenceStep) {
          updateData.currentCadenceStepId = firstCadenceStep.id
          updateData.lastCadenceActionAt = now
          updateData.lastCadenceStepResponded = false
        } else {
          updateData.currentCadenceStepId = ''
        }
        // Update client stage
        await updateDoc(doc(db, 'clients', client.id), updateData as any)

        // Add log entry
        await addDoc(collection(db, 'clients', client.id, 'logs'), {
          text: `Movido em massa de "${fromStageName}" para "${toStageName}"`,
          author: userEmail || 'Sistema',
          createdAt: now,
          orgId,
        })
      })

      await Promise.all(updatePromises)

      toast.success(`${bulkMoveFilteredClients.length} contato(s) movido(s) com sucesso!`)
      resetBulkMoveModal()
    } catch (error) {
      console.error('Error executing bulk move:', error)
      toast.error('Erro ao mover contatos. Tente novamente.')
    } finally {
      setExecutingBulkMove(false)
    }
  }, [bulkMoveToStage, bulkMoveFromStage, bulkMoveFilteredClients, funnelStages, funnelId, userEmail, resetBulkMoveModal])

  // Get clients for bulk cost center change (clients in the selected stage)
  const bulkCostCenterClients = useMemo(() => {
    if (!bulkCostCenterStage) return []
    if (bulkCostCenterStage === 'unassigned') {
      return clients.filter(c => !c.funnelStage)
    }
    return clients.filter(c => c.funnelStage === bulkCostCenterStage)
  }, [clients, bulkCostCenterStage])

  // Execute bulk cost center change
  const executeBulkCostCenterChange = useCallback(async () => {
    if (!bulkCostCenterStage || bulkCostCenterClients.length === 0) return

    setExecutingBulkCostCenter(true)
    const now = new Date().toISOString()
    const costCenterName = costCenters.find(cc => cc.id === bulkCostCenterId)?.name || 'Sem centro de custos'
    const stageName = bulkCostCenterStage === 'unassigned'
      ? 'Sem etapa'
      : funnelStages.find(s => s.id === bulkCostCenterStage)?.name || 'Etapa'

    try {
      const updatePromises = bulkCostCenterClients.map(async (client) => {
        await updateDoc(doc(db, 'clients', client.id), {
          costCenterId: bulkCostCenterId || deleteField(),
          updatedAt: now,
        })

        await addDoc(collection(db, 'clients', client.id, 'logs'), {
          text: bulkCostCenterId
            ? `Centro de custos alterado em massa para "${costCenterName}" (etapa: ${stageName})`
            : `Centro de custos removido em massa (etapa: ${stageName})`,
          author: userEmail || 'Sistema',
          createdAt: now,
          orgId,
        })
      })

      await Promise.all(updatePromises)

      toast.success(`Centro de custos de ${bulkCostCenterClients.length} contato(s) atualizado!`)
      setShowBulkCostCenterModal(false)
      setBulkCostCenterStage('')
      setBulkCostCenterId('')
    } catch (error) {
      console.error('Error executing bulk cost center change:', error)
      toast.error('Erro ao atualizar centro de custos. Tente novamente.')
    } finally {
      setExecutingBulkCostCenter(false)
    }
  }, [bulkCostCenterStage, bulkCostCenterClients, bulkCostCenterId, costCenters, funnelStages, userEmail])

  // Cross-funnel transfer: load all org funnels (Story 15.3)
  const [allOrgFunnels, setAllOrgFunnels] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(collection(db, 'organizations', orgId, 'funnels'), (snap) => {
      setAllOrgFunnels(snap.docs.map(d => ({ id: d.id, name: d.data().name as string })))
    })
    return () => unsub()
  }, [orgId])

  // Load stages for target funnel
  useEffect(() => {
    if (!crossFunnelTarget || !orgId) {
      setCrossFunnelStages([])
      return
    }
    const q = query(collection(db, 'funnelStages'), where('orgId', '==', orgId), where('funnelId', '==', crossFunnelTarget), orderBy('order'))
    const unsub = onSnapshot(q, (snap) => {
      setCrossFunnelStages(snap.docs.map(d => ({ id: d.id, name: d.data().name as string, order: d.data().order as number })))
    })
    return () => unsub()
  }, [crossFunnelTarget, orgId])

  // Load stages for move-client funnel target (Story 21.2)
  useEffect(() => {
    if (!moveFunnelTarget || !orgId) {
      setMoveFunnelStages([])
      return
    }
    const q = query(collection(db, 'funnelStages'), where('orgId', '==', orgId), where('funnelId', '==', moveFunnelTarget), orderBy('order'))
    const unsub = onSnapshot(q, (snap) => {
      setMoveFunnelStages(snap.docs.map(d => ({ id: d.id, name: d.data().name as string, order: d.data().order as number })))
    })
    return () => unsub()
  }, [moveFunnelTarget, orgId])

  // Reset move funnel state when selected client changes (Story 21.2 QA fix, Story 24.1)
  useEffect(() => {
    setMoveFunnelTarget('')
    setMoveFunnelStage('')
    setFunnelDropdownOpen(false)
    setFunnelDropdownStep('funnels')
  }, [selectedClient?.id])

  // Toggle bulk select for a single card
  const toggleBulkSelect = useCallback((clientId: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }, [])

  // Select all contacts in a stage
  const selectAllInStage = useCallback((stageId: string) => {
    const stageClients = clients.filter(c => c.funnelStage === stageId)
    setBulkSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = stageClients.every(c => next.has(c.id))
      if (allSelected) {
        stageClients.forEach(c => next.delete(c.id))
      } else {
        stageClients.forEach(c => next.add(c.id))
      }
      return next
    })
  }, [clients])

  // Execute cross-funnel transfer
  const executeCrossFunnelTransfer = useCallback(async () => {
    if (!crossFunnelTargetStage || bulkSelectedIds.size === 0) return
    setExecutingCrossFunnel(true)
    const now = new Date().toISOString()
    const targetFunnelName = allOrgFunnels.find(f => f.id === crossFunnelTarget)?.name || 'Funil destino'
    const targetStageName = crossFunnelStages.find(s => s.id === crossFunnelTargetStage)?.name || 'Etapa destino'
    try {
      const ids = Array.from(bulkSelectedIds)
      // Split into batches of 500
      for (let i = 0; i < ids.length; i += 500) {
        const batch = writeBatch(db)
        const chunk = ids.slice(i, i + 500)
        for (const clientId of chunk) {
          const ref = doc(db, 'clients', clientId)
          batch.update(ref, {
            funnelId: crossFunnelTarget,
            funnelStage: crossFunnelTargetStage,
            funnelStageUpdatedAt: now,
            updatedAt: now,
            // Clear cadence fields on transfer
            currentCadenceStepId: deleteField(),
            lastCadenceActionAt: deleteField(),
            lastCadenceStepResponded: deleteField(),
          })
        }
        await batch.commit()
        // Add logs in parallel (non-blocking — transfer already committed)
        await Promise.all(chunk.map(clientId =>
          addDoc(collection(db, 'clients', clientId, 'logs'), {
            text: `Transferido para "${targetFunnelName}" → "${targetStageName}"`,
            author: userEmail || 'Sistema',
            createdAt: now,
            orgId,
          }).catch(() => { /* log write failure is non-critical */ })
        ))
      }
      toast.success(`${ids.length} contato(s) transferido(s) para "${targetFunnelName}"!`)
      setBulkSelectMode(false)
      setBulkSelectedIds(new Set())
      setShowCrossFunnelModal(false)
      setCrossFunnelTarget('')
      setCrossFunnelTargetStage('')
    } catch (error) {
      console.error('Error executing cross-funnel transfer:', error)
      toast.error('Erro ao transferir contatos. Tente novamente.')
    } finally {
      setExecutingCrossFunnel(false)
    }
  }, [crossFunnelTargetStage, bulkSelectedIds, crossFunnelTarget, crossFunnelStages, allOrgFunnels, userEmail])

  // Check if table has active filters
  const hasActiveTableFilters = Object.values(tableColumnFilters).some((v) => v)

  // Calendar navigation - memoized
  const navigateCalendar = useCallback((direction: 'prev' | 'next') => {
    setCalendarDate((prev) => {
      const newDate = new Date(prev)
      if (calendarView === 'day') {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1))
      } else if (calendarView === 'week') {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7))
      } else {
        newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1))
      }
      return newDate
    })
  }, [calendarView])

  const goToToday = useCallback(() => {
    setCalendarDate(new Date())
  }, [])

  // Pagination handlers - memoized
  const handleStagePageChange = useCallback((stageId: string, page: number) => {
    setStagePages((prev) => ({ ...prev, [stageId]: page }))
  }, [])

  const handleStageTablePageChange = useCallback((stageName: string, page: number) => {
    setStageTablePages((prev) => ({ ...prev, [stageName]: page }))
  }, [])

  // Table sort handler for contacts today
  const handleTableSort = useCallback((key: TableSortKey) => {
    setTableSortConfig((prev) => {
      if (prev.key === key) {
        // Toggle direction if same key, or clear if already desc
        if (prev.direction === 'asc') {
          return { key, direction: 'desc' }
        } else {
          return { key: null, direction: 'desc' } // Clear sort
        }
      }
      // New key, start with ascending
      return { key, direction: 'asc' }
    })
    // Reset pagination when sorting changes
    setStageTablePages({})
  }, [])

  // Sort stage handler
  const handleSortStage = useCallback((stageId: string, type: 'stageTime' | 'lastContact') => {
    const currentType = sortType[stageId]
    const currentDirection = sortDirection[stageId]
    const isSameType = currentType === type

    // Primeiro clique: desc (mais recente primeiro). Depois alterna.
    let newDirection: 'asc' | 'desc'
    if (!isSameType || !currentDirection) {
      newDirection = 'desc'
    } else {
      newDirection = currentDirection === 'desc' ? 'asc' : 'desc'
    }

    setSortDirection((prev) => ({ ...prev, [stageId]: newDirection }))
    setSortType((prev) => ({ ...prev, [stageId]: type }))
    setSortMenuOpen(null)
    setStagePages({})
  }, [sortType, sortDirection])

  const handleForceCadence = useCallback(async () => {
    if (!forceCadenceStageId || !orgId) return
    setForcingCadence(true)
    try {
      const res = await fetch('/api/cadence/force-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, stageId: forceCadenceStageId, limit: forceCadenceLimit }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao forçar cadência')
      toast.success(data.message || `Cadência forçada para ${data.total} contatos`)
      setForceCadenceStageId(null)
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err))
    } finally {
      setForcingCadence(false)
    }
  }, [forceCadenceStageId, forceCadenceLimit, orgId])

  // Close sort menu when clicking outside
  useEffect(() => {
    if (!sortMenuOpen) return
    const handleClickOutside = () => setSortMenuOpen(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [sortMenuOpen])

  // Client selection handler - memoized
  const handleSelectClient = useCallback((client: Cliente) => {
    setSelectedClient(client)
  }, [])

  // Quick follow-up modal handler - memoized
  const handleOpenQuickFollowUp = useCallback((client: Cliente) => {
    setQuickFollowUpClient(client)
  }, [])

  // Stage change modal handler - memoized
  const handleOpenStageChange = useCallback((client: Cliente) => {
    setChangingStageClient(client)
  }, [])

  // Cadence action handler - opens modal with message template
  const handleCadenceAction = useCallback((client: ContactToday) => {
    setCadenceActionClient(client)
  }, [])

  // Mark response handler - opens modal to mark if client responded
  const handleMarkResponse = useCallback((client: ContactToday) => {
    setRespondedClient(client)
    setShowResponseModal(true)
  }, [])

  // Send WhatsApp directly (without cadence)
  const handleSendWhatsApp = useCallback((client: ContactToday) => {
    const phone = client.phone?.replace(/\D/g, '') || ''
    if (phone) {
      window.open(`https://wa.me/55${phone}`, '_blank')
    } else {
      toast.error('Contato sem telefone cadastrado')
    }
  }, [])

  // Send Email directly (without cadence)
  const handleSendEmail = useCallback((client: ContactToday) => {
    if (client.email) {
      window.open(`mailto:${client.email}`, '_blank')
    } else {
      toast.error('Contato sem e-mail cadastrado')
    }
  }, [])

  // Execute cadence action
  const executeCadenceAction = useCallback(async () => {
    if (!cadenceActionClient || !cadenceActionClient.currentStep) return

    setExecutingCadenceAction(true)
    const step = cadenceActionClient.currentStep

    try {
      // Register the action log
      await addDoc(collection(db, 'clients', cadenceActionClient.id, 'logs'), {
        type: 'cadence_action',
        action: step.contactMethod,
        stepId: step.id,
        stepName: step.name,
        message: step.messageTemplate || '',
        createdAt: new Date().toISOString(),
        orgId,
      })

      // Update lastFollowUpAt on client
      await updateDoc(doc(db, 'clients', cadenceActionClient.id), {
        lastFollowUpAt: new Date().toISOString(),
        currentCadenceStepId: step.id,
        lastCadenceActionAt: new Date().toISOString(),
      })

      // Open the action based on contact method
      const phone = cadenceActionClient.phone?.replace(/\D/g, '') || ''
      const message = encodeURIComponent(step.messageTemplate || '')

      if (step.contactMethod === 'whatsapp' && phone) {
        window.open(`https://wa.me/55${phone}?text=${message}`, '_blank')
      } else if (step.contactMethod === 'email' && cadenceActionClient.email) {
        window.open(`mailto:${cadenceActionClient.email}?subject=${encodeURIComponent(step.name)}&body=${message}`, '_blank')
      } else if (step.contactMethod === 'phone' && phone) {
        window.open(`tel:+55${phone}`, '_blank')
      }

      toast.success(`Ação "${step.name}" executada!`)
      setCadenceActionClient(null)
    } catch (error) {
      console.error('Erro ao executar ação de cadência:', error)
      toast.error('Erro ao registrar ação')
    } finally {
      setExecutingCadenceAction(false)
    }
  }, [cadenceActionClient])

  // Handle marking client response
  const handleClientResponse = useCallback(async (responded: boolean) => {
    if (!respondedClient || !respondedClient.currentStep) return

    const step = respondedClient.currentStep
    const now = new Date().toISOString()

    try {
      // Register response log
      await addDoc(collection(db, 'clients', respondedClient.id, 'logs'), {
        type: 'cadence_response',
        stepId: step.id,
        stepName: step.name,
        responded,
        createdAt: now,
        orgId,
      })

      // If responded, we might want to reset or move to a new flow
      // If not responded, we continue to the next step based on condition
      const nextStep = getNextCadenceStep(step, responded)

      // Update client with response status and lastFollowUpAt
      await updateDoc(doc(db, 'clients', respondedClient.id), {
        lastCadenceStepResponded: responded,
        lastFollowUpAt: now,
        ...(nextStep ? { currentCadenceStepId: nextStep.id } : {}),
      })

      if (nextStep) {
        toast.success(responded ? 'Cliente respondeu! Avançando no fluxo.' : `Sem resposta. Próximo step: ${nextStep.name}`)
      } else {
        toast.success(responded ? 'Cliente respondeu!' : 'Cadência finalizada.')
      }

      setShowResponseModal(false)
      setRespondedClient(null)
    } catch (error) {
      console.error('Erro ao marcar resposta:', error)
      toast.error('Erro ao registrar resposta')
    }
  }, [respondedClient, getNextCadenceStep])

  // Get contacts for a specific date
  const getContactsForDate = (date: Date) => {
    return contactsWithDueDates.filter((contact) => {
      const dueDate = contact.dueDate
      return (
        dueDate.getDate() === date.getDate() &&
        dueDate.getMonth() === date.getMonth() &&
        dueDate.getFullYear() === date.getFullYear()
      )
    })
  }

  // Get week days for calendar
  const getWeekDays = (date: Date) => {
    const startOfWeek = new Date(date)
    const day = startOfWeek.getDay()
    startOfWeek.setDate(startOfWeek.getDate() - day)

    const days: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek)
      d.setDate(d.getDate() + i)
      days.push(d)
    }
    return days
  }

  // Get month days for calendar
  const getMonthDays = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startDay = firstDay.getDay()

    const days: (Date | null)[] = []

    // Add empty slots for days before the first day of the month
    for (let i = 0; i < startDay; i++) {
      days.push(null)
    }

    // Add all days of the month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i))
    }

    return days
  }

  // Check if date is today
  const isToday = (date: Date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  // Funnel not found or no access
  if (funnelNotFound) {
    return (
      <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ExclamationTriangleIcon className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Funil nao encontrado</h3>
          <p className="text-sm text-gray-600 mb-6">
            Este funil nao existe ou voce nao tem permissao para visualiza-lo.
          </p>
          <button
            onClick={() => router.push('/funil')}
            className="inline-flex items-center px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            Voltar ao Hub de Funis
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50 flex flex-col">
      {/* Header with KPIs */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-20">
        <div className="px-6 py-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-6">
              <button
                onClick={() => router.push('/funil')}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                title="Voltar ao Hub de Funis"
              >
                <ChevronLeftIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Funis</span>
              </button>
              <div className="h-6 w-px bg-slate-200" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: funnelColor }} />
                  <h1 className="text-xl font-bold text-slate-800 truncate">{funnelName || 'Funil de Vendas'}</h1>
                  <span className="hidden sm:inline text-slate-300">·</span>
                  <span className="hidden sm:inline text-sm text-slate-500 flex-shrink-0">{globalMetrics.totalContacts} contato{globalMetrics.totalContacts !== 1 ? 's' : ''}</span>
                  {/* Automation Status Pill (clicável) */}
                  {autoConfig && (
                    <div className="relative hidden sm:block">
                      <span className="inline text-slate-300 mr-1">·</span>
                      <button
                        type="button"
                        onClick={() => setShowAutoPanel(!showAutoPanel)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          activeQueue
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : autoConfig.enabled
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          activeQueue ? 'bg-green-500 animate-pulse' : autoConfig.enabled ? 'bg-emerald-400' : 'bg-slate-400'
                        }`} />
                        {activeQueue ? (
                          <>
                            Ligando {activeQueue.completedItems}/{activeQueue.totalItems}
                            {activeQueue.activeCallsCount > 0 && ` · ${activeQueue.activeCallsCount} ativas`}
                          </>
                        ) : autoConfig.enabled ? 'Automações ativas' : 'Automações pausadas'}
                        <ChevronDownIcon className="w-3 h-3" />
                      </button>

                      {/* Painel expandido */}
                      {showAutoPanel && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowAutoPanel(false)} />
                          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl bg-white p-4 shadow-xl ring-1 ring-black/10">
                            <h4 className="text-sm font-semibold text-slate-900 mb-3">Status da Cadência</h4>

                            {/* Status geral */}
                            <div className="space-y-2 text-xs">
                              <div className="flex justify-between">
                                <span className="text-slate-500">Automação</span>
                                <span className={autoConfig.enabled ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                                  {autoConfig.enabled ? 'Ligada' : 'Desligada'}
                                </span>
                              </div>

                              {/* Último processamento */}
                              <div className="flex justify-between">
                                <span className="text-slate-500">Último cron</span>
                                <span className="text-slate-700 font-medium">
                                  {autoConfig.lastCronRunAt ? (() => {
                                    const mins = Math.round((Date.now() - new Date(autoConfig.lastCronRunAt).getTime()) / 60000)
                                    return mins < 1 ? 'agora' : mins < 60 ? `${mins} min atrás` : `${Math.round(mins / 60)}h atrás`
                                  })() : 'Nunca'}
                                </span>
                              </div>

                              {/* Ações do dia */}
                              {autoConfig.lastCronStats && (
                                <>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Ações hoje</span>
                                    <span className="text-slate-700 font-medium">
                                      {autoConfig.lastCronStats.todayActions} / {autoConfig.lastCronStats.maxActionsPerDay}
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                                    <div
                                      className="bg-primary-500 h-1.5 rounded-full transition-all"
                                      style={{ width: `${Math.min(100, (autoConfig.lastCronStats.todayActions / autoConfig.lastCronStats.maxActionsPerDay) * 100)}%` }}
                                    />
                                  </div>
                                </>
                              )}

                              {/* Último resultado */}
                              {autoConfig.lastCronStats && (
                                <div className="mt-2 pt-2 border-t border-slate-100">
                                  <p className="text-slate-500 mb-1">Último processamento:</p>
                                  <div className="grid grid-cols-2 gap-1">
                                    {autoConfig.lastCronStats.enrolled > 0 && (
                                      <span className="text-blue-600">{autoConfig.lastCronStats.enrolled} inscritos</span>
                                    )}
                                    {autoConfig.lastCronStats.success > 0 && (
                                      <span className="text-green-600">{autoConfig.lastCronStats.success} sucesso</span>
                                    )}
                                    {autoConfig.lastCronStats.failed > 0 && (
                                      <span className="text-red-600">{autoConfig.lastCronStats.failed} falhas</span>
                                    )}
                                    {autoConfig.lastCronStats.processed === 0 && autoConfig.lastCronStats.enrolled === 0 && (
                                      <span className="text-slate-400 col-span-2">Nenhuma ação pendente</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Fila ativa */}
                              {activeQueue && (
                                <div className="mt-2 pt-2 border-t border-slate-100">
                                  <p className="text-slate-500 mb-1">Fila de ligações:</p>
                                  <div className="flex justify-between">
                                    <span className="text-slate-700">Progresso</span>
                                    <span className="text-green-600 font-medium">{activeQueue.completedItems}/{activeQueue.totalItems}</span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                                    <div
                                      className="bg-green-500 h-1.5 rounded-full transition-all"
                                      style={{ width: `${activeQueue.totalItems > 0 ? (activeQueue.completedItems / activeQueue.totalItems) * 100 : 0}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between mt-1">
                                    <span>{activeQueue.activeCallsCount} ligando agora</span>
                                    {(activeQueue.failedItems || 0) > 0 && (
                                      <span className="text-red-500">{activeQueue.failedItems} falharam</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {!activeQueue && autoConfig.enabled && !autoConfig.lastCronStats && (
                                <p className="text-slate-400 mt-2 pt-2 border-t border-slate-100">
                                  Aguardando próximo ciclo do cron (a cada 15 min)
                                </p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* KPI Pills */}
              <div className="hidden lg:flex items-center gap-1.5 ml-3">
                <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  globalMetrics.overduePercent > 30
                    ? 'bg-red-50 text-red-700'
                    : globalMetrics.overduePercent > 15
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`} title={`${globalMetrics.totalOverdue} contatos em atraso`}>
                  <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                  {globalMetrics.overduePercent}%
                </div>
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700" title="Tempo médio no funil">
                  <ClockIcon className="w-3.5 h-3.5" />
                  {globalMetrics.avgDaysInFunnel}d
                </div>
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-700" title="Follow-ups para hoje">
                  <ChatBubbleIcon className="w-3.5 h-3.5" />
                  {todayFollowUpsCountMemo}
                </div>
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700" title="Probabilidade média de conversão">
                  <ChartBarIcon className="w-3.5 h-3.5" />
                  {globalMetrics.weightedProbability}%
                </div>
                {globalMetrics.totalPipelineValue > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700" title="Valor total do pipeline">
                    <CurrencyDollarIcon className="w-3.5 h-3.5" />
                    {formatCurrencyShort(globalMetrics.totalPipelineValue)}
                  </div>
                )}
                {globalMetrics.totalExpectedValue > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700" title="Valor esperado (ponderado por probabilidade)">
                    <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
                    {formatCurrencyShort(globalMetrics.totalExpectedValue)}
                  </div>
                )}
                {/* Credits Pill */}
                {!credits.loading && (
                  <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    credits.actionBalance === 0 || credits.minuteBalance === 0
                      ? 'bg-red-50 text-red-700'
                      : credits.actionBalance < 200 || credits.minuteBalance < 50
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`} title={`${credits.actionBalance} ações · ${credits.minuteBalance} minutos`}>
                    <BoltIcon className="w-3.5 h-3.5" />
                    {credits.actionBalance} ações · {credits.minuteBalance} min
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* View Mode Dropdown */}
              <div className="relative">
                <select
                  value={viewMode}
                  onChange={e => setViewMode(e.target.value as ViewMode)}
                  className="appearance-none bg-white rounded-lg ring-1 ring-slate-200 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 cursor-pointer hover:ring-primary-300 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="kanban">Kanban</option>
                  <option value="table">Hoje{contactsToday.length > 0 ? ` (${contactsToday.length})` : ''}</option>
                  <option value="calendar">Calendario</option>
                  <option value="activity">Log</option>
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>

              {/* Search, Period Filters, and Export */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por nome, telefone, CNPJ, sócios..."
                    className="w-48 sm:w-64 lg:w-80 pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white/80"
                  />
                </div>

                {/* Responsible filter for admin/manager */}
                {viewScope === 'all' && (
                  <select
                    value={filterAssignedTo}
                    onChange={(e) => setFilterAssignedTo(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                  >
                    <option value="">Todos responsáveis</option>
                    <option value="__none__">Sem responsável</option>
                    {Array.from(new Set(clients.filter(c => c.assignedToName).map(c => JSON.stringify({ id: c.assignedTo, name: c.assignedToName })))).map(json => {
                      const m = JSON.parse(json) as { id: string; name: string }
                      return <option key={m.id} value={m.id}>{m.name}</option>
                    })}
                  </select>
                )}

                {/* Advanced Filters Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      activeAdvancedFiltersCount > 0
                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-400'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <FunnelIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">Filtros</span>
                    {activeAdvancedFiltersCount > 0 && (
                      <span className="flex items-center justify-center w-5 h-5 bg-primary-600 text-white text-xs rounded-full font-bold">
                        {activeAdvancedFiltersCount}
                      </span>
                    )}
                  </button>

                  {/* Advanced Filters Panel */}
                  {showAdvancedFilters && (
                      <div className="absolute right-0 top-12 z-50 w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        {/* Panel Header */}
                        <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-purple-50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                                <FunnelIcon className="w-4 h-4 text-primary-600" />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-slate-800">Filtros Avançados</h4>
                                <p className="text-xs text-slate-500">Filtre contatos por qualquer campo</p>
                              </div>
                            </div>
                            {activeAdvancedFiltersCount > 0 && (
                              <button
                                onClick={clearAdvancedFilters}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors"
                              >
                                <Cross2Icon className="w-3.5 h-3.5" />
                                Limpar
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Panel Content */}
                        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-4">
                          {/* Capital Social Range */}
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                              Capital Social (R$)
                            </label>
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                placeholder="Mínimo"
                                value={advancedFilters.capitalSocialMin || ''}
                                onChange={(e) => setAdvancedFilters(prev => ({
                                  ...prev,
                                  capitalSocialMin: Number(e.target.value) || 0
                                }))}
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                              />
                              <span className="text-slate-400 text-sm">até</span>
                              <input
                                type="number"
                                placeholder="Máximo"
                                value={advancedFilters.capitalSocialMax || ''}
                                onChange={(e) => setAdvancedFilters(prev => ({
                                  ...prev,
                                  capitalSocialMax: Number(e.target.value) || 0
                                }))}
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                              />
                            </div>
                            {advancedFilterOptions.maxCapitalSocial > 0 && (
                              <p className="text-xs text-slate-400 mt-1">
                                Máximo na base: R$ {advancedFilterOptions.maxCapitalSocial.toLocaleString('pt-BR')}
                              </p>
                            )}
                          </div>

                          {/* Porte Empresa - Multi-select */}
                          {advancedFilterOptions.porteOptions.length > 0 && (
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-2">
                                Porte da Empresa
                              </label>
                              <div className="flex flex-wrap gap-2">
                                {advancedFilterOptions.porteOptions.map((porte) => (
                                  <button
                                    key={porte}
                                    type="button"
                                    onClick={() => {
                                      setAdvancedFilters(prev => ({
                                        ...prev,
                                        porteEmpresa: prev.porteEmpresa.includes(porte)
                                          ? prev.porteEmpresa.filter(p => p !== porte)
                                          : [...prev.porteEmpresa, porte]
                                      }))
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                      advancedFilters.porteEmpresa.includes(porte)
                                        ? 'bg-primary-100 text-primary-700 border-2 border-primary-400'
                                        : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
                                    }`}
                                  >
                                    {porte}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Two column grid for dropdowns */}
                          <div className="grid grid-cols-2 gap-3">
                            {/* Estado */}
                            {advancedFilterOptions.estadoOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Estado</label>
                                <select
                                  value={advancedFilters.estado}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, estado: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todos</option>
                                  {advancedFilterOptions.estadoOptions.map((e) => (
                                    <option key={e} value={e}>{e}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Cidade */}
                            {advancedFilterOptions.municipioOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Cidade</label>
                                <select
                                  value={advancedFilters.municipio}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, municipio: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todas</option>
                                  {advancedFilterOptions.municipioOptions.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Tipo */}
                            {advancedFilterOptions.tipoOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo</label>
                                <select
                                  value={advancedFilters.tipo}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, tipo: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todos</option>
                                  {advancedFilterOptions.tipoOptions.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Natureza Jurídica */}
                            {advancedFilterOptions.naturezaJuridicaOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Natureza Jurídica</label>
                                <select
                                  value={advancedFilters.naturezaJuridica}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, naturezaJuridica: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todas</option>
                                  {advancedFilterOptions.naturezaJuridicaOptions.map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Situação */}
                            {advancedFilterOptions.situacaoOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Situação</label>
                                <select
                                  value={advancedFilters.situacao}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, situacao: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todas</option>
                                  {advancedFilterOptions.situacaoOptions.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Setor/Indústria */}
                            {advancedFilterOptions.industryOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Setor</label>
                                <select
                                  value={advancedFilters.industry}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, industry: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todos</option>
                                  {advancedFilterOptions.industryOptions.map((i) => (
                                    <option key={i} value={i}>{i}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          {/* Divider */}
                          <div className="border-t border-slate-100 pt-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Filtros de Lead</p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Origem do Lead */}
                            {advancedFilterOptions.leadSourceOptions.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Origem</label>
                                <select
                                  value={advancedFilters.leadSource}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, leadSource: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todas</option>
                                  {advancedFilterOptions.leadSourceOptions.map((ls) => (
                                    <option key={ls} value={ls}>{ls}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Tipo de Lead */}
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo de Lead</label>
                              <select
                                value={advancedFilters.leadType}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, leadType: e.target.value as '' | 'Inbound' | 'Outbound' }))}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                              >
                                <option value="">Todos</option>
                                <option value="Inbound">Inbound</option>
                                <option value="Outbound">Outbound</option>
                              </select>
                            </div>

                            {/* Etapa do Funil */}
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-600 mb-1.5">Etapa do Funil</label>
                              <select
                                value={advancedFilters.funnelStage}
                                onChange={(e) => setAdvancedFilters(prev => ({ ...prev, funnelStage: e.target.value }))}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                              >
                                <option value="">Todas</option>
                                <option value="unassigned">Sem etapa</option>
                                {funnelStages.map((stage) => (
                                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Centro de Custos */}
                            {costCenters.length > 0 && (
                              <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">Centro de Custos</label>
                                <select
                                  value={advancedFilters.costCenterId}
                                  onChange={(e) => setAdvancedFilters(prev => ({ ...prev, costCenterId: e.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                >
                                  <option value="">Todos</option>
                                  {costCenters.map((cc) => (
                                    <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Panel Footer */}
                        <div className="p-4 border-t border-slate-100 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-slate-600">
                              <span className="font-medium">{filteredClients.length}</span> contato{filteredClients.length !== 1 ? 's' : ''} encontrado{filteredClients.length !== 1 ? 's' : ''}
                            </p>
                            <button
                              onClick={() => setShowAdvancedFilters(false)}
                              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
                            >
                              Aplicar
                            </button>
                          </div>
                        </div>
                      </div>
                  )}
                </div>

                {/* Period filter and export buttons moved to Report Modal (menu + > Gerar Relatório) */}
              </div>

              {/* Actions Menu */}
              <div className="relative">
                <button
                  onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                  className="flex items-center justify-center w-10 h-10 bg-primary-600 hover:bg-primary-700 rounded-xl text-white transition-colors shadow-sm"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>

                {actionsMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setActionsMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-12 z-50 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      <button
                        onClick={() => {
                          setShowNewContactModal(true)
                          setActionsMenuOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                          <UserPlusIcon className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Novo Contato</p>
                          <p className="text-xs text-slate-500">Adicionar lead ao funil</p>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setShowSettings(true)
                          setActionsMenuOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                          <GearIcon className="w-4 h-4 text-slate-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Configurar Etapas</p>
                          <p className="text-xs text-slate-500">Editar funil de vendas</p>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setShowBulkMoveModal(true)
                          setActionsMenuOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                          <ArrowsRightLeftIcon className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Mover em Massa</p>
                          <p className="text-xs text-slate-500">Mover cards entre etapas</p>
                        </div>
                      </button>

                      <Link
                        href="/ligacoes"
                        onClick={() => setActionsMenuOpen(false)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                          <PhoneIcon className="w-4 h-4 text-green-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Iniciar Ligações</p>
                          <p className="text-xs text-slate-500">Disparar ligações automáticas</p>
                        </div>
                      </Link>

                      {costCenters.length > 0 && (
                        <button
                          onClick={() => {
                            setShowBulkCostCenterModal(true)
                            setActionsMenuOpen(false)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                            <CurrencyDollarIcon className="w-4 h-4 text-primary-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">Centro de Custos em Massa</p>
                            <p className="text-xs text-slate-500">Alterar CC de etapa inteira</p>
                          </div>
                        </button>
                      )}

                      {can('canEditContacts') && (
                        <button
                          onClick={() => {
                            setBulkSelectMode(true)
                            setActionsMenuOpen(false)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                            <ArrowsRightLeftIcon className="w-4 h-4 text-violet-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">Transferir entre Funis</p>
                            <p className="text-xs text-slate-500">Selecionar e mover para outro funil</p>
                          </div>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setShowReportModal(true)
                          setActionsMenuOpen(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                          <ChartBarIcon className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Gerar Relatório</p>
                          <p className="text-xs text-slate-500">Excel, PDF e filtros por período</p>
                        </div>
                      </button>

                      <div className="my-2 border-t border-slate-100" />

                      <Link
                        href={`/cadencia?funnelId=${funnelId}`}
                        onClick={() => setActionsMenuOpen(false)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                          <SparklesIcon className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">Programar Cadencia</p>
                          <p className="text-xs text-slate-500">Fluxo de contatos por etapa</p>
                        </div>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile KPI Row */}
          <div className="flex lg:hidden items-center gap-1.5 mt-2.5 overflow-x-auto pb-1">
            <div className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
              globalMetrics.overduePercent > 30 ? 'bg-red-50 text-red-700' :
              globalMetrics.overduePercent > 15 ? 'bg-amber-50 text-amber-700' :
              'bg-emerald-50 text-emerald-700'
            }`}>
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              {globalMetrics.overduePercent}%
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
              <ClockIcon className="w-3.5 h-3.5" />
              {globalMetrics.avgDaysInFunnel}d
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-700">
              <ChatBubbleIcon className="w-3.5 h-3.5" />
              {todayFollowUpsCountMemo}
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
              <ChartBarIcon className="w-3.5 h-3.5" />
              {globalMetrics.weightedProbability}%
            </div>
            {globalMetrics.totalPipelineValue > 0 && (
              <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700" title="Valor total do pipeline">
                <CurrencyDollarIcon className="w-3.5 h-3.5" />
                {formatCurrencyShort(globalMetrics.totalPipelineValue)}
              </div>
            )}
            {globalMetrics.totalExpectedValue > 0 && (
              <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700" title="Valor esperado (ponderado por probabilidade)">
                <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
                {formatCurrencyShort(globalMetrics.totalExpectedValue)}
              </div>
            )}
          </div>

          {/* Active Filters Bar */}
          {activeAdvancedFiltersCount > 0 && (
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-slate-500">Filtros ativos:</span>

              {/* Capital Social Range */}
              {(advancedFilters.capitalSocialMin > 0 || advancedFilters.capitalSocialMax > 0) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Capital: {advancedFilters.capitalSocialMin > 0 ? `R$ ${advancedFilters.capitalSocialMin.toLocaleString('pt-BR')}` : '0'} - {advancedFilters.capitalSocialMax > 0 ? `R$ ${advancedFilters.capitalSocialMax.toLocaleString('pt-BR')}` : '∞'}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, capitalSocialMin: 0, capitalSocialMax: 0 }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Porte Empresa */}
              {advancedFilters.porteEmpresa.map(porte => (
                <span key={porte} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  {porte}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, porteEmpresa: prev.porteEmpresa.filter(p => p !== porte) }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              ))}

              {/* Estado */}
              {advancedFilters.estado && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Estado: {advancedFilters.estado}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, estado: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Municipio */}
              {advancedFilters.municipio && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Cidade: {advancedFilters.municipio}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, municipio: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Tipo */}
              {advancedFilters.tipo && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Tipo: {advancedFilters.tipo}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, tipo: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Natureza Juridica */}
              {advancedFilters.naturezaJuridica && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Nat. Jurídica: {advancedFilters.naturezaJuridica}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, naturezaJuridica: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Situacao */}
              {advancedFilters.situacao && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Situação: {advancedFilters.situacao}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, situacao: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Industry */}
              {advancedFilters.industry && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  Setor: {advancedFilters.industry}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, industry: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Lead Source */}
              {advancedFilters.leadSource && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium">
                  Origem: {advancedFilters.leadSource}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, leadSource: '' }))}
                    className="hover:text-emerald-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Lead Type */}
              {advancedFilters.leadType && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                  advancedFilters.leadType === 'Inbound' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  Tipo: {advancedFilters.leadType}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, leadType: '' }))}
                    className="hover:opacity-80"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Funnel Stage */}
              {advancedFilters.funnelStage && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">
                  Etapa: {advancedFilters.funnelStage === 'unassigned' ? 'Sem etapa' : funnelStages.find(s => s.id === advancedFilters.funnelStage)?.name || advancedFilters.funnelStage}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, funnelStage: '' }))}
                    className="hover:text-amber-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Cost Center */}
              {advancedFilters.costCenterId && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium">
                  CC: {costCenters.find(cc => cc.id === advancedFilters.costCenterId)?.name || advancedFilters.costCenterId}
                  <button
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, costCenterId: '' }))}
                    className="hover:text-primary-900"
                  >
                    <Cross2Icon className="w-3 h-3" />
                  </button>
                </span>
              )}

              {/* Clear All Button */}
              <button
                onClick={clearAdvancedFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
              >
                <Cross2Icon className="w-3 h-3" />
                Limpar tudo
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-x-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : viewMode === 'table' ? (
          /* Table View - Contacts to contact today */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-red-50 to-orange-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-200">
                    <ExclamationTriangleIcon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Contatos para Hoje</h3>
                    <p className="text-xs text-slate-500">
                      {contactsToday.length} contato{contactsToday.length !== 1 ? 's' : ''}
                      {hasActiveTableFilters ? ' (filtrado)' : ' atrasado' + (contactsToday.length !== 1 ? 's' : '') + ' ou vencendo hoje'}
                      {hasActiveTableFilters && ` de ${contactsTodayRaw.length} total`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasActiveTableFilters && (
                    <button
                      onClick={clearTableFilters}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors"
                    >
                      <Cross2Icon className="w-3.5 h-3.5" />
                      Limpar filtros
                    </button>
                  )}
                  <p className="text-xs text-slate-500">
                    Apenas etapas que contam para métricas
                  </p>
                </div>
              </div>
            </div>

            {contactsTodayRaw.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <CheckIcon className="w-12 h-12 mb-3 text-emerald-400" />
                <p className="text-lg font-medium text-emerald-600">Tudo em dia!</p>
                <p className="text-sm">Nenhum contato atrasado ou vencendo hoje</p>
              </div>
            ) : contactsToday.length === 0 && hasActiveTableFilters ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <FunnelIcon className="w-12 h-12 mb-3" />
                <p className="text-lg font-medium text-slate-600">Nenhum resultado</p>
                <p className="text-sm">Tente ajustar os filtros</p>
                <button
                  onClick={clearTableFilters}
                  className="mt-3 px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                >
                  Limpar filtros
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-6">
                {/* Tables grouped by stage */}
                {paginatedContactsTodayByStage.map((stageData) => (
                  <div
                    key={stageData.stageName}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    {/* Stage Header */}
                    <div className={`px-4 py-3 border-b border-slate-100 ${stageData.stageColor.bg}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full bg-gradient-to-br ${stageData.stageColor.gradient}`} />
                          <h4 className={`text-sm font-bold ${stageData.stageColor.text}`}>
                            {stageData.stageName}
                          </h4>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${stageData.stageColor.bg} ${stageData.stageColor.text}`}>
                            {stageData.totalContacts} contato{stageData.totalContacts !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stage Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50/50">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('name')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Contato
                                {tableSortConfig.key === 'name' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('status')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Status
                                {tableSortConfig.key === 'status' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('stageName')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Etapa
                                {tableSortConfig.key === 'stageName' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('currentStep')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Step da Cadência
                                {tableSortConfig.key === 'currentStep' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('daysInStage')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Tempo na Etapa
                                {tableSortConfig.key === 'daysInStage' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              <button
                                onClick={() => handleTableSort('daysSinceLastFollowUp')}
                                className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                              >
                                Último FUP
                                {tableSortConfig.key === 'daysSinceLastFollowUp' && (
                                  <span className="text-primary-600">
                                    {tableSortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              Ações
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stageData.paginatedContacts.map((contact) => (
                            <TableRow
                              key={contact.id}
                              contact={contact}
                              onSelect={handleSelectClient}
                              onQuickFollowUp={handleOpenQuickFollowUp}
                              onChangeStage={handleOpenStageChange}
                              onCadenceAction={handleCadenceAction}
                              onMarkResponse={handleMarkResponse}
                              onSendWhatsApp={handleSendWhatsApp}
                              onSendEmail={handleSendEmail}
                              onCallContact={(c) => {
                                pendingCallConfirmRef.current = true
                                setSelectedClient(c)
                              }}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Stage Pagination */}
                    {stageData.totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/30">
                        <span className="text-xs text-slate-500">
                          {((stageData.currentPage - 1) * ITEMS_PER_STAGE_TABLE) + 1} - {Math.min(stageData.currentPage * ITEMS_PER_STAGE_TABLE, stageData.totalContacts)} de {stageData.totalContacts}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleStageTablePageChange(stageData.stageName, stageData.currentPage - 1)}
                            disabled={stageData.currentPage === 1}
                            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Anterior
                          </button>
                          <span className="px-2 py-1 text-xs font-medium text-slate-600">
                            {stageData.currentPage} / {stageData.totalPages}
                          </span>
                          <button
                            onClick={() => handleStageTablePageChange(stageData.stageName, stageData.currentPage + 1)}
                            disabled={stageData.currentPage === stageData.totalPages}
                            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Próximo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : viewMode === 'calendar' ? (
          /* Calendar View */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Calendar Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                    <CalendarDaysIcon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Calendário de Follow-ups</h3>
                    <p className="text-xs text-slate-500">
                      Visualize os prazos de contato
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Calendar View Selector */}
                  <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setCalendarView('day')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        calendarView === 'day' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Dia
                    </button>
                    <button
                      onClick={() => setCalendarView('week')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        calendarView === 'week' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Semana
                    </button>
                    <button
                      onClick={() => setCalendarView('month')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        calendarView === 'month' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Mês
                    </button>
                  </div>

                  {/* Navigation */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigateCalendar('prev')}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <ChevronLeftIcon className="w-4 h-4 text-slate-600" />
                    </button>
                    <button
                      onClick={goToToday}
                      className="px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium hover:bg-primary-200 transition-colors"
                    >
                      Hoje
                    </button>
                    <button
                      onClick={() => navigateCalendar('next')}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <ChevronRightIcon className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Current Date Display */}
              <div className="mt-3">
                <h4 className="text-lg font-bold text-slate-800">
                  {calendarView === 'day' && calendarDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  {calendarView === 'week' && `Semana de ${getWeekDays(calendarDate)[0].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} - ${getWeekDays(calendarDate)[6].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  {calendarView === 'month' && calendarDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </h4>
              </div>
            </div>

            {/* Calendar Content */}
            <div className="p-6">
              {calendarView === 'day' && (
                /* Day View - Expanded Google Calendar Style */
                <div className="h-[calc(100vh-320px)] min-h-[500px] flex flex-col">
                  {/* Day Header */}
                  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div className="flex items-center gap-4">
                      <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center ${
                        isToday(calendarDate) ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'
                      }`}>
                        <span className="text-[10px] uppercase font-medium opacity-80">
                          {calendarDate.toLocaleDateString('pt-BR', { weekday: 'short' })}
                        </span>
                        <span className="text-2xl font-bold leading-none">{calendarDate.getDate()}</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-slate-800">
                          {calendarDate.toLocaleDateString('pt-BR', { weekday: 'long' })}
                        </h3>
                        <p className="text-sm text-slate-500">
                          {calendarDate.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const contacts = getContactsForDate(calendarDate)
                        const overdueCount = contacts.filter(c => c.isOverdue).length
                        const dueTodayCount = contacts.filter(c => c.isDueToday).length
                        const scheduledCount = contacts.filter(c => c.isScheduledReturn).length
                        return (
                          <div className="flex items-center gap-2">
                            {overdueCount > 0 && (
                              <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                                {overdueCount} atrasado{overdueCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {dueTodayCount > 0 && (
                              <span className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium">
                                {dueTodayCount} vence hoje
                              </span>
                            )}
                            {scheduledCount > 0 && (
                              <span className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium flex items-center gap-1">
                                <CalendarDaysIcon className="w-3.5 h-3.5" />
                                {scheduledCount} retorno{scheduledCount > 1 ? 's' : ''}
                              </span>
                            )}
                            <span className="px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg text-sm font-medium">
                              {contacts.length} contato{contacts.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Day Content - Scrollable */}
                  <div className="flex-1 overflow-auto pt-4">
                    {getContactsForDate(calendarDate).length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <CalendarDaysIcon className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg font-medium">Nenhum contato para este dia</p>
                        <p className="text-sm mt-1">Navegue para outros dias ou adicione um novo contato</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {getContactsForDate(calendarDate).map((contact) => (
                          <div
                            key={contact.id}
                            onClick={() => setSelectedClient(contact)}
                            className={`p-5 rounded-2xl border-l-4 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.01] ${
                              contact.isScheduledReturn
                                ? 'border-orange-400 bg-orange-50 hover:bg-orange-100'
                                : contact.isOverdue
                                ? 'border-red-400 bg-red-50 hover:bg-red-100'
                                : contact.isDueToday
                                ? 'border-amber-400 bg-amber-50 hover:bg-amber-100'
                                : 'border-primary-400 bg-white hover:bg-slate-50 shadow-sm'
                            }`}
                          >
                            <div className="flex items-start gap-4">
                              {/* Avatar */}
                              {contact.photoUrl ? (
                                <Image src={contact.photoUrl} alt={contact.name} width={56} height={56} className="w-14 h-14 rounded-2xl object-cover shadow-sm" />
                              ) : (
                                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${contact.isScheduledReturn ? 'from-orange-500 to-amber-500' : contact.stageColor.gradient} flex items-center justify-center text-white font-bold text-lg shadow-sm`}>
                                  {contact.name?.charAt(0).toUpperCase()}
                                </div>
                              )}

                              {/* Contact Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-bold text-base text-slate-800">{contact.name}</h4>
                                      {contact.isScheduledReturn && (
                                        <span className="px-2 py-0.5 bg-orange-200 text-orange-800 rounded-full text-xs font-semibold flex items-center gap-1">
                                          <CalendarDaysIcon className="w-3 h-3" />
                                          Agendamento
                                        </span>
                                      )}
                                      {contact.isOverdue && !contact.isScheduledReturn && (
                                        <span className="px-2 py-0.5 bg-red-200 text-red-800 rounded-full text-xs font-semibold">
                                          Atrasado
                                        </span>
                                      )}
                                      {contact.isDueToday && !contact.isScheduledReturn && !contact.isOverdue && (
                                        <span className="px-2 py-0.5 bg-amber-200 text-amber-800 rounded-full text-xs font-semibold">
                                          Vence Hoje
                                        </span>
                                      )}
                                    </div>
                                    {contact.company && (
                                      <p className="text-sm text-slate-600 mt-0.5">{contact.company}</p>
                                    )}
                                  </div>
                                </div>

                                {/* Stage & Details */}
                                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                                  <span className={`px-2.5 py-1 rounded-lg bg-gradient-to-r ${contact.stageColor.gradient} text-white text-xs font-medium`}>
                                    {contact.stageName}
                                  </span>
                                  {!contact.isScheduledReturn && (
                                    <span className="text-slate-500">
                                      {contact.daysInStage} dias na etapa
                                    </span>
                                  )}
                                  {contact.phone && (
                                    <span className="text-slate-400 flex items-center gap-1">
                                      <PhoneIcon className="w-3.5 h-3.5" />
                                      {contact.phone}
                                    </span>
                                  )}
                                </div>

                                {/* Action Buttons */}
                                <div className="mt-4 flex items-center gap-2">
                                  {contact.phone && (
                                    <a
                                      href={`https://wa.me/${formatWhatsAppNumber(contact.phone)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200 transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <PhoneIcon className="w-3.5 h-3.5" />
                                      WhatsApp
                                    </a>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setQuickFollowUpClient(contact); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium hover:bg-primary-200 transition-colors"
                                  >
                                    <ChatBubbleIcon className="w-3.5 h-3.5" />
                                    Follow-up
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedClient(contact); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors"
                                  >
                                    <PersonIcon className="w-3.5 h-3.5" />
                                    Ver detalhes
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {calendarView === 'week' && (
                /* Week View - Google Calendar Style */
                <div className="flex flex-col h-[calc(100vh-320px)] min-h-[500px]">
                  {/* Week Header */}
                  <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                    {getWeekDays(calendarDate).map((date, idx) => {
                      const dayNames = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
                      const contacts = getContactsForDate(date)
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col items-center py-3 ${idx !== 6 ? 'border-r border-slate-200' : ''}`}
                        >
                          <span className="text-xs font-medium text-slate-500">{dayNames[idx]}</span>
                          <button
                            onClick={() => {
                              setCalendarDate(date)
                              setCalendarView('day')
                            }}
                            className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all hover:bg-primary-100 ${
                              isToday(date)
                                ? 'bg-primary-600 text-white hover:bg-primary-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {date.getDate()}
                          </button>
                          {contacts.length > 0 && (
                            <span className={`mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              contacts.some(c => c.isOverdue) ? 'bg-red-100 text-red-600' :
                              contacts.some(c => c.isDueToday) ? 'bg-amber-100 text-amber-600' :
                              'bg-primary-100 text-primary-600'
                            }`}>
                              {contacts.length}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Week Body - Scrollable columns */}
                  <div className="flex-1 overflow-auto">
                    <div className="grid grid-cols-7 h-full min-h-[400px]">
                      {getWeekDays(calendarDate).map((date, idx) => {
                        const contacts = getContactsForDate(date)
                        const hasOverdue = contacts.some((c) => c.isOverdue)
                        const hasDueToday = contacts.some((c) => c.isDueToday)

                        return (
                          <div
                            key={idx}
                            className={`flex flex-col p-2 ${idx !== 6 ? 'border-r border-slate-100' : ''} ${
                              isToday(date)
                                ? 'bg-primary-50/50'
                                : hasOverdue
                                ? 'bg-red-50/30'
                                : hasDueToday
                                ? 'bg-amber-50/30'
                                : 'bg-white'
                            }`}
                          >
                            {contacts.length === 0 ? (
                              <div className="flex-1 flex items-center justify-center">
                                <span className="text-xs text-slate-300">-</span>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {contacts.map((contact) => (
                                  <button
                                    key={contact.id}
                                    onClick={() => setSelectedClient(contact)}
                                    className={`w-full text-left p-2 rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all ${
                                      contact.isScheduledReturn
                                        ? 'bg-orange-50 border-orange-400 hover:bg-orange-100'
                                        : contact.isOverdue
                                        ? 'bg-red-50 border-red-400 hover:bg-red-100'
                                        : contact.isDueToday
                                        ? 'bg-amber-50 border-amber-400 hover:bg-amber-100'
                                        : 'bg-white border-primary-400 hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      {contact.photoUrl ? (
                                        <Image src={contact.photoUrl} alt={contact.name} width={28} height={28} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                                      ) : (
                                        <div className={`w-7 h-7 rounded-full flex-shrink-0 bg-gradient-to-br ${contact.isScheduledReturn ? 'from-orange-500 to-amber-500' : contact.stageColor.gradient} flex items-center justify-center text-white font-bold text-[10px]`}>
                                          {contact.name?.charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-xs text-slate-800 truncate">{contact.name}</p>
                                        <p className="text-[10px] text-slate-500 truncate">
                                          {contact.isScheduledReturn ? 'Agendamento' : contact.stageName}
                                        </p>
                                        {contact.isScheduledReturn && (
                                          <span className="inline-flex items-center gap-0.5 mt-0.5 px-1 py-0.5 bg-orange-100 text-orange-700 rounded text-[9px] font-medium">
                                            <CalendarDaysIcon className="w-2 h-2" />
                                            Agendamento
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {calendarView === 'month' && (
                /* Month View */
                <div>
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
                      <div key={day} className="text-center text-xs font-semibold text-slate-500 uppercase py-2">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {getMonthDays(calendarDate).map((date, idx) => {
                      if (!date) {
                        return <div key={idx} className="min-h-[80px]" />
                      }

                      const contacts = getContactsForDate(date)
                      const hasOverdue = contacts.some((c) => c.isOverdue)
                      const hasDueToday = contacts.some((c) => c.isDueToday)
                      const hasScheduledReturn = contacts.some((c) => c.isScheduledReturn)

                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            if (contacts.length > 0) {
                              setCalendarDate(date)
                              setCalendarView('day')
                            }
                          }}
                          className={`min-h-[80px] p-1.5 rounded-lg border text-left transition-all ${
                            contacts.length > 0 ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : 'cursor-default'
                          } ${
                            isToday(date)
                              ? 'border-primary-300 bg-primary-50'
                              : hasOverdue
                              ? 'border-red-200 bg-red-50/30'
                              : hasDueToday
                              ? 'border-amber-200 bg-amber-50/30'
                              : 'border-slate-100 bg-white'
                          }`}
                        >
                          <div className={`text-xs font-bold mb-1 ${isToday(date) ? 'text-primary-600' : 'text-slate-600'}`}>
                            {date.getDate()}
                          </div>
                          {contacts.length > 0 && (
                            <div className="space-y-0.5">
                              <div className={`text-xs px-1.5 py-0.5 rounded ${
                                hasOverdue ? 'bg-red-100 text-red-700' : hasDueToday ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {contacts.length} contato{contacts.length !== 1 ? 's' : ''}
                              </div>
                              {hasScheduledReturn && (
                                <div className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex items-center gap-0.5">
                                  <CalendarDaysIcon className="w-2.5 h-2.5" />
                                  Retorno
                                </div>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : viewMode === 'activity' ? (
          /* Activity Log View */
          <ActivityLogView clients={clients} />
        ) : (
          /* Kanban View */
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 min-w-max pb-4">
              {stageGroups.map((group) => {
                const macroColor = group.macroStage
                  ? getColorByIndex(parseInt(group.macroStage.color || '0'))
                  : null

                // If this is a macro stage group with multiple stages, render with a wrapper
                if (group.macroStage && group.stages.length > 0) {
                  return (
                    <div
                      key={`macro-${group.macroStage.id}`}
                      className={`relative rounded-2xl p-2 pt-8 border-2 ${macroColor?.border || 'border-slate-300'} bg-gradient-to-b from-${macroColor?.bg?.replace('bg-', '') || 'slate-50'} to-white/50`}
                      style={{
                        borderColor: macroColor ? undefined : '#cbd5e1',
                        background: `linear-gradient(to bottom, ${
                          macroColor?.gradient?.includes('blue') ? 'rgba(219, 234, 254, 0.5)' :
                          macroColor?.gradient?.includes('cyan') ? 'rgba(207, 250, 254, 0.5)' :
                          macroColor?.gradient?.includes('emerald') ? 'rgba(209, 250, 229, 0.5)' :
                          macroColor?.gradient?.includes('amber') ? 'rgba(254, 243, 199, 0.5)' :
                          macroColor?.gradient?.includes('orange') ? 'rgba(255, 237, 213, 0.5)' :
                          macroColor?.gradient?.includes('violet') ? 'rgba(237, 233, 254, 0.5)' :
                          macroColor?.gradient?.includes('pink') ? 'rgba(252, 231, 243, 0.5)' :
                          macroColor?.gradient?.includes('red') ? 'rgba(254, 226, 226, 0.5)' :
                          macroColor?.gradient?.includes('teal') ? 'rgba(204, 251, 241, 0.5)' :
                          'rgba(241, 245, 249, 0.5)'
                        }, rgba(255, 255, 255, 0.8))`
                      }}
                    >
                      {/* Macro Stage Label */}
                      <div
                        className={`absolute -top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-4 py-1.5 rounded-full text-xs font-bold shadow-sm bg-gradient-to-r ${macroColor?.gradient || 'from-slate-500 to-slate-600'} text-white whitespace-nowrap`}
                      >
                        {group.macroStage.name}
                      </div>

                      {/* Stages inside macro stage */}
                      <div className="flex gap-3">
                        {group.stages.map((stage) => {
                          const allStageClients = clientsByStage[stage.id] || []
                          const paginatedData = paginatedClientsByStage[stage.id] || { clients: [], totalPages: 1, currentPage: 1 }
                          const color = getColorByIndex(parseInt(stage.color || '0'))
                          const stats = stageStats[stage.id]

                          return (
                            <Droppable key={stage.id} droppableId={stage.id}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.droppableProps}
                                  className={`w-80 flex-shrink-0 bg-white rounded-xl border flex flex-col ${
                                    snapshot.isDraggingOver
                                      ? `${color.border} border-2 shadow-lg`
                                      : 'border-slate-200/60 shadow-sm'
                                  }`}
                                >
                                  {/* Column Header */}
                                  <div className={`px-4 py-3 border-b ${color.border} bg-gradient-to-r ${color.gradient} rounded-t-xl`}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-white">{stage.name}</h3>
                                        <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold text-white">
                                          {allStageClients.length}
                                        </span>
                                      </div>
                                      <div className="flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-1 text-white/80 text-xs">
                                          <ChartBarIcon className="w-3.5 h-3.5" />
                                          {stage.probability || 0}%
                                        </div>
                                        {(() => {
                                          const stageTotal = allStageClients.reduce((sum, c) => sum + (c.dealValue || 0), 0)
                                          const stageExpected = allStageClients.reduce((sum, c) => sum + ((c.dealValue || 0) * getClientProbability(c, stage) / 100), 0)
                                          return stageTotal > 0 ? (
                                            <div className="flex items-center gap-1.5 text-white/70 text-[10px]">
                                              <span title="Valor total">{formatCurrencyShort(stageTotal)}</span>
                                              <span className="text-white/40">&middot;</span>
                                              <span title="Valor esperado" className="text-emerald-200">{formatCurrencyShort(stageExpected)}</span>
                                            </div>
                                          ) : null
                                        })()}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-white/70">
                                      {bulkSelectMode && allStageClients.length > 0 && (
                                        <button
                                          onClick={() => selectAllInStage(stage.id)}
                                          className="px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-full text-white text-xs transition-colors"
                                        >
                                          {allStageClients.every(c => bulkSelectedIds.has(c.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
                                        </button>
                                      )}
                                      <span className="flex items-center gap-1">
                                        <ClockIcon className="w-3 h-3" />
                                        Média: {stats?.avgDays || 0}d
                                      </span>
                                      {stage.maxDays && (
                                        <span className="flex items-center gap-1">
                                          Prazo: {stage.maxDays}d
                                        </span>
                                      )}
                                      {/* Cadência + Sort */}
                                      <div className="flex items-center gap-1 ml-auto">
                                        <Link
                                          href={`/cadencia?funnelId=${funnelId}`}
                                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                                            cadenceSteps.some(s => s.stageId === stage.id && s.isActive)
                                              ? 'bg-white/30 text-white'
                                              : 'bg-white/10 hover:bg-white/20 text-white/80'
                                          }`}
                                          title={`Cadência: ${cadenceSteps.filter(s => s.stageId === stage.id).length} steps`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <SparklesIcon className="w-3 h-3" />
                                          {cadenceSteps.filter(s => s.stageId === stage.id).length > 0 && (
                                            <span>{cadenceSteps.filter(s => s.stageId === stage.id).length}</span>
                                          )}
                                        </Link>
                                        {cadenceSteps.some(s => s.stageId === stage.id && s.isActive) && (
                                          <button
                                            type="button"
                                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/30 text-white/80 hover:text-white transition-colors"
                                            title="Forçar cadência desta etapa"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setForceCadenceStageId(stage.id)
                                              setForceCadenceLimit(10)
                                            }}
                                          >
                                            <BoltIcon className="w-3 h-3" />
                                          </button>
                                        )}
                                        {/* Sort dropdown */}
                                        <div className="relative">
                                          <button
                                            type="button"
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                                              sortDirection[stage.id]
                                                ? 'bg-white/30 text-white'
                                                : 'bg-white/10 hover:bg-white/20 text-white/80'
                                            }`}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setSortMenuOpen(sortMenuOpen === stage.id ? null : stage.id)
                                            }}
                                            title="Ordenar cards"
                                          >
                                            <ChevronUpIcon className="w-3 h-3" />
                                            <ChevronDownIcon className="w-3 h-3 -ml-1.5" />
                                            {sortType[stage.id] === 'lastContact' ? 'Contato' : sortType[stage.id] === 'stageTime' ? 'Etapa' : 'Ordenar'}
                                            {sortDirection[stage.id] && (sortDirection[stage.id] === 'asc' ? ' ▲' : ' ▼')}
                                          </button>
                                          {sortMenuOpen === stage.id && (
                                            <div
                                              className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/10"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <button
                                                type="button"
                                                className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 transition-colors ${
                                                  sortType[stage.id] === 'lastContact' ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700'
                                                }`}
                                                onClick={() => handleSortStage(stage.id, 'lastContact')}
                                              >
                                                Por último contato {sortType[stage.id] === 'lastContact' && (sortDirection[stage.id] === 'asc' ? '▲' : '▼')}
                                              </button>
                                              <button
                                                type="button"
                                                className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 transition-colors ${
                                                  sortType[stage.id] === 'stageTime' ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700'
                                                }`}
                                                onClick={() => handleSortStage(stage.id, 'stageTime')}
                                              >
                                                Por tempo na etapa {sortType[stage.id] === 'stageTime' && (sortDirection[stage.id] === 'asc' ? '▲' : '▼')}
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Cards - Paginated */}
                                  <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-400px)] overflow-y-auto flex-1">
                                    {paginatedData.clients.map((client, index) => {
                                      const daysInStage = calculateDaysSince(client.funnelStageUpdatedAt)
                                      const isOverdue = stage.maxDays && daysInStage !== null && daysInStage > stage.maxDays
                                      const realIndex = ((paginatedData.currentPage - 1) * ITEMS_PER_PAGE) + index

                                      return (
                                        <div key={client.id} className={`relative ${bulkSelectMode ? 'flex items-start gap-2' : ''}`}>
                                          {bulkSelectMode && (
                                            <input
                                              type="checkbox"
                                              checked={bulkSelectedIds.has(client.id)}
                                              onChange={() => toggleBulkSelect(client.id)}
                                              className="mt-3 w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 flex-shrink-0 cursor-pointer"
                                            />
                                          )}
                                          <div className={bulkSelectMode ? 'flex-1' : ''}>
                                            <KanbanCard
                                              client={client}
                                              index={realIndex}
                                              daysInStage={daysInStage}
                                              lastContactDate={client.lastFollowUpAt}
                                              isOverdue={!!isOverdue}
                                              stageColor={color}
                                              stageName={stage.name}
                                              costCenterName={costCenters.find(cc => cc.id === client.costCenterId)?.name}
                                              proposalData={proposalsByClient[client.id]}
                                              icpColor={client.icpProfileId ? icpMap[client.icpProfileId]?.color : undefined}
                                              icpName={client.icpProfileId ? icpMap[client.icpProfileId]?.name : undefined}
                                              cadenceStepName={getCurrentCadenceStep(client, stage.id)?.name}
                                              onSelect={bulkSelectMode ? () => toggleBulkSelect(client.id) : handleSelectClient}
                                            />
                                          </div>
                                        </div>
                                      )
                                    })}
                                    {provided.placeholder}

                                    {allStageClients.length === 0 && (
                                      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                                        <UserGroupIcon className="w-8 h-8 mb-2" />
                                        <p className="text-xs">Nenhum contato</p>
                                      </div>
                                    )}
                                  </div>

                                  {/* Pagination */}
                                  {paginatedData.totalPages > 1 && (
                                    <Pagination
                                      currentPage={paginatedData.currentPage}
                                      totalPages={paginatedData.totalPages}
                                      onPageChange={(page) => handleStagePageChange(stage.id, page)}
                                    />
                                  )}
                                </div>
                              )}
                            </Droppable>
                          )
                        })}
                      </div>
                    </div>
                  )
                }

                // Single stage without macro stage - render normally
                const stage = group.stages[0]
                if (!stage) return null

                const allStageClients = clientsByStage[stage.id] || []
                const paginatedData = paginatedClientsByStage[stage.id] || { clients: [], totalPages: 1, currentPage: 1 }
                const color = getColorByIndex(parseInt(stage.color || '0'))
                const stats = stageStats[stage.id]

                return (
                  <Droppable key={stage.id} droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`w-80 flex-shrink-0 bg-white rounded-2xl border flex flex-col ${
                          snapshot.isDraggingOver
                            ? `${color.border} border-2 shadow-lg`
                            : 'border-slate-200/60 shadow-sm'
                        }`}
                      >
                        {/* Column Header */}
                        <div className={`px-4 py-3 border-b ${color.border} bg-gradient-to-r ${color.gradient} rounded-t-2xl`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-white">{stage.name}</h3>
                              <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold text-white">
                                {allStageClients.length}
                              </span>
                            </div>
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1 text-white/80 text-xs">
                                <ChartBarIcon className="w-3.5 h-3.5" />
                                {stage.probability || 0}%
                              </div>
                              {(() => {
                                const stageTotal = allStageClients.reduce((sum, c) => sum + (c.dealValue || 0), 0)
                                const stageExpected = allStageClients.reduce((sum, c) => sum + ((c.dealValue || 0) * getClientProbability(c, stage) / 100), 0)
                                return stageTotal > 0 ? (
                                  <div className="flex items-center gap-1.5 text-white/70 text-[10px]">
                                    <span title="Valor total">{formatCurrencyShort(stageTotal)}</span>
                                    <span className="text-white/40">&middot;</span>
                                    <span title="Valor esperado" className="text-emerald-200">{formatCurrencyShort(stageExpected)}</span>
                                  </div>
                                ) : null
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-white/70">
                            <span className="flex items-center gap-1">
                              <ClockIcon className="w-3 h-3" />
                              Média: {stats?.avgDays || 0}d
                            </span>
                            {stage.maxDays && (
                              <span className="flex items-center gap-1">
                                Prazo: {stage.maxDays}d
                              </span>
                            )}
                            {/* Cadência + Sort */}
                            <div className="flex items-center gap-1 ml-auto">
                              <Link
                                href={`/cadencia?funnelId=${funnelId}`}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                                  cadenceSteps.some(s => s.stageId === stage.id && s.isActive)
                                    ? 'bg-white/30 text-white'
                                    : 'bg-white/10 hover:bg-white/20 text-white/80'
                                }`}
                                title={`Cadência: ${cadenceSteps.filter(s => s.stageId === stage.id).length} steps`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SparklesIcon className="w-3 h-3" />
                                {cadenceSteps.filter(s => s.stageId === stage.id).length > 0 && (
                                  <span>{cadenceSteps.filter(s => s.stageId === stage.id).length}</span>
                                )}
                              </Link>
                              {cadenceSteps.some(s => s.stageId === stage.id && s.isActive) && (
                                <button
                                  type="button"
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/30 text-white/80 hover:text-white transition-colors"
                                  title="Forçar cadência desta etapa"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setForceCadenceStageId(stage.id)
                                    setForceCadenceLimit(10)
                                  }}
                                >
                                  <BoltIcon className="w-3 h-3" />
                                </button>
                              )}
                              {/* Sort dropdown */}
                              <div className="relative">
                                <button
                                  type="button"
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                                    sortDirection[stage.id]
                                      ? 'bg-white/30 text-white'
                                      : 'bg-white/10 hover:bg-white/20 text-white/80'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSortMenuOpen(sortMenuOpen === stage.id ? null : stage.id)
                                  }}
                                  title="Ordenar cards"
                                >
                                  <ChevronUpIcon className="w-3 h-3" />
                                  <ChevronDownIcon className="w-3 h-3 -ml-1.5" />
                                  {sortType[stage.id] === 'lastContact' ? 'Contato' : sortType[stage.id] === 'stageTime' ? 'Etapa' : 'Ordenar'}
                                  {sortDirection[stage.id] && (sortDirection[stage.id] === 'asc' ? ' ▲' : ' ▼')}
                                </button>
                                {sortMenuOpen === stage.id && (
                                  <div
                                    className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/10"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 transition-colors ${
                                        sortType[stage.id] === 'lastContact' ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700'
                                      }`}
                                      onClick={() => handleSortStage(stage.id, 'lastContact')}
                                    >
                                      Por último contato {sortType[stage.id] === 'lastContact' && (sortDirection[stage.id] === 'asc' ? '▲' : '▼')}
                                    </button>
                                    <button
                                      type="button"
                                      className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 transition-colors ${
                                        sortType[stage.id] === 'stageTime' ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700'
                                      }`}
                                      onClick={() => handleSortStage(stage.id, 'stageTime')}
                                    >
                                      Por tempo na etapa {sortType[stage.id] === 'stageTime' && (sortDirection[stage.id] === 'asc' ? '▲' : '▼')}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Cards - Paginated */}
                        <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-400px)] overflow-y-auto flex-1">
                          {paginatedData.clients.map((client, index) => {
                            const daysInStage = calculateDaysSince(client.funnelStageUpdatedAt)
                            const isOverdue = stage.maxDays && daysInStage !== null && daysInStage > stage.maxDays
                            const realIndex = ((paginatedData.currentPage - 1) * ITEMS_PER_PAGE) + index

                            return (
                              <KanbanCard
                                key={client.id}
                                client={client}
                                index={realIndex}
                                daysInStage={daysInStage}
                                lastContactDate={client.lastFollowUpAt}
                                isOverdue={!!isOverdue}
                                stageColor={color}
                                stageName={stage.name}
                                costCenterName={costCenters.find(cc => cc.id === client.costCenterId)?.name}
                                proposalData={proposalsByClient[client.id]}
                                icpColor={client.icpProfileId ? icpMap[client.icpProfileId]?.color : undefined}
                                icpName={client.icpProfileId ? icpMap[client.icpProfileId]?.name : undefined}
                                cadenceStepName={getCurrentCadenceStep(client, stage.id)?.name}
                                onSelect={handleSelectClient}
                              />
                            )
                          })}
                          {provided.placeholder}

                          {allStageClients.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                              <UserGroupIcon className="w-8 h-8 mb-2" />
                              <p className="text-xs">Nenhum contato</p>
                            </div>
                          )}
                        </div>

                        {/* Pagination */}
                        {paginatedData.totalPages > 1 && (
                          <Pagination
                            currentPage={paginatedData.currentPage}
                            totalPages={paginatedData.totalPages}
                            onPageChange={(page) => handleStagePageChange(stage.id, page)}
                          />
                        )}
                      </div>
                    )}
                  </Droppable>
                )
              })}

              {/* Unassigned column */}
              {clientsByStage['unassigned']?.length > 0 && (
                <Droppable droppableId="unassigned">
                  {(provided, snapshot) => {
                    const allUnassigned = clientsByStage['unassigned'] || []
                    const unassignedPaginated = paginatedClientsByStage['unassigned'] || { clients: [], totalPages: 1, currentPage: 1 }

                    return (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`w-80 flex-shrink-0 bg-slate-50 rounded-2xl border flex flex-col ${
                          snapshot.isDraggingOver
                            ? 'border-slate-400 border-2 shadow-lg'
                            : 'border-slate-200/60 border-dashed shadow-sm'
                        }`}
                      >
                        <div className="px-4 py-3 border-b border-slate-200 bg-slate-100 rounded-t-2xl">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-600">Sem etapa</h3>
                              <span className="px-2 py-0.5 bg-slate-200 rounded-full text-xs font-bold text-slate-600">
                                {allUnassigned.length}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-400px)] overflow-y-auto flex-1">
                          {unassignedPaginated.clients.map((client, index) => {
                            const realIndex = ((unassignedPaginated.currentPage - 1) * ITEMS_PER_PAGE) + index
                            return (
                              <UnassignedCard
                                key={client.id}
                                client={client}
                                index={realIndex}
                                lastContactDate={client.lastFollowUpAt}
                                onSelect={handleSelectClient}
                              />
                            )
                          })}
                          {provided.placeholder}
                        </div>

                        {/* Pagination */}
                        {unassignedPaginated.totalPages > 1 && (
                          <Pagination
                            currentPage={unassignedPaginated.currentPage}
                            totalPages={unassignedPaginated.totalPages}
                            onPageChange={(page) => handleStagePageChange('unassigned', page)}
                          />
                        )}
                      </div>
                    )
                  }}
                </Droppable>
              )}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* Click outside to close filter dropdown */}
      {activeFilterColumn && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setActiveFilterColumn(null)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden m-4 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                  <GearIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Configurar Etapas do Funil</h3>
                  <p className="text-xs text-slate-500">Gerencie as etapas e a régua de probabilidade</p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Macro Stages Section */}
              <div className="p-4 bg-gradient-to-br from-primary-50 to-blue-50 rounded-xl border border-primary-100">
                <h4 className="text-sm font-semibold text-primary-800 mb-3 flex items-center gap-2">
                  <Squares2X2Icon className="w-4 h-4" />
                  Macro Etapas (Grupos) ({macroStages.length})
                </h4>
                <p className="text-xs text-primary-600 mb-4">
                  Agrupe etapas relacionadas em macro etapas para melhor visualizar seu funil.
                </p>

                {/* Existing Macro Stages */}
                <div className="space-y-2 mb-4">
                  {macroStages.map((macroStage, index) => {
                    const color = getColorByIndex(parseInt(macroStage.color || '0'))
                    const isEditingMacro = editingMacroStage?.id === macroStage.id
                    const stagesInMacro = funnelStages.filter(s => s.macroStageId === macroStage.id)

                    return (
                      <div
                        key={macroStage.id}
                        className={`p-3 rounded-lg border transition-all ${
                          isEditingMacro ? 'border-primary-300 bg-primary-50' : 'border-primary-200 bg-white hover:border-primary-300'
                        }`}
                      >
                        {isEditingMacro ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Nome</label>
                                <input
                                  type="text"
                                  value={editingMacroStage.name}
                                  onChange={(e) => setEditingMacroStage({ ...editingMacroStage, name: e.target.value })}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Cor da Borda</label>
                                <div className="flex gap-1">
                                  {stageColorOptions.map((opt, colorIdx) => (
                                    <button
                                      key={colorIdx}
                                      onClick={() => setEditingMacroStage({ ...editingMacroStage, color: String(colorIdx) })}
                                      className={`w-5 h-5 rounded-full bg-gradient-to-r ${opt.gradient} ${
                                        editingMacroStage.color === String(colorIdx) ? 'ring-2 ring-offset-1 ring-primary-500' : ''
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditingMacroStage(null)}
                                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleUpdateMacroStage}
                                disabled={savingMacroStage}
                                className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
                              >
                                {savingMacroStage ? (
                                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <CheckIcon className="w-3 h-3" />
                                )}
                                Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col gap-0.5">
                                <button
                                  onClick={() => handleReorderMacroStage(macroStage.id, 'up')}
                                  disabled={index === 0}
                                  className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30"
                                >
                                  <ChevronUpIcon className="w-3 h-3 text-slate-400" />
                                </button>
                                <button
                                  onClick={() => handleReorderMacroStage(macroStage.id, 'down')}
                                  disabled={index === macroStages.length - 1}
                                  className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30"
                                >
                                  <ChevronDownIcon className="w-3 h-3 text-slate-400" />
                                </button>
                              </div>
                              <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${color.gradient}`} />
                              <div>
                                <p className="font-semibold text-sm text-slate-800">{macroStage.name}</p>
                                <p className="text-xs text-slate-500">{stagesInMacro.length} etapa{stagesInMacro.length !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingMacroStage(macroStage)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <Pencil1Icon className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                              <button
                                onClick={() => setDeletingMacroStageId(macroStage.id)}
                                className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <TrashIcon className="w-3.5 h-3.5 text-red-500" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Delete confirmation for macro stage */}
                        {deletingMacroStageId === macroStage.id && (
                          <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                            <p className="text-xs text-red-700 mb-2">
                              Tem certeza? As etapas dentro desta macro etapa ficarão sem grupo.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setDeletingMacroStageId(null)}
                                className="px-3 py-1 text-xs text-slate-600 hover:bg-white rounded transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => handleDeleteMacroStage(macroStage.id)}
                                className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Add New Macro Stage */}
                <div className="p-3 bg-white rounded-lg border border-primary-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nova Macro Etapa</label>
                      <input
                        type="text"
                        value={newMacroStageName}
                        onChange={(e) => setNewMacroStageName(e.target.value)}
                        placeholder="Ex: Qualificacao"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cor da Borda</label>
                      <div className="flex gap-1 mt-1">
                        {stageColorOptions.map((opt, colorIdx) => (
                          <button
                            key={colorIdx}
                            onClick={() => setNewMacroStageColor(colorIdx)}
                            className={`w-5 h-5 rounded-full bg-gradient-to-r ${opt.gradient} transition-all ${
                              newMacroStageColor === colorIdx ? 'ring-2 ring-offset-1 ring-primary-500 scale-110' : 'hover:scale-105'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleAddMacroStage}
                    disabled={!newMacroStageName.trim() || savingMacroStage}
                    className="mt-3 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-primary-700 hover:to-blue-700 transition-all disabled:opacity-50"
                  >
                    {savingMacroStage ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <PlusIcon className="w-4 h-4" />
                    )}
                    Adicionar Macro Etapa
                  </button>
                </div>
              </div>

              {/* Existing Stages */}
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <ArrowTrendingUpIcon className="w-4 h-4" />
                  Etapas do Funil ({funnelStages.length})
                </h4>
                <div className="space-y-2">
                  {funnelStages.map((stage, index) => {
                    const color = getColorByIndex(parseInt(stage.color || '0'))
                    const isEditing = editingStage?.id === stage.id

                    return (
                      <div
                        key={stage.id}
                        className={`p-4 rounded-xl border transition-all ${
                          isEditing ? 'border-primary-300 bg-primary-50' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Nome</label>
                                <input
                                  type="text"
                                  value={editingStage.name}
                                  onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Cor</label>
                                <div className="flex gap-1">
                                  {stageColorOptions.map((opt, colorIdx) => (
                                    <button
                                      key={colorIdx}
                                      onClick={() => setEditingStage({ ...editingStage, color: String(colorIdx) })}
                                      className={`w-6 h-6 rounded-full bg-gradient-to-r ${opt.gradient} ${
                                        editingStage.color === String(colorIdx) ? 'ring-2 ring-offset-2 ring-primary-500' : ''
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">
                                  Probabilidade de Fechamento
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={editingStage.probability || 0}
                                    onChange={(e) => setEditingStage({ ...editingStage, probability: parseInt(e.target.value) })}
                                    className="flex-1 accent-primary-600"
                                  />
                                  <span className="w-12 text-sm font-bold text-primary-600 text-right">
                                    {editingStage.probability || 0}%
                                  </span>
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">
                                  Prazo Máximo (dias)
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  value={editingStage.maxDays || 7}
                                  onChange={(e) => setEditingStage({ ...editingStage, maxDays: parseInt(e.target.value) || 7 })}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                />
                              </div>
                            </div>
                            {/* Macro Stage Selector */}
                            {macroStages.length > 0 && (
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">
                                  Macro Etapa (Grupo)
                                </label>
                                <select
                                  value={editingStage.macroStageId || ''}
                                  onChange={(e) => setEditingStage({ ...editingStage, macroStageId: e.target.value || undefined })}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white"
                                >
                                  <option value="">Sem grupo</option>
                                  {macroStages.map((macro) => (
                                    <option key={macro.id} value={macro.id}>
                                      {macro.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {/* Metrics Toggle */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div>
                                <p className="text-sm font-medium text-slate-700">Conta para métricas</p>
                                <p className="text-xs text-slate-500">Incluir no cálculo de tempo e atraso</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingStage({ ...editingStage, countsForMetrics: !editingStage.countsForMetrics })}
                                className={`relative w-11 h-6 rounded-full transition-colors ${
                                  editingStage.countsForMetrics !== false ? 'bg-primary-600' : 'bg-slate-300'
                                }`}
                              >
                                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                                  editingStage.countsForMetrics !== false ? 'translate-x-5.5 left-0.5' : 'left-0.5'
                                }`} style={{ transform: editingStage.countsForMetrics !== false ? 'translateX(22px)' : 'translateX(0)' }} />
                              </button>
                            </div>
                            {/* Prospection Stage Toggle */}
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-slate-700">Etapa de Prospecção</p>
                                <p className="text-xs text-slate-500">Marcar como etapa de início da prospecção</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingStage({ ...editingStage, isProspectionStage: !editingStage.isProspectionStage })}
                                className={`relative w-11 h-6 rounded-full transition-colors ${
                                  editingStage.isProspectionStage ? 'bg-emerald-600' : 'bg-slate-300'
                                }`}
                              >
                                <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform" style={{ transform: editingStage.isProspectionStage ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                              </button>
                            </div>
                            {/* Conversion Type Selector */}
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-2">
                                Tipo de Conversão
                              </label>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingStage({ ...editingStage, conversionType: 'neutral' })}
                                  className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                                    (editingStage.conversionType || 'neutral') === 'neutral'
                                      ? 'border-slate-400 bg-slate-100 text-slate-700'
                                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                                  }`}
                                >
                                  Neutro
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingStage({ ...editingStage, conversionType: 'positive' })}
                                  className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                                    editingStage.conversionType === 'positive'
                                      ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                                      : 'border-slate-200 text-slate-500 hover:border-emerald-300'
                                  }`}
                                >
                                  Positivo (Promotor)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingStage({ ...editingStage, conversionType: 'negative' })}
                                  className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                                    editingStage.conversionType === 'negative'
                                      ? 'border-red-400 bg-red-100 text-red-700'
                                      : 'border-slate-200 text-slate-500 hover:border-red-300'
                                  }`}
                                >
                                  Negativo (Detrator)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingStage({ ...editingStage, conversionType: 'final_conversion' })}
                                  className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                                    editingStage.conversionType === 'final_conversion'
                                      ? 'border-primary-400 bg-primary-100 text-primary-700'
                                      : 'border-slate-200 text-slate-500 hover:border-primary-300'
                                  }`}
                                >
                                  Conversão Final
                                </button>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Define como esta etapa impacta a conversão do funil
                              </p>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditingStage(null)}
                                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleUpdateStage}
                                disabled={savingStage}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
                              >
                                {savingStage ? (
                                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                )}
                                Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col gap-0.5">
                                <button
                                  onClick={() => handleReorderStage(stage.id, 'up')}
                                  disabled={index === 0}
                                  className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30"
                                >
                                  <ChevronUpIcon className="w-3 h-3 text-slate-400" />
                                </button>
                                <button
                                  onClick={() => handleReorderStage(stage.id, 'down')}
                                  disabled={index === funnelStages.length - 1}
                                  className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30"
                                >
                                  <ChevronDownIcon className="w-3 h-3 text-slate-400" />
                                </button>
                              </div>
                              <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${color.gradient}`} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-sm text-slate-800">{stage.name}</p>
                                  {stage.macroStageId && (
                                    <span className="px-1.5 py-0.5 bg-primary-100 text-primary-600 text-xs rounded">
                                      {macroStages.find(m => m.id === stage.macroStageId)?.name || 'Grupo'}
                                    </span>
                                  )}
                                  {stage.countsForMetrics === false && (
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded">
                                      Não conta métricas
                                    </span>
                                  )}
                                  {stage.conversionType === 'positive' && (
                                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 text-xs rounded">
                                      Promotor
                                    </span>
                                  )}
                                  {stage.conversionType === 'negative' && (
                                    <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded">
                                      Detrator
                                    </span>
                                  )}
                                  {stage.conversionType === 'final_conversion' && (
                                    <span className="px-1.5 py-0.5 bg-primary-100 text-primary-600 text-xs rounded">
                                      Conversão Final
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500">
                                  {stage.probability || 0}% de probabilidade | Prazo: {stage.maxDays || 7} dias
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingStage(stage)}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <Pencil1Icon className="w-4 h-4 text-slate-500" />
                              </button>
                              <button
                                onClick={() => setDeletingStageId(stage.id)}
                                className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <TrashIcon className="w-4 h-4 text-red-500" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Add New Stage */}
              <div className="p-4 bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl border border-primary-100">
                <h4 className="text-sm font-semibold text-primary-800 mb-4 flex items-center gap-2">
                  <PlusIcon className="w-4 h-4" />
                  Adicionar Nova Etapa
                </h4>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nome da Etapa</label>
                      <input
                        type="text"
                        value={newStageName}
                        onChange={(e) => setNewStageName(e.target.value)}
                        placeholder="Ex: Qualificação"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cor</label>
                      <div className="flex gap-1.5">
                        {stageColorOptions.map((opt, colorIdx) => (
                          <button
                            key={colorIdx}
                            onClick={() => setNewStageColor(colorIdx)}
                            className={`w-6 h-6 rounded-full bg-gradient-to-r ${opt.gradient} transition-all ${
                              newStageColor === colorIdx ? 'ring-2 ring-offset-2 ring-primary-500 scale-110' : 'hover:scale-105'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Probabilidade de Fechamento
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={newStageProbability}
                          onChange={(e) => setNewStageProbability(parseInt(e.target.value))}
                          className="flex-1 accent-primary-600"
                        />
                        <span className="w-12 text-sm font-bold text-primary-600 text-right">
                          {newStageProbability}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Prazo Máximo (dias)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={newStageMaxDays}
                        onChange={(e) => setNewStageMaxDays(parseInt(e.target.value) || 7)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white"
                      />
                    </div>
                  </div>
                  {/* Macro Stage Selector */}
                  {macroStages.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Macro Etapa (Grupo)
                      </label>
                      <select
                        value={newStageMacroStageId}
                        onChange={(e) => setNewStageMacroStageId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white"
                      >
                        <option value="">Sem grupo</option>
                        {macroStages.map((macro) => (
                          <option key={macro.id} value={macro.id}>
                            {macro.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Metrics Toggle */}
                  <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Conta para métricas</p>
                      <p className="text-xs text-slate-500">Incluir no cálculo de tempo e atraso</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewStageCountsForMetrics(!newStageCountsForMetrics)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        newStageCountsForMetrics ? 'bg-primary-600' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform"
                        style={{ transform: newStageCountsForMetrics ? 'translateX(22px)' : 'translateX(0)' }}
                      />
                    </button>
                  </div>
                  {/* Conversion Type Selector */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-2">
                      Tipo de Conversão
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewStageConversionType('neutral')}
                        className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                          newStageConversionType === 'neutral'
                            ? 'border-slate-400 bg-slate-100 text-slate-700'
                            : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        Neutro
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewStageConversionType('positive')}
                        className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                          newStageConversionType === 'positive'
                            ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                            : 'border-slate-200 text-slate-500 hover:border-emerald-300'
                        }`}
                      >
                        Positivo (Promotor)
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewStageConversionType('negative')}
                        className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                          newStageConversionType === 'negative'
                            ? 'border-red-400 bg-red-100 text-red-700'
                            : 'border-slate-200 text-slate-500 hover:border-red-300'
                        }`}
                      >
                        Negativo (Detrator)
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewStageConversionType('final_conversion')}
                        className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                          newStageConversionType === 'final_conversion'
                            ? 'border-primary-400 bg-primary-100 text-primary-700'
                            : 'border-slate-200 text-slate-500 hover:border-primary-300'
                        }`}
                      >
                        Conversão Final
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Define como esta etapa impacta a conversão do funil
                    </p>
                  </div>
                  <button
                    onClick={handleAddStage}
                    disabled={!newStageName.trim() || savingStage}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 disabled:opacity-50"
                  >
                    {savingStage ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <PlusIcon className="w-4 h-4" />
                    )}
                    Adicionar Etapa
                  </button>
                </div>
              </div>

              {/* Probability Guide */}
              <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-100">
                <h4 className="text-sm font-semibold text-emerald-800 mb-3 flex items-center gap-2">
                  <SparklesIcon className="w-4 h-4" />
                  Régua de Probabilidade - Guia
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-blue-500 rounded flex items-center justify-center text-white font-bold">10%</span>
                    <span className="text-slate-600">Novo Lead / Prospecção</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-cyan-500 rounded flex items-center justify-center text-white font-bold">20%</span>
                    <span className="text-slate-600">Primeiro Contato</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-amber-500 rounded flex items-center justify-center text-white font-bold">40%</span>
                    <span className="text-slate-600">Qualificação</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-primary-500 rounded flex items-center justify-center text-white font-bold">60%</span>
                    <span className="text-slate-600">Proposta Enviada</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-orange-500 rounded flex items-center justify-center text-white font-bold">80%</span>
                    <span className="text-slate-600">Negociação</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-5 bg-emerald-500 rounded flex items-center justify-center text-white font-bold">100%</span>
                    <span className="text-slate-600">Fechado Ganho</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white rounded-xl transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Stage Confirmation */}
      {deletingStageId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeletingStageId(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrashIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Excluir etapa</h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir esta etapa? Todos os contatos serão movidos para &quot;Sem etapa&quot;.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeletingStageId(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteStage(deletingStageId)}
                className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors"
              >
                Excluir etapa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Detail Panel */}
      {selectedClient && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedClient(null)}
          />
          <div className="relative ml-auto w-full max-w-6xl bg-white shadow-2xl flex h-full">
            {/* Left side - Client Info */}
            <div className="w-1/2 border-r border-slate-200 flex flex-col h-full overflow-hidden">
              {/* Client Header */}
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-purple-50">
                <div className="flex items-center gap-4">
                  {selectedClient.photoUrl ? (
                    <Image
                      src={selectedClient.photoUrl}
                      alt={selectedClient.name}
                      width={64}
                      height={64}
                      className="w-16 h-16 rounded-2xl object-cover ring-4 ring-white shadow-lg"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl shadow-lg">
                      {selectedClient.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-slate-800 truncate">{selectedClient.name}</h2>
                    {selectedClient.company && (
                      <p className="text-sm text-slate-500 flex items-center gap-1.5">
                        <BuildingOfficeIcon className="w-4 h-4" />
                        {selectedClient.company}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Funnel Dropdown (Story 24.1) */}
                      <div className="relative">
                        <button
                          onClick={() => { setFunnelDropdownOpen(!funnelDropdownOpen); setFunnelDropdownStep('funnels'); setStageDropdownOpen(false) }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:ring-2 hover:ring-offset-1 bg-violet-100 text-violet-700 hover:ring-violet-300/30"
                        >
                          <FunnelIcon className="w-3 h-3" />
                          {funnelName || 'Funil'}
                          <ChevronDownIcon className={`w-3 h-3 transition-transform ${funnelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {funnelDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => { setFunnelDropdownOpen(false); setFunnelDropdownStep('funnels'); setMoveFunnelTarget('') }}
                            />
                            <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 max-h-64 overflow-y-auto">
                              {funnelDropdownStep === 'funnels' ? (
                                <>
                                  {allOrgFunnels.map((f) => {
                                    const isCurrentFunnel = f.id === funnelId
                                    return (
                                      <button
                                        key={f.id}
                                        onClick={() => {
                                          if (isCurrentFunnel) {
                                            setFunnelDropdownOpen(false)
                                          } else {
                                            setMoveFunnelTarget(f.id)
                                            setFunnelDropdownStep('stages')
                                          }
                                        }}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${isCurrentFunnel ? 'bg-violet-50' : ''}`}
                                      >
                                        <FunnelIcon className="w-3.5 h-3.5 text-violet-500" />
                                        <span className={`text-sm flex-1 ${isCurrentFunnel ? 'font-medium text-violet-700' : 'text-slate-700'}`}>
                                          {f.name}
                                        </span>
                                        {isCurrentFunnel && (
                                          <CheckIcon className="w-4 h-4 text-violet-600" />
                                        )}
                                      </button>
                                    )
                                  })}
                                </>
                              ) : (
                                <>
                                  <div className="px-3 py-1.5 text-[10px] text-slate-400 font-medium border-b border-slate-100 mb-1 uppercase tracking-wide">
                                    Selecione a etapa em {allOrgFunnels.find(f => f.id === moveFunnelTarget)?.name}
                                  </div>
                                  {moveFunnelStages.length === 0 ? (
                                    <div className="px-3 py-3 text-xs text-slate-400 text-center">Carregando etapas...</div>
                                  ) : (
                                    moveFunnelStages.map((stage) => (
                                      <button
                                        key={stage.id}
                                        onClick={() => handleMoveToFunnel(moveFunnelTarget, stage.id)}
                                        disabled={movingFunnel}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors disabled:opacity-50"
                                      >
                                        <div className="w-3 h-3 rounded-full bg-gradient-to-r from-violet-400 to-violet-600" />
                                        <span className="text-sm flex-1 text-slate-700">{stage.name}</span>
                                      </button>
                                    ))
                                  )}
                                  <div className="border-t border-slate-100 mt-1 pt-1">
                                    <button
                                      onClick={() => { setFunnelDropdownStep('funnels'); setMoveFunnelTarget('') }}
                                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors text-slate-500"
                                    >
                                      <ChevronLeftIcon className="w-3.5 h-3.5" />
                                      <span className="text-sm">Voltar</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Stage Dropdown */}
                      <div className="relative">
                        <button
                          onClick={() => { setStageDropdownOpen(!stageDropdownOpen); setFunnelDropdownOpen(false) }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:ring-2 hover:ring-offset-1 ${
                            getStageColor(selectedClient.funnelStage).bg
                          } ${getStageColor(selectedClient.funnelStage).text} hover:ring-${getStageColor(selectedClient.funnelStage).text.replace('text-', '')}/30`}
                        >
                          {funnelStages.find((s) => s.id === selectedClient.funnelStage)?.name || 'Sem etapa'}
                          <ChevronDownIcon className={`w-3 h-3 transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {stageDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setStageDropdownOpen(false)}
                            />
                            <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 max-h-64 overflow-y-auto">
                              {funnelStages.map((stage) => {
                                const color = getColorByIndex(parseInt(stage.color || '0'))
                                const isCurrentStage = selectedClient.funnelStage === stage.id
                                return (
                                  <button
                                    key={stage.id}
                                    onClick={async () => {
                                      if (!isCurrentStage) {
                                        await handleQuickStageChange(selectedClient.id, stage.id)
                                        setSelectedClient({ ...selectedClient, funnelStage: stage.id })
                                      }
                                      setStageDropdownOpen(false)
                                    }}
                                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${
                                      isCurrentStage ? 'bg-primary-50' : ''
                                    }`}
                                  >
                                    <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${color.gradient}`} />
                                    <span className={`text-sm flex-1 ${isCurrentStage ? 'font-medium text-primary-700' : 'text-slate-700'}`}>
                                      {stage.name}
                                    </span>
                                    <span className="text-xs text-slate-400">{stage.probability}%</span>
                                    {isCurrentStage && (
                                      <CheckIcon className="w-4 h-4 text-primary-600" />
                                    )}
                                  </button>
                                )
                              })}
                              <div className="border-t border-slate-100 mt-1 pt-1">
                                <button
                                  onClick={async () => {
                                    if (selectedClient.funnelStage) {
                                      await handleQuickStageChange(selectedClient.id, '')
                                      setSelectedClient({ ...selectedClient, funnelStage: undefined })
                                    }
                                    setStageDropdownOpen(false)
                                  }}
                                  className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${
                                    !selectedClient.funnelStage ? 'bg-slate-100' : ''
                                  }`}
                                >
                                  <div className="w-3 h-3 rounded-full bg-slate-400" />
                                  <span className={`text-sm flex-1 ${!selectedClient.funnelStage ? 'font-medium text-slate-600' : 'text-slate-500'}`}>
                                    Sem etapa
                                  </span>
                                  {!selectedClient.funnelStage && (
                                    <CheckIcon className="w-4 h-4 text-slate-500" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Probability + Expected Value inline (Story 24.2) */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <ChartBarIcon className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <div className="flex items-center gap-0.5">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          defaultValue={getClientProbability(selectedClient as { closingProbability?: number }, funnelStages.find(s => s.id === selectedClient.funnelStage))}
                          key={`prob-inline-${selectedClient.id}-${selectedClient.funnelStage}-${selectedClient.closingProbability ?? 'default'}`}
                          onBlur={(e) => {
                            const val = e.target.value ? parseInt(e.target.value) : null
                            if (val !== null && (val < 0 || val > 100)) {
                              toast.error('Probabilidade deve ser entre 0 e 100')
                              return
                            }
                            if (val !== (selectedClient.closingProbability ?? null)) {
                              handleUpdateProbability(val)
                            }
                          }}
                          className="w-10 text-center bg-transparent border-b border-amber-300 focus:border-amber-500 focus:outline-none text-xs text-amber-700 font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-amber-600 font-medium">%</span>
                      </div>
                      {selectedClient.closingProbability != null && (
                        <span className="text-[10px] text-amber-400 italic">personalizado</span>
                      )}
                      {selectedClient.dealValue != null && selectedClient.dealValue > 0 && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-[10px] text-emerald-600 font-medium">
                            Esperado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                              (selectedClient.dealValue * getClientProbability(selectedClient as { closingProbability?: number }, funnelStages.find(s => s.id === selectedClient.funnelStage))) / 100
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedClient(null)}
                    className="p-2 rounded-xl hover:bg-white/50 transition-colors"
                  >
                    <Cross2Icon className="w-5 h-5 text-slate-500" />
                  </button>
                </div>
              </div>

              {/* Client Details */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Contact Info */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Contato</h4>

                  {selectedClient.phone && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <PhoneIcon className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-500">Telefone</p>
                        <p className="text-sm font-medium text-slate-700">{selectedClient.phone}</p>
                      </div>
                      <a
                        href={`https://wa.me/${formatWhatsAppNumber(selectedClient.phone)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors"
                      >
                        WhatsApp
                      </a>
                    </div>
                  )}

                  {selectedClient.email && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                        <EnvelopeClosedIcon className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-500">Email</p>
                        <p className="text-sm font-medium text-slate-700">{selectedClient.email}</p>
                      </div>
                      <a
                        href={`mailto:${selectedClient.email}`}
                        className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors"
                      >
                        Enviar
                      </a>
                    </div>
                  )}

                  {/* Quick Action Buttons */}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setShowWhatsAppModal(true)}
                      disabled={!selectedClient.phone}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChatBubbleLeftRightIcon className="w-4 h-4" />
                      Enviar WhatsApp
                    </button>
                    <button
                      onClick={() => setShowEmailModal(true)}
                      disabled={!selectedClient.email}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <EnvelopeClosedIcon className="w-4 h-4" />
                      Enviar Email
                    </button>
                  </div>
                </div>

                {/* Additional Info */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Informações</h4>

                  <div className="grid grid-cols-2 gap-2">
                    {selectedClient.industry && (
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500">Ramo</p>
                        <p className="text-sm font-medium text-slate-700">{selectedClient.industry}</p>
                      </div>
                    )}
                    {selectedClient.document && (
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500">CNPJ/CPF</p>
                        <p className="text-sm font-medium text-slate-700">{selectedClient.document}</p>
                      </div>
                    )}
                    {selectedClient.leadSource && (
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500">Origem</p>
                        <div className="flex items-center gap-1.5">
                          {leadSourceIcons[selectedClient.leadSource] && (
                            <Image
                              src={leadSourceIcons[selectedClient.leadSource]}
                              alt={selectedClient.leadSource}
                              width={16}
                              height={16}
                            />
                          )}
                          <p className="text-sm font-medium text-slate-700">{selectedClient.leadSource}</p>
                        </div>
                      </div>
                    )}
                    {selectedClient.leadType && (
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500">Tipo de Lead</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          leadTypeOptions.find(opt => opt.value === selectedClient.leadType)?.color || 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {selectedClient.leadType}
                        </span>
                      </div>
                    )}
                    {selectedClient.createdAt && (
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-xs text-slate-500">Cadastro</p>
                        <p className="text-sm font-medium text-slate-700">
                          {new Date(selectedClient.createdAt).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    )}
                    {selectedClient.firstContactAt && (
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                        <p className="text-xs text-emerald-600">Primeiro Contato</p>
                        <p className="text-sm font-medium text-emerald-700">
                          {(() => {
                            const val = selectedClient.firstContactAt as unknown
                            let date: Date | null = null
                            if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
                              date = (val as { toDate: () => Date }).toDate()
                            } else if (typeof val === 'object' && val !== null && '_seconds' in val) {
                              date = new Date((val as { _seconds: number })._seconds * 1000)
                            } else if (typeof val === 'string') {
                              date = new Date(val)
                            }
                            if (date && !isNaN(date.getTime())) {
                              return date.toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            }
                            return '-'
                          })()}
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedClient.description && (
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">Descrição</p>
                      <p className="text-sm text-slate-700">{selectedClient.description}</p>
                    </div>
                  )}
                  {selectedClient.partners && (
                    <div className="p-3 bg-primary-50 rounded-xl border border-primary-100">
                      <div className="flex items-center gap-2 mb-2">
                        <UsersIcon className="w-4 h-4 text-primary-500" />
                        <p className="text-xs font-medium text-primary-600">Sócios</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedClient.partners.split(',').map((partner, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-primary-200 text-sm text-slate-700"
                          >
                            <span className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center text-primary-600 font-semibold text-[10px]">
                              {partner.trim().charAt(0).toUpperCase()}
                            </span>
                            {partner.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedClient.capital_social && (
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                      <div className="flex items-center gap-2 mb-1">
                        <ChartBarIcon className="w-4 h-4 text-emerald-500" />
                        <p className="text-xs font-medium text-emerald-600">Capital Social</p>
                      </div>
                      <p className="text-sm font-semibold text-emerald-700">
                        {typeof selectedClient.capital_social === 'number'
                          ? selectedClient.capital_social.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : `R$ ${selectedClient.capital_social}`}
                      </p>
                    </div>
                  )}
                  {/* Deal Value */}
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <div className="flex items-center gap-2 mb-1">
                      <CurrencyDollarIcon className="w-4 h-4 text-emerald-500" />
                      <p className="text-xs font-medium text-emerald-600">Valor do Negócio</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="R$ 0,00"
                      defaultValue={selectedClient.dealValue ?? ''}
                      key={selectedClient.id}
                      onBlur={(e) => {
                        const val = e.target.value ? parseFloat(e.target.value) : null
                        if (val !== (selectedClient.dealValue ?? null)) {
                          handleUpdateDealValue(val)
                        }
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                    />
                    {selectedClient.dealValue != null && selectedClient.dealValue > 0 && (
                      <p className="text-xs text-emerald-600 mt-1">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedClient.dealValue)}
                      </p>
                    )}
                  </div>

                  {/* Cost Center Selector */}
                  <div className="p-3 bg-primary-50/50 rounded-xl border border-primary-100">
                    <p className="text-xs text-primary-600 mb-2 font-medium">Centro de Custos</p>
                    <select
                      value={selectedClient.costCenterId || ''}
                      onChange={(e) => handleUpdateCostCenter(e.target.value || null)}
                      className="w-full px-3 py-2 text-sm bg-white border border-primary-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    >
                      <option value="">Selecionar centro de custos...</option>
                      {costCenters.map((cc) => (
                        <option key={cc.id} value={cc.id}>
                          {cc.code} - {cc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Responsible Selector (Story 11.4) */}
                  <div className="p-3 bg-primary-50/50 rounded-xl border border-primary-100">
                    <p className="text-xs text-primary-600 mb-2 font-medium">Responsável</p>
                    {canEditResponsible ? (
                      <div className="relative">
                        <button
                          onClick={() => setShowResponsibleDropdown(!showResponsibleDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors text-left"
                        >
                          {selectedClient.assignedToName ? (
                            <>
                              <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] font-bold text-primary-600">{selectedClient.assignedToName.charAt(0).toUpperCase()}</span>
                              </div>
                              <span className="text-slate-700 flex-1 truncate">{selectedClient.assignedToName}</span>
                            </>
                          ) : (
                            <>
                              <UserPlusIcon className="w-4 h-4 text-primary-400 flex-shrink-0" />
                              <span className="text-slate-400 flex-1">Atribuir responsável</span>
                            </>
                          )}
                          <ChevronDownIcon className={`w-3 h-3 text-slate-400 transition-transform ${showResponsibleDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showResponsibleDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowResponsibleDropdown(false)} />
                            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-xl border border-slate-200 py-1 max-h-48 overflow-y-auto">
                              {orgMembers.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => handleAssignResponsible(m.id, m.displayName)}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary-50 transition-colors ${selectedClient.assignedTo === m.id ? 'bg-primary-50' : ''}`}
                                >
                                  <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[10px] font-bold text-primary-600">{m.displayName.charAt(0).toUpperCase()}</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-700 truncate">{m.displayName}</p>
                                    <p className="text-[10px] text-slate-400 capitalize">{m.role}</p>
                                  </div>
                                  {selectedClient.assignedTo === m.id && (
                                    <CheckIcon className="w-4 h-4 text-primary-600 flex-shrink-0" />
                                  )}
                                </button>
                              ))}
                              {selectedClient.assignedTo && (
                                <div className="border-t border-slate-100 mt-1 pt-1">
                                  <button
                                    onClick={() => handleAssignResponsible('', '')}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-50 transition-colors text-red-600"
                                  >
                                    <Cross2Icon className="w-4 h-4" />
                                    <span className="text-sm">Remover responsável</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-primary-200 rounded-lg">
                        {selectedClient.assignedToName ? (
                          <>
                            <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-bold text-primary-600">{selectedClient.assignedToName.charAt(0).toUpperCase()}</span>
                            </div>
                            <span className="text-slate-700">{selectedClient.assignedToName}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">Sem responsável</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Funnel Progress */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Progresso no Funil</h4>
                  <div className="p-4 bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl border border-primary-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-slate-700">
                        {funnelStages.find((s) => s.id === selectedClient.funnelStage)?.name || 'Sem etapa'}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          defaultValue={getClientProbability(selectedClient as { closingProbability?: number }, funnelStages.find(s => s.id === selectedClient.funnelStage))}
                          key={`prob-progress-${selectedClient.id}-${selectedClient.funnelStage}-${selectedClient.closingProbability ?? 'default'}`}
                          onBlur={(e) => {
                            const val = e.target.value ? parseInt(e.target.value) : null
                            if (val !== null && (val < 0 || val > 100)) {
                              toast.error('Probabilidade deve ser entre 0 e 100')
                              return
                            }
                            if (val !== (selectedClient.closingProbability ?? null)) {
                              handleUpdateProbability(val)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          className="w-12 text-right bg-transparent border-b-2 border-primary-300 focus:border-primary-500 focus:outline-none text-lg font-bold text-primary-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-lg font-bold text-primary-600">%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-white rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-500 to-purple-500 transition-all"
                        style={{
                          width: `${getClientProbability(selectedClient as { closingProbability?: number }, funnelStages.find(s => s.id === selectedClient.funnelStage))}%`,
                        }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        {formatDays(calculateDaysSince(selectedClient.funnelStageUpdatedAt))} nesta etapa
                      </span>
                      <span>{selectedClient.closingProbability != null ? 'Personalizado' : 'Padrão da etapa'}</span>
                    </div>
                  </div>
                </div>

                {/* Scheduled Return */}
                {selectedClient.scheduledReturn && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Agendamento</h4>
                    <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                            <CalendarDaysIcon className="w-5 h-5 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-amber-800">
                              {new Date(selectedClient.scheduledReturn).toLocaleDateString('pt-BR', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              })}
                            </p>
                            <p className="text-xs text-amber-600">
                              {(() => {
                                const returnDate = new Date(selectedClient.scheduledReturn)
                                const today = new Date()
                                returnDate.setHours(0, 0, 0, 0)
                                today.setHours(0, 0, 0, 0)
                                const diff = Math.floor((returnDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                                if (diff === 0) return 'Hoje!'
                                if (diff === 1) return 'Amanhã'
                                if (diff < 0) return `${Math.abs(diff)} dias atrás`
                                return `Em ${diff} dias`
                              })()}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveScheduledReturn(selectedClient.id)}
                          className="p-2 hover:bg-amber-100 rounded-lg transition-colors"
                          title="Remover retorno agendado"
                        >
                          <Cross2Icon className="w-4 h-4 text-amber-600" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="pt-4 space-y-3">
                  {selectedClient.phone && (
                    <div className="relative">
                      <button
                        onClick={() => setShowCallConfirm(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium text-sm hover:from-emerald-600 hover:to-teal-600 transition-all shadow-lg shadow-emerald-200"
                      >
                        <PhoneIcon className="w-4 h-4" />
                        Ligar pelo Agente de Voz
                      </button>
                      {showCallConfirm && (
                        <div className="absolute bottom-full left-0 right-0 mb-2 p-4 bg-white rounded-xl shadow-2xl border border-slate-200 z-30">
                          <p className="text-sm text-slate-700 mb-1 font-medium">Confirmar ligação</p>
                          <p className="text-xs text-slate-500 mb-3">
                            O agente de voz vai ligar para <span className="font-medium text-slate-700">{selectedClient.name}</span> no número <span className="font-medium text-slate-700">{selectedClient.phone}</span>
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={handleCallContact}
                              disabled={callingContact}
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                              {callingContact ? (
                                <>
                                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Ligando...
                                </>
                              ) : (
                                <>
                                  <PhoneIcon className="w-3.5 h-3.5" />
                                  Confirmar
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => setShowCallConfirm(false)}
                              disabled={callingContact}
                              className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active Call Status Monitor */}
                  {activeCallStatus && activeCallStatus.clientId === selectedClient.id && (
                    <div className={`p-3 rounded-xl border text-sm transition-all ${
                      activeCallStatus.status === 'completed'
                        ? 'bg-emerald-50 border-emerald-200'
                        : activeCallStatus.status === 'error'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-blue-50 border-blue-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        {activeCallStatus.status === 'completed' ? (
                          <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                        ) : activeCallStatus.status === 'error' ? (
                          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                        ) : (
                          <svg className="animate-spin w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        <span className={`font-medium text-xs ${
                          activeCallStatus.status === 'completed'
                            ? 'text-emerald-700'
                            : activeCallStatus.status === 'error'
                            ? 'text-red-700'
                            : 'text-blue-700'
                        }`}>
                          {activeCallStatus.status === 'initiating' && 'Iniciando ligação...'}
                          {activeCallStatus.status === 'queued' && 'Na fila - aguardando'}
                          {activeCallStatus.status === 'ringing' && 'Chamando...'}
                          {activeCallStatus.status === 'in-progress' && 'Em andamento'}
                          {activeCallStatus.status === 'forwarding' && 'Transferindo...'}
                          {activeCallStatus.status === 'ended' && 'Finalizando...'}
                          {activeCallStatus.status === 'completed' && 'Ligação concluída'}
                          {activeCallStatus.status === 'error' && 'Erro na ligação'}
                        </span>
                      </div>
                      {activeCallStatus.callStatus && !['completed', 'error'].includes(activeCallStatus.status) && (
                        <p className="text-xs text-blue-600 ml-6">{activeCallStatus.callStatus}</p>
                      )}
                      {activeCallStatus.resultado && (
                        <p className={`text-xs ml-6 ${activeCallStatus.status === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                          {activeCallStatus.resultado}
                        </p>
                      )}
                      {activeCallStatus.duration !== undefined && activeCallStatus.duration > 0 && (
                        <p className="text-xs text-slate-500 ml-6">
                          Duração: {Math.floor(activeCallStatus.duration / 60)}:{String(activeCallStatus.duration % 60).padStart(2, '0')}
                        </p>
                      )}
                      {activeCallStatus.startedAt && !['completed', 'error'].includes(activeCallStatus.status) && (
                        <p className="text-xs text-slate-400 ml-6 mt-1">
                          Monitorando a cada 10s
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setSchedulingReturnClient(selectedClient)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-200"
                  >
                    <CalendarDaysIcon className="w-4 h-4" />
                    {selectedClient.scheduledReturn ? 'Reagendar Retorno' : 'Agendar Retorno'}
                  </button>
                  <button
                    onClick={() => router.push(`/contatos/${selectedClient.id}`)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200"
                  >
                    <PersonIcon className="w-4 h-4" />
                    Ver perfil completo
                  </button>
                </div>
              </div>
            </div>

            {/* Right side - Proposals, Comments & Notes */}
            <div className="w-1/2 flex flex-col h-full overflow-hidden">
              {/* Proposals Section (Story 11.3) */}
              <div className="p-6 border-b border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DocumentDuplicateIcon className="w-4 h-4 text-primary-500" />
                    Propostas
                  </h4>
                  <button
                    onClick={() => router.push(`/contatos/${selectedClient.id}/proposta/nova`)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-lg text-xs font-medium hover:bg-primary-200 transition-colors"
                  >
                    <PlusIcon className="w-3 h-3" />
                    Nova
                  </button>
                </div>
                {loadingProposals ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                  </div>
                ) : clientProposals.length === 0 ? (
                  <div className="p-4 bg-slate-50 rounded-xl text-center">
                    <p className="text-xs text-slate-400">Nenhuma proposta encontrada</p>
                    <button
                      onClick={() => router.push(`/contatos/${selectedClient.id}/proposta/nova`)}
                      className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Criar primeira proposta
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {clientProposals.map((proposal) => {
                      const statusColors: Record<string, string> = {
                        'Aprovada': 'bg-emerald-100 text-emerald-700',
                        'Pendente': 'bg-amber-100 text-amber-700',
                        'Em análise': 'bg-blue-100 text-blue-700',
                        'Recusada': 'bg-red-100 text-red-700',
                        'Expirada': 'bg-slate-100 text-slate-600',
                        'Cancelada': 'bg-rose-100 text-rose-700',
                      }
                      return (
                        <button
                          key={proposal.id}
                          onClick={() => router.push(`/contatos/${selectedClient.id}/proposta/${proposal.id}`)}
                          className="w-full p-3 bg-slate-50 hover:bg-primary-50 rounded-xl border border-slate-100 hover:border-primary-200 transition-colors text-left"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-700 truncate">
                              {proposal.number ? `#${String(proposal.number).padStart(4, '0')} · ` : ''}{proposal.projectName || 'Proposta'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[proposal.status || ''] || 'bg-slate-100 text-slate-600'}`}>
                              {proposal.status || 'Pendente'}
                            </span>
                            {proposal.total !== undefined && (
                              <span className="text-xs text-slate-500 font-medium">
                                {proposal.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </span>
                            )}
                            {proposal.createdAt && (
                              <span className="text-[10px] text-slate-400 ml-auto">
                                {new Date(proposal.createdAt).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Comments Section */}
              <div className="p-6 border-b border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <DocumentTextIcon className="w-4 h-4 text-amber-500" />
                    Comentários sobre o Contato
                  </h4>
                  {!editingComments && (
                    <button
                      onClick={() => setEditingComments(true)}
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <Pencil1Icon className="w-4 h-4 text-slate-400" />
                    </button>
                  )}
                </div>
                {editingComments ? (
                  <div className="space-y-3">
                    <textarea
                      value={contactComments}
                      onChange={(e) => setContactComments(e.target.value)}
                      placeholder="Adicione comentários, observações e notas sobre o contato..."
                      rows={5}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-none bg-amber-50/30"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setContactComments(selectedClient.needsDetail || '')
                          setEditingComments(false)
                        }}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveComments}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100 min-h-[100px]">
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">
                      {contactComments || (
                        <span className="text-slate-400 italic">
                          Clique no lápis para adicionar comentários...
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {/* Notes Section */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                    <ChatBubbleIcon className="w-4 h-4 text-primary-500" />
                    Anotações & Follow-ups
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'note', label: 'Notas' },
                      { key: 'whatsapp', label: 'WhatsApp' },
                      { key: 'email', label: 'Email' },
                      { key: 'call', label: 'Ligações' },
                      { key: 'log', label: 'Sistema' },
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setLogFilter(f.key)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                          logFilter === f.key
                            ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* New Note Input */}
                <div className="px-6 py-4 bg-gradient-to-br from-primary-50/50 to-purple-50/50 border-b border-slate-100">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Adicione uma nova anotação..."
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-none bg-white"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleSaveNote}
                      disabled={!newNote.trim() || savingNote}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-primary-700 hover:to-purple-700 transition-all shadow-md shadow-primary-200 disabled:opacity-50"
                    >
                      {savingNote ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <PlusIcon className="w-3.5 h-3.5" />
                      )}
                      Salvar
                    </button>
                  </div>
                </div>

                {/* Notes List */}
                <div className="flex-1 overflow-y-auto p-6">
                  {loadingFollowUps ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                    </div>
                  ) : clientFollowUps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <ChatBubbleIcon className="w-10 h-10 mb-3" />
                      <p className="text-sm">Nenhuma anotação ou log ainda</p>
                      <p className="text-xs">Adicione uma anotação acima</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {clientFollowUps.filter((n) => {
                        if (logFilter === 'all') return true
                        if (logFilter === 'log') return n.source === 'log'
                        return n.source === 'followup' && (n.type || 'note') === logFilter
                      }).map((note, index) => (
                        <div key={note.id} className="relative pl-6">
                          <div className={`absolute left-0 top-1.5 w-3 h-3 rounded-full ring-4 ${
                            note.source === 'log'
                              ? 'bg-slate-400 ring-slate-100'
                              : note.type === 'whatsapp'
                              ? 'bg-green-500 ring-green-100'
                              : note.type === 'email'
                              ? 'bg-blue-500 ring-blue-100'
                              : note.type === 'call'
                              ? 'bg-amber-500 ring-amber-100'
                              : 'bg-primary-500 ring-primary-100'
                          }`} />
                          {index < clientFollowUps.length - 1 && (
                            <div className="absolute left-[5px] top-5 w-0.5 h-full bg-slate-200" />
                          )}
                          <div className={`border rounded-xl p-3 shadow-sm ${
                            note.source === 'log'
                              ? 'bg-slate-50 border-slate-200'
                              : 'bg-white border-slate-200'
                          }`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${
                                  note.source === 'log' ? 'text-slate-500' : 'text-primary-600'
                                }`}>
                                  {new Date(note.createdAt).toLocaleDateString('pt-BR', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                  note.source === 'log'
                                    ? 'bg-slate-200 text-slate-600'
                                    : note.type === 'whatsapp'
                                    ? 'bg-green-100 text-green-700'
                                    : note.type === 'email'
                                    ? 'bg-blue-100 text-blue-700'
                                    : note.type === 'call'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-primary-100 text-primary-600'
                                }`}>
                                  {note.source === 'log' ? 'Sistema' : note.type === 'whatsapp' ? 'WhatsApp' : note.type === 'email' ? 'Email' : note.type === 'call' ? 'Ligação' : 'Nota'}
                                </span>
                              </div>
                              <span className="text-xs text-slate-400">
                                {new Date(note.createdAt).toLocaleTimeString('pt-BR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            {note.author && (
                              <p className={`text-xs mb-1 ${
                                note.source === 'log' ? 'text-slate-400' : 'text-primary-400'
                              }`}>
                                {note.author}
                              </p>
                            )}
                            <p className="text-sm text-slate-600 whitespace-pre-wrap">
                              {/* Render text, replacing recording URLs with clickable links */}
                              {note.text?.split('\n').map((line, li) => {
                                const recordingMatch = line.match(/Gravação:\s*(https?:\/\/\S+)/)
                                if (recordingMatch) {
                                  return (
                                    <span key={li} className="block">
                                      Gravação:{' '}
                                      <a href={recordingMatch[1]} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline text-xs">
                                        Ouvir gravação
                                      </a>
                                    </span>
                                  )
                                }
                                return <span key={li} className="block">{line}</span>
                              })}
                            </p>
                            {/* Audio player with speed control */}
                            {(note.recordingUrl || note.text?.includes('storage.vapi.ai')) && (() => {
                              const url = note.recordingUrl || note.text?.match(/https?:\/\/storage\.vapi\.ai\/\S+/)?.[0]
                              return url ? (
                                <AudioPlayer url={url} />
                              ) : null
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Follow-up Modal */}
      {quickFollowUpClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setQuickFollowUpClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                <ChatBubbleIcon className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Registrar Follow-up</h3>
                <p className="text-sm text-slate-500">{quickFollowUpClient.name}</p>
              </div>
            </div>
            <textarea
              value={quickFollowUpText}
              onChange={(e) => setQuickFollowUpText(e.target.value)}
              placeholder="Descreva o follow-up realizado..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-none mb-4"
              autoFocus
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setQuickFollowUpClient(null)
                  setQuickFollowUpText('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleQuickFollowUp}
                disabled={!quickFollowUpText.trim() || savingQuickFollowUp}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all disabled:opacity-50"
              >
                {savingQuickFollowUp ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stage Change Modal */}
      {changingStageClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChangingStageClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                <ArrowTrendingUpIcon className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Mudar Etapa</h3>
                <p className="text-sm text-slate-500">{changingStageClient.name}</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              {funnelStages.map((stage) => {
                const color = getColorByIndex(parseInt(stage.color || '0'))
                const isCurrentStage = changingStageClient.funnelStage === stage.id

                return (
                  <button
                    key={stage.id}
                    onClick={() => handleQuickStageChange(changingStageClient.id, stage.id)}
                    disabled={isCurrentStage}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isCurrentStage
                        ? `${color.bg} ${color.border} cursor-default`
                        : 'border-slate-200 hover:border-primary-200 hover:bg-primary-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${color.gradient}`} />
                      <span className={`font-medium text-sm ${isCurrentStage ? color.text : 'text-slate-700'}`}>
                        {stage.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{stage.probability}%</span>
                      {isCurrentStage && (
                        <span className="px-2 py-0.5 bg-white rounded-full text-xs font-medium text-primary-600">
                          Atual
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
              <button
                onClick={() => handleQuickStageChange(changingStageClient.id, '')}
                disabled={!changingStageClient.funnelStage}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                  !changingStageClient.funnelStage
                    ? 'bg-slate-100 border-slate-300 cursor-default'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-slate-400" />
                  <span className={`font-medium text-sm ${!changingStageClient.funnelStage ? 'text-slate-500' : 'text-slate-700'}`}>
                    Sem etapa
                  </span>
                </div>
                {!changingStageClient.funnelStage && (
                  <span className="px-2 py-0.5 bg-white rounded-full text-xs font-medium text-slate-500">
                    Atual
                  </span>
                )}
              </button>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => setChangingStageClient(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Return Modal */}
      {schedulingReturnClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => {
            setSchedulingReturnClient(null)
            setSelectedReturnDate('')
          }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                <CalendarDaysIcon className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Agendar Retorno</h3>
                <p className="text-sm text-slate-500">{schedulingReturnClient.name}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Selecione a data do retorno
                </label>
                <input
                  type="date"
                  value={selectedReturnDate}
                  onChange={(e) => setSelectedReturnDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                />
              </div>

              {/* Quick date buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const date = new Date()
                    date.setDate(date.getDate() + 1)
                    setSelectedReturnDate(date.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Amanhã
                </button>
                <button
                  onClick={() => {
                    const date = new Date()
                    date.setDate(date.getDate() + 3)
                    setSelectedReturnDate(date.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Em 3 dias
                </button>
                <button
                  onClick={() => {
                    const date = new Date()
                    date.setDate(date.getDate() + 7)
                    setSelectedReturnDate(date.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Em 1 semana
                </button>
                <button
                  onClick={() => {
                    const date = new Date()
                    date.setDate(date.getDate() + 14)
                    setSelectedReturnDate(date.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Em 2 semanas
                </button>
                <button
                  onClick={() => {
                    const date = new Date()
                    date.setMonth(date.getMonth() + 1)
                    setSelectedReturnDate(date.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                >
                  Em 1 mês
                </button>
              </div>

              {selectedReturnDate && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-sm text-amber-800">
                    <span className="font-medium">Data selecionada:</span>{' '}
                    {new Date(selectedReturnDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setSchedulingReturnClient(null)
                  setSelectedReturnDate('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleScheduleReturn}
                disabled={!selectedReturnDate || savingReturn}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50"
              >
                {savingReturn ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cadence Action Modal */}
      {cadenceActionClient && cadenceActionClient.currentStep && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCadenceActionClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4 p-6">
            <div className="flex items-center gap-4 mb-6">
              {(() => {
                const step = cadenceActionClient.currentStep!
                const methodConfig = {
                  whatsapp: { icon: ChatBubbleLeftRightIcon, bg: 'bg-green-100', text: 'text-green-600', label: 'WhatsApp' },
                  email: { icon: EnvelopeIcon, bg: 'bg-blue-100', text: 'text-blue-600', label: 'E-mail' },
                  phone: { icon: PhoneIcon, bg: 'bg-amber-100', text: 'text-amber-600', label: 'Ligação' },
                  meeting: { icon: VideoCameraIcon, bg: 'bg-purple-100', text: 'text-purple-600', label: 'Reunião' },
                }
                const config = methodConfig[step.contactMethod]
                const Icon = config.icon
                return (
                  <div className={`w-12 h-12 rounded-full ${config.bg} flex items-center justify-center`}>
                    <Icon className={`w-6 h-6 ${config.text}`} />
                  </div>
                )
              })()}
              <div>
                <h3 className="text-lg font-bold text-slate-800">{cadenceActionClient.currentStep.name}</h3>
                <p className="text-sm text-slate-500">{cadenceActionClient.name}</p>
              </div>
            </div>

            {cadenceActionClient.currentStep.objective && (
              <div className="mb-4 p-3 bg-primary-50 rounded-xl border border-primary-100">
                <p className="text-sm text-primary-800">
                  <span className="font-medium">Objetivo:</span> {cadenceActionClient.currentStep.objective}
                </p>
              </div>
            )}

            {cadenceActionClient.currentStep.messageTemplate && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Mensagem a enviar:</label>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap">
                  {cadenceActionClient.currentStep.messageTemplate}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setCadenceActionClient(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={executeCadenceAction}
                disabled={executingCadenceAction}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all disabled:opacity-50"
              >
                {executingCadenceAction ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Executar Ação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Response Modal */}
      {showResponseModal && respondedClient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => {
            setShowResponseModal(false)
            setRespondedClient(null)
          }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Resposta do Cliente</h3>
                <p className="text-sm text-slate-500">{respondedClient.name}</p>
              </div>
            </div>

            {respondedClient.currentStep && (
              <div className="mb-6 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-600">
                  <span className="font-medium">Step atual:</span> {respondedClient.currentStep.name}
                </p>
              </div>
            )}

            <p className="text-sm text-slate-600 mb-4">O cliente respondeu ao contato?</p>

            <div className="flex items-center gap-3">
              <button
                onClick={() => handleClientResponse(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-sm transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
                Não Respondeu
              </button>
              <button
                onClick={() => handleClientResponse(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white rounded-xl font-medium text-sm transition-colors"
              >
                <CheckIcon className="w-5 h-5" />
                Respondeu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Move Modal */}
      {showBulkMoveModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={resetBulkMoveModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl m-4 max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-200">
                  <ArrowsRightLeftIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Movimentação em Massa</h3>
                  <p className="text-sm text-slate-500">Mover cards de uma etapa para outra com filtros</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Stage Selection */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">De (Etapa Origem)</label>
                  <select
                    value={bulkMoveFromStage}
                    onChange={(e) => setBulkMoveFromStage(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                  >
                    <option value="">Selecione a etapa...</option>
                    <option value="unassigned">
                      Sem etapa ({clientsByStage['unassigned']?.length || 0})
                    </option>
                    {funnelStages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name} ({clientsByStage[stage.id]?.length || 0})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Para (Etapa Destino)</label>
                  <select
                    value={bulkMoveToStage}
                    onChange={(e) => setBulkMoveToStage(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    disabled={!bulkMoveFromStage}
                  >
                    <option value="">Selecione a etapa...</option>
                    {funnelStages.filter(s => s.id !== bulkMoveFromStage).map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Filters Section */}
              <div className="border-t border-slate-200 pt-6">
                <h4 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                  <FunnelIcon className="w-4 h-4" />
                  Filtros (Opcional)
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  {/* Capital Social Range */}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-600 mb-2">
                      Capital Social (R$)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        placeholder="Mínimo"
                        value={bulkMoveFilters.capitalSocialMin || ''}
                        onChange={(e) => setBulkMoveFilters(prev => ({
                          ...prev,
                          capitalSocialMin: Number(e.target.value) || 0
                        }))}
                        className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                      />
                      <span className="text-slate-400">até</span>
                      <input
                        type="number"
                        placeholder="Máximo"
                        value={bulkMoveFilters.capitalSocialMax || ''}
                        onChange={(e) => setBulkMoveFilters(prev => ({
                          ...prev,
                          capitalSocialMax: Number(e.target.value) || 0
                        }))}
                        className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                      />
                    </div>
                    {bulkMoveFilterOptions.maxCapitalSocial > 0 && (
                      <p className="text-xs text-slate-400 mt-1">
                        Máximo na base: R$ {bulkMoveFilterOptions.maxCapitalSocial.toLocaleString('pt-BR')}
                      </p>
                    )}
                  </div>

                  {/* Porte Empresa - Multi-select */}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-600 mb-2">
                      Porte da Empresa (selecione um ou mais)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {bulkMoveFilterOptions.porteOptions.map((porte) => (
                        <button
                          key={porte}
                          type="button"
                          onClick={() => {
                            setBulkMoveFilters(prev => ({
                              ...prev,
                              porteEmpresa: prev.porteEmpresa.includes(porte)
                                ? prev.porteEmpresa.filter(p => p !== porte)
                                : [...prev.porteEmpresa, porte]
                            }))
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            bulkMoveFilters.porteEmpresa.includes(porte)
                              ? 'bg-amber-100 text-amber-700 border-2 border-amber-400'
                              : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
                          }`}
                        >
                          {porte}
                        </button>
                      ))}
                      {bulkMoveFilterOptions.porteOptions.length === 0 && (
                        <span className="text-sm text-slate-400 italic">Nenhum porte cadastrado</span>
                      )}
                    </div>
                  </div>

                  {/* Municipio */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Cidade</label>
                    <select
                      value={bulkMoveFilters.municipio}
                      onChange={(e) => setBulkMoveFilters(prev => ({ ...prev, municipio: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    >
                      <option value="">Todas</option>
                      {bulkMoveFilterOptions.municipioOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  {/* Estado */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Estado</label>
                    <select
                      value={bulkMoveFilters.estado}
                      onChange={(e) => setBulkMoveFilters(prev => ({ ...prev, estado: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    >
                      <option value="">Todos</option>
                      {bulkMoveFilterOptions.estadoOptions.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                  </div>

                  {/* Tipo */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Tipo</label>
                    <select
                      value={bulkMoveFilters.tipo}
                      onChange={(e) => setBulkMoveFilters(prev => ({ ...prev, tipo: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    >
                      <option value="">Todos</option>
                      {bulkMoveFilterOptions.tipoOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Natureza Juridica */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Natureza Jurídica</label>
                    <select
                      value={bulkMoveFilters.naturezaJuridica}
                      onChange={(e) => setBulkMoveFilters(prev => ({ ...prev, naturezaJuridica: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    >
                      <option value="">Todas</option>
                      {bulkMoveFilterOptions.naturezaJuridicaOptions.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  {/* Centro de Custos */}
                  {costCenters.length > 0 && (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-600 mb-2">Centro de Custos</label>
                      <select
                        value={bulkMoveFilters.costCenterId}
                        onChange={(e) => setBulkMoveFilters(prev => ({ ...prev, costCenterId: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                      >
                        <option value="">Todos os centros de custos</option>
                        <option value="none">Sem centro de custos</option>
                        {costCenters.map((cc) => (
                          <option key={cc.id} value={cc.id}>
                            {cc.code.toString().padStart(4, '0')} - {cc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Results Count */}
              {bulkMoveFromStage && (
                <div className="mt-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                        <UserGroupIcon className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Contatos que atendem aos critérios</p>
                        <p className="text-xs text-slate-500">
                          Da etapa: {funnelStages.find(s => s.id === bulkMoveFromStage)?.name || '-'}
                        </p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-amber-600">
                      {bulkMoveFilteredClients.length}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={resetBulkMoveModal}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setShowBulkMoveConfirm(true)}
                disabled={!bulkMoveFromStage || !bulkMoveToStage || bulkMoveFilteredClients.length === 0}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-200"
              >
                <ArrowsRightLeftIcon className="w-4 h-4" />
                Mover {bulkMoveFilteredClients.length} Contato{bulkMoveFilteredClients.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Move Confirmation Modal */}
      {showBulkMoveConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowBulkMoveConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                <ExclamationTriangleIcon className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Confirmar Movimentação</h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>

            <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-sm text-slate-600 mb-2">
                Você está prestes a mover <strong className="text-amber-600">{bulkMoveFilteredClients.length} contato{bulkMoveFilteredClients.length !== 1 ? 's' : ''}</strong>
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-slate-200 rounded text-slate-700">
                  {funnelStages.find(s => s.id === bulkMoveFromStage)?.name || '-'}
                </span>
                <ArrowsRightLeftIcon className="w-4 h-4 text-slate-400" />
                <span className="px-2 py-1 bg-amber-100 rounded text-amber-700">
                  {funnelStages.find(s => s.id === bulkMoveToStage)?.name || '-'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowBulkMoveConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                disabled={executingBulkMove}
              >
                Cancelar
              </button>
              <button
                onClick={executeBulkMove}
                disabled={executingBulkMove}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50"
              >
                {executingBulkMove ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Cost Center Change Modal */}
      {showBulkCostCenterModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setShowBulkCostCenterModal(false)
              setBulkCostCenterStage('')
              setBulkCostCenterId('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4">
            {/* Header */}
            <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-primary-50 to-primary-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-500 flex items-center justify-center shadow-lg shadow-primary-200">
                  <CurrencyDollarIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Centro de Custos em Massa</h3>
                  <p className="text-sm text-slate-500">Alterar CC de todos os contatos de uma etapa</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Stage Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Etapa do Funil</label>
                <select
                  value={bulkCostCenterStage}
                  onChange={(e) => setBulkCostCenterStage(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                >
                  <option value="">Selecione a etapa...</option>
                  <option value="unassigned">
                    Sem etapa ({clientsByStage['unassigned']?.length || 0})
                  </option>
                  {funnelStages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name} ({clientsByStage[stage.id]?.length || 0})
                    </option>
                  ))}
                </select>
              </div>

              {/* Cost Center Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Novo Centro de Custos</label>
                <select
                  value={bulkCostCenterId}
                  onChange={(e) => setBulkCostCenterId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                  disabled={!bulkCostCenterStage}
                >
                  <option value="">Remover centro de custos</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} - {cc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Results Count */}
              {bulkCostCenterStage && (
                <div className="p-4 bg-gradient-to-r from-primary-50 to-primary-50 rounded-xl border border-primary-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                        <UserGroupIcon className="w-5 h-5 text-primary-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Contatos a serem atualizados</p>
                        <p className="text-xs text-slate-500">
                          {bulkCostCenterStage === 'unassigned'
                            ? 'Sem etapa'
                            : funnelStages.find(s => s.id === bulkCostCenterStage)?.name}
                        </p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-primary-600">
                      {bulkCostCenterClients.length}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl">
              <button
                onClick={() => {
                  setShowBulkCostCenterModal(false)
                  setBulkCostCenterStage('')
                  setBulkCostCenterId('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={executeBulkCostCenterChange}
                disabled={!bulkCostCenterStage || bulkCostCenterClients.length === 0 || executingBulkCostCenter}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-medium text-sm hover:from-primary-600 hover:to-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-200"
              >
                {executingBulkCostCenter ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Aplicar a {bulkCostCenterClients.length} Contato{bulkCostCenterClients.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay para fechar filtros avançados (fora do sticky header para evitar stacking context) */}
      {showAdvancedFilters && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setShowAdvancedFilters(false)}
        />
      )}

      {/* Modal de Relatório */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowReportModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <ChartBarIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Gerar Relatório</h3>
                  <p className="text-xs text-slate-500">Selecione o período e formato</p>
                </div>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Período</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={reportDateFrom}
                    onChange={(e) => setReportDateFrom(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    placeholder="Data início"
                  />
                  <span className="text-sm text-slate-400">a</span>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={(e) => setReportDateTo(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    placeholder="Data fim"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Deixe em branco para exportar todos os contatos</p>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  onClick={handleExportExcel}
                  disabled={exportingExcel || filteredClients.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {exportingExcel ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <ArrowDownTrayIcon className="w-4 h-4" />
                  )}
                  Exportar Excel
                </button>
                <button
                  onClick={handleGeneratePdf}
                  disabled={exportingPdf || filteredClients.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {exportingPdf ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <DocumentTextIcon className="w-4 h-4" />
                  )}
                  Gerar Resumo PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Forçar Cadência */}
      {forceCadenceStageId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !forcingCadence && setForceCadenceStageId(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Forçar Cadência</h3>
            <p className="mt-1 text-sm text-slate-500">
              Executar a próxima ação de cadência para os contatos mais antigos desta etapa.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700">
                Quantos contatos?
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={forceCadenceLimit}
                onChange={(e) => setForceCadenceLimit(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                disabled={forcingCadence}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                onClick={() => setForceCadenceStageId(null)}
                disabled={forcingCadence}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                onClick={handleForceCadence}
                disabled={forcingCadence}
              >
                {forcingCadence ? 'Executando...' : 'Executar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Novo Contato */}
      {showNewContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowNewContactModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                  <PersonIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Novo Contato</h2>
                  <p className="text-xs text-slate-500">Preencha os dados do contato</p>
                </div>
              </div>
              <button
                onClick={() => setShowNewContactModal(false)}
                className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-6">
              {/* Photo */}
              <div className="flex items-center gap-4">
                {newContactPhotoPreview || newContactForm.photoUrl ? (
                  <Image
                    src={newContactPhotoPreview || newContactForm.photoUrl}
                    alt="Foto"
                    width={80}
                    height={80}
                    className="w-20 h-20 rounded-2xl object-cover ring-4 ring-white shadow-lg"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                    <PersonIcon className="w-8 h-8 text-slate-400" />
                  </div>
                )}
                <div>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium text-slate-700 cursor-pointer transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null
                        setNewContactPhotoFile(f)
                        setNewContactPhotoPreview(f ? URL.createObjectURL(f) : null)
                      }}
                      className="sr-only"
                    />
                    Alterar foto
                  </label>
                  <p className="text-xs text-slate-500 mt-1">JPG, PNG ou GIF</p>
                </div>
              </div>

              {/* Form fields */}
              {Object.keys(newContactErrors).length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Corrija os seguintes campos para continuar:</p>
                    <ul className="mt-1 text-sm text-red-600 list-disc list-inside">
                      {Object.values(newContactErrors).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <PersonIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={newContactForm.name}
                      onChange={(e) => {
                        setNewContactForm({ ...newContactForm, name: e.target.value })
                        if (newContactErrors.name) setNewContactErrors(prev => { const { name, ...rest } = prev; return rest })
                      }}
                      placeholder="Nome do contato"
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${newContactErrors.name ? 'border-red-300 focus:ring-red-500/20 focus:border-red-400' : 'border-slate-200 focus:ring-primary-500/20 focus:border-primary-400'}`}
                    />
                  </div>
                  {newContactErrors.name && <p className="mt-1 text-xs text-red-500">{newContactErrors.name}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Telefone <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <MobileIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={newContactForm.phone}
                      onChange={(e) => {
                        setNewContactForm({ ...newContactForm, phone: maskPhone(e.target.value) })
                        if (newContactErrors.phone) setNewContactErrors(prev => { const { phone, ...rest } = prev; return rest })
                      }}
                      placeholder="(00) 00000-0000"
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${newContactErrors.phone ? 'border-red-300 focus:ring-red-500/20 focus:border-red-400' : 'border-slate-200 focus:ring-primary-500/20 focus:border-primary-400'}`}
                    />
                  </div>
                  {newContactErrors.phone && <p className="mt-1 text-xs text-red-500">{newContactErrors.phone}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <div className="relative">
                    <EnvelopeClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={newContactForm.email}
                      onChange={(e) => {
                        setNewContactForm({ ...newContactForm, email: e.target.value })
                        if (newContactErrors.email) setNewContactErrors(prev => { const { email, ...rest } = prev; return rest })
                      }}
                      placeholder="email@exemplo.com"
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${newContactErrors.email ? 'border-red-300 focus:ring-red-500/20 focus:border-red-400' : 'border-slate-200 focus:ring-primary-500/20 focus:border-primary-400'}`}
                    />
                  </div>
                  {newContactErrors.email && <p className="mt-1 text-xs text-red-500">{newContactErrors.email}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Empresa</label>
                  <div className="relative">
                    <BuildingOfficeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={newContactForm.company}
                      onChange={(e) => setNewContactForm({ ...newContactForm, company: e.target.value })}
                      placeholder="Nome da empresa"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">CNPJ / CPF</label>
                  <input
                    type="text"
                    value={newContactForm.document}
                    onChange={(e) => {
                      setNewContactForm({ ...newContactForm, document: maskDocument(e.target.value) })
                      if (newContactErrors.document) setNewContactErrors(prev => { const { document, ...rest } = prev; return rest })
                    }}
                    placeholder="000.000.000-00"
                    className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${newContactErrors.document ? 'border-red-300 focus:ring-red-500/20 focus:border-red-400' : 'border-slate-200 focus:ring-primary-500/20 focus:border-primary-400'}`}
                  />
                  {newContactErrors.document && <p className="mt-1 text-xs text-red-500">{newContactErrors.document}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Ramo de atuação</label>
                  <input
                    type="text"
                    value={newContactForm.industry}
                    onChange={(e) => setNewContactForm({ ...newContactForm, industry: e.target.value })}
                    placeholder="Ex: Tecnologia, Varejo..."
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Origem do Lead</label>
                  <select
                    value={newContactForm.leadSource}
                    onChange={(e) => setNewContactForm({ ...newContactForm, leadSource: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all bg-white"
                  >
                    <option value="">Selecione...</option>
                    {leadSourceOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo de Lead</label>
                  <select
                    value={newContactForm.leadType}
                    onChange={(e) => setNewContactForm({ ...newContactForm, leadType: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all bg-white"
                  >
                    <option value="">Selecione...</option>
                    {leadTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {costCenters.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Centro de Custos</label>
                    <select
                      value={newContactForm.costCenterId}
                      onChange={(e) => setNewContactForm({ ...newContactForm, costCenterId: e.target.value })}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all bg-white"
                    >
                      <option value="">Selecione...</option>
                      {costCenters.map((cc) => (
                        <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Aniversário</label>
                  <input
                    type="date"
                    value={newContactForm.birthday}
                    onChange={(e) => setNewContactForm({ ...newContactForm, birthday: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Alerta de retorno</label>
                  <input
                    type="date"
                    value={newContactForm.returnAlert}
                    onChange={(e) => setNewContactForm({ ...newContactForm, returnAlert: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                {/* Sócios */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Socios</label>
                  {newContactPartners.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {newContactPartners.map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 px-3 py-1.5 rounded-full text-sm font-medium">
                          {p}
                          <button
                            type="button"
                            onClick={() => setNewContactPartners(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-primary-400 hover:text-red-500 transition-colors"
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newPartnerInput}
                      onChange={(e) => setNewPartnerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const name = newPartnerInput.trim()
                          if (name) {
                            setNewContactPartners(prev => [...prev, name])
                            setNewPartnerInput('')
                          }
                        }
                      }}
                      placeholder="Nome do socio e pressione Enter ou clique +"
                      className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const name = newPartnerInput.trim()
                        if (name) {
                          setNewContactPartners(prev => [...prev, name])
                          setNewPartnerInput('')
                        }
                      }}
                      className="px-3.5 py-2.5 bg-primary-50 text-primary-600 rounded-xl text-sm font-bold hover:bg-primary-100 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Descricao</label>
                  <textarea
                    value={newContactForm.description}
                    onChange={(e) => setNewContactForm({ ...newContactForm, description: e.target.value })}
                    placeholder="Descrição da empresa ou notas sobre o contato..."
                    rows={3}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowNewContactModal(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNewContact}
                disabled={savingNewContact}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingNewContact ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    Adicionar contato
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Active Call Status Indicator */}
      {activeCallStatus && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border backdrop-blur-sm ${
            activeCallStatus.status === 'completed'
              ? 'bg-emerald-50/95 border-emerald-300 shadow-emerald-200/50'
              : activeCallStatus.status === 'error'
              ? 'bg-red-50/95 border-red-300 shadow-red-200/50'
              : 'bg-white/95 border-blue-200 shadow-blue-200/30'
          }`}>
            {activeCallStatus.status === 'completed' ? (
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
              </div>
            ) : activeCallStatus.status === 'error' ? (
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
            ) : (
              <div className="relative w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <PhoneIcon className="w-4 h-4 text-blue-600" />
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full animate-ping" />
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full" />
              </div>
            )}
            <div className="flex flex-col">
              <span className={`text-sm font-semibold ${
                activeCallStatus.status === 'completed'
                  ? 'text-emerald-800'
                  : activeCallStatus.status === 'error'
                  ? 'text-red-800'
                  : 'text-slate-800'
              }`}>
                {activeCallStatus.clientName}
              </span>
              <span className={`text-xs ${
                activeCallStatus.status === 'completed'
                  ? 'text-emerald-600'
                  : activeCallStatus.status === 'error'
                  ? 'text-red-600'
                  : 'text-blue-600'
              }`}>
                {activeCallStatus.status === 'initiating' && 'Iniciando ligação...'}
                {activeCallStatus.status === 'queued' && 'Na fila - aguardando'}
                {activeCallStatus.status === 'ringing' && 'Chamando...'}
                {activeCallStatus.status === 'in-progress' && 'Em andamento'}
                {activeCallStatus.status === 'forwarding' && 'Transferindo...'}
                {activeCallStatus.status === 'ended' && 'Finalizando...'}
                {activeCallStatus.status === 'completed' && (activeCallStatus.resultado || 'Concluída')}
                {activeCallStatus.status === 'error' && (activeCallStatus.resultado || 'Erro')}
              </span>
              {activeCallStatus.duration !== undefined && activeCallStatus.duration > 0 && (
                <span className="text-xs text-slate-400">
                  {Math.floor(activeCallStatus.duration / 60)}:{String(activeCallStatus.duration % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            {['completed', 'error'].includes(activeCallStatus.status) && (
              <button
                onClick={() => setActiveCallStatus(null)}
                className="ml-2 p-1 rounded-full hover:bg-slate-200/50 transition-colors"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bulk Selection Floating Bar (Story 15.3) */}
      {bulkSelectMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white rounded-2xl px-6 py-3 flex items-center gap-4 shadow-2xl">
          <span className="text-sm font-medium">
            {bulkSelectedIds.size} contato{bulkSelectedIds.size !== 1 ? 's' : ''} selecionado{bulkSelectedIds.size !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => {
              if (bulkSelectedIds.size === 0) {
                toast.error('Selecione ao menos um contato')
                return
              }
              if (bulkSelectedIds.size > 500) {
                toast.error('Máximo de 500 contatos por transferência')
                return
              }
              setShowCrossFunnelModal(true)
            }}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium transition-colors"
          >
            Mover para outro funil
          </button>
          <button
            onClick={() => {
              setBulkSelectMode(false)
              setBulkSelectedIds(new Set())
            }}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Cross-Funnel Transfer Modal (Story 15.3) */}
      {showCrossFunnelModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCrossFunnelModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Transferir para outro Funil</h3>
            <p className="text-sm text-slate-500">{bulkSelectedIds.size} contato{bulkSelectedIds.size !== 1 ? 's' : ''} selecionado{bulkSelectedIds.size !== 1 ? 's' : ''}</p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Funil destino</label>
              <select
                value={crossFunnelTarget}
                onChange={(e) => { setCrossFunnelTarget(e.target.value); setCrossFunnelTargetStage('') }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              >
                <option value="">Selecionar funil...</option>
                {allOrgFunnels.filter(f => f.id !== funnelId).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {crossFunnelTarget && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Etapa destino</label>
                <select
                  value={crossFunnelTargetStage}
                  onChange={(e) => setCrossFunnelTargetStage(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="">Selecionar etapa...</option>
                  {crossFunnelStages.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowCrossFunnelModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={executeCrossFunnelTransfer}
                disabled={!crossFunnelTargetStage || executingCrossFunnel}
                className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {executingCrossFunnel ? 'Transferindo...' : 'Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Modal */}
      {showWhatsAppModal && selectedClient && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-green-50">
              <div className="flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="w-5 h-5 text-green-600" />
                <h3 className="text-lg font-semibold text-slate-800">Enviar WhatsApp</h3>
              </div>
              <button
                onClick={() => { setShowWhatsAppModal(false); setWhatsappMessage('') }}
                className="p-1 rounded-lg hover:bg-green-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-sm text-slate-500 mb-1">Para: <span className="font-medium text-slate-700">{selectedClient.name}</span></p>
                <p className="text-xs text-slate-400">{selectedClient.phone}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem</label>
                <textarea
                  value={whatsappMessage}
                  onChange={(e) => setWhatsappMessage(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                  placeholder="Digite sua mensagem..."
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowWhatsAppModal(false); setWhatsappMessage('') }}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSendWhatsAppMessage}
                  disabled={!whatsappMessage.trim() || sendingWhatsApp}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingWhatsApp ? 'Enviando...' : 'Enviar WhatsApp'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {showEmailModal && selectedClient && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-blue-50">
              <div className="flex items-center gap-2">
                <EnvelopeClosedIcon className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-slate-800">Enviar Email</h3>
              </div>
              <button
                onClick={() => { setShowEmailModal(false); setEmailSubject(''); setEmailBody('') }}
                className="p-1 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Para: <span className="font-medium text-slate-700">{selectedClient.name}</span></p>
                  <p className="text-xs text-slate-400">{selectedClient.email}</p>
                </div>
                {emailTemplates.length > 0 && (
                  <select
                    onChange={(e) => {
                      const tpl = emailTemplates.find(t => t.id === e.target.value)
                      if (tpl) {
                        const replaceVars = (text: string) =>
                          text
                            .replace(/\{\{nome\}\}/g, selectedClient.name || '')
                            .replace(/\{\{empresa\}\}/g, selectedClient.company || '')
                            .replace(/\{\{email\}\}/g, selectedClient.email || '')
                        setEmailSubject(replaceVars(tpl.subject))
                        setEmailBody(replaceVars(tpl.body))
                      }
                      e.target.value = ''
                    }}
                    className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    defaultValue=""
                  >
                    <option value="" disabled>Usar template...</option>
                    {emailTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assunto</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Assunto do email..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem</label>
                <RichTextEditor
                  value={emailBody}
                  onChange={setEmailBody}
                  placeholder="Escreva o corpo do email..."
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
              <button
                onClick={async () => {
                  if (!emailSubject.trim() || !emailBody.trim()) return
                  const name = window.prompt('Nome do template:')
                  if (!name?.trim() || !orgId) return
                  setSavingTemplate(true)
                  try {
                    await addDoc(collection(db, 'organizations', orgId, 'emailTemplates'), {
                      name: name.trim(),
                      subject: emailSubject,
                      body: emailBody,
                      createdAt: new Date().toISOString(),
                    })
                    const snap = await getDocs(query(
                      collection(db, 'organizations', orgId, 'emailTemplates'),
                      orderBy('createdAt', 'desc')
                    ))
                    setEmailTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; subject: string; body: string })))
                  } catch (error) {
                    console.error('Error saving template:', error)
                  } finally {
                    setSavingTemplate(false)
                  }
                }}
                disabled={!emailSubject.trim() || !emailBody.trim() || savingTemplate}
                className="text-sm text-slate-500 hover:text-slate-700 underline decoration-dotted disabled:opacity-40 disabled:no-underline"
              >
                {savingTemplate ? 'Salvando...' : 'Salvar como template'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowEmailModal(false); setEmailSubject(''); setEmailBody('') }}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSendEmailMessage}
                  disabled={!emailSubject.trim() || !emailBody.trim() || sendingEmail}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingEmail ? 'Enviando...' : 'Enviar Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
