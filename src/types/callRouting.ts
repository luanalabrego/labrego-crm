// Tipos para o sistema de Call Routing (Ligações por Voz)

// ========== WIZARD GAMIFICADO ==========

export interface AgentWizardAnswers {
  // Fase 1: Identidade
  agentName: string
  agentRole: string
  companyName: string
  toneDescription: string

  // Fase 2: Negocio
  whatYouSell: string
  idealCustomer: string
  differentials: string
  valueProposition: string

  // Fase 3: Abertura
  openingApproach: string
  hookStrategy: string

  // Fase 4: Investigacao
  discoveryQuestions: string[]
  qualificationCriteria: string

  // Fase 5: Proposta & Agendamento
  solutionBridge: string
  specialistName: string
  meetingDuration: number

  // Fase 6: Objecoes
  objections: { objection: string; response: string }[]

  // Fase 7: Linguagem & Regras
  forbiddenWords: string
  keyExpressions: string
  behaviorRules: string

  // Meta
  completedPhases: number[]
  strengthScore: number
  lastUpdated: string
  manuallyEdited?: boolean
}

// ========== CONFIGURAÇÕES ==========

export interface CallRoutingSchedule {
  enabled: boolean
  startHour: number // 0-23
  endHour: number // 0-23
  timezone: string // ex: "America/Sao_Paulo"
  workDays: number[] // 0=dom, 1=seg, ..., 6=sab
  slotDuration: number // minutos
  callInterval: number // segundos entre ligações
}

export interface CallRoutingVoiceAgent {
  vapiAssistantId: string
  vapiPhoneNumberId: string
  voiceId?: string // ElevenLabs voice ID
  llmModel: string // ex: "gpt-4o"
  sttProvider: string // ex: "deepgram"
  systemPrompt?: string
}

// Objecao do agente
export interface CallAgentObjection {
  id: string
  objection: string // Objecao comum (ex: "nao tenho tempo")
  response: string // Resposta sugerida
}

// FAQ do agente
export interface CallAgentFAQ {
  id: string
  question: string // Pergunta frequente
  answer: string // Resposta
}

// Conhecimento e instrucoes do agente de ligacao
export interface CallAgentKnowledge {
  // Identidade do Agente
  agentName: string // Nome do agente (ex: "Carol")
  agentRole: string // Funcao do agente (ex: "Consultora de Marketing")
  companyName: string // Nome da empresa
  companyDescription: string // Descricao breve da empresa

  // Mensagens e Prompts
  firstMessage: string // Primeira mensagem ao atender
  systemPrompt: string // Prompt do sistema/instrucoes gerais
  endCallMessage: string // Mensagem de despedida

  // Diretrizes de Comunicacao
  toneOfVoice: string // Tom de voz (ex: "profissional mas amigavel")
  languageStyle: string // Estilo de linguagem (ex: "formal", "informal", "tecnico")
  keyPhrases: string[] // Frases-chave para usar
  forbiddenPhrases: string[] // Frases proibidas

  // Conhecimento da Empresa
  productsServices: string // Produtos/servicos oferecidos
  targetAudience: string // Publico-alvo
  valueProposition: string // Proposta de valor
  competitiveDifferentials: string // Diferenciais competitivos

  // Tratamento de Objecoes
  commonObjections: CallAgentObjection[]

  // FAQ do Agente
  faqItems: CallAgentFAQ[]

  // Timeout de Silencio (idle messages)
  idleMessages: string[] // Mensagens que o agente fala quando o cliente fica em silencio
  idleTimeoutSeconds: number // Segundos de silencio antes de falar novamente (padrao: 5)
  idleMessageMaxSpokenCount: number // Maximo de vezes que o agente repete antes de desistir (padrao: 3)
  silenceTimeoutMessage: string // Mensagem final antes de encerrar por silencio

  // Wizard Gamificado (Story 12.1)
  wizardAnswers?: AgentWizardAnswers
}

// ========== INTEGRAÇÕES POR ORG ==========

export type IntegrationStatus = 'connected' | 'untested' | 'error'

export interface OrgIntegrations {
  vapi?: {
    apiKey: string
    assistantId: string
    phoneNumberId: string
    status?: IntegrationStatus
    lastTestedAt?: string
  }
  twilio?: {
    accountSid: string
    authToken: string
    phoneNumber: string
    status?: IntegrationStatus
  }
  elevenLabs?: {
    apiKey: string
    status?: IntegrationStatus
  }
  google?: {
    calendarId: string
    status?: IntegrationStatus
  }
}

export interface CallRoutingCalendar {
  googleCalendarId: string
  bufferDays: number // dias até primeiro slot disponível
  maxSlotsToShow: number // quantos slots mostrar ao prospect
}

export interface CallRoutingNotifications {
  whatsappReportEnabled: boolean
  whatsappNumber?: string
  emailReportEnabled: boolean
  emailAddresses?: string[]
}

export interface CallRoutingConfig {
  id?: string
  schedule: CallRoutingSchedule
  voiceAgent: CallRoutingVoiceAgent
  agentKnowledge: CallAgentKnowledge // Conhecimento e instrucoes do agente
  calendar: CallRoutingCalendar
  notifications: CallRoutingNotifications
  integrations?: OrgIntegrations // Story 12.8: chaves por org
  cronEnabled: boolean
  cronSchedule: string // formato cron: "0 9 * * 1-5"
  cronLimit: number // máximo de ligações por batch
  updatedAt?: Date | string
  updatedBy?: string
}

// Configuracao padrao do conhecimento do agente
export const DEFAULT_AGENT_KNOWLEDGE: CallAgentKnowledge = {
  agentName: '',
  agentRole: '',
  companyName: '',
  companyDescription: '',
  firstMessage: '',
  systemPrompt: '',
  endCallMessage: '',
  toneOfVoice: '',
  languageStyle: 'profissional',
  keyPhrases: [],
  forbiddenPhrases: [],
  productsServices: '',
  targetAudience: '',
  valueProposition: '',
  competitiveDifferentials: '',
  commonObjections: [],
  faqItems: [],
  idleMessages: [
    'Oi, voce ainda esta ai?',
    'Consegue me ouvir?',
    'Ola? Estou aguardando sua resposta.',
  ],
  idleTimeoutSeconds: 5,
  idleMessageMaxSpokenCount: 3,
  silenceTimeoutMessage: 'Nao consegui te ouvir, vou encerrar por aqui. Qualquer coisa pode me retornar!',
}

// ========== ROTEIROS DE VENDAS ==========

export interface CallScriptPhase {
  id: string
  order: number
  name: string
  objective: string
  prompt: string
  questions?: string[]
  examplePhrases?: string[]
  durationSeconds?: number
}

export interface CallScriptObjection {
  id: string
  trigger: string // ex: "não tenho tempo", "me manda email"
  response: string
  alternativeResponses?: string[]
}

export interface CallScript {
  id: string
  name: string
  description?: string
  isActive: boolean
  phases: CallScriptPhase[]
  objections: CallScriptObjection[]
  toneGuidelines?: string[]
  wordsToUse?: string[]
  wordsToAvoid?: string[]
  createdAt: Date | string
  updatedAt: Date | string
  createdBy?: string
}

// ========== RESULTADOS DE LIGAÇÃO ==========

export type CallOutcomeCode =
  | 'TELEFONE_INDISPONIVEL'
  | 'REUNIAO_AGENDADA'
  | 'ENVIAR_EMAIL'
  | 'SEM_INTERESSE'
  | 'CALLBACK'
  | 'DESQUALIFICADO'

export interface CallOutcome {
  id: string
  code: CallOutcomeCode
  label: string
  description?: string
  targetFunnelStageId?: string // para onde mover o lead
  createFollowup: boolean
  followupTemplate?: string // ex: "Reunião agendada para {{date}}"
  priority: number // ordem de exibição
  color: string // hex color
  icon?: string
}

// ========== ETAPAS DO FUNIL ==========

export const FUNNEL_STAGES = {
  PROSPECCAO_ATIVA: 'UvnIbksdP5RLTYED5Ls7',
  TELEFONE_INDISPONIVEL: 'icmJMFGBg4yCAlgZ957A',
  PRIMEIRO_CONTATO: 'qB1lFGTkGWWRkLfyyTEA',
  REUNIAO_BRIEFING: 'McODeXTMDLyIGWLin6rG',
  ENVIAR_APRESENTACAO: 'kAou6U9lzJ7aK9GKkONb',
  SEM_INTERESSE: 'PwNhDN5TpmFZibczzsm2',
  ON_HOLD: 'XEHpX54uoW2Au6T0ksxL',
  BARRADO_TWILIO: 'wcBPtzDxFBtDdGyB3hjx',
} as const

// ========== HISTÓRICO DE LIGAÇÕES ==========

export interface CallRecord {
  id: string
  clientId: string
  vapiCallId: string
  startedAt: Date | string
  endedAt?: Date | string
  duration?: number // segundos
  outcome?: CallOutcomeCode
  outcomeLabel?: string
  transcript?: string
  summary?: string
  endedReason?: string
  recordingUrl?: string
  meetingScheduled?: {
    date: string
    calendarEventId?: string
  }
  scriptUsed?: string
  metadata?: {
    prospectName?: string
    prospectCompany?: string
    prospectPhone?: string
    phoneIndex?: number // índice do telefone usado (0-based)
    totalPhones?: number // total de telefones disponíveis
  }
  createdAt: Date | string
}

// ========== MULTI-PHONE SUPPORT ==========

export interface PhoneAttempt {
  phone: string // número formatado E.164
  phoneIndex: number // índice no array de telefones (0-based)
  totalPhones: number // total de telefones disponíveis
}

export interface MultiPhoneMetadata {
  clientId: string
  prospectName: string
  prospectCompany?: string
  phones: string[] // array de todos os telefones formatados
  currentPhoneIndex: number // índice atual sendo tentado
}

// ========== SLOTS DE AGENDA ==========

export interface AvailableSlot {
  start: string // ISO string
  end: string // ISO string
  formatted: string // ex: "terça dia 5 às 14 horas"
}

// ========== TRACKING DE BATCH ==========

export interface CallBatchTracker {
  date: string
  batchId: string
  started: number
  pendingCallIds: string[]
  results: {
    atendeu: number
    naoAtendeu: number
    outcomes: Record<string, number>
  }
  prospects: {
    callId: string
    name: string
    status: 'pendente' | 'atendeu' | 'não atendeu'
    outcome?: CallOutcomeCode
  }[]
}

// ========== VAPI TYPES ==========

export interface VapiToolCallRequest {
  message: {
    type: 'tool-calls'
    toolCallList: {
      id: string
      function: {
        name: string
        arguments: Record<string, unknown>
      }
    }[]
    call?: {
      id: string
      customer?: { number: string }
      metadata?: {
        clientId?: string
        prospectName?: string
        prospectCompany?: string
      }
      assistantOverrides?: {
        metadata?: {
          clientId?: string
          prospectName?: string
          prospectCompany?: string
        }
      }
    }
  }
}

export interface VapiEndOfCallReport {
  message: {
    type: 'end-of-call-report'
    endedReason?: string
    transcript?: string
    summary?: string
    recordingUrl?: string
    messages?: Array<{
      role: string
      message?: string
      content?: string
      time?: number
    }>
    call?: {
      id: string
      startedAt?: string
      endedAt?: string
      endedReason?: string
      customer?: { number: string }
      metadata?: {
        clientId?: string
        prospectName?: string
        prospectCompany?: string
        phones?: string[]
        currentPhoneIndex?: number
      }
      assistantOverrides?: {
        metadata?: {
          clientId?: string
          prospectName?: string
          prospectCompany?: string
          phones?: string[]
          currentPhoneIndex?: number
        }
      }
      analysis?: {
        summary?: string
        successEvaluation?: string | boolean
      }
      artifact?: {
        recordingUrl?: string
      }
    }
  }
}

export interface VapiToolResponse {
  results: {
    toolCallId: string
    result: string
  }[]
}

// ========== RELATÓRIOS ==========

export interface CallDailyReport {
  date: string
  total: number
  atenderam: number
  naoAtenderam: number
  outcomes: Record<CallOutcomeCode, number>
  details: {
    name: string
    phone?: string
    status: 'atendeu' | 'não atendeu'
    outcome?: CallOutcomeCode
    duration?: number
  }[]
}

// ========== HELPERS ==========

export const generateCallId = (): string => {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export const OUTCOME_LABELS: Record<CallOutcomeCode, string> = {
  TELEFONE_INDISPONIVEL: 'Telefone Indisponível',
  REUNIAO_AGENDADA: 'Reunião Agendada',
  ENVIAR_EMAIL: 'Enviar E-mail',
  SEM_INTERESSE: 'Sem Interesse',
  CALLBACK: 'Retornar Ligação',
  DESQUALIFICADO: 'Desqualificado',
}

export const OUTCOME_COLORS: Record<CallOutcomeCode, string> = {
  TELEFONE_INDISPONIVEL: '#6B7280', // gray
  REUNIAO_AGENDADA: '#22C55E', // green
  ENVIAR_EMAIL: '#3B82F6', // blue
  SEM_INTERESSE: '#EF4444', // red
  CALLBACK: '#F59E0B', // yellow
  DESQUALIFICADO: '#8B5CF6', // purple
}

export const ENDED_REASON_MAP: Record<string, string> = {
  'customer-ended-call': 'Cliente desligou',
  'assistant-ended-call': 'Assistente encerrou',
  'voicemail': 'Caixa postal',
  'no-answer': 'Não atendeu',
  'busy': 'Linha ocupada',
  'failed': 'Falha na ligação',
  'customer-did-not-give-response': 'Cliente não respondeu',
  'assistant-did-not-give-response': 'Erro do assistente',
  'silence-timeout': 'Silêncio prolongado',
  'call-exceeded-max-duration': 'Tempo máximo excedido',
  'manually-canceled': 'Cancelada',
  'assistant-error': 'Erro do assistente',
  'pipeline-error': 'Erro técnico',
  'twilio-failed-to-connect-call': 'Falha ao conectar',
}

// Reasons que indicam que não conectou
export const NOT_CONNECTED_REASONS = [
  'voicemail',
  'no-answer',
  'busy',
  'failed',
  'pipeline-error',
  'manually-canceled',
  'twilio-failed-to-connect-call',
]

// Frases que indicam caixa postal no transcript
export const VOICEMAIL_PHRASES = [
  'entrego o seu recado',
  'deixe sua mensagem',
  'caixa postal',
  'voicemail',
  'telefone estiver disponível',
  'leave a message',
  'não está disponível',
]

// ========== FILA DE LIGAÇÕES ==========

export type CallQueueItemStatus = 'pending' | 'calling' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface CallQueueItem {
  id: string
  queueId: string // ID do batch/fila
  clientId: string
  name: string
  phone: string
  company?: string
  industry?: string
  partners?: string
  status: CallQueueItemStatus
  vapiCallId?: string
  outcome?: CallOutcomeCode
  outcomeLabel?: string
  duration?: number
  error?: string
  position: number // posição na fila (ordem)
  createdAt: string
  updatedAt: string
  startedAt?: string
  endedAt?: string
  // Cadence fields (populated when queue is created from cadence)
  cadenceStepId?: string
  stageId?: string
  cadenceOverrides?: {
    systemPrompt?: string
    firstMessage?: string
  }
}

export type CallQueueStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled'

export interface CallQueue {
  id: string
  status: CallQueueStatus
  type?: 'manual' | 'cadence'
  maxConcurrent: number // máximo de ligações simultâneas (default 10)
  totalItems: number
  completedItems: number
  failedItems: number
  activeCallsCount: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  callStaggerDelayMs?: number // Delay entre ligações consecutivas (default: 10000 = 10s)
  lastCallStartedAt?: string // Timestamp da última ligação iniciada
}
