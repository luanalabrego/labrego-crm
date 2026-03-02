'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { db, storage } from '@/lib/firebaseClient'
import { formatDate, formatCurrency, formatDateTime, formatWhatsAppNumber } from '@/lib/format'
import { useCrmUser } from '@/contexts/CrmUserContext'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { leadSourceIcons, leadTypeOptions, leadSourceOptions } from '@/lib/leadSources'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Pencil1Icon,
  PlusIcon,
  CheckIcon,
  PersonIcon,
  EnvelopeClosedIcon,
  MobileIcon,
  CalendarIcon,
  ClockIcon,
  FileTextIcon,
  ChatBubbleIcon,
  CopyIcon,
  DotsHorizontalIcon,
  ArrowLeftIcon,
  Cross2Icon,
  MagnifyingGlassIcon,
  DownloadIcon,
  TrashIcon,
  ChevronRightIcon,
} from '@radix-ui/react-icons'
import {
  BuildingOfficeIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  FolderIcon,
  ClipboardDocumentListIcon,
  BanknotesIcon,
  DocumentDuplicateIcon,
  GlobeAltIcon,
  MapPinIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  ArchiveBoxIcon,
  FolderOpenIcon,
  UsersIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'

// Types
type Client = {
  id: string
  name: string
  company?: string
  description?: string
  industry?: string
  document?: string
  phone: string
  email?: string
  birthday?: string
  returnAlert?: string
  photoUrl?: string
  status?: 'Lead' | 'Lead-qualificado' | 'Ativo' | 'Inativo' | 'Inatividade Longa'
  leadSource?: string
  leadType?: 'Inbound' | 'Outbound' // Tipo de lead: Inbound ou Outbound
  funnelId?: string
  funnelStage?: string
  funnelStageUpdatedAt?: string
  firstContactAt?: string
  createdAt?: string
  updatedAt?: string
  needsDetail?: string
  meetingTranscriptLink?: string
  partners?: string // Lista de sócios separados por vírgula
  // CNPJ Biz fields
  bairro?: string
  capital_social?: string | number
  cep?: string
  complemento?: string
  data_abertura?: string | number
  estado?: string
  logradouro?: string
  municipio?: string
  natureza_juridica?: string
  numero?: string | number
  porte_empresa?: string
  situacao?: string
}

type FunnelStage = {
  id: string
  name: string
  order: number
  funnelId: string
  color?: string
}

type Funnel = {
  id: string
  name: string
  color: string
  isDefault: boolean
}

type Proposal = {
  id: string
  number?: number
  createdAt?: string
  statusUpdatedAt?: string
  status?: string
  total?: number
  projectName?: string
  // Extended fields for detail view
  context?: string
  items?: Array<{
    productId?: string
    name?: string
    description?: string
    qty?: number
    price?: number
  }>
  monthlyFees?: Array<{
    description?: string
    amount?: number
  }>
  schedule?: Array<{
    stage?: string
    days?: number
  }>
  expectedDays?: number
  paymentMethod?: string
  discountValue?: number
  subtotal?: number
  pdfName?: string
}

type Billing = {
  id: string
  proposalId?: string
  projectId?: string
  competence?: string
  expectedDate: string
  paymentMethod: string
  amount: number
  status?: string
  paymentDate?: string
  notes?: string
  chargeUrl?: string
  invoiceUrl?: string
  invoiceNumber?: string
}

type Project = {
  id: string
  name: string
  proposalId?: string
  status?: string
}

type FollowUpType = 'note' | 'whatsapp' | 'email' | 'call'

type FollowUp = {
  id: string
  text: string
  author: string
  createdAt: string
  source?: 'followup' | 'log'
  type?: FollowUpType
  recordingUrl?: string
}

type Contract = {
  id: string
  projectId?: string
  projectName?: string
  signedAt?: string
  name?: string
  url: string
}

type Folder = {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  source?: string // 'contratos', 'propostas', etc.
}

type FileDoc = {
  id: string
  name: string
  url: string
  folderId: string | null
  size?: number
  type?: string
  uploadedAt: string
  source?: string
}

// Tabs configuration
const tabs = [
  { id: 'propostas', label: 'Propostas', icon: DocumentTextIcon },
  { id: 'financeiro', label: 'Financeiro', icon: BanknotesIcon },
  { id: 'historico', label: 'Histórico', icon: ClockIcon },
  { id: 'documentos', label: 'Documentos', icon: FolderIcon },
]

// Status colors for proposals
const proposalStatusColors: Record<string, string> = {
  'Aprovada': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'Recusada': 'bg-red-100 text-red-700 border border-red-200',
  'Pendente': 'bg-amber-100 text-amber-700 border border-amber-200',
  'Em análise': 'bg-blue-100 text-blue-700 border border-blue-200',
  'Expirada': 'bg-slate-100 text-slate-700 border border-slate-200',
  'Cancelada': 'bg-rose-100 text-rose-700 border border-rose-200',
}

// Status colors for payments/billings (matching finance system)
const paymentStatusColors: Record<string, string> = {
  'Pagamento realizado': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'Pendente de pagamento': 'bg-amber-100 text-amber-700 border border-amber-200',
  'Atrasado': 'bg-red-100 text-red-700 border border-red-200',
  'Cancelado': 'bg-slate-100 text-slate-700 border border-slate-200',
}

export default function ContactDetailsPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { userEmail, orgId } = useCrmUser()
  const id = params?.id

  // Data states
  const [client, setClient] = useState<Client | null>(null)
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [billings, setBillings] = useState<Billing[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<FileDoc[]>([])
  const [loading, setLoading] = useState(true)

  // UI states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    resumo: true,
    detalhes: false,
  })
  const [activeTab, setActiveTab] = useState('propostas')
  const [showFollowUpForm, setShowFollowUpForm] = useState(false)
  const [newFollowUp, setNewFollowUp] = useState('')
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [editingNeeds, setEditingNeeds] = useState(false)
  const [needsDetail, setNeedsDetail] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [editingLeadType, setEditingLeadType] = useState(false)
  const [savingLeadType, setSavingLeadType] = useState(false)
  const [editingFunnel, setEditingFunnel] = useState(false)
  const [savingFunnel, setSavingFunnel] = useState(false)

  // Documents/Folders states
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState<Folder[]>([])
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [fileSearch, setFileSearch] = useState('')
  const [deletingItem, setDeletingItem] = useState<{ type: 'folder' | 'file'; id: string } | null>(null)

  // Proposal modal states
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)
  const [loadingProposal, setLoadingProposal] = useState(false)

  // Actions dropdown & edit modal states
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({
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
  })
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Partners (Sócios) states
  const [editingPartners, setEditingPartners] = useState(false)
  const [partnersList, setPartnersList] = useState<string[]>([])
  const [newPartnerName, setNewPartnerName] = useState('')
  const [savingPartners, setSavingPartners] = useState(false)
  const [editingPartnerIndex, setEditingPartnerIndex] = useState<number | null>(null)
  const [editingPartnerName, setEditingPartnerName] = useState('')

  // Load data
  useEffect(() => {
    if (!id || !orgId) return

    const loadData = async () => {
      try {
        // Load client
        const clientSnap = await getDoc(doc(db, 'clients', id))
        if (clientSnap.exists()) {
          const clientData = { id: clientSnap.id, ...clientSnap.data() } as Client
          setClient(clientData)
          setNeedsDetail(clientData.needsDetail || '')
        }

        // Load funnels
        const funnelsSnap = await getDocs(collection(db, 'organizations', orgId, 'funnels'))
        setFunnels(
          funnelsSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Funnel))
            .sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.name.localeCompare(b.name)))
        )

        // Load funnel stages
        const stagesSnap = await getDocs(query(collection(db, 'funnelStages'), where('orgId', '==', orgId)))
        setFunnelStages(
          stagesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as FunnelStage))
            .sort((a, b) => a.order - b.order)
        )

        // Load proposals
        const proposalsSnap = await getDocs(
          query(collection(db, 'proposals'), where('clientId', '==', id), where('orgId', '==', orgId))
        )
        const proposalsData = proposalsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Proposal[]
        setProposals(proposalsData)

        // Load billings
        const billingsSnap = await getDocs(
          query(collection(db, 'billings'), where('clientId', '==', id), where('orgId', '==', orgId))
        )
        setBillings(
          billingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Billing[]
        )

        // Load projects related to proposals
        if (proposalsData.length > 0) {
          const projectsSnap = await getDocs(query(collection(db, 'projects'), where('orgId', '==', orgId)))
          const relatedProjects = projectsSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Project))
            .filter((p) => proposalsData.some((pr) => pr.id === p.proposalId))
          setProjects(relatedProjects)
        }

        // Load follow-ups and logs
        const [followUpsSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'clients', id, 'followups')),
          getDocs(collection(db, 'clients', id, 'logs')),
        ])
        const allFollowUps: FollowUp[] = [
          ...followUpsSnap.docs.map((d) => {
            const data = d.data()
            return {
              id: d.id,
              text: data.text || data.message || '',
              author: data.author || data.email || 'Sistema',
              createdAt: data.createdAt,
              source: 'followup' as const,
              type: (data.type as FollowUpType) || undefined,
              recordingUrl: data.recordingUrl || undefined,
            } as FollowUp
          }),
          ...logsSnap.docs.map((d) => {
            const data = d.data()
            return {
              id: d.id,
              text: data.text || data.message || '',
              author: data.author || data.email || 'Sistema',
              createdAt: data.createdAt,
              source: 'log' as const,
            } as FollowUp
          }),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setFollowUps(allFollowUps)

        // Load contracts
        const contractsSnap = await getDocs(
          query(collection(db, 'contracts'), where('clientId', '==', id), where('orgId', '==', orgId))
        )
        setContracts(
          contractsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Contract[]
        )

        // Load folders
        const foldersSnap = await getDocs(collection(db, 'clients', id, 'folders'))
        const foldersData = foldersSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Folder[]
        setFolders(foldersData)

        // Load files
        const filesSnap = await getDocs(collection(db, 'clients', id, 'files'))
        const filesData = filesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as FileDoc[]
        setFiles(filesData)

        setLoading(false)
      } catch (error) {
        console.error('Error loading data:', error)
        setLoading(false)
      }
    }

    loadData()
  }, [id, orgId])

  // Build folder path when currentFolderId changes
  useEffect(() => {
    if (!currentFolderId) {
      setFolderPath([])
      return
    }

    const buildPath = (folderId: string): Folder[] => {
      const folder = folders.find((f) => f.id === folderId)
      if (!folder) return []
      if (folder.parentId) {
        return [...buildPath(folder.parentId), folder]
      }
      return [folder]
    }

    setFolderPath(buildPath(currentFolderId))
  }, [currentFolderId, folders])

  // Get funnel stage name and color
  const getStageName = useCallback(
    (stageId?: string) => {
      if (!stageId) return 'Não definido'
      const stage = funnelStages.find((s) => s.id === stageId)
      return stage?.name || 'Não definido'
    },
    [funnelStages]
  )

  const getStageColor = useCallback(
    (stageId?: string) => {
      if (!stageId) return 'bg-slate-100 text-slate-600'
      const stage = funnelStages.find((s) => s.id === stageId)
      if (stage?.color) return stage.color
      return 'bg-primary-100 text-primary-700'
    },
    [funnelStages]
  )

  // Calculate financial summary - based only on billings (matching finance system)
  const financialSummary = {
    totalBillings: billings.reduce((acc, b) => acc + b.amount, 0),
    totalPaid: billings
      .filter((b) => b.status === 'Pagamento realizado')
      .reduce((acc, b) => acc + b.amount, 0),
    totalPending: billings
      .filter((b) => b.status !== 'Pagamento realizado' && b.status !== 'Cancelado')
      .reduce((acc, b) => acc + b.amount, 0),
    proposalsCount: proposals.length,
    projectsCount: projects.length,
  }

  // Toggle section
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Copy to clipboard
  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Save follow-up
  const handleSaveFollowUp = async () => {
    if (!newFollowUp.trim() || !id) return
    setSavingFollowUp(true)
    try {
      const now = new Date().toISOString()
      await addDoc(collection(db, 'clients', id, 'followups'), {
        text: newFollowUp.trim(),
        author: userEmail || 'Usuário',
        createdAt: now,
        type: 'note',
        orgId,
      })
      // Update lastFollowUpAt to track last interaction instantly
      await updateDoc(doc(db, 'clients', id), {
        lastFollowUpAt: now,
        updatedAt: now,
      })
      setFollowUps((prev) => [
        {
          id: Date.now().toString(),
          text: newFollowUp.trim(),
          author: userEmail || 'Usuário',
          createdAt: now,
          source: 'followup',
        },
        ...prev,
      ])
      setNewFollowUp('')
      setShowFollowUpForm(false)
    } catch (error) {
      console.error('Error saving follow-up:', error)
    } finally {
      setSavingFollowUp(false)
    }
  }

  // Save needs detail
  const handleSaveNeeds = async () => {
    if (!id) return
    try {
      await updateDoc(doc(db, 'clients', id), { needsDetail })
      setClient((prev) => (prev ? { ...prev, needsDetail } : prev))
      setEditingNeeds(false)
    } catch (error) {
      console.error('Error saving needs:', error)
    }
  }

  // Save lead type
  const handleSaveLeadType = async (newLeadType: string) => {
    if (!id) return
    setSavingLeadType(true)
    try {
      await updateDoc(doc(db, 'clients', id), {
        leadType: newLeadType || null,
        updatedAt: new Date().toISOString()
      })
      setClient((prev) => (prev ? { ...prev, leadType: newLeadType as 'Inbound' | 'Outbound' | undefined } : prev))
      setEditingLeadType(false)
    } catch (error) {
      console.error('Error saving lead type:', error)
    } finally {
      setSavingLeadType(false)
    }
  }

  // Save funnel + stage
  const handleSaveFunnelStage = async (newFunnelId: string, newStageId: string) => {
    if (!id) return
    setSavingFunnel(true)
    try {
      const now = new Date().toISOString()
      await updateDoc(doc(db, 'clients', id), {
        funnelId: newFunnelId || '',
        funnelStage: newStageId || null,
        funnelStageUpdatedAt: now,
        updatedAt: now,
      })
      setClient((prev) =>
        prev
          ? { ...prev, funnelId: newFunnelId, funnelStage: newStageId || undefined, funnelStageUpdatedAt: now }
          : prev
      )
      setEditingFunnel(false)
    } catch (error) {
      console.error('Error saving funnel/stage:', error)
    } finally {
      setSavingFunnel(false)
    }
  }

  // Open edit modal
  const openEditModal = () => {
    if (!client) return
    setEditForm({
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
    })
    setEditPhotoPreview(client.photoUrl || null)
    setShowEditModal(true)
    setShowActionsMenu(false)
  }

  // Save client edit
  const handleSaveEdit = async () => {
    if (!editForm.name.trim() || !editForm.phone.trim() || !id) {
      alert('Nome e telefone são obrigatórios')
      return
    }

    setSavingEdit(true)
    try {
      let photoUrl = editForm.photoUrl

      // Upload new photo if selected
      if (editPhotoFile) {
        const ext = editPhotoFile.name.split('.').pop()
        const photoRef = ref(storage, `client-photos/${Date.now()}.${ext}`)
        await uploadBytes(photoRef, editPhotoFile)
        photoUrl = await getDownloadURL(photoRef)
      }

      const clientData = {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        company: editForm.company.trim() || null,
        email: editForm.email.trim() || null,
        industry: editForm.industry.trim() || null,
        document: editForm.document.trim() || null,
        description: editForm.description.trim() || null,
        birthday: editForm.birthday || null,
        returnAlert: editForm.returnAlert || null,
        leadSource: editForm.leadSource || null,
        leadType: editForm.leadType || null,
        photoUrl: photoUrl || null,
        updatedAt: new Date().toISOString(),
      }

      await updateDoc(doc(db, 'clients', id), clientData)

      // Update local state with proper typing
      setClient((prev) => {
        if (!prev) return null
        return {
          ...prev,
          name: editForm.name.trim(),
          phone: editForm.phone.trim(),
          company: editForm.company.trim() || undefined,
          email: editForm.email.trim() || undefined,
          industry: editForm.industry.trim() || undefined,
          document: editForm.document.trim() || undefined,
          description: editForm.description.trim() || undefined,
          birthday: editForm.birthday || undefined,
          returnAlert: editForm.returnAlert || undefined,
          leadSource: editForm.leadSource || undefined,
          leadType: (editForm.leadType as 'Inbound' | 'Outbound') || undefined,
          photoUrl: photoUrl || undefined,
        }
      })
      setShowEditModal(false)
      setEditPhotoFile(null)
      setEditPhotoPreview(null)
    } catch (error) {
      console.error('Erro ao salvar:', error)
      alert('Erro ao salvar contato')
    } finally {
      setSavingEdit(false)
    }
  }

  // Partners management
  const openPartnersEdit = () => {
    const current = client?.partners
      ? client.partners.split(',').map((p) => p.trim()).filter(Boolean)
      : []
    setPartnersList(current)
    setNewPartnerName('')
    setEditingPartnerIndex(null)
    setEditingPartnerName('')
    setEditingPartners(true)
  }

  const handleAddPartner = () => {
    const name = newPartnerName.trim()
    if (!name) return
    setPartnersList((prev) => [...prev, name])
    setNewPartnerName('')
  }

  const handleRemovePartner = (index: number) => {
    setPartnersList((prev) => prev.filter((_, i) => i !== index))
  }

  const handleStartEditPartner = (index: number) => {
    setEditingPartnerIndex(index)
    setEditingPartnerName(partnersList[index])
  }

  const handleConfirmEditPartner = () => {
    if (editingPartnerIndex === null) return
    const name = editingPartnerName.trim()
    if (!name) return
    setPartnersList((prev) =>
      prev.map((p, i) => (i === editingPartnerIndex ? name : p))
    )
    setEditingPartnerIndex(null)
    setEditingPartnerName('')
  }

  const handleSavePartners = async () => {
    if (!id) return
    setSavingPartners(true)
    try {
      const partnersStr = partnersList.length > 0 ? partnersList.join(', ') : null
      await updateDoc(doc(db, 'clients', id), {
        partners: partnersStr,
        updatedAt: new Date().toISOString(),
      })
      setClient((prev) =>
        prev ? { ...prev, partners: partnersStr || undefined } : prev
      )
      setEditingPartners(false)
    } catch (error) {
      console.error('Erro ao salvar sócios:', error)
      alert('Erro ao salvar sócios')
    } finally {
      setSavingPartners(false)
    }
  }

  // Delete client
  const handleDeleteClient = async () => {
    if (!id) return

    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'clients', id))
      router.push('/contatos')
    } catch (error) {
      console.error('Erro ao excluir:', error)
      alert('Erro ao excluir contato')
    } finally {
      setDeleting(false)
    }
  }

  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !id) return
    setCreatingFolder(true)
    try {
      const folderRef = doc(collection(db, 'clients', id, 'folders'))
      const newFolder: Omit<Folder, 'id'> = {
        name: newFolderName.trim(),
        parentId: currentFolderId,
        createdAt: new Date().toISOString(),
      }
      await setDoc(folderRef, newFolder)
      setFolders((prev) => [...prev, { id: folderRef.id, ...newFolder }])
      setNewFolderName('')
      setShowNewFolderModal(false)
    } catch (error) {
      console.error('Error creating folder:', error)
    } finally {
      setCreatingFolder(false)
    }
  }

  // Upload file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return

    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const storageRef = ref(storage, `clients/${id}/files/${Date.now()}.${ext}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)

      const fileRef = doc(collection(db, 'clients', id, 'files'))
      const newFile: Omit<FileDoc, 'id'> = {
        name: file.name,
        url,
        folderId: currentFolderId,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
      }
      await setDoc(fileRef, newFile)
      setFiles((prev) => [...prev, { id: fileRef.id, ...newFile }])
    } catch (error) {
      console.error('Error uploading file:', error)
      alert('Erro ao fazer upload do arquivo')
    } finally {
      setUploadingFile(false)
      e.target.value = ''
    }
  }

  // Delete folder or file
  const handleDelete = async () => {
    if (!deletingItem || !id) return
    try {
      if (deletingItem.type === 'folder') {
        // Check for nested content
        const hasSubfolders = folders.some((f) => f.parentId === deletingItem.id)
        const hasFiles = files.some((f) => f.folderId === deletingItem.id)
        if (hasSubfolders || hasFiles) {
          alert('Pasta contém arquivos ou subpastas. Remova-os primeiro.')
          setDeletingItem(null)
          return
        }
        await deleteDoc(doc(db, 'clients', id, 'folders', deletingItem.id))
        setFolders((prev) => prev.filter((f) => f.id !== deletingItem.id))
      } else {
        const file = files.find((f) => f.id === deletingItem.id)
        if (file?.url && file.url.includes('firebase')) {
          try {
            const storageRef = ref(storage, file.url)
            await deleteObject(storageRef)
          } catch {
            // File might not exist in storage
          }
        }
        await deleteDoc(doc(db, 'clients', id, 'files', deletingItem.id))
        setFiles((prev) => prev.filter((f) => f.id !== deletingItem.id))
      }
    } catch (error) {
      console.error('Error deleting:', error)
    } finally {
      setDeletingItem(null)
    }
  }

  // Load full proposal details
  const handleOpenProposal = async (proposal: Proposal) => {
    setLoadingProposal(true)
    setShowProposalModal(true)
    try {
      const proposalSnap = await getDoc(doc(db, 'proposals', proposal.id))
      if (proposalSnap.exists()) {
        const data = proposalSnap.data()
        setSelectedProposal({
          id: proposalSnap.id,
          ...data,
        } as Proposal)
      } else {
        setSelectedProposal(proposal)
      }
    } catch (error) {
      console.error('Error loading proposal:', error)
      setSelectedProposal(proposal)
    } finally {
      setLoadingProposal(false)
    }
  }

  // Close proposal modal
  const handleCloseProposalModal = () => {
    setShowProposalModal(false)
    setSelectedProposal(null)
  }

  // Get files and folders in current directory (including from contracts if at root)
  const currentItems = useMemo(() => {
    const currentFolders = folders.filter((f) => f.parentId === currentFolderId)
    let currentFiles = files.filter((f) => f.folderId === currentFolderId)

    // At root level, include contracts as virtual files in a "Contratos" folder indicator
    if (currentFolderId === null && contracts.length > 0) {
      // Check if there's already a "Contratos" folder
      const contractsFolder = folders.find((f) => f.name === 'Contratos' && f.source === 'contratos')
      if (!contractsFolder && !currentFolders.some((f) => f.name === 'Contratos')) {
        currentFolders.push({
          id: '__contracts__',
          name: 'Contratos',
          parentId: null,
          createdAt: '',
          source: 'contratos',
        })
      }
    }

    // If in virtual contracts folder, show contracts as files
    if (currentFolderId === '__contracts__') {
      currentFiles = contracts.map((c) => ({
        id: c.id,
        name: c.name || c.projectName || 'Contrato',
        url: c.url,
        folderId: '__contracts__',
        uploadedAt: c.signedAt || '',
        source: 'contrato',
      }))
    }

    // Search filter
    if (fileSearch) {
      const search = fileSearch.toLowerCase()
      return {
        folders: currentFolders.filter((f) => f.name.toLowerCase().includes(search)),
        files: currentFiles.filter((f) => f.name.toLowerCase().includes(search)),
      }
    }

    return { folders: currentFolders, files: currentFiles }
  }, [folders, files, contracts, currentFolderId, fileSearch])

  // Format file size
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Format address
  const formatAddress = () => {
    if (!client) return null
    const parts = [
      client.logradouro,
      client.numero,
      client.complemento,
      client.bairro,
      client.municipio,
      client.estado,
      client.cep,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-slate-500">Contato não encontrado</p>
          <Link href="/contatos" className="text-primary-600 hover:underline mt-2 inline-block">
            Voltar para contatos
          </Link>
        </div>
      </div>
    )
  }

  const address = formatAddress()

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5 text-slate-500" />
            </button>

            <div className="flex items-center gap-4 flex-1">
              {client.photoUrl ? (
                <Image
                  src={client.photoUrl}
                  alt={client.name}
                  width={56}
                  height={56}
                  className="w-14 h-14 rounded-2xl object-cover ring-4 ring-white shadow-lg"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-primary-200">
                  {client.name?.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-slate-800 truncate">{client.name}</h1>
                  {editingFunnel ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={client.funnelId || ''}
                        onChange={(e) => {
                          const newFunnelId = e.target.value
                          // When funnel changes, clear stage
                          handleSaveFunnelStage(newFunnelId, '')
                        }}
                        disabled={savingFunnel}
                        className="px-2 py-1 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
                      >
                        <option value="">Sem funil</option>
                        {funnels.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                      {client.funnelId && (
                        <select
                          value={client.funnelStage || ''}
                          onChange={(e) => {
                            handleSaveFunnelStage(client.funnelId || '', e.target.value)
                          }}
                          disabled={savingFunnel}
                          className="px-2 py-1 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
                        >
                          <option value="">Sem etapa</option>
                          {funnelStages
                            .filter((s) => s.funnelId === client.funnelId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                      )}
                      <button
                        onClick={() => setEditingFunnel(false)}
                        className="p-1 text-slate-400 hover:text-slate-600"
                      >
                        <Cross2Icon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingFunnel(true)}
                      className={`group/funnel inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all hover:ring-2 hover:ring-primary-200 ${getStageColor(client.funnelStage)}`}
                      title="Clique para alterar funil e etapa"
                    >
                      <FunnelIcon className="w-3 h-3" />
                      {funnels.find((f) => f.id === client.funnelId)?.name || 'Sem funil'}
                      {client.funnelStage && ` · ${getStageName(client.funnelStage)}`}
                      <Pencil1Icon className="w-3 h-3 opacity-0 group-hover/funnel:opacity-100 transition-opacity" />
                    </button>
                  )}
                </div>
                {client.company && (
                  <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <BuildingOfficeIcon className="w-4 h-4" />
                    {client.company}
                  </p>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2">
              {client.phone && (
                <a
                  href={`https://wa.me/${formatWhatsAppNumber(client.phone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 text-white rounded-xl font-medium text-sm hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-200"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                </a>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  <DotsHorizontalIcon className="w-5 h-5 text-slate-500" />
                </button>

                {/* Dropdown Menu */}
                {showActionsMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setShowActionsMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200/60 py-1 z-30">
                      <button
                        onClick={openEditModal}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Pencil1Icon className="w-4 h-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(true)
                          setShowActionsMenu(false)
                        }}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" />
                        Excluir
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Info */}
          <div className="lg:col-span-1 space-y-4">
            {/* Resumo */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleSection('resumo')}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <PersonIcon className="w-4 h-4 text-primary-600" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Resumo</span>
                </div>
                {expandedSections.resumo ? (
                  <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {expandedSections.resumo && (
                <div className="px-5 pb-5 space-y-4">
                  {client.email && (
                    <InfoRow
                      icon={<EnvelopeClosedIcon className="w-4 h-4" />}
                      label="Email"
                      value={client.email}
                      copyable
                      onCopy={() => copyToClipboard(client.email!, 'email')}
                      copied={copiedField === 'email'}
                    />
                  )}
                  {client.phone && (
                    <InfoRow
                      icon={<MobileIcon className="w-4 h-4" />}
                      label="Telefone"
                      value={client.phone}
                      copyable
                      onCopy={() => copyToClipboard(client.phone, 'phone')}
                      copied={copiedField === 'phone'}
                    />
                  )}
                  {client.leadSource && (
                    <InfoRow
                      icon={
                        leadSourceIcons[client.leadSource] ? (
                          <Image
                            src={leadSourceIcons[client.leadSource]}
                            alt={client.leadSource}
                            width={16}
                            height={16}
                          />
                        ) : (
                          <GlobeAltIcon className="w-4 h-4" />
                        )
                      }
                      label="Origem"
                      value={client.leadSource}
                    />
                  )}
                  {/* Lead Type - Editable */}
                  <div className="flex items-center gap-3 py-2">
                    <div className="w-4 h-4 flex items-center justify-center text-slate-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-400">Tipo de Lead</p>
                      {editingLeadType ? (
                        <div className="flex items-center gap-2 mt-1">
                          <select
                            value={client.leadType || ''}
                            onChange={(e) => handleSaveLeadType(e.target.value)}
                            disabled={savingLeadType}
                            className="px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white"
                            autoFocus
                          >
                            <option value="">Selecione...</option>
                            {leadTypeOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setEditingLeadType(false)}
                            className="p-1 text-slate-400 hover:text-slate-600"
                          >
                            <Cross2Icon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingLeadType(true)}
                          className="group flex items-center gap-1.5 hover:bg-slate-50 rounded px-1 -ml-1 transition-colors"
                        >
                          {client.leadType ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              leadTypeOptions.find(opt => opt.value === client.leadType)?.color || 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                              {client.leadType}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">Não definido</span>
                          )}
                          <Pencil1Icon className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      )}
                    </div>
                  </div>
                  {client.industry && (
                    <InfoRow
                      icon={<BuildingOfficeIcon className="w-4 h-4" />}
                      label="Ramo"
                      value={client.industry}
                    />
                  )}
                  {client.birthday && (
                    <InfoRow
                      icon={<CalendarIcon className="w-4 h-4" />}
                      label="Aniversário"
                      value={formatDate(client.birthday)}
                    />
                  )}
                  {client.returnAlert && (
                    <InfoRow
                      icon={<ClockIcon className="w-4 h-4" />}
                      label="Retorno"
                      value={formatDate(client.returnAlert)}
                      highlight={new Date(client.returnAlert) <= new Date()}
                    />
                  )}
                  {client.firstContactAt && (
                    <InfoRow
                      icon={<CalendarIcon className="w-4 h-4" />}
                      label="Primeiro Contato"
                      value={formatDateTime(client.firstContactAt)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Detalhes */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleSection('detalhes')}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <ClipboardDocumentListIcon className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Detalhes</span>
                </div>
                {expandedSections.detalhes ? (
                  <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {expandedSections.detalhes && (
                <div className="px-5 pb-5 space-y-4">
                  {client.document && (
                    <InfoRow
                      icon={<FileTextIcon className="w-4 h-4" />}
                      label="CNPJ/CPF"
                      value={client.document}
                      copyable
                      onCopy={() => copyToClipboard(client.document!, 'document')}
                      copied={copiedField === 'document'}
                    />
                  )}
                  {address && (
                    <InfoRow
                      icon={<MapPinIcon className="w-4 h-4" />}
                      label="Endereço"
                      value={address}
                    />
                  )}
                  {client.natureza_juridica && (
                    <InfoRow
                      icon={<BuildingOfficeIcon className="w-4 h-4" />}
                      label="Natureza Jurídica"
                      value={client.natureza_juridica}
                    />
                  )}
                  {client.porte_empresa && (
                    <InfoRow
                      icon={<BuildingOfficeIcon className="w-4 h-4" />}
                      label="Porte"
                      value={client.porte_empresa}
                    />
                  )}
                  {client.capital_social && (
                    <InfoRow
                      icon={<CurrencyDollarIcon className="w-4 h-4" />}
                      label="Capital Social"
                      value={formatCurrency(Number(client.capital_social))}
                    />
                  )}
                  {client.data_abertura && (
                    <InfoRow
                      icon={<CalendarIcon className="w-4 h-4" />}
                      label="Abertura"
                      value={String(client.data_abertura)}
                    />
                  )}
                  {client.description && (
                    <div className="pt-3 border-t border-slate-100">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Descrição</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{client.description}</p>
                    </div>
                  )}
                  <div className="pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <UsersIcon className="w-4 h-4 text-slate-400" />
                          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Sócios</p>
                        </div>
                        {!editingPartners && (
                          <button
                            onClick={openPartnersEdit}
                            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Editar sócios"
                          >
                            <Pencil1Icon className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        )}
                      </div>
                      {editingPartners ? (
                        <div className="space-y-2">
                          {partnersList.map((partner, index) => (
                            <div key={index} className="flex items-center gap-2">
                              {editingPartnerIndex === index ? (
                                <>
                                  <input
                                    type="text"
                                    value={editingPartnerName}
                                    onChange={(e) => setEditingPartnerName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleConfirmEditPartner()
                                      if (e.key === 'Escape') {
                                        setEditingPartnerIndex(null)
                                        setEditingPartnerName('')
                                      }
                                    }}
                                    className="flex-1 px-3 py-1.5 text-sm border border-primary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                                    autoFocus
                                  />
                                  <button
                                    onClick={handleConfirmEditPartner}
                                    className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                                    title="Confirmar"
                                  >
                                    <CheckIcon className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingPartnerIndex(null)
                                      setEditingPartnerName('')
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
                                    title="Cancelar"
                                  >
                                    <Cross2Icon className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg">
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center text-primary-600 font-semibold text-[10px]">
                                      {partner.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-sm text-slate-700">{partner}</span>
                                  </div>
                                  <button
                                    onClick={() => handleStartEditPartner(index)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
                                    title="Editar"
                                  >
                                    <Pencil1Icon className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleRemovePartner(index)}
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                                    title="Remover"
                                  >
                                    <Cross2Icon className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newPartnerName}
                              onChange={(e) => setNewPartnerName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddPartner()
                              }}
                              placeholder="Nome do sócio"
                              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                            />
                            <button
                              onClick={handleAddPartner}
                              disabled={!newPartnerName.trim()}
                              className="p-1.5 rounded-lg bg-primary-100 hover:bg-primary-200 text-primary-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Adicionar sócio"
                            >
                              <PlusIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={() => setEditingPartners(false)}
                              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={handleSavePartners}
                              disabled={savingPartners}
                              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                            >
                              {savingPartners ? 'Salvando...' : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {client.partners ? (
                            client.partners.split(',').map((partner, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg"
                              >
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center text-primary-600 font-semibold text-xs">
                                  {partner.trim().charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm text-slate-700">{partner.trim()}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-400 italic">Nenhum sócio cadastrado</p>
                          )}
                        </div>
                      )}
                    </div>
                </div>
              )}
            </div>

            {/* Necessidades */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <ChatBubbleIcon className="w-4 h-4 text-amber-600" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">Necessidades do Cliente</span>
                </div>
                {!editingNeeds && (
                  <button
                    onClick={() => setEditingNeeds(true)}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <Pencil1Icon className="w-4 h-4 text-slate-400" />
                  </button>
                )}
              </div>
              <div className="px-5 pb-5">
                {editingNeeds ? (
                  <div className="space-y-3">
                    <textarea
                      value={needsDetail}
                      onChange={(e) => setNeedsDetail(e.target.value)}
                      placeholder="Descreva as necessidades do cliente..."
                      rows={4}
                      className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-none bg-slate-50/50"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setNeedsDetail(client.needsDetail || '')
                          setEditingNeeds(false)
                        }}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveNeeds}
                        className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {client.needsDetail || (
                      <span className="text-slate-400 italic">
                        Clique no lápis para adicionar...
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right column - Tabs */}
          <div className="lg:col-span-2 space-y-4">
            {/* Financial Summary Cards - based only on billings */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Total Faturado"
                value={formatCurrency(financialSummary.totalBillings)}
                icon={<BanknotesIcon className="w-5 h-5" />}
                color="violet"
              />
              <StatCard
                label="Valor Pago"
                value={formatCurrency(financialSummary.totalPaid)}
                icon={<CheckIcon className="w-5 h-5" />}
                color="emerald"
              />
              <StatCard
                label="Valor Pendente"
                value={formatCurrency(financialSummary.totalPending)}
                icon={<ClockIcon className="w-5 h-5" />}
                color="amber"
              />
              <StatCard
                label="Propostas"
                value={String(financialSummary.proposalsCount)}
                icon={<DocumentTextIcon className="w-5 h-5" />}
                color="blue"
              />
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
              {/* Tab Headers */}
              <div className="flex border-b border-slate-200/60">
                {tabs.map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  const count = tab.id === 'propostas'
                    ? proposals.length
                    : tab.id === 'financeiro'
                    ? billings.length
                    : tab.id === 'historico'
                    ? followUps.length
                    : folders.length + files.length + contracts.length
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium transition-all relative ${
                        isActive
                          ? 'text-primary-600'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                        isActive ? 'bg-primary-100 text-primary-600' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {count}
                      </span>
                      {isActive && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Tab Content */}
              <div className="p-5">
                {/* Propostas Tab */}
                {activeTab === 'propostas' && (
                  <div>
                    {/* Header with create button */}
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-slate-500">
                        {proposals.length} {proposals.length === 1 ? 'proposta' : 'propostas'} encontradas
                      </p>
                      <Link
                        href={`/contatos/${id}/proposta/nova`}
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200"
                      >
                        <PlusIcon className="w-4 h-4" />
                        Nova Proposta
                      </Link>
                    </div>

                    {proposals.length === 0 ? (
                      <EmptyState
                        icon={<DocumentTextIcon className="w-8 h-8" />}
                        title="Nenhuma proposta"
                        description="Crie uma proposta comercial para este cliente"
                      />
                    ) : (
                      <div className="space-y-3">
                        {proposals.map((proposal) => {
                          const statusColor = proposalStatusColors[proposal.status || 'Pendente'] || proposalStatusColors['Pendente']
                          return (
                            <button
                              key={proposal.id}
                              onClick={() => handleOpenProposal(proposal)}
                              className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-slate-50/80 to-slate-50/40 rounded-xl hover:from-primary-50/80 hover:to-primary-50/40 hover:border-primary-200 transition-all group border border-slate-100 cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ${
                                  proposal.status === 'Aprovada' ? 'bg-emerald-100' :
                                  proposal.status === 'Recusada' ? 'bg-red-100' :
                                  proposal.status === 'Cancelada' ? 'bg-rose-100' :
                                  proposal.status === 'Expirada' ? 'bg-slate-100' :
                                  'bg-primary-100'
                                }`}>
                                  <DocumentTextIcon className={`w-5 h-5 ${
                                    proposal.status === 'Aprovada' ? 'text-emerald-600' :
                                    proposal.status === 'Recusada' ? 'text-red-600' :
                                    proposal.status === 'Cancelada' ? 'text-rose-600' :
                                    proposal.status === 'Expirada' ? 'text-slate-600' :
                                    'text-primary-600'
                                  }`} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-800 group-hover:text-primary-700 transition-colors">
                                    {proposal.projectName || `Proposta #${proposal.number || proposal.id.slice(0, 6)}`}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {proposal.createdAt && formatDate(proposal.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${statusColor}`}>
                                  {proposal.status || 'Pendente'}
                                </span>
                                <span className="text-base font-bold text-slate-800">
                                  {formatCurrency(proposal.total || 0)}
                                </span>
                                <ChevronRightIcon className="w-4 h-4 text-slate-300 group-hover:text-primary-400 transition-colors" />
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Financeiro Tab */}
                {activeTab === 'financeiro' && (
                  <div>
                    {billings.length === 0 ? (
                      <EmptyState
                        icon={<BanknotesIcon className="w-8 h-8" />}
                        title="Nenhum lançamento"
                        description="Os lançamentos financeiros aparecerão aqui"
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left">
                              <th className="pb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Competência</th>
                              <th className="pb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Vencimento</th>
                              <th className="pb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Valor</th>
                              <th className="pb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                              <th className="pb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Pagamento</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {billings.map((billing) => {
                              // Determine status - check if overdue (matching finance system)
                              let displayStatus = billing.status || 'Pendente de pagamento'
                              if (displayStatus !== 'Pagamento realizado' && displayStatus !== 'Cancelado') {
                                const dueDate = new Date(billing.expectedDate)
                                const today = new Date()
                                today.setHours(0, 0, 0, 0)
                                if (dueDate < today) {
                                  displayStatus = 'Atrasado'
                                }
                              }
                              const statusColor = paymentStatusColors[displayStatus] || paymentStatusColors['Pendente de pagamento']

                              return (
                                <tr key={billing.id} className="group hover:bg-slate-50/50">
                                  <td className="py-3.5 text-sm text-slate-700 font-medium">{billing.competence || '-'}</td>
                                  <td className="py-3.5 text-sm text-slate-600">{formatDate(billing.expectedDate)}</td>
                                  <td className="py-3.5 text-sm font-bold text-slate-800">
                                    {formatCurrency(billing.amount)}
                                  </td>
                                  <td className="py-3.5">
                                    <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor}`}>
                                      {displayStatus}
                                    </span>
                                  </td>
                                  <td className="py-3.5 text-sm text-slate-600">
                                    {billing.paymentDate ? formatDate(billing.paymentDate) : '-'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Histórico Tab */}
                {activeTab === 'historico' && (
                  <div>
                    {/* Add button */}
                    <div className="flex justify-end mb-4">
                      <button
                        onClick={() => setShowFollowUpForm(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded-xl transition-colors"
                      >
                        <PlusIcon className="w-4 h-4" />
                        Adicionar
                      </button>
                    </div>

                    {showFollowUpForm && (
                      <div className="mb-5 p-4 bg-gradient-to-br from-primary-50 to-purple-50/50 rounded-xl border border-primary-100">
                        <textarea
                          value={newFollowUp}
                          onChange={(e) => setNewFollowUp(e.target.value)}
                          placeholder="Digite uma anotação..."
                          rows={3}
                          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-none bg-white"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-3">
                          <button
                            onClick={() => {
                              setNewFollowUp('')
                              setShowFollowUpForm(false)
                            }}
                            className="px-4 py-2 text-sm text-slate-600 hover:bg-white rounded-lg transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleSaveFollowUp}
                            disabled={!newFollowUp.trim() || savingFollowUp}
                            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                          >
                            {savingFollowUp ? 'Salvando...' : 'Salvar'}
                          </button>
                        </div>
                      </div>
                    )}

                    {followUps.length === 0 ? (
                      <EmptyState
                        icon={<ClockIcon className="w-8 h-8" />}
                        title="Nenhum registro"
                        description="O histórico de interações aparecerá aqui"
                      />
                    ) : (
                      <div className="space-y-4">
                        {followUps.map((fu) => (
                          <div key={fu.id} className="flex gap-4 group">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                              fu.source === 'log' ? 'bg-slate-100' : 'bg-primary-100'
                            }`}>
                              {fu.source === 'log' ? (
                                <ClockIcon className="w-5 h-5 text-slate-500" />
                              ) : (
                                <ChatBubbleIcon className="w-5 h-5 text-primary-600" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 bg-slate-50/50 rounded-xl p-4 border border-slate-100">
                              <div className="flex items-baseline justify-between gap-2 mb-1">
                                <span className="text-sm font-semibold text-slate-800">{fu.author}</span>
                                <span className="text-xs text-slate-400">
                                  {formatDateTime(fu.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm text-slate-600 leading-relaxed">{fu.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Documentos Tab */}
                {activeTab === 'documentos' && (
                  <div>
                    {/* Toolbar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                      {/* Search */}
                      <div className="relative flex-1 max-w-xs">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={fileSearch}
                          onChange={(e) => setFileSearch(e.target.value)}
                          placeholder="Buscar arquivos..."
                          className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-slate-50/50"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowNewFolderModal(true)}
                          className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                        >
                          <FolderPlusIcon className="w-4 h-4" />
                          <span className="hidden sm:inline">Nova Pasta</span>
                        </button>
                        <label className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded-xl transition-colors cursor-pointer">
                          <input
                            type="file"
                            onChange={handleFileUpload}
                            className="sr-only"
                            disabled={uploadingFile}
                          />
                          {uploadingFile ? (
                            <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                          ) : (
                            <DocumentPlusIcon className="w-4 h-4" />
                          )}
                          <span className="hidden sm:inline">Upload</span>
                        </label>
                        {(files.length > 0 || contracts.length > 0) && (
                          <button className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                            <ArchiveBoxIcon className="w-4 h-4" />
                            <span className="hidden sm:inline">Baixar ZIP</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Breadcrumb */}
                    <div className="flex items-center gap-1 mb-4 text-sm overflow-x-auto pb-2">
                      <button
                        onClick={() => setCurrentFolderId(null)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
                          currentFolderId === null
                            ? 'text-primary-600 font-medium'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <FolderIcon className="w-4 h-4" />
                        Raiz
                      </button>
                      {folderPath.map((folder, index) => (
                        <div key={folder.id} className="flex items-center">
                          <ChevronRightIcon className="w-4 h-4 text-slate-300" />
                          <button
                            onClick={() => setCurrentFolderId(folder.id)}
                            className={`px-2 py-1 rounded-lg transition-colors ${
                              index === folderPath.length - 1
                                ? 'text-primary-600 font-medium'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {folder.name}
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Files and Folders Grid */}
                    {currentItems.folders.length === 0 && currentItems.files.length === 0 ? (
                      <EmptyState
                        icon={<FolderOpenIcon className="w-8 h-8" />}
                        title="Pasta vazia"
                        description="Adicione arquivos ou crie uma nova pasta"
                      />
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {/* Folders */}
                        {currentItems.folders.map((folder) => (
                          <div
                            key={folder.id}
                            className="group relative bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-4 border border-slate-200/60 hover:border-primary-200 hover:shadow-md transition-all cursor-pointer"
                            onClick={() => setCurrentFolderId(folder.id)}
                          >
                            <div className="flex flex-col items-center text-center">
                              <div className="w-14 h-14 rounded-xl bg-amber-100 flex items-center justify-center mb-3 shadow-sm group-hover:shadow-md transition-shadow">
                                <FolderIcon className="w-7 h-7 text-amber-600" />
                              </div>
                              <p className="text-sm font-medium text-slate-700 truncate w-full">{folder.name}</p>
                              {folder.source && (
                                <p className="text-xs text-slate-400 mt-1">{folder.source}</p>
                              )}
                            </div>
                            {!folder.source && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeletingItem({ type: 'folder', id: folder.id })
                                }}
                                className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all"
                              >
                                <TrashIcon className="w-3.5 h-3.5 text-red-500" />
                              </button>
                            )}
                          </div>
                        ))}

                        {/* Files */}
                        {currentItems.files.map((file) => (
                          <div
                            key={file.id}
                            className="group relative bg-white rounded-xl p-4 border border-slate-200/60 hover:border-primary-200 hover:shadow-md transition-all"
                          >
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex flex-col items-center text-center"
                            >
                              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-3 shadow-sm ${
                                file.source === 'contrato' ? 'bg-emerald-100' : 'bg-blue-100'
                              }`}>
                                {file.source === 'contrato' ? (
                                  <DocumentDuplicateIcon className="w-7 h-7 text-emerald-600" />
                                ) : (
                                  <FileTextIcon className="w-7 h-7 text-blue-600" />
                                )}
                              </div>
                              <p className="text-sm font-medium text-slate-700 truncate w-full" title={file.name}>
                                {file.name}
                              </p>
                              {file.size && (
                                <p className="text-xs text-slate-400 mt-1">{formatFileSize(file.size)}</p>
                              )}
                            </a>
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <a
                                href={file.url}
                                download
                                className="p-1.5 rounded-lg bg-white/80 hover:bg-slate-100 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DownloadIcon className="w-3.5 h-3.5 text-slate-500" />
                              </a>
                              {!file.source && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDeletingItem({ type: 'file', id: file.id })
                                  }}
                                  className="p-1.5 rounded-lg bg-white/80 hover:bg-red-50 transition-colors"
                                >
                                  <TrashIcon className="w-3.5 h-3.5 text-red-500" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setShowNewFolderModal(false)
              setNewFolderName('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <FolderPlusIcon className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Nova Pasta</h3>
                  <p className="text-xs text-slate-500">Crie uma pasta para organizar arquivos</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowNewFolderModal(false)
                  setNewFolderName('')
                }}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">Nome da pasta</label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Ex: Documentos fiscais"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => {
                  setShowNewFolderModal(false)
                  setNewFolderName('')
                }}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {creatingFolder ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Criar Pasta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDeletingItem(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrashIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  Excluir {deletingItem.type === 'folder' ? 'pasta' : 'arquivo'}
                </h3>
                <p className="text-sm text-slate-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir {deletingItem.type === 'folder' ? 'esta pasta' : 'este arquivo'}?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingItem(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proposal Detail Modal */}
      {showProposalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseProposalModal}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] m-4 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-purple-50">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${
                  selectedProposal?.status === 'Aprovada' ? 'bg-emerald-100' :
                  selectedProposal?.status === 'Recusada' ? 'bg-red-100' :
                  selectedProposal?.status === 'Cancelada' ? 'bg-rose-100' :
                  'bg-primary-100'
                }`}>
                  <DocumentTextIcon className={`w-6 h-6 ${
                    selectedProposal?.status === 'Aprovada' ? 'text-emerald-600' :
                    selectedProposal?.status === 'Recusada' ? 'text-red-600' :
                    selectedProposal?.status === 'Cancelada' ? 'text-rose-600' :
                    'text-primary-600'
                  }`} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">
                    {selectedProposal?.projectName || `Proposta #${selectedProposal?.number || ''}`}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedProposal?.createdAt && formatDate(selectedProposal.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedProposal?.status && (
                  <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    proposalStatusColors[selectedProposal.status] || proposalStatusColors['Pendente']
                  }`}>
                    {selectedProposal.status}
                  </span>
                )}
                <button
                  onClick={handleCloseProposalModal}
                  className="p-2 rounded-lg hover:bg-white/50 transition-colors"
                >
                  <Cross2Icon className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingProposal ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                </div>
              ) : selectedProposal ? (
                <div className="space-y-6">
                  {/* Value Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-primary-50 to-purple-50 rounded-xl p-4 border border-primary-100">
                      <p className="text-xs font-medium text-primary-600 uppercase tracking-wide">Valor Total</p>
                      <p className="text-2xl font-bold text-primary-700 mt-1">
                        {formatCurrency(selectedProposal.total || 0)}
                      </p>
                    </div>
                    {selectedProposal.subtotal && selectedProposal.subtotal !== selectedProposal.total && (
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Subtotal</p>
                        <p className="text-lg font-bold text-slate-700 mt-1">
                          {formatCurrency(selectedProposal.subtotal)}
                        </p>
                      </div>
                    )}
                    {selectedProposal.discountValue && selectedProposal.discountValue > 0 && (
                      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                        <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Desconto</p>
                        <p className="text-lg font-bold text-emerald-700 mt-1">
                          -{formatCurrency(selectedProposal.discountValue)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Context */}
                  {selectedProposal.context && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-2">Contexto</h4>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                          {selectedProposal.context}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Items/Scope */}
                  {selectedProposal.items && selectedProposal.items.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-2">Escopo / Produtos</h4>
                      <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                        {selectedProposal.items.map((item, index) => (
                          <div key={index} className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-slate-800">{item.name || 'Item'}</p>
                                {item.description && (
                                  <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{item.description}</p>
                                )}
                              </div>
                              {item.qty && item.price && (
                                <div className="text-right ml-4">
                                  <p className="text-sm font-bold text-slate-700">
                                    {formatCurrency(item.qty * item.price)}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {item.qty}x {formatCurrency(item.price)}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Monthly Fees */}
                  {selectedProposal.monthlyFees && selectedProposal.monthlyFees.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-2">Mensalidades</h4>
                      <div className="bg-amber-50 rounded-xl border border-amber-100 divide-y divide-amber-100">
                        {selectedProposal.monthlyFees.map((fee, index) => (
                          <div key={index} className="p-4 flex items-center justify-between">
                            <p className="text-sm text-amber-800">{fee.description || 'Mensalidade'}</p>
                            <p className="text-sm font-bold text-amber-700">
                              {formatCurrency(fee.amount || 0)}/mês
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schedule */}
                  {selectedProposal.schedule && selectedProposal.schedule.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-2">Cronograma</h4>
                      <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {selectedProposal.schedule.map((stage, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-blue-400" />
                              <span className="text-sm text-blue-800">{stage.stage}</span>
                              <span className="text-xs text-blue-600 font-medium">{stage.days}h</span>
                            </div>
                          ))}
                        </div>
                        {selectedProposal.expectedDays && (
                          <div className="mt-3 pt-3 border-t border-blue-100">
                            <p className="text-sm text-blue-700">
                              <span className="font-medium">Prazo previsto:</span> {selectedProposal.expectedDays} dias
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Payment Method */}
                  {selectedProposal.paymentMethod && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 mb-2">Forma de Pagamento</h4>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <p className="text-sm text-slate-600 whitespace-pre-wrap">
                          {selectedProposal.paymentMethod}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-slate-500">Não foi possível carregar os detalhes da proposta</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                onClick={handleCloseProposalModal}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white rounded-xl transition-colors"
              >
                Fechar
              </button>
              <Link
                href={`/contatos/${id}/proposta/${selectedProposal?.id}`}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors"
              >
                <Pencil1Icon className="w-4 h-4" />
                Editar Proposta
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowEditModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary-200">
                  <PersonIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Editar Contato</h2>
                  <p className="text-xs text-slate-500">Atualize os dados do contato</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <Cross2Icon className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-6">
              {/* Photo */}
              <div className="flex items-center gap-4">
                {editPhotoPreview || editForm.photoUrl ? (
                  <Image
                    src={editPhotoPreview || editForm.photoUrl}
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
                        setEditPhotoFile(f)
                        setEditPhotoPreview(f ? URL.createObjectURL(f) : null)
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
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
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
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
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
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
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
                      value={editForm.company}
                      onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                      placeholder="Nome da empresa"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">CNPJ / CPF</label>
                  <input
                    type="text"
                    value={editForm.document}
                    onChange={(e) => setEditForm({ ...editForm, document: e.target.value })}
                    placeholder="00.000.000/0000-00"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Ramo de atuacao</label>
                  <input
                    type="text"
                    value={editForm.industry}
                    onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                    placeholder="Ex: Tecnologia, Varejo..."
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Origem do Lead</label>
                  <select
                    value={editForm.leadSource}
                    onChange={(e) => setEditForm({ ...editForm, leadSource: e.target.value })}
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
                    value={editForm.leadType}
                    onChange={(e) => setEditForm({ ...editForm, leadType: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all bg-white"
                  >
                    <option value="">Selecione...</option>
                    {leadTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Aniversario</label>
                  <input
                    type="date"
                    value={editForm.birthday}
                    onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Alerta de retorno</label>
                  <input
                    type="date"
                    value={editForm.returnAlert}
                    onChange={(e) => setEditForm({ ...editForm, returnAlert: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Descricao</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Descricao da empresa ou notas sobre o contato..."
                    rows={3}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium text-sm hover:from-primary-700 hover:to-purple-700 transition-all shadow-lg shadow-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingEdit ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    Salvar alteracoes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmacao de Exclusao */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <TrashIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Excluir contato</h3>
                <p className="text-sm text-slate-500">Esta acao nao pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir este contato? Todos os dados associados serao removidos permanentemente.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteClient}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  'Excluir contato'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Components
function InfoRow({
  icon,
  label,
  value,
  copyable,
  onCopy,
  copied,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  copyable?: boolean
  onCopy?: () => void
  copied?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-start gap-3 group">
      <span className="text-slate-400 flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
        <p className={`text-sm ${highlight ? 'text-amber-600 font-semibold' : 'text-slate-700'}`}>
          {value}
        </p>
      </div>
      {copyable && (
        <button
          onClick={onCopy}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-slate-100 transition-all flex-shrink-0"
          title="Copiar"
        >
          {copied ? (
            <CheckIcon className="w-4 h-4 text-emerald-500" />
          ) : (
            <CopyIcon className="w-4 h-4 text-slate-400" />
          )}
        </button>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: 'violet' | 'emerald' | 'amber' | 'blue'
}) {
  const colors = {
    violet: 'bg-primary-50 text-primary-600 shadow-primary-100',
    emerald: 'bg-emerald-50 text-emerald-600 shadow-emerald-100',
    amber: 'bg-amber-50 text-amber-600 shadow-amber-100',
    blue: 'bg-blue-50 text-blue-600 shadow-blue-100',
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/60 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-10 h-10 rounded-xl ${colors[color]} flex items-center justify-center mb-3 shadow-sm`}>
        {icon}
      </div>
      <p className="text-lg font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="py-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-400">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400 mt-1">{description}</p>
    </div>
  )
}
