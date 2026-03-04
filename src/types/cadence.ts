/* ═══════════════════════════════════════════════════════════ */
/*  Cadence Automation Types                                  */
/* ═══════════════════════════════════════════════════════════ */

export type ContactMethod = 'whatsapp' | 'email' | 'phone' | 'meeting'
export type CadenceType = 'normal' | 'reengagement'

export interface CadenceStep {
  id: string
  orgId: string
  stageId: string
  order: number
  name: string
  contactMethod: ContactMethod
  daysAfterPrevious: number
  objective?: string
  messageTemplate?: string
  twilioTemplateSid?: string
  isActive: boolean
  parentStepId?: string
  condition?: 'responded' | 'not_responded'
  cadenceType?: CadenceType

  // Automation fields
  emailSubject?: string
  emailBody?: string
  vapiSystemPrompt?: string
  vapiFirstMessage?: string
  retryCount?: number
  lastRetryAt?: string
}

export interface ReengagementConfig {
  id: string
  orgId: string
  enabled: boolean
  inactiveDays: number
  includeLost: boolean
  maxCycles: number
  steps: ReengagementStep[]
  createdAt: string
  updatedAt: string
}

export interface ReengagementStep {
  id: string
  order: number
  name: string
  contactMethod: ContactMethod
  daysAfterPrevious: number
  messageTemplate?: string
  emailSubject?: string
  emailBody?: string
  isActive: boolean
}

export interface ReengagementEnrollment {
  id: string
  orgId: string
  contactId: string
  contactName: string
  configId: string
  currentStepIndex: number
  cycle: number
  status: 'active' | 'responded' | 'completed' | 'max_cycles'
  enrolledAt: string
  lastStepAt?: string
  respondedAt?: string
  reason: 'inactive' | 'lost'
}

export interface CadenceExecutionLog {
  id: string
  orgId: string
  clientId: string
  clientName: string
  stepId: string
  stepName: string
  stageId: string
  stageName: string
  channel: ContactMethod
  status: 'success' | 'failed' | 'retry_pending' | 'retry_failed'
  error?: string
  executedAt: string
  retryCount: number
}

export type CadenceExhaustedAction = 'keep' | 'move' | 'notify'

export interface StageAutomationConfig {
  cadenceExhaustedAction: CadenceExhaustedAction
  cadenceExhaustedTargetStageId?: string
  // Per-stage call scheduling (overrides org-level when set)
  callStartHour?: string    // e.g. "09:00"
  callEndHour?: string      // e.g. "18:00"
  maxCallsPerDay?: number   // e.g. 200
}

export interface AutomationConfig {
  enabled: boolean
  pausedStageIds: string[]
  workHoursStart: string
  workHoursEnd: string
  timezone: string
  maxActionsPerDay: number
  maxConcurrentCalls: number
  maxCallsPerDay: number
  callStaggerDelayMs?: number // Delay between consecutive calls (default: 10000 = 10s)
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  enabled: false,
  pausedStageIds: [],
  workHoursStart: '08:00',
  workHoursEnd: '18:00',
  timezone: 'America/Sao_Paulo',
  maxActionsPerDay: 100,
  maxConcurrentCalls: 10,
  maxCallsPerDay: 300,
}

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  phone: 'Ligação',
  meeting: 'Reunião',
}

export const CONTACT_METHOD_COLORS: Record<ContactMethod, string> = {
  whatsapp: 'bg-green-50 text-green-700 border-green-200',
  email: 'bg-blue-50 text-blue-700 border-blue-200',
  phone: 'bg-primary-50 text-primary-700 border-primary-200',
  meeting: 'bg-amber-50 text-amber-700 border-amber-200',
}

export const CADENCE_VARIABLES = [
  { key: '{{nome}}', label: 'Nome do contato' },
  { key: '{{empresa}}', label: 'Empresa' },
  { key: '{{email}}', label: 'Email' },
  { key: '{{telefone}}', label: 'Telefone' },
  { key: '{{segmento}}', label: 'Segmento' },
  { key: '{{responsavel}}', label: 'Responsável' },
]

export function replaceCadenceVariables(template: string, contact: Record<string, unknown>): string {
  return template
    .replace(/\{\{nome\}\}/g, (contact.name as string) || '')
    .replace(/\{\{empresa\}\}/g, (contact.company as string) || '')
    .replace(/\{\{email\}\}/g, (contact.email as string) || '')
    .replace(/\{\{telefone\}\}/g, (contact.phone as string) || '')
    .replace(/\{\{segmento\}\}/g, (contact.industry as string) || '')
    .replace(/\{\{responsavel\}\}/g, (contact.assignedToName as string) || '')
}
