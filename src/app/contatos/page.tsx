'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, addDoc, query, orderBy, getDocs, where, writeBatch } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { leadSourceOptions, leadSourceIcons, leadTypeOptions } from '@/lib/leadSources'
import Image from 'next/image'
import Skeleton from '@/components/shared/Skeleton'
import * as XLSX from 'xlsx'
import {
  PlusIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  PersonIcon,
  EnvelopeClosedIcon,
  MobileIcon,
  CheckIcon,
} from '@radix-ui/react-icons'
import {
  BuildingOfficeIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  UserGroupIcon,
  CheckBadgeIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { formatWhatsAppNumber } from '@/lib/format'
import MemberSelector from '@/components/MemberSelector'
import { useVisibleFunnels } from '@/hooks/useVisibleFunnels'

// Types
type Cliente = {
  id: string
  name: string
  phone: string
  phone2?: string
  company?: string
  address?: string
  description?: string
  industry?: string
  document?: string
  email?: string
  birthday?: string
  returnAlert?: string
  photoUrl?: string
  leadSource?: string
  leadType?: 'Inbound' | 'Outbound' // Tipo de lead: Inbound ou Outbound
  funnelStage?: string
  funnelStageUpdatedAt?: string
  firstContactAt?: string
  status?: 'Lead' | 'Lead-qualificado' | 'Ativo' | 'Inativo' | 'Inatividade Longa'
  createdAt?: string
  updatedAt?: string
  lastFollowUpAt?: string
  partners?: string // Lista de sócios separados por vírgula
  costCenterId?: string
  assignedTo?: string
  assignedToName?: string
  assignedAt?: string
}

type FunnelStage = {
  id: string
  name: string
  order: number
  color?: string
  funnelId?: string
}

type SortConfig = {
  key: keyof Cliente | 'daysInStage' | 'daysSinceFollowUp' | null
  direction: 'asc' | 'desc'
}

type ColumnFilters = {
  [key: string]: string
}

type FollowUp = {
  id: string
  text?: string
  author?: string
  createdAt: string
}

// Stage colors mapping
const stageColors: Record<string, { bg: string; text: string }> = {
  // Default colors for common stage names
  'Novo Lead': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Lead': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Primeiro Contato': { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  'Qualificação': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Qualificado': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Proposta Enviada': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Proposta': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Negociação': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'Fechado Ganho': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Ganho': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Cliente': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Fechado Perdido': { bg: 'bg-red-100', text: 'text-red-700' },
  'Perdido': { bg: 'bg-red-100', text: 'text-red-700' },
  'Sem interesse': { bg: 'bg-slate-100', text: 'text-slate-600' },
  'Prospecção ativa': { bg: 'bg-primary-100', text: 'text-primary-700' },
  'Primeiro Contato realizado': { bg: 'bg-teal-100', text: 'text-teal-700' },
}

// Color palette for stages without predefined colors
const colorPalette = [
  { bg: 'bg-primary-100', text: 'text-primary-700' },
  { bg: 'bg-primary-100', text: 'text-primary-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-lime-100', text: 'text-lime-700' },
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
]

// Helper to calculate days from a date
const calculateDaysSince = (dateString?: string): number | null => {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffTime = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays >= 0 ? diffDays : null
}

// Format days display
const formatDays = (days: number | null): string => {
  if (days === null) return '-'
  if (days === 0) return 'Hoje'
  if (days === 1) return '1 dia'
  return `${days} dias`
}

// Get days badge color
const getDaysBadgeColor = (days: number | null): string => {
  if (days === null) return 'bg-slate-100 text-slate-500'
  if (days <= 2) return 'bg-emerald-100 text-emerald-700'
  if (days <= 7) return 'bg-amber-100 text-amber-700'
  if (days <= 14) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}

const emptyForm = {
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
  assignedTo: '',
  assignedToName: '',
}

type CostCenter = {
  id: string
  code: number
  name: string
}

export default function ContatosPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { userEmail, orgId } = useCrmUser()
  const [clients, setClients] = useState<Cliente[]>([])
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)

  // Table state
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' })
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({})
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [perPage] = useState(15)

  // Form state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allFilteredSelected, setAllFilteredSelected] = useState(false)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [deletingBulk, setDeletingBulk] = useState(false)
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false)
  const [bulkFunnelId, setBulkFunnelId] = useState('')
  const [bulkStageId, setBulkStageId] = useState('')
  const [savingBulkMove, setSavingBulkMove] = useState(false)
  const [quickFunnelFilter, setQuickFunnelFilter] = useState<'all' | 'no-funnel'>('all')

  // Actions dropdown
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [actionsPosition, setActionsPosition] = useState<{ top: number; left: number } | null>(null)

  // Stage change modal
  const [stageChangeClient, setStageChangeClient] = useState<Cliente | null>(null)
  const [newStageId, setNewStageId] = useState<string>('')
  const [savingStage, setSavingStage] = useState(false)

  // Follow-up modal
  const [followUpClient, setFollowUpClient] = useState<Cliente | null>(null)
  const [followUpNote, setFollowUpNote] = useState('')
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [clientFollowUps, setClientFollowUps] = useState<FollowUp[]>([])
  const [loadingFollowUps, setLoadingFollowUps] = useState(false)

  // Dynamic stage color mapping
  const [stageColorMap, setStageColorMap] = useState<Record<string, { bg: string; text: string }>>({})

  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<Array<Record<string, string>>>([])
  const [exporting, setExporting] = useState(false)
  const [importFunnelId, setImportFunnelId] = useState('')
  const [importStageId, setImportStageId] = useState('')
  const [importResult, setImportResult] = useState<{ success: boolean; count: number } | null>(null)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const { funnels } = useVisibleFunnels()

  const importStagesForFunnel = useMemo(() => {
    if (!importFunnelId) return []
    return funnelStages.filter(s => s.funnelId === importFunnelId)
  }, [importFunnelId, funnelStages])

  // Partners upload state
  const [showPartnersModal, setShowPartnersModal] = useState(false)
  const [uploadingPartners, setUploadingPartners] = useState(false)
  const [partnersFile, setPartnersFile] = useState<File | null>(null)
  const [partnersPreview, setPartnersPreview] = useState<Array<{ cnpj: string; partners: string }>>([])
  const [partnersResult, setPartnersResult] = useState<{ updated: number; notFound: string[] } | null>(null)

  // Load clients, funnel stages, and cost centers
  useEffect(() => {
    if (!orgId) return

    const unsubClients = onSnapshot(query(collection(db, 'clients'), where('orgId', '==', orgId)), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Cliente[]
      setClients(data)
      setLoading(false)
    })

    const unsubStages = onSnapshot(query(collection(db, 'funnelStages'), where('orgId', '==', orgId)), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as FunnelStage[]
      setFunnelStages(data.sort((a, b) => a.order - b.order))

      // Build color map for stages
      const colorMap: Record<string, { bg: string; text: string }> = {}
      let paletteIndex = 0
      data.forEach((stage) => {
        if (stageColors[stage.name]) {
          colorMap[stage.id] = stageColors[stage.name]
        } else {
          colorMap[stage.id] = colorPalette[paletteIndex % colorPalette.length]
          paletteIndex++
        }
      })
      setStageColorMap(colorMap)
    })

    const unsubCostCenters = onSnapshot(query(collection(db, 'organizations', orgId, 'costCenters')), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CostCenter[]
      setCostCenters(data.sort((a, b) => a.code - b.code))
    })

    return () => {
      unsubClients()
      unsubStages()
      unsubCostCenters()
    }
  }, [orgId])

  // Check for 'novo' parameter to open modal automatically
  useEffect(() => {
    if (searchParams.get('novo') === 'true') {
      setEditingId(null)
      setForm(emptyForm)
      setPhotoFile(null)
      setPhotoPreview(null)
      setShowModal(true)
      // Remove the parameter from the URL without reloading the page
      router.replace('/contatos', { scroll: false })
    }
  }, [searchParams, router])

  // Load follow-ups when follow-up modal opens
  useEffect(() => {
    if (!followUpClient) {
      setClientFollowUps([])
      return
    }

    const loadFollowUps = async () => {
      setLoadingFollowUps(true)
      try {
        // Follow-ups are stored as subcollection: clients/{clientId}/followups
        const q = query(
          collection(db, 'clients', followUpClient.id, 'followups'),
          orderBy('createdAt', 'desc')
        )
        const snapshot = await getDocs(q)
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as FollowUp[]
        setClientFollowUps(data)
      } catch (error) {
        console.error('Erro ao carregar follow-ups:', error)
      } finally {
        setLoadingFollowUps(false)
      }
    }

    loadFollowUps()
  }, [followUpClient])

  // Get funnel stage name
  const getStageName = useCallback((stageId?: string) => {
    if (!stageId) return '-'
    const stage = funnelStages.find((s) => s.id === stageId)
    return stage?.name || '-'
  }, [funnelStages])

  // Get funnel stage color
  const getStageColor = useCallback((stageId?: string) => {
    if (!stageId) return { bg: 'bg-slate-100', text: 'text-slate-600' }
    return stageColorMap[stageId] || { bg: 'bg-slate-100', text: 'text-slate-600' }
  }, [stageColorMap])

  // Handle stage change
  const handleStageChange = async () => {
    if (!stageChangeClient || !newStageId) return
    setSavingStage(true)
    try {
      const fromStageName = funnelStages.find(s => s.id === stageChangeClient.funnelStage)?.name || 'Sem etapa'
      const toStageName = funnelStages.find(s => s.id === newStageId)?.name || 'Desconhecido'

      await updateDoc(doc(db, 'clients', stageChangeClient.id), {
        funnelStage: newStageId,
        funnelStageUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Audit log for stage change
      await addDoc(collection(db, 'clients', stageChangeClient.id, 'logs'), {
        action: 'stage_change',
        message: `Etapa alterada de ${fromStageName} para ${toStageName}`,
        type: 'audit',
        author: userEmail || 'Sistema',
        authorId: '',
        metadata: {
          fromStageId: stageChangeClient.funnelStage || '',
          toStageId: newStageId,
          fromStageName,
          toStageName,
        },
        orgId,
        createdAt: new Date().toISOString(),
      })

      setStageChangeClient(null)
      setNewStageId('')
    } catch (error) {
      console.error('Erro ao mudar etapa:', error)
      alert('Erro ao mudar etapa')
    } finally {
      setSavingStage(false)
    }
  }

  // Handle follow-up registration
  const handleFollowUp = async () => {
    if (!followUpClient) return
    setSavingFollowUp(true)
    try {
      const now = new Date().toISOString()

      // Save follow-up to subcollection: clients/{clientId}/followups
      const followUpRef = doc(collection(db, 'clients', followUpClient.id, 'followups'))
      const newFollowUp = {
        text: followUpNote.trim() || null,
        author: userEmail || 'Usuário',
        createdAt: now,
      }
      await setDoc(followUpRef, newFollowUp)

      // Update client's lastFollowUpAt
      await updateDoc(doc(db, 'clients', followUpClient.id), {
        lastFollowUpAt: now,
        updatedAt: now,
      })

      // Add to local state immediately
      setClientFollowUps((prev) => [{ id: followUpRef.id, ...newFollowUp } as FollowUp, ...prev])
      setFollowUpNote('')
    } catch (error) {
      console.error('Erro ao registrar follow-up:', error)
      alert('Erro ao registrar follow-up')
    } finally {
      setSavingFollowUp(false)
    }
  }

  // Open WhatsApp
  const openWhatsApp = (phone: string, name: string) => {
    const message = encodeURIComponent(`Olá ${name}!`)
    window.open(`https://wa.me/${formatWhatsAppNumber(phone)}?text=${message}`, '_blank')
  }

  // Open Email
  const openEmail = (email?: string, name?: string) => {
    if (!email) {
      alert('Este contato não possui email cadastrado')
      return
    }
    const subject = encodeURIComponent(`Contato - ${name || 'Cliente'}`)
    window.open(`mailto:${email}?subject=${subject}`, '_blank')
  }

  // Handle import file selection (CSV + XLSX/XLS)
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFile(file)
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    if (isExcel) {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const data = event.target?.result
          const workbook = XLSX.read(data, { type: 'array' })
          const worksheet = workbook.Sheets[workbook.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })

          const preview = rows.slice(0, 5).map((row) => {
            const mapped: Record<string, string> = {}
            Object.entries(row).forEach(([key, value]) => {
              mapped[key.toLowerCase().trim()] = String(value ?? '').trim()
            })
            return mapped
          })

          setImportPreview(preview)
        } catch {
          alert('Erro ao ler arquivo Excel')
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const text = event.target?.result as string
          const lines = text.split('\n').filter((line) => line.trim())
          const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase())

          const preview = lines.slice(1, 6).map((line) => {
            const values = line.match(/("([^"]*)"|[^,]+)/g) || []
            const row: Record<string, string> = {}
            headers.forEach((header, idx) => {
              row[header] = values[idx]?.replace(/"/g, '').trim() || ''
            })
            return row
          })

          setImportPreview(preview)
        } catch {
          alert('Erro ao ler arquivo CSV')
        }
      }
      reader.readAsText(file, 'UTF-8')
    }
  }

  // Import contacts from CSV or XLSX
  const handleImport = async () => {
    if (!importFile) return

    const fieldMap: Record<string, string> = {
      // Nome
      nome: 'name',
      name: 'name',
      'razao social': 'name',
      'razão social': 'name',
      // Nome Fantasia → empresa
      'nome fantasia': 'company',
      empresa: 'company',
      company: 'company',
      // Telefone
      telefone: 'phone',
      phone: 'phone',
      'telefone1 completo': 'phone',
      telefone1: 'phone',
      'telefone2 completo': 'phone2',
      telefone2: 'phone2',
      // Email
      email: 'email',
      'e-mail': 'email',
      // Ramo/Industria
      ramo: 'industry',
      industry: 'industry',
      'ramo de atividade': 'industry',
      // Documento
      cnpj: 'document',
      cpf: 'document',
      'cnpj/cpf': 'document',
      document: 'document',
      // Origem
      origem: 'leadSource',
      leadsource: 'leadSource',
      source: 'leadSource',
      // Socios
      'socio(s)': 'partners',
      'sócio(s)': 'partners',
      socios: 'partners',
      'sócios': 'partners',
      partners: 'partners',
      // Responsavel
      'usuario responsavel': 'assignedToName',
      'usuário responsável': 'assignedToName',
    }

    // Colunas de endereco que serao combinadas em um unico campo 'address'
    const addressColumns = [
      'tipo logradouro', 'logradouro', 'numero', 'número',
      'complemento', 'bairro', 'cep', 'uf', 'municipio', 'município',
    ]

    const isExcel = importFile.name.endsWith('.xlsx') || importFile.name.endsWith('.xls')

    setImporting(true)
    try {
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          let rows: Record<string, string>[] = []

          // Monta endereco a partir de colunas individuais
          const buildAddress = (addrParts: Record<string, string>): string => {
            return [
              [addrParts['tipo logradouro'], addrParts['logradouro']].filter(Boolean).join(' '),
              addrParts['numero'] || addrParts['número'] ? `${addrParts['numero'] || addrParts['número']}` : '',
              addrParts['complemento'],
              addrParts['bairro'],
              [addrParts['municipio'] || addrParts['município'], addrParts['uf']].filter(Boolean).join('/'),
              addrParts['cep'] ? `CEP ${addrParts['cep']}` : '',
            ].filter(Boolean).join(', ')
          }

          // Mapeia uma row (XLSX ou CSV) para campos do contato
          const mapRow = (entries: [string, unknown][]): Record<string, string> => {
            const mapped: Record<string, string> = {}
            const addrParts: Record<string, string> = {}

            entries.forEach(([key, value]) => {
              const normalizedKey = key.toLowerCase().trim()
              const val = String(value ?? '').trim()
              if (!val) return

              const field = fieldMap[normalizedKey]
              if (field) {
                // Se o campo ja tem valor (ex: 'name' via 'razao social'), nao sobrescreve com vazio
                if (!mapped[field]) {
                  mapped[field] = val
                }
              }

              if (addressColumns.includes(normalizedKey)) {
                addrParts[normalizedKey] = val
              }
            })

            const address = buildAddress(addrParts)
            if (address) {
              mapped.address = address
            }

            return mapped
          }

          if (isExcel) {
            const data = event.target?.result
            const workbook = XLSX.read(data, { type: 'array' })
            const worksheet = workbook.Sheets[workbook.SheetNames[0]]
            const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
            rows = rawRows.map((row) => mapRow(Object.entries(row)))
          } else {
            const text = event.target?.result as string
            const lines = text.split('\n').filter((line) => line.trim())
            const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim())

            for (let i = 1; i < lines.length; i++) {
              const values = lines[i].match(/("([^"]*)"|[^,]+)/g) || []
              const entries: [string, unknown][] = headers.map((header, idx) => [
                header,
                values[idx]?.replace(/"/g, '').trim() || '',
              ])
              rows.push(mapRow(entries))
            }
          }

          const validRows = rows.filter(c => c.name && c.phone)
          const total = validRows.length
          setImportProgress({ current: 0, total })

          let imported = 0
          for (const contact of validRows) {
            const contactRef = doc(collection(db, 'clients'))
            await setDoc(contactRef, {
              ...contact,
              orgId,
              ...(importStageId && importFunnelId && {
                funnelId: importFunnelId,
                funnelStage: importStageId,
                funnelStageUpdatedAt: new Date().toISOString(),
              }),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            imported++
            setImportProgress({ current: imported, total })
          }

          setShowImportModal(false)
          setImportFile(null)
          setImportPreview([])
          setImportFunnelId('')
          setImportStageId('')
          setImportProgress(null)
          setImportResult({ success: true, count: imported })
        } catch (error) {
          console.error('Erro ao importar:', error)
          setShowImportModal(false)
          setImportFile(null)
          setImportPreview([])
          setImportFunnelId('')
          setImportStageId('')
          setImportProgress(null)
          setImportResult({ success: false, count: 0 })
        } finally {
          setImporting(false)
        }
      }

      if (isExcel) {
        reader.readAsArrayBuffer(importFile)
      } else {
        reader.readAsText(importFile, 'UTF-8')
      }
    } catch {
      setImporting(false)
    }
  }

  // Filter and sort clients
  const filteredClients = useMemo(() => {
    let result = [...clients]

    // Quick funnel filter
    if (quickFunnelFilter === 'no-funnel') {
      result = result.filter(c => !c.funnelStage)
    }

    // Apply column filters
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) {
        result = result.filter((client) => {
          const clientValue = key === 'funnelStage'
            ? getStageName(client.funnelStage)
            : String(client[key as keyof Cliente] || '').toLowerCase()
          return clientValue.toLowerCase().includes(value.toLowerCase())
        })
      }
    })

    // Apply sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aVal: string | number | null
        let bVal: string | number | null

        if (sortConfig.key === 'daysInStage') {
          aVal = calculateDaysSince(a.funnelStageUpdatedAt)
          bVal = calculateDaysSince(b.funnelStageUpdatedAt)
        } else if (sortConfig.key === 'daysSinceFollowUp') {
          aVal = calculateDaysSince(a.lastFollowUpAt)
          bVal = calculateDaysSince(b.lastFollowUpAt)
        } else {
          aVal = a[sortConfig.key as keyof Cliente] as string || ''
          bVal = b[sortConfig.key as keyof Cliente] as string || ''
        }

        // Handle null values (put them at the end)
        if (aVal === null && bVal === null) return 0
        if (aVal === null) return 1
        if (bVal === null) return -1

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }

    return result
  }, [clients, columnFilters, sortConfig, getStageName, quickFunnelFilter])

  // Export contacts to CSV
  const handleExport = useCallback(() => {
    setExporting(true)
    try {
      const headers = ['Nome', 'Telefone', 'Email', 'Empresa', 'Ramo', 'CNPJ/CPF', 'Origem', 'Etapa', 'Data Cadastro']
      const rows = filteredClients.map((c) => [
        c.name || '',
        c.phone || '',
        c.email || '',
        c.company || '',
        c.industry || '',
        c.document || '',
        c.leadSource || '',
        getStageName(c.funnelStage) || '',
        c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '',
      ])

      const csvContent = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')

      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `contatos_${new Date().toISOString().split('T')[0]}.csv`
      link.click()
    } catch (error) {
      console.error('Erro ao exportar:', error)
      alert('Erro ao exportar contatos')
    } finally {
      setExporting(false)
    }
  }, [filteredClients, getStageName])

  // Helper to normalize CNPJ (remove formatting)
  const normalizeCnpj = (cnpj: string): string => {
    return String(cnpj).replace(/\D/g, '')
  }

  // Parse Excel/CSV data for partners
  const parsePartnersData = (data: ArrayBuffer | string, isExcel: boolean): Array<{ cnpj: string; partners: string }> => {
    let rows: Array<Record<string, unknown>> = []

    console.log('[Partners Upload] Iniciando parsing, isExcel:', isExcel)

    if (isExcel) {
      // Parse Excel file
      console.log('[Partners Upload] Lendo arquivo Excel...')
      const workbook = XLSX.read(data, { type: 'array' })
      console.log('[Partners Upload] Workbook sheets:', workbook.SheetNames)
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
      console.log('[Partners Upload] Linhas encontradas:', rows.length)
      if (rows.length > 0) {
        console.log('[Partners Upload] Primeira linha:', rows[0])
      }
    } else {
      // Parse CSV file
      const text = data as string
      const lines = text.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return []

      const headers = lines[0].split(/[,;\t]/).map((h) => h.replace(/"/g, '').trim().toLowerCase())

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].match(/("([^"]*)"|[^,;\t]+)/g) || []
        const row: Record<string, unknown> = {}
        headers.forEach((header, idx) => {
          row[header] = values[idx]?.replace(/"/g, '').trim() || ''
        })
        rows.push(row)
      }
    }

    if (rows.length === 0) {
      console.log('[Partners Upload] Nenhuma linha encontrada')
      return []
    }

    // Find column names for CNPJ and partners
    const allKeys = Object.keys(rows[0])
    console.log('[Partners Upload] Colunas encontradas:', allKeys)

    const cnpjKey = allKeys.find((h) => {
      const lowerH = h.toLowerCase()
      return lowerH.includes('cnpj') || lowerH.includes('documento') || lowerH.includes('document')
    })
    const partnersKey = allKeys.find((h) => {
      const lowerH = h.toLowerCase()
      return lowerH.includes('socio') || lowerH.includes('sócio') || lowerH.includes('partner') || lowerH.includes('socios') || lowerH.includes('sócios')
    })

    console.log('[Partners Upload] Coluna CNPJ encontrada:', cnpjKey)
    console.log('[Partners Upload] Coluna Sócios encontrada:', partnersKey)

    if (!cnpjKey || !partnersKey) {
      console.log('[Partners Upload] ERRO: Colunas não encontradas!')
      return []
    }

    const result: Array<{ cnpj: string; partners: string }> = []
    for (const row of rows) {
      const cnpj = String(row[cnpjKey] || '').trim()
      const partners = String(row[partnersKey] || '').trim()

      if (cnpj && partners) {
        result.push({ cnpj: normalizeCnpj(cnpj), partners })
      }
    }

    console.log('[Partners Upload] Total de registros válidos:', result.length)
    console.log('[Partners Upload] Primeiros 3 registros:', result.slice(0, 3))

    return result
  }

  // Handle partners file selection
  const handlePartnersFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setPartnersFile(file)
    setPartnersResult(null)

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const data = event.target?.result
        if (!data) return

        const parsed = parsePartnersData(data as ArrayBuffer | string, isExcel)
        setPartnersPreview(parsed.slice(0, 5))

        if (parsed.length === 0) {
          alert('Não foi possível encontrar as colunas CNPJ e Sócios no arquivo. Verifique se o arquivo contém essas colunas.')
        }
      } catch (err) {
        console.error('Erro ao ler arquivo:', err)
        alert('Erro ao ler arquivo')
      }
    }

    if (isExcel) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file, 'UTF-8')
    }
  }

  // Upload partners
  const handleUploadPartners = async () => {
    if (!partnersFile) return

    setUploadingPartners(true)
    const isExcel = partnersFile.name.endsWith('.xlsx') || partnersFile.name.endsWith('.xls')

    try {
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const data = event.target?.result
          if (!data) return

          const parsed = parsePartnersData(data as ArrayBuffer | string, isExcel)

          console.log('[Partners Upload] Iniciando matching com', parsed.length, 'registros')
          console.log('[Partners Upload] Total de clientes no sistema:', clients.length)

          // Log some client documents for debugging
          const clientsWithDoc = clients.filter(c => c.document)
          console.log('[Partners Upload] Clientes com documento:', clientsWithDoc.length)
          console.log('[Partners Upload] Primeiros 5 documentos normalizados:', clientsWithDoc.slice(0, 5).map(c => ({
            name: c.name,
            docOriginal: c.document,
            docNormalizado: normalizeCnpj(c.document || '')
          })))

          let updated = 0
          const notFound: string[] = []

          for (const { cnpj, partners } of parsed) {
            // Find client with matching CNPJ
            const client = clients.find((c) => {
              if (!c.document) return false
              return normalizeCnpj(c.document) === cnpj
            })

            if (client) {
              console.log('[Partners Upload] Match encontrado!', cnpj, '->', client.name)
              await updateDoc(doc(db, 'clients', client.id), {
                partners,
                updatedAt: new Date().toISOString(),
              })
              updated++
            } else {
              notFound.push(cnpj)
            }
          }

          console.log('[Partners Upload] Resultado: updated=', updated, 'notFound=', notFound.length)
          setPartnersResult({ updated, notFound })
        } catch (error) {
          console.error('Erro ao processar arquivo:', error)
          alert('Erro ao processar arquivo')
        } finally {
          setUploadingPartners(false)
        }
      }

      if (isExcel) {
        reader.readAsArrayBuffer(partnersFile)
      } else {
        reader.readAsText(partnersFile, 'UTF-8')
      }
    } catch {
      setUploadingPartners(false)
    }
  }

  // Pagination
  const totalPages = Math.ceil(filteredClients.length / perPage)
  const paginatedClients = useMemo(() => {
    const start = (page - 1) * perPage
    return filteredClients.slice(start, start + perPage)
  }, [filteredClients, page, perPage])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [columnFilters])

  // Handle sort
  const handleSort = (key: keyof Cliente | 'daysInStage' | 'daysSinceFollowUp') => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  // Handle filter
  const handleFilter = (column: string, value: string) => {
    setColumnFilters((prev) => ({
      ...prev,
      [column]: value,
    }))
  }

  // Clear all filters
  const clearFilters = () => {
    setColumnFilters({})
    setActiveFilterColumn(null)
    setQuickFunnelFilter('all')
  }

  // Open new contact modal
  const openNewModal = () => {
    setEditingId(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
    setShowModal(true)
  }

  // Open edit modal
  const openEditModal = (client: Cliente) => {
    setEditingId(client.id)
    setForm({
      name: client.name || '',
      phone: client.phone || '',
      company: client.company || '',
      email: client.email || '',
      industry: client.industry || '',
      document: client.document || '',
      description: client.description || '',
      birthday: client.birthday || '',
      returnAlert: client.returnAlert || '',
      leadSource: client.leadSource || '',
      leadType: client.leadType || '',
      photoUrl: client.photoUrl || '',
      costCenterId: client.costCenterId || '',
      assignedTo: client.assignedTo || '',
      assignedToName: client.assignedToName || '',
    })
    setPhotoPreview(client.photoUrl || null)
    setShowModal(true)
    setOpenActionsId(null)
  }

  // Save client
  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      alert('Nome e telefone são obrigatórios')
      return
    }

    setSaving(true)
    try {
      let photoUrl = form.photoUrl

      // Upload photo if new
      if (photoFile) {
        const ext = photoFile.name.split('.').pop()
        const photoRef = ref(storage, `client-photos/${Date.now()}.${ext}`)
        await uploadBytes(photoRef, photoFile)
        photoUrl = await getDownloadURL(photoRef)
      }

      const clientData: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        industry: form.industry.trim() || null,
        document: form.document.trim() || null,
        description: form.description.trim() || null,
        birthday: form.birthday || null,
        returnAlert: form.returnAlert || null,
        leadSource: form.leadSource || null,
        leadType: form.leadType || null,
        photoUrl: photoUrl || null,
        costCenterId: form.costCenterId || null,
        updatedAt: new Date().toISOString(),
      }

      // Include assignedTo on creation if set
      if (!editingId && form.assignedTo) {
        clientData.assignedTo = form.assignedTo
        clientData.assignedToName = form.assignedToName || null
        clientData.assignedAt = new Date().toISOString()
      }

      if (editingId) {
        await updateDoc(doc(db, 'clients', editingId), clientData)
      } else {
        const newRef = doc(collection(db, 'clients'))
        await setDoc(newRef, {
          ...clientData,
          orgId,
          createdAt: new Date().toISOString(),
        })
      }

      setShowModal(false)
      setForm(emptyForm)
      setPhotoFile(null)
      setPhotoPreview(null)
      setEditingId(null)
    } catch (error) {
      console.error('Erro ao salvar:', error)
      alert('Erro ao salvar contato')
    } finally {
      setSaving(false)
    }
  }

  // Delete client
  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteDoc(doc(db, 'clients', deleteId))
      setDeleteId(null)
    } catch (error) {
      console.error('Erro ao excluir:', error)
      alert('Erro ao excluir contato')
    }
  }

  // Multi-select handlers
  const handleSelectAll = () => {
    if (selectedIds.size === paginatedClients.length) {
      setSelectedIds(new Set())
      setAllFilteredSelected(false)
    } else {
      setSelectedIds(new Set(paginatedClients.map((c) => c.id)))
    }
  }

  const handleSelectAllFiltered = () => {
    setSelectedIds(new Set(filteredClients.map((c) => c.id)))
    setAllFilteredSelected(true)
  }

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
    setAllFilteredSelected(false)
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setDeletingBulk(true)
    try {
      const deletePromises = Array.from(selectedIds).map((id) =>
        deleteDoc(doc(db, 'clients', id))
      )
      await Promise.all(deletePromises)
      setSelectedIds(new Set())
      setAllFilteredSelected(false)
      setShowBulkDeleteModal(false)
    } catch (error) {
      console.error('Erro ao excluir contatos:', error)
      alert('Erro ao excluir alguns contatos')
    } finally {
      setDeletingBulk(false)
    }
  }

  const handleBulkMove = async () => {
    if (selectedIds.size === 0 || !bulkFunnelId || !bulkStageId) return
    setSavingBulkMove(true)
    try {
      const ids = Array.from(selectedIds)
      const chunkSize = 250
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize)
        const batch = writeBatch(db)
        for (const id of chunk) {
          const clientRef = doc(db, 'clients', id)
          batch.update(clientRef, {
            funnelId: bulkFunnelId,
            funnelStage: bulkStageId,
            funnelStageUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
        await batch.commit()
      }
      setSelectedIds(new Set())
      setAllFilteredSelected(false)
      setShowBulkMoveModal(false)
      setBulkFunnelId('')
      setBulkStageId('')
    } catch (error) {
      console.error('Erro ao mover contatos:', error)
      alert('Erro ao mover alguns contatos')
    } finally {
      setSavingBulkMove(false)
    }
  }

  const bulkStagesForFunnel = useMemo(() => {
    if (!bulkFunnelId) return []
    return funnelStages.filter(s => s.funnelId === bulkFunnelId)
  }, [bulkFunnelId, funnelStages])

  // Column definitions
  const columns = [
    { key: 'name', label: 'Nome', sortable: true, filterable: true },
    { key: 'company', label: 'Empresa', sortable: true, filterable: true },
    { key: 'phone', label: 'Telefone', sortable: true, filterable: true },
    { key: 'leadSource', label: 'Origem', sortable: true, filterable: true },
    { key: 'leadType', label: 'Tipo', sortable: true, filterable: true },
    { key: 'funnelStage', label: 'Etapa', sortable: true, filterable: true },
    { key: 'daysInStage', label: 'Dias na Etapa', sortable: true, filterable: false },
    { key: 'daysSinceFollowUp', label: 'Último Follow-up', sortable: true, filterable: false },
  ]

  const hasActiveFilters = Object.values(columnFilters).some((v) => v) || quickFunnelFilter !== 'all'

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Gestão de Contatos</h1>
            <p className="text-sm text-slate-500 mt-1">
              {filteredClients.length} contato{filteredClients.length !== 1 ? 's' : ''} encontrado{filteredClients.length !== 1 ? 's' : ''}
              {hasActiveFilters && ' (filtrado)'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Sem Funil filter chip */}
            <button
              onClick={() => setQuickFunnelFilter(prev => prev === 'no-funnel' ? 'all' : 'no-funnel')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-all border ${
                quickFunnelFilter === 'no-funnel'
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <FunnelIcon className="w-4 h-4" />
              Sem Funil
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <Cross2Icon className="w-4 h-4" />
                Limpar filtros
              </button>
            )}

            {/* Export Button */}
            <button
              onClick={handleExport}
              disabled={exporting || filteredClients.length === 0}
              className="flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="Exportar contatos"
            >
              {exporting ? (
                <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <ArrowDownTrayIcon className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Exportar</span>
            </button>

            {/* Import Button */}
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 rounded-xl transition-all shadow-sm"
              title="Importar contatos"
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Importar</span>
            </button>

            {/* New Contact Button */}
            <button
              onClick={openNewModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 hover:shadow-xl hover:shadow-primary-300"
            >
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Novo Contato</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Total Contacts Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
              <UserGroupIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Total de Contatos</p>
              <p className="text-2xl font-bold text-slate-800">{clients.length}</p>
            </div>
          </div>
        </div>

        {/* Active Clients Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckBadgeIcon className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Clientes Ativos</p>
              <p className="text-2xl font-bold text-slate-800">
                {clients.filter(c => {
                  const stage = funnelStages.find(s => s.id === c.funnelStage)
                  return stage?.name === 'Ativo'
                }).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Selection Action Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 p-4 bg-primary-50 rounded-2xl border border-primary-200 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <CheckIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary-800">
                  {selectedIds.size} {selectedIds.size === 1 ? 'contato selecionado' : 'contatos selecionados'}
                </p>
                <p className="text-xs text-primary-600">Selecione uma ação para aplicar aos contatos</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSelectedIds(new Set()); setAllFilteredSelected(false) }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white/60 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setShowBulkMoveModal(true)}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors flex items-center gap-2"
              >
                <FunnelIcon className="w-4 h-4" />
                Mover para Funil
              </button>
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <TrashIcon className="w-4 h-4" />
                Excluir selecionados
              </button>
            </div>
          </div>
          {/* Banner: selecionar todos os filtrados */}
          {!allFilteredSelected && selectedIds.size === paginatedClients.length && filteredClients.length > paginatedClients.length && (
            <div className="mt-3 pt-3 border-t border-primary-200 text-center">
              <p className="text-sm text-primary-700">
                Todos os <strong>{paginatedClients.length}</strong> contatos desta página estão selecionados.{' '}
                <button
                  onClick={handleSelectAllFiltered}
                  className="text-primary-700 font-semibold underline hover:text-primary-900 transition-colors"
                >
                  Selecionar todos os {filteredClients.length} contatos filtrados
                </button>
              </p>
            </div>
          )}
          {allFilteredSelected && (
            <div className="mt-3 pt-3 border-t border-primary-200 text-center">
              <p className="text-sm text-primary-700 font-medium">
                Todos os <strong>{filteredClients.length}</strong> contatos filtrados estão selecionados.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
        {loading ? (
          <Skeleton variant="table-row" count={8} className="py-4" />
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/60">
                    {/* Checkbox column */}
                    <th className="w-12 px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectAll()
                        }}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          paginatedClients.length > 0 && selectedIds.size === paginatedClients.length
                            ? 'bg-primary-600 border-primary-600'
                            : selectedIds.size > 0
                            ? 'bg-primary-200 border-primary-400'
                            : 'border-slate-300 hover:border-primary-400'
                        }`}
                      >
                        {paginatedClients.length > 0 && selectedIds.size === paginatedClients.length ? (
                          <CheckIcon className="w-3.5 h-3.5 text-white" />
                        ) : selectedIds.size > 0 ? (
                          <div className="w-2 h-0.5 bg-primary-600 rounded" />
                        ) : null}
                      </button>
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider"
                      >
                        <div className="flex items-center gap-2">
                          {col.sortable ? (
                            <button
                              onClick={() => handleSort(col.key as keyof Cliente)}
                              className="flex items-center gap-1.5 hover:text-slate-700 transition-colors group"
                            >
                              {col.label}
                              <span className={`transition-opacity ${sortConfig.key === col.key ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                                {sortConfig.key === col.key && sortConfig.direction === 'asc' ? (
                                  <ChevronUpIcon className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDownIcon className="w-3.5 h-3.5" />
                                )}
                              </span>
                            </button>
                          ) : (
                            col.label
                          )}

                          {col.filterable && (
                            <div className="relative">
                              <button
                                onClick={() => setActiveFilterColumn(activeFilterColumn === col.key ? null : col.key)}
                                className={`p-1 rounded-md transition-colors ${
                                  columnFilters[col.key]
                                    ? 'text-primary-600 bg-primary-100'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                <FunnelIcon className="w-3.5 h-3.5" />
                              </button>

                              {activeFilterColumn === col.key && (
                                <div className="absolute top-full left-0 mt-1 z-20 bg-white rounded-xl shadow-xl border border-slate-200 p-2 min-w-[200px]">
                                  <input
                                    type="text"
                                    value={columnFilters[col.key] || ''}
                                    onChange={(e) => handleFilter(col.key, e.target.value)}
                                    placeholder={`Filtrar ${col.label.toLowerCase()}...`}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                    autoFocus
                                  />
                                  {columnFilters[col.key] && (
                                    <button
                                      onClick={() => handleFilter(col.key, '')}
                                      className="mt-2 w-full text-xs text-slate-500 hover:text-slate-700 py-1"
                                    >
                                      Limpar filtro
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="w-12 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedClients.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                            <PersonIcon className="w-6 h-6 text-slate-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-600">Nenhum contato encontrado</p>
                            <p className="text-xs text-slate-400 mt-1">
                              {hasActiveFilters ? 'Tente ajustar os filtros' : 'Adicione seu primeiro contato'}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedClients.map((client) => (
                      <tr
                        key={client.id}
                        onClick={() => router.push(`/contatos/${client.id}`)}
                        className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${
                          selectedIds.has(client.id) ? 'bg-primary-50' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-2.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectOne(client.id)
                            }}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                              selectedIds.has(client.id)
                                ? 'bg-primary-600 border-primary-600'
                                : 'border-slate-300 hover:border-primary-400'
                            }`}
                          >
                            {selectedIds.has(client.id) && (
                              <CheckIcon className="w-3.5 h-3.5 text-white" />
                            )}
                          </button>
                        </td>
                        {/* Nome */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            {client.photoUrl ? (
                              <Image
                                src={client.photoUrl}
                                alt={client.name}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover ring-2 ring-white shadow-sm"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center text-primary-600 font-semibold text-xs">
                                {client.name?.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="font-medium text-sm text-slate-800 truncate max-w-[180px]">
                              {client.name}
                            </span>
                          </div>
                        </td>

                        {/* Empresa */}
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-slate-600 truncate max-w-[150px] block">
                            {client.company || '-'}
                          </span>
                        </td>

                        {/* Telefone */}
                        <td className="px-4 py-2.5">
                          <span className="text-sm text-slate-600">
                            {client.phone || '-'}
                          </span>
                        </td>

                        {/* Origem */}
                        <td className="px-4 py-2.5">
                          {client.leadSource ? (
                            <div className="flex items-center gap-1.5">
                              {leadSourceIcons[client.leadSource] && (
                                <Image
                                  src={leadSourceIcons[client.leadSource]}
                                  alt={client.leadSource}
                                  width={16}
                                  height={16}
                                  className="w-4 h-4"
                                />
                              )}
                              <span className="text-xs text-slate-600">{client.leadSource}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </td>

                        {/* Tipo de Lead */}
                        <td className="px-4 py-2.5">
                          {client.leadType ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              leadTypeOptions.find(opt => opt.value === client.leadType)?.color || 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {client.leadType}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </td>

                        {/* Etapa do Funil - COM CORES */}
                        <td className="px-4 py-2.5">
                          {(() => {
                            const stageColor = getStageColor(client.funnelStage)
                            return (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${stageColor.bg} ${stageColor.text}`}>
                                {getStageName(client.funnelStage)}
                              </span>
                            )
                          })()}
                        </td>

                        {/* Dias na Etapa */}
                        <td className="px-4 py-2.5">
                          {(() => {
                            const days = calculateDaysSince(client.funnelStageUpdatedAt)
                            const badgeColor = getDaysBadgeColor(days)
                            return (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                                {formatDays(days)}
                              </span>
                            )
                          })()}
                        </td>

                        {/* Último Follow-up */}
                        <td className="px-4 py-2.5">
                          {(() => {
                            const days = calculateDaysSince(client.lastFollowUpAt)
                            const badgeColor = getDaysBadgeColor(days)
                            return (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                                {formatDays(days)}
                              </span>
                            )
                          })()}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                if (openActionsId === client.id) {
                                  setOpenActionsId(null)
                                  setActionsPosition(null)
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  // Calculate position - show above or below based on space
                                  const spaceBelow = window.innerHeight - rect.bottom
                                  const menuHeight = 280 // approximate menu height
                                  const showAbove = spaceBelow < menuHeight && rect.top > menuHeight

                                  setActionsPosition({
                                    top: showAbove ? rect.top - 8 : rect.bottom + 8,
                                    left: rect.right - 180, // 180 is menu width
                                  })
                                  setOpenActionsId(client.id)
                                }
                              }}
                              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <DotsHorizontalIcon className="w-4 h-4 text-slate-500" />
                            </button>

                            {openActionsId === client.id && actionsPosition && (
                              <>
                                <div
                                  className="fixed inset-0 z-[9999]"
                                  onClick={() => {
                                    setOpenActionsId(null)
                                    setActionsPosition(null)
                                  }}
                                />
                                <div
                                  className="fixed z-[10000] bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 min-w-[180px]"
                                  style={{
                                    top: actionsPosition.top,
                                    left: actionsPosition.left,
                                    transform: actionsPosition.top < 300 ? 'translateY(0)' : 'translateY(-100%)',
                                  }}
                                >
                                  {/* WhatsApp */}
                                  <button
                                    onClick={() => {
                                      openWhatsApp(client.phone, client.name)
                                      setOpenActionsId(null)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors"
                                  >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                    </svg>
                                    WhatsApp
                                  </button>

                                  {/* Email */}
                                  <button
                                    onClick={() => {
                                      openEmail(client.email, client.name)
                                      setOpenActionsId(null)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
                                  >
                                    <EnvelopeClosedIcon className="w-4 h-4" />
                                    Enviar Email
                                  </button>

                                  <div className="border-t border-slate-100 my-1" />

                                  {/* Registrar Follow-up */}
                                  <button
                                    onClick={() => {
                                      setFollowUpClient(client)
                                      setOpenActionsId(null)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                    Registrar Follow-up
                                  </button>

                                  {/* Mudar Etapa */}
                                  <button
                                    onClick={() => {
                                      setStageChangeClient(client)
                                      setNewStageId(client.funnelStage || '')
                                      setOpenActionsId(null)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Mudar Etapa
                                  </button>

                                  <div className="border-t border-slate-100 my-1" />

                                  {/* Editar */}
                                  <button
                                    onClick={() => {
                                      openEditModal(client)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                  >
                                    <Pencil1Icon className="w-4 h-4" />
                                    Editar
                                  </button>

                                  {/* Excluir */}
                                  <button
                                    onClick={() => {
                                      setDeleteId(client.id)
                                      setOpenActionsId(null)
                                      setActionsPosition(null)
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                    Excluir
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Mostrando {((page - 1) * perPage) + 1} a {Math.min(page * perPage, filteredClients.length)} de {filteredClients.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeftIcon className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) {
                      pageNum = i + 1
                    } else if (page <= 3) {
                      pageNum = i + 1
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i
                    } else {
                      pageNum = page - 2 + i
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          page === pageNum
                            ? 'bg-primary-600 text-white'
                            : 'hover:bg-slate-100 text-slate-600'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Click outside to close filter */}
      {activeFilterColumn && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setActiveFilterColumn(null)}
        />
      )}

      {/* Modal de Cadastro/Edição */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                  <PersonIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    {editingId ? 'Editar Contato' : 'Novo Contato'}
                  </h2>
                  <p className="text-xs text-slate-500">Preencha os dados do contato</p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-6">
              {/* Photo */}
              <div className="flex items-center gap-4">
                {photoPreview || form.photoUrl ? (
                  <Image
                    src={photoPreview || form.photoUrl}
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
                        setPhotoFile(f)
                        setPhotoPreview(f ? URL.createObjectURL(f) : null)
                      }}
                      className="sr-only"
                    />
                    Alterar foto
                  </label>
                  <p className="text-xs text-slate-500 mt-1">JPG, PNG ou GIF</p>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <PersonIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Nome do contato"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Telefone <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <MobileIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="(00) 00000-0000"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <div className="relative">
                    <EnvelopeClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="email@exemplo.com"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Empresa</label>
                  <div className="relative">
                    <BuildingOfficeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      placeholder="Nome da empresa"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">CNPJ / CPF</label>
                  <input
                    type="text"
                    value={form.document}
                    onChange={(e) => setForm({ ...form, document: e.target.value })}
                    placeholder="00.000.000/0000-00"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Ramo de atuação</label>
                  <input
                    type="text"
                    value={form.industry}
                    onChange={(e) => setForm({ ...form, industry: e.target.value })}
                    placeholder="Ex: Tecnologia, Varejo..."
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Origem do Lead</label>
                  <select
                    value={form.leadSource}
                    onChange={(e) => setForm({ ...form, leadSource: e.target.value })}
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
                    value={form.leadType}
                    onChange={(e) => setForm({ ...form, leadType: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all bg-white"
                  >
                    <option value="">Selecione...</option>
                    {leadTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Responsável</label>
                  <MemberSelector
                    value={form.assignedTo || null}
                    valueName={form.assignedToName || null}
                    onChange={(id, name) => setForm({ ...form, assignedTo: id || '', assignedToName: name || '' })}
                    size="md"
                  />
                </div>

                {costCenters.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Centro de Custos</label>
                    <select
                      value={form.costCenterId}
                      onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}
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
                    value={form.birthday}
                    onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Alerta de retorno</label>
                  <input
                    type="date"
                    value={form.returnAlert}
                    onChange={(e) => setForm({ ...form, returnAlert: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Descrição</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    {editingId ? 'Salvar alterações' : 'Adicionar contato'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDeleteId(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrashIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Excluir contato</h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir este contato? Todos os dados associados serão removidos permanentemente.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors"
              >
                Excluir contato
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão em Massa */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !deletingBulk && setShowBulkDeleteModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrashIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Excluir {selectedIds.size} contatos</h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir <span className="font-semibold text-red-600">{selectedIds.size}</span> {selectedIds.size === 1 ? 'contato' : 'contatos'}? Todos os dados associados serão removidos permanentemente.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={deletingBulk}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={deletingBulk}
                className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {deletingBulk ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  <>
                    <TrashIcon className="w-4 h-4" />
                    Excluir {selectedIds.size} {selectedIds.size === 1 ? 'contato' : 'contatos'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Mover para Funil (bulk) */}
      {showBulkMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !savingBulkMove && setShowBulkMoveModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                <FunnelIcon className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Mover {selectedIds.size} contatos</h3>
                <p className="text-sm text-slate-500">Selecione o funil e a etapa de destino</p>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Funil</label>
                <select
                  value={bulkFunnelId}
                  onChange={(e) => { setBulkFunnelId(e.target.value); setBulkStageId('') }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition-all"
                >
                  <option value="">Selecione um funil</option>
                  {funnels.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {bulkFunnelId && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Etapa</label>
                  <select
                    value={bulkStageId}
                    onChange={(e) => setBulkStageId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition-all"
                  >
                    <option value="">Selecione uma etapa</option>
                    {bulkStagesForFunnel.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBulkMoveModal(false)}
                disabled={savingBulkMove}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkMove}
                disabled={savingBulkMove || !bulkFunnelId || !bulkStageId}
                className="px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {savingBulkMove ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Movendo...
                  </>
                ) : (
                  <>
                    <FunnelIcon className="w-4 h-4" />
                    Mover {selectedIds.size} {selectedIds.size === 1 ? 'contato' : 'contatos'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Mudança de Etapa */}
      {stageChangeClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setStageChangeClient(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm m-4 max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-800">Mudar Etapa</h3>
                <p className="text-xs text-slate-500 truncate">{stageChangeClient.name}</p>
              </div>
              <button
                onClick={() => setStageChangeClient(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-1.5">
                {funnelStages.map((stage) => {
                  const color = stageColorMap[stage.id] || { bg: 'bg-slate-100', text: 'text-slate-600' }
                  const isSelected = newStageId === stage.id
                  return (
                    <button
                      key={stage.id}
                      onClick={() => setNewStageId(stage.id)}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left
                        ${isSelected
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }
                      `}
                    >
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}`}>
                        {stage.name}
                      </span>
                      {isSelected && (
                        <CheckIcon className="w-4 h-4 text-primary-600 ml-auto" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => setStageChangeClient(null)}
                className="px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleStageChange}
                disabled={savingStage || !newStageId}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-all shadow-md shadow-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingStage ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-3.5 h-3.5" />
                    Confirmar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Registro de Follow-up */}
      {followUpClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setFollowUpClient(null)
              setFollowUpNote('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg m-4 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-800">Follow-up</h3>
                <p className="text-xs text-slate-500 truncate">{followUpClient.name}</p>
              </div>
              <button
                onClick={() => {
                  setFollowUpClient(null)
                  setFollowUpNote('')
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto">
              {/* New follow-up form */}
              <div className="p-4 bg-gradient-to-br from-primary-50/50 to-purple-50/50 border-b border-slate-100">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Novo follow-up
                </label>
                <textarea
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  placeholder="Descreva o que foi conversado..."
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none bg-white"
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleFollowUp}
                    disabled={savingFollowUp}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-lg font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-md shadow-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingFollowUp ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <PlusIcon className="w-3.5 h-3.5" />
                        Registrar
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Follow-up history */}
              <div className="p-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Histórico de Follow-ups
                </h4>

                {loadingFollowUps ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                  </div>
                ) : clientFollowUps.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500">Nenhum follow-up registrado</p>
                    <p className="text-xs text-slate-400 mt-1">Registre o primeiro acima</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {clientFollowUps.map((followUp, index) => (
                      <div
                        key={followUp.id}
                        className="relative pl-6"
                      >
                        {/* Timeline dot and line */}
                        <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full bg-primary-500 ring-4 ring-primary-100" />
                        {index < clientFollowUps.length - 1 && (
                          <div className="absolute left-[5px] top-5 w-0.5 h-full bg-slate-200" />
                        )}

                        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-primary-600">
                                {new Date(followUp.createdAt).toLocaleDateString('pt-BR', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                              {followUp.author && (
                                <span className="text-xs text-slate-500">
                                  • {followUp.author}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">
                              {new Date(followUp.createdAt).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {followUp.text ? (
                            <p className="text-sm text-slate-600">{followUp.text}</p>
                          ) : (
                            <p className="text-sm text-slate-400 italic">Follow-up registrado sem nota</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end p-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => {
                  setFollowUpClient(null)
                  setFollowUpNote('')
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setShowImportModal(false)
              setImportFile(null)
              setImportPreview([])
              setImportFunnelId('')
              setImportStageId('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200">
                  <ArrowUpTrayIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Importar Contatos</h3>
                  <p className="text-xs text-slate-500">Carregue um arquivo CSV ou Excel (.xlsx) com seus contatos</p>
                </div>
              </div>
              {!importing && (
                <button
                  onClick={() => {
                    setShowImportModal(false)
                    setImportFile(null)
                    setImportPreview([])
                    setImportFunnelId('')
                    setImportStageId('')
                  }}
                  className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <Cross2Icon className="w-4 h-4 text-slate-400" />
                </button>
              )}
            </div>

            {/* Progress screen */}
            {importing && importProgress && (
              <div className="p-10 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
                  <ArrowUpTrayIcon className="w-8 h-8 text-emerald-600 animate-pulse" />
                </div>
                <h4 className="text-lg font-bold text-slate-800 mb-1">Importando contatos...</h4>
                <p className="text-sm text-slate-500 mb-6">
                  {importProgress.current} de {importProgress.total} contato{importProgress.total !== 1 ? 's' : ''}
                </p>
                <div className="w-full max-w-xs">
                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-center text-sm font-semibold text-emerald-600 mt-2">
                    {importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%
                  </p>
                </div>
                <p className="text-xs text-slate-400 mt-4">Nao feche esta janela</p>
              </div>
            )}

            {/* Content */}
            <div className={`p-6 ${importing ? 'hidden' : ''}`}>
              {/* Upload area */}
              <label className="block">
                <div className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  importFile
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 hover:border-primary-300 hover:bg-primary-50/50'
                }`}>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleImportFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {importFile ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                        <CheckIcon className="w-6 h-6 text-emerald-600" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">{importFile.name}</p>
                      <p className="text-xs text-slate-500">Arquivo selecionado</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                        <ArrowUpTrayIcon className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">Clique ou arraste um arquivo CSV ou Excel</p>
                      <p className="text-xs text-slate-500">Colunas aceitas: Nome/Razao Social, Telefone, Email, Empresa, Ramo, CNPJ, Socios, Endereco e mais</p>
                    </div>
                  )}
                </div>
              </label>

              {/* Preview */}
              {importPreview.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Pré-visualização (primeiros 5)</h4>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          {Object.keys(importPreview[0]).slice(0, 5).map((key) => (
                            <th key={key} className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importPreview.map((row, idx) => (
                          <tr key={idx}>
                            {Object.values(row).slice(0, 5).map((val, vidx) => (
                              <td key={vidx} className="px-3 py-2 text-slate-600 truncate max-w-[150px]">
                                {val || '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Funnel destination */}
              {funnels.length > 0 && (
                <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <FunnelIcon className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold text-slate-700">Destino no funil</p>
                    <span className="text-xs text-slate-400">(opcional)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Funil</label>
                      <select
                        value={importFunnelId}
                        onChange={(e) => {
                          setImportFunnelId(e.target.value)
                          setImportStageId('')
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
                      >
                        <option value="">Nenhum</option>
                        {funnels.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Etapa</label>
                      <select
                        value={importStageId}
                        onChange={(e) => setImportStageId(e.target.value)}
                        disabled={!importFunnelId}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Selecione a etapa</option>
                        {importStagesForFunnel.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-xs text-blue-700">
                    <p className="font-semibold mb-1">Dicas para importação</p>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                      <li>Use a primeira linha como cabeçalho</li>
                      <li>Campos obrigatórios: Nome e Telefone</li>
                      <li>Encoding: UTF-8 para caracteres especiais</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            {!importing && (
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                <button
                  onClick={() => {
                    setShowImportModal(false)
                    setImportFile(null)
                    setImportPreview([])
                    setImportFunnelId('')
                    setImportStageId('')
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importFile || importing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-medium text-sm hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUpTrayIcon className="w-4 h-4" />
                  Importar Contatos
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Result Modal */}
      {importResult && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setImportResult(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 fade-in duration-200">
            <div className="p-8 text-center">
              {importResult.success ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                    <CheckIcon className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">Importação concluída!</h3>
                  <p className="text-sm text-slate-500">
                    <span className="font-semibold text-emerald-600">{importResult.count}</span> contato{importResult.count !== 1 ? 's' : ''} importado{importResult.count !== 1 ? 's' : ''} com sucesso.
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                    <Cross2Icon className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">Erro na importação</h3>
                  <p className="text-sm text-slate-500">Ocorreu um erro ao importar os contatos. Verifique o arquivo e tente novamente.</p>
                </>
              )}
            </div>
            <div className="px-8 pb-6">
              <button
                onClick={() => setImportResult(null)}
                className={`w-full py-2.5 rounded-xl font-medium text-sm text-white transition-colors ${
                  importResult.success
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partners Upload Modal */}
      {showPartnersModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setShowPartnersModal(false)
              setPartnersFile(null)
              setPartnersPreview([])
              setPartnersResult(null)
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                  <UsersIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Importar Sócios</h3>
                  <p className="text-xs text-slate-500">Adicione sócios aos contatos via CNPJ</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPartnersModal(false)
                  setPartnersFile(null)
                  setPartnersPreview([])
                  setPartnersResult(null)
                }}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Result */}
              {partnersResult && (
                <div className="mb-6 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <CheckIcon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-emerald-800">Importação concluída!</p>
                      <p className="text-sm text-emerald-600">
                        {partnersResult.updated} contato{partnersResult.updated !== 1 ? 's' : ''} atualizado{partnersResult.updated !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  {partnersResult.notFound.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-emerald-200">
                      <p className="text-xs font-medium text-amber-700 mb-1">
                        CNPJs não encontrados ({partnersResult.notFound.length}):
                      </p>
                      <div className="text-xs text-amber-600 max-h-20 overflow-y-auto">
                        {partnersResult.notFound.slice(0, 10).join(', ')}
                        {partnersResult.notFound.length > 10 && ` e mais ${partnersResult.notFound.length - 10}...`}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Upload area */}
              <label className="block">
                <div className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  partnersFile
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-slate-200 hover:border-primary-300 hover:bg-primary-50/50'
                }`}>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handlePartnersFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {partnersFile ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mx-auto">
                        <CheckIcon className="w-6 h-6 text-primary-600" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">{partnersFile.name}</p>
                      <p className="text-xs text-slate-500">Arquivo selecionado</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                        <UsersIcon className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-700">Clique ou arraste um arquivo CSV/Excel</p>
                      <p className="text-xs text-slate-500">Colunas: CNPJ, Sócios</p>
                    </div>
                  )}
                </div>
              </label>

              {/* Preview */}
              {partnersPreview.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Pré-visualização (primeiros 5)</h4>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">CNPJ</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Sócios</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {partnersPreview.map((row, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-slate-600 font-mono text-xs">{row.cnpj}</td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[300px]">{row.partners}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-xs text-blue-700">
                    <p className="font-semibold mb-1">Formato esperado</p>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                      <li>Coluna CNPJ com o documento da empresa</li>
                      <li>Coluna Sócios com os nomes separados por vírgula</li>
                      <li>Ex: Antonio Rivas,Julio Grynglas,Lucio Mauro</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => {
                  setShowPartnersModal(false)
                  setPartnersFile(null)
                  setPartnersPreview([])
                  setPartnersResult(null)
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white rounded-xl transition-colors"
              >
                {partnersResult ? 'Fechar' : 'Cancelar'}
              </button>
              {!partnersResult && (
                <button
                  onClick={handleUploadPartners}
                  disabled={!partnersFile || partnersPreview.length === 0 || uploadingPartners}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadingPartners ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <UsersIcon className="w-4 h-4" />
                      Importar Sócios
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
