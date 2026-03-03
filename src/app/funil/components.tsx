'use client'

import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { Draggable } from '@hello-pangea/dnd'
import {
  ChatBubbleIcon,
} from '@radix-ui/react-icons'
import {
  BuildingOfficeIcon,
  PhoneIcon,
  FunnelIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  VideoCameraIcon,
  CheckCircleIcon,
  CalendarIcon,
  UsersIcon,
  CurrencyDollarIcon,
  ClockIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline'
import { leadSourceIcons, leadTypeOptions } from '@/lib/leadSources'

// Helper function to format time since last contact
const formatTimeSince = (dateString?: string | null): string => {
  if (!dateString) return '-'
  const date = new Date(dateString)
  // Validate that the date is valid
  if (isNaN(date.getTime())) return '-'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    return diffMinutes <= 0 ? 'agora' : `${diffMinutes}m`
  }
  if (diffHours < 24) {
    return `${diffHours}h`
  }
  return `${diffDays}d`
}

// Helper function to parse date from various formats (string, Date, Firestore Timestamp)
const parseDate = (value?: any): Date | null => {
  if (!value) return null

  let date: Date | null = null

  // Handle Firestore Timestamp with toDate() method
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    date = value.toDate()
  // Handle serialized Firestore Timestamp with _seconds
  } else if (typeof value === 'object' && value !== null && '_seconds' in value) {
    date = new Date((value as { _seconds: number })._seconds * 1000)
  } else if (typeof value === 'string') {
    date = new Date(value)
  } else if (value instanceof Date) {
    date = value
  }

  if (!date || isNaN(date.getTime())) return null
  return date
}

// Helper function to format first contact date (DD/MM)
const formatFirstContactDate = (value?: any): string | null => {
  const date = parseDate(value)
  if (!date) return null

  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  return `${day}/${month}`
}

// Helper function to format first contact date for tooltip (full date/time)
const formatFirstContactFull = (value?: any): string => {
  const date = parseDate(value)
  if (!date) return ''
  return date.toLocaleString('pt-BR')
}

// Helper function to format scheduled return date
const formatScheduledReturn = (dateString?: string | null): { text: string; isOverdue: boolean; isToday: boolean } | null => {
  if (!dateString) return null
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return null

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const returnDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((returnDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')

  if (diffDays < 0) {
    return { text: `${day}/${month}`, isOverdue: true, isToday: false }
  } else if (diffDays === 0) {
    return { text: 'Hoje', isOverdue: false, isToday: true }
  } else if (diffDays === 1) {
    return { text: 'Amanhã', isOverdue: false, isToday: false }
  } else {
    return { text: `${day}/${month}`, isOverdue: false, isToday: false }
  }
}

// Helper to format currency in abbreviated form (R$ 500, R$ 12K, R$ 1.5M)
export const formatCurrencyShort = (value: number): string => {
  if (!value) return ''
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`
  return `R$ ${Math.round(value)}`
}

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
  costCenterId?: string
  assignedTo?: string
  assignedToName?: string
  assignedAt?: string
  icpProfileId?: string
  dealValue?: number
}

type StageColor = {
  name: string
  bg: string
  text: string
  border: string
  gradient: string
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

type ContactToday = Cliente & {
  stageName: string
  stageColor: StageColor
  daysInStage: number | null
  daysSinceLastFollowUp: number | null
  isOverdue: boolean
  isDueToday: boolean
  maxDays: number
  currentStep?: CadenceStep | null
}

// Proposal status colors
const proposalStatusColors: Record<string, string> = {
  'Aprovada': 'bg-emerald-100 text-emerald-700',
  'Pendente': 'bg-amber-100 text-amber-700',
  'Em análise': 'bg-blue-100 text-blue-700',
  'Recusada': 'bg-red-100 text-red-700',
  'Expirada': 'bg-slate-100 text-slate-600',
  'Cancelada': 'bg-rose-100 text-rose-700',
}

// Memoized Kanban Card
type KanbanCardProps = {
  client: Cliente
  index: number
  daysInStage: number | null
  lastContactDate?: string | null
  isOverdue: boolean
  stageColor: StageColor
  stageName?: string
  costCenterName?: string
  proposalData?: { total: number; status: string; count: number }
  icpColor?: string
  icpName?: string
  onSelect: (client: Cliente) => void
}

export const KanbanCard = memo(function KanbanCard({
  client,
  index,
  daysInStage,
  lastContactDate,
  isOverdue,
  stageColor,
  stageName,
  costCenterName,
  proposalData,
  icpColor,
  icpName,
  onSelect,
}: KanbanCardProps) {
  // Compute last activity = most recent of lastFollowUpAt and updatedAt
  const lastActivityDate = (() => {
    const dates = [lastContactDate, client.updatedAt].filter(Boolean) as string[]
    if (dates.length === 0) return null
    return dates.reduce((latest, d) => {
      const t = new Date(d).getTime()
      return !isNaN(t) && t > new Date(latest).getTime() ? d : latest
    })
  })()
  const timeSinceActivity = formatTimeSince(lastActivityDate)
  const daysSinceLastActivity = (() => {
    if (!lastActivityDate) return null
    const date = new Date(lastActivityDate)
    if (isNaN(date.getTime())) return null
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
  })()
  const scheduledReturnInfo = formatScheduledReturn(client.scheduledReturn)
  const firstContactDate = formatFirstContactDate(client.firstContactAt)

  const hasFinancial = proposalData || (client.dealValue && client.dealValue > 0)
  const hasFooter = costCenterName || client.assignedToName

  return (
    <Draggable key={client.id} draggableId={client.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => !snapshot.isDragging && onSelect(client)}
          className={`p-3 bg-white rounded-xl border cursor-pointer ${
            snapshot.isDragging
              ? 'shadow-2xl border-primary-300 z-50'
              : isOverdue
              ? 'border-red-200 hover:border-red-300 shadow-sm hover:shadow-md transition-shadow'
              : 'border-slate-200 hover:border-primary-200 shadow-sm hover:shadow-md transition-shadow'
          }`}
          style={{
            ...provided.draggableProps.style,
            ...(snapshot.isDragging ? { opacity: 0.95 } : {}),
          }}
        >
          {/* Top Row: Classification + Scheduled Return (Story 24.3) */}
          <div className="flex items-center gap-1.5 mb-2">
            {client.leadType && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                  leadTypeOptions.find(opt => opt.value === client.leadType)?.color || 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
                title={`Tipo: ${client.leadType}`}
              >
                {client.leadType === 'Inbound' ? 'IN' : 'OUT'}
              </span>
            )}
            {client.leadSource && leadSourceIcons[client.leadSource] && (
              <Image
                src={leadSourceIcons[client.leadSource]}
                alt={client.leadSource}
                width={14}
                height={14}
                className="w-3.5 h-3.5"
                loading="lazy"
              />
            )}
            {icpColor && (
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white"
                style={{ backgroundColor: icpColor }}
                title={icpName ? `ICP: ${icpName}` : 'ICP'}
              />
            )}
            <div className="flex-1" />
            {scheduledReturnInfo && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium shadow-sm ${
                  scheduledReturnInfo.isOverdue
                    ? 'bg-red-500 text-white'
                    : scheduledReturnInfo.isToday
                    ? 'bg-amber-500 text-white'
                    : 'bg-orange-500 text-white'
                }`}
                title={`Retorno agendado: ${client.scheduledReturn ? new Date(client.scheduledReturn).toLocaleDateString('pt-BR') : ''}`}
              >
                <CalendarIcon className="w-3 h-3" />
                {scheduledReturnInfo.text}
              </span>
            )}
          </div>

          {/* Identity: Avatar + Name + Company + Partners */}
          <div className="flex items-start gap-2.5">
            {client.photoUrl ? (
              <Image
                src={client.photoUrl}
                alt={client.name}
                width={36}
                height={36}
                className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                loading="lazy"
              />
            ) : (
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${stageColor.gradient} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                {client.name?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-slate-800 truncate leading-tight">
                {client.name}
              </h4>
              {client.company && (
                <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                  {client.company}
                </p>
              )}
              {client.partners && (
                <p
                  className="text-[10px] text-primary-600 truncate flex items-center gap-0.5 mt-0.5"
                  title={client.partners}
                >
                  <UsersIcon className="w-3 h-3 flex-shrink-0" />
                  {client.partners.split(',').length} sócio{client.partners.split(',').length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Financial: Proposal or DealValue */}
          {hasFinancial && (
            <div className="flex items-center gap-1.5 mt-2">
              {proposalData ? (
                <>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium ${proposalStatusColors[proposalData.status] || 'bg-slate-100 text-slate-600'}`}>
                    <DocumentDuplicateIcon className="w-3 h-3" />
                    {proposalData.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                  {proposalData.count > 1 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-lg text-[10px] font-medium bg-primary-100 text-primary-700">
                      +{proposalData.count - 1}
                    </span>
                  )}
                </>
              ) : client.dealValue && client.dealValue > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-emerald-100 text-emerald-700">
                  <CurrencyDollarIcon className="w-3 h-3" />
                  {formatCurrencyShort(client.dealValue)}
                </span>
              ) : null}
            </div>
          )}

          {/* Tracking: Days in stage + Last contact + First contact */}
          <div className="flex items-center gap-2 mt-2">
            {firstContactDate ? (
              <span
                className="flex items-center gap-0.5 text-[11px] text-emerald-600 font-medium"
                title={`Primeiro contato: ${formatFirstContactFull(client.firstContactAt)}`}
              >
                <PhoneIcon className="w-3 h-3" />
                {firstContactDate}
              </span>
            ) : daysInStage !== null ? (
              <span className={`flex items-center gap-0.5 text-[11px] ${
                isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'
              }`} title="Tempo na etapa">
                <FunnelIcon className="w-3 h-3" />
                {daysInStage}d
              </span>
            ) : null}
            {lastActivityDate && (
              <span className={`flex items-center gap-0.5 text-[11px] ${
                daysSinceLastActivity !== null && daysSinceLastActivity > 7
                  ? 'text-orange-600 font-medium'
                  : 'text-slate-400'
              }`} title="Última atividade">
                <ClockIcon className="w-3 h-3" />
                {timeSinceActivity}
              </span>
            )}
          </div>

          {/* FRT Badge: Aguardando 1o contato */}
          {!client.firstContactAt && client.createdAt && (() => {
            const hoursWaiting = (Date.now() - new Date(client.createdAt).getTime()) / (1000 * 60 * 60)
            const slaColor = hoursWaiting > 8 ? 'bg-red-100 text-red-700' : hoursWaiting > 2 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            return (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium mt-2 ${slaColor}`}>
                <ClockIcon className="w-3 h-3" />
                Aguardando 1º contato ({hoursWaiting < 1 ? `${Math.round(hoursWaiting * 60)}min` : `${Math.round(hoursWaiting)}h`})
              </span>
            )
          })()}

          {/* Footer: Cost Center + Assigned (Story 24.3) */}
          {hasFooter && (
            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100">
              {costCenterName ? (
                <span
                  className="text-[10px] text-slate-400 truncate flex items-center gap-0.5 max-w-[60%]"
                  title={`Centro de custos: ${costCenterName}`}
                >
                  <CurrencyDollarIcon className="w-3 h-3 flex-shrink-0" />
                  {costCenterName}
                </span>
              ) : <span />}
              {client.assignedToName && (
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-[8px] font-bold text-primary-600">{client.assignedToName.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate max-w-[80px]">{client.assignedToName}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
})

// Memoized Kanban Card for unassigned column (simpler version)
type UnassignedCardProps = {
  client: Cliente
  index: number
  lastContactDate?: string | null
  onSelect: (client: Cliente) => void
}

export const UnassignedCard = memo(function UnassignedCard({
  client,
  index,
  lastContactDate,
  onSelect,
}: UnassignedCardProps) {
  const timeSinceContact = formatTimeSince(lastContactDate)
  return (
    <Draggable key={client.id} draggableId={client.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => !snapshot.isDragging && onSelect(client)}
          className={`p-3 bg-white rounded-xl border cursor-pointer ${
            snapshot.isDragging
              ? 'shadow-2xl border-primary-300 z-50'
              : 'border-slate-200 hover:border-primary-200 shadow-sm hover:shadow-md transition-shadow'
          }`}
          style={{
            ...provided.draggableProps.style,
            ...(snapshot.isDragging ? { opacity: 0.95 } : {}),
          }}
        >
          <div className="flex items-start gap-3">
            {client.photoUrl ? (
              <Image
                src={client.photoUrl}
                alt={client.name}
                width={40}
                height={40}
                className="w-10 h-10 rounded-xl object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white font-bold text-sm">
                {client.name?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-slate-800 truncate">
                {client.name}
              </h4>
              {client.company && (
                <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                  <BuildingOfficeIcon className="w-3 h-3 flex-shrink-0" />
                  {client.company}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                {client.leadSource && leadSourceIcons[client.leadSource] && (
                  <Image
                    src={leadSourceIcons[client.leadSource]}
                    alt={client.leadSource}
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                    loading="lazy"
                  />
                )}
                <span className="flex items-center gap-0.5 text-xs text-slate-500" title="Tempo sem contato">
                  <ChatBubbleIcon className="w-3 h-3" />
                  {timeSinceContact}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
})

// Contact method config
const contactMethodConfig = {
  whatsapp: { icon: ChatBubbleLeftRightIcon, bg: 'bg-green-100', hover: 'hover:bg-green-200', text: 'text-green-600', label: 'WhatsApp' },
  email: { icon: EnvelopeIcon, bg: 'bg-blue-100', hover: 'hover:bg-blue-200', text: 'text-blue-600', label: 'E-mail' },
  phone: { icon: PhoneIcon, bg: 'bg-amber-100', hover: 'hover:bg-amber-200', text: 'text-amber-600', label: 'Ligacao' },
  meeting: { icon: VideoCameraIcon, bg: 'bg-purple-100', hover: 'hover:bg-purple-200', text: 'text-purple-600', label: 'Reuniao' },
}

// Memoized Table Row
type TableRowProps = {
  contact: ContactToday
  onSelect: (client: ContactToday) => void
  onQuickFollowUp: (client: ContactToday) => void
  onChangeStage: (client: ContactToday) => void
  onCadenceAction: (client: ContactToday) => void
  onMarkResponse: (client: ContactToday) => void
  onSendWhatsApp: (client: ContactToday) => void
  onSendEmail: (client: ContactToday) => void
  onCallContact?: (client: ContactToday) => void
  hideStageColumn?: boolean
}

export const TableRow = memo(function TableRow({
  contact,
  onSelect,
  onQuickFollowUp,
  onChangeStage,
  onCadenceAction,
  onMarkResponse,
  onSendWhatsApp,
  onSendEmail,
  onCallContact,
  hideStageColumn = false,
}: TableRowProps) {
  const step = contact.currentStep
  const methodConfig = step ? contactMethodConfig[step.contactMethod] : null
  const MethodIcon = methodConfig?.icon || ChatBubbleLeftRightIcon
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Track mounted state for portal
  useEffect(() => {
    setMounted(true)
  }, [])

  // Calculate menu position when opening
  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 192, // 192px = w-48 (12rem)
      })
    }
    setMenuOpen(!menuOpen)
  }, [menuOpen])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {contact.photoUrl ? (
            <Image
              src={contact.photoUrl}
              alt={contact.name}
              width={40}
              height={40}
              className="w-10 h-10 rounded-xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${contact.stageColor.gradient} flex items-center justify-center text-white font-bold text-sm`}>
              {contact.name?.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-sm text-slate-800">{contact.name}</p>
            {contact.company && (
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <BuildingOfficeIcon className="w-3 h-3" />
                {contact.company}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {contact.isOverdue ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            Atrasado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Vence Hoje
          </span>
        )}
      </td>
      {!hideStageColumn && (
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${contact.stageColor.bg} ${contact.stageColor.text}`}>
            {contact.stageName}
          </span>
        </td>
      )}
      {/* Step Column */}
      <td className="px-4 py-3">
        {step ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-800">{step.name}</span>
            <span className={`inline-flex items-center gap-1 text-xs ${methodConfig?.text || 'text-slate-500'}`}>
              <MethodIcon className="w-3 h-3" />
              {methodConfig?.label || step.contactMethod}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Sem cadencia</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {contact.daysInStage !== null ? (
          <span className={contact.isOverdue ? 'text-red-600 font-medium' : ''}>
            {contact.daysInStage} dia{contact.daysInStage !== 1 ? 's' : ''}
          </span>
        ) : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {contact.daysSinceLastFollowUp !== null ? (
          <span>
            {contact.daysSinceLastFollowUp === 0 ? 'Hoje' : `${contact.daysSinceLastFollowUp}d`}
          </span>
        ) : '-'}
      </td>
      <td className="px-4 py-3">
        <div className="relative flex items-center justify-center">
          {/* Menu Button (three vertical dots) */}
          <button
            ref={buttonRef}
            onClick={handleMenuToggle}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            title="Ações"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>

          {/* Dropdown Menu - Rendered via Portal to escape overflow:hidden */}
          {mounted && menuOpen && createPortal(
            <div
              ref={menuRef}
              className="fixed w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
                zIndex: 9999,
              }}
            >
              {/* Cadence Action */}
              {step && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCadenceAction(contact)
                    setMenuOpen(false)
                  }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 ${methodConfig?.text || 'text-slate-700'}`}
                >
                  <MethodIcon className="w-4 h-4" />
                  Executar: {step.name}
                </button>
              )}

              {/* Mark Response */}
              {step && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkResponse(contact)
                    setMenuOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-emerald-600"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  Marcar resposta
                </button>
              )}

              {/* Divider */}
              {step && <div className="border-t border-slate-100 my-1" />}

              {/* Send WhatsApp */}
              {contact.phone && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSendWhatsApp(contact)
                    setMenuOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-green-600"
                >
                  <ChatBubbleLeftRightIcon className="w-4 h-4" />
                  Enviar WhatsApp
                </button>
              )}

              {/* Send Email */}
              {contact.email && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSendEmail(contact)
                    setMenuOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-blue-600"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Enviar Email
                </button>
              )}

              {/* Call via Voice Agent */}
              {contact.phone && onCallContact && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCallContact(contact)
                    setMenuOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-emerald-600"
                >
                  <PhoneIcon className="w-4 h-4" />
                  Ligar (Agente de Voz)
                </button>
              )}

              {/* Divider */}
              <div className="border-t border-slate-100 my-1" />

              {/* Quick Follow-up */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onQuickFollowUp(contact)
                  setMenuOpen(false)
                }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-blue-600"
              >
                <ChatBubbleIcon className="w-4 h-4" />
                Adicionar follow-up
              </button>

              {/* Change Stage */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onChangeStage(contact)
                  setMenuOpen(false)
                }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-amber-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Mudar etapa
              </button>

              {/* View Details */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(contact)
                  setMenuOpen(false)
                }}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-primary-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Ver detalhes
              </button>
            </div>,
            document.body
          )}
        </div>
      </td>
    </tr>
  )
})

// Pagination Component
type PaginationProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export const Pagination = memo(function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-1 py-2 border-t border-slate-100">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
      >
        ←
      </button>
      <span className="px-2 text-xs text-slate-500">
        {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
      >
        →
      </button>
    </div>
  )
})

// Activity Log types - shows follow-ups and logs added to contacts
type ContactActivityLog = {
  id: string
  clientId: string
  clientName: string
  type: 'followup' | 'log'
  text: string
  author: string
  createdAt: Date
}

type ActivitySortField = 'createdAt' | 'clientName' | 'type' | 'author'
type SortDirection = 'asc' | 'desc'

type ActivityLogViewProps = {
  clients: { id: string; name: string }[]
}

// Activity Log View Component - displays follow-ups and logs per contact
export function ActivityLogView({ clients }: ActivityLogViewProps) {
  const [logs, setLogs] = useState<ContactActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<ActivitySortField>('createdAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  // Build client name map
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>()
    clients.forEach(c => map.set(c.id, c.name))
    return map
  }, [clients])

  // Safe date parsing - returns null for invalid dates
  const parseDate = useCallback((value: unknown): Date | null => {
    if (!value) return null
    // Firestore Timestamp
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate()
    }
    // Number (epoch ms)
    if (typeof value === 'number') {
      const d = new Date(value)
      return isNaN(d.getTime()) ? null : d
    }
    // String (ISO or other)
    if (typeof value === 'string') {
      const d = new Date(value)
      return isNaN(d.getTime()) ? null : d
    }
    return null
  }, [])

  // Load follow-ups and logs from client subcollections
  useEffect(() => {
    const loadLogs = async () => {
      try {
        setLoading(true)
        const { collectionGroup, getDocs, query, orderBy, limit } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebaseClient')

        // Fetch all follow-ups across all clients
        const followupsQuery = query(
          collectionGroup(db, 'followups'),
          orderBy('createdAt', 'desc'),
          limit(500)
        )

        // Fetch all logs across all entities (will filter to client logs)
        const logsQuery = query(
          collectionGroup(db, 'logs'),
          orderBy('createdAt', 'desc'),
          limit(1000)
        )

        const [followupsSnap, logsSnap] = await Promise.all([
          getDocs(followupsQuery),
          getDocs(logsQuery),
        ])

        const followupsData: ContactActivityLog[] = followupsSnap.docs
          .filter(doc => doc.ref.path.startsWith('clients/'))
          .reduce<ContactActivityLog[]>((acc, doc) => {
            const data = doc.data()
            const date = parseDate(data.createdAt)
            if (!date) return acc
            const clientId = doc.ref.parent.parent?.id || ''
            if (!clientNameMap.has(clientId)) return acc // Skip clients from other orgs
            acc.push({
              id: doc.id,
              clientId,
              clientName: clientNameMap.get(clientId) || clientId,
              type: 'followup' as const,
              text: data.text || data.message || '',
              author: data.author || data.email || 'Sistema',
              createdAt: date,
            })
            return acc
          }, [])

        const clientLogsData: ContactActivityLog[] = logsSnap.docs
          .filter(doc => doc.ref.path.startsWith('clients/'))
          .reduce<ContactActivityLog[]>((acc, doc) => {
            const data = doc.data()
            const date = parseDate(data.createdAt)
            if (!date) return acc
            const clientId = doc.ref.parent.parent?.id || ''
            if (!clientNameMap.has(clientId)) return acc // Skip clients from other orgs
            acc.push({
              id: doc.id,
              clientId,
              clientName: clientNameMap.get(clientId) || clientId,
              type: 'log' as const,
              text: data.text || data.message || '',
              author: data.author || data.email || 'Sistema',
              createdAt: date,
            })
            return acc
          }, [])

        setLogs([...followupsData, ...clientLogsData])
      } catch (error) {
        console.error('Error loading activity logs:', error)
      } finally {
        setLoading(false)
      }
    }

    loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientNameMap])

  // Sort logs
  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      let aValue: string | number = ''
      let bValue: string | number = ''

      if (sortField === 'createdAt') {
        aValue = a.createdAt.getTime()
        bValue = b.createdAt.getTime()
      } else {
        aValue = (a[sortField] || '').toLowerCase()
        bValue = (b[sortField] || '').toLowerCase()
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }, [logs, sortField, sortDirection])

  // Paginate logs
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sortedLogs.slice(start, start + itemsPerPage)
  }, [sortedLogs, currentPage])

  const totalPages = Math.ceil(sortedLogs.length / itemsPerPage)

  // Handle sort
  const handleSort = (field: ActivitySortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Format date
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date)
  }

  // Render sort icon
  const SortIcon = ({ field }: { field: ActivitySortField }) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-primary-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-200">
              <ClockIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Log de Atividade</h3>
              <p className="text-xs text-slate-500">
                {sortedLogs.length} registro{sortedLogs.length !== 1 ? 's' : ''} encontrado{sortedLogs.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : sortedLogs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-slate-500">Nenhum registro de atividade encontrado</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-2">
                      Data e Hora
                      <SortIcon field="createdAt" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => handleSort('clientName')}
                  >
                    <div className="flex items-center gap-2">
                      Contato
                      <SortIcon field="clientName" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => handleSort('type')}
                  >
                    <div className="flex items-center gap-2">
                      Tipo
                      <SortIcon field="type" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => handleSort('author')}
                  >
                    <div className="flex items-center gap-2">
                      Autor
                      <SortIcon field="author" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">
                    Conteúdo
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map((log) => (
                  <tr key={`${log.type}-${log.id}`} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 font-medium">
                      {log.clientName}
                    </td>
                    <td className="px-4 py-3">
                      {log.type === 'followup' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">
                          <ChatBubbleIcon className="w-3 h-3" />
                          Follow-up
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-medium">
                          <ClockIcon className="w-3 h-3" />
                          Log
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {log.author}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-md truncate">
                      {log.text || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 border-t border-slate-100">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Anterior
              </button>
              <span className="text-sm text-slate-600">
                Página {currentPage} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
