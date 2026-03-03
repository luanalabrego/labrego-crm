// src/lib/callRouting.ts
// Biblioteca de integração para ligações por voz (Vapi, Google Calendar, etc.)

import { google } from 'googleapis'
import { getAdminDb } from './firebaseAdmin'
import {
  CallRoutingConfig,
  CallScript,
  CallOutcome,
  CallRecord,
  AvailableSlot,
  CallBatchTracker,
  CallOutcomeCode,
  FUNNEL_STAGES,
  NOT_CONNECTED_REASONS,
  VOICEMAIL_PHRASES,
  ENDED_REASON_MAP,
} from '@/types/callRouting'

// ========== CONFIGURAÇÕES ==========

const VAPI_API_KEY = process.env.VAPI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER

// Story 12.8: Helper functions para usar keys do org com fallback env
export function getVapiApiKey(config?: CallRoutingConfig | null): string {
  return config?.integrations?.vapi?.apiKey || VAPI_API_KEY || ''
}

export function getTwilioCredentials(config?: CallRoutingConfig | null): {
  accountSid: string; authToken: string; phoneNumber: string
} {
  return {
    accountSid: config?.integrations?.twilio?.accountSid || TWILIO_ACCOUNT_SID || '',
    authToken: config?.integrations?.twilio?.authToken || TWILIO_AUTH_TOKEN || '',
    phoneNumber: config?.integrations?.twilio?.phoneNumber || TWILIO_PHONE_NUMBER || '',
  }
}

// Google OAuth2 credentials
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const GOOGLE_OAUTH_REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary'

// URL base da aplicação (necessário para webhook do Vapi)
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
  'https://labregoia.app.br'

// Cache para evitar PATCH repetido no assistant a cada ligação
let _vapiAssistantServerUrlConfigured = false

// ========== RATE LIMIT HELPERS ==========

/**
 * Wrapper para chamadas à API do Vapi com retry automático em caso de 429 (rate limit).
 * Usa exponential backoff: 2s, 4s, 8s, 16s.
 * Respeita o header Retry-After quando disponível.
 */
async function vapiFetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 4
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options)

    if (response.status !== 429) {
      return response
    }

    // Se já esgotou os retries, retornar a resposta 429
    if (attempt === maxRetries) {
      console.warn(`[VAPI-RATE-LIMIT] Esgotou ${maxRetries} retries para ${url}`)
      return response
    }

    // Calcular delay: usar Retry-After se disponível, senão exponential backoff
    const retryAfterHeader = response.headers.get('Retry-After')
    let delayMs: number
    if (retryAfterHeader) {
      const retryAfterSec = parseInt(retryAfterHeader, 10)
      delayMs = (isNaN(retryAfterSec) ? Math.pow(2, attempt + 1) : retryAfterSec) * 1000
    } else {
      delayMs = Math.pow(2, attempt + 1) * 1000 // 2s, 4s, 8s, 16s
    }

    console.warn(`[VAPI-RATE-LIMIT] 429 recebido, retry ${attempt + 1}/${maxRetries} em ${delayMs}ms...`)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  // Fallback - não deveria chegar aqui
  return fetch(url, options)
}

/**
 * Fila serial para chamadas de polling do Vapi.
 * Garante que polling requests não sejam disparados todos em paralelo,
 * adicionando um pequeno delay entre cada requisição.
 */
const POLL_THROTTLE_MS = 500 // 500ms entre cada poll request
let _pollQueue: Promise<void> = Promise.resolve()

function throttledPoll<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _pollQueue = _pollQueue.then(async () => {
      try {
        const result = await fn()
        resolve(result)
      } catch (err) {
        reject(err)
      }
      await new Promise(r => setTimeout(r, POLL_THROTTLE_MS))
    })
  })
}

// ========== FIRESTORE HELPERS ==========

export async function getCallRoutingConfig(orgId?: string): Promise<CallRoutingConfig | null> {
  const db = getAdminDb()
  const docId = orgId || 'settings'
  const doc = await db.collection('callRoutingConfig').doc(docId).get()
  if (!doc.exists) return null
  return doc.data() as CallRoutingConfig
}

export async function saveCallRoutingConfig(config: Partial<CallRoutingConfig>, orgId?: string): Promise<void> {
  const db = getAdminDb()
  const docId = orgId || 'settings'
  await db.collection('callRoutingConfig').doc(docId).set(
    {
      ...config,
      ...(orgId ? { orgId } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  )
}

export async function getActiveCallScript(): Promise<CallScript | null> {
  const db = getAdminDb()
  const snapshot = await db
    .collection('callScripts')
    .where('isActive', '==', true)
    .limit(1)
    .get()
  if (snapshot.empty) return null
  const doc = snapshot.docs[0]
  return { id: doc.id, ...doc.data() } as CallScript
}

export async function getCallOutcomes(): Promise<CallOutcome[]> {
  const db = getAdminDb()
  const snapshot = await db
    .collection('callOutcomes')
    .orderBy('priority', 'asc')
    .get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CallOutcome))
}

export async function saveCallRecord(clientId: string, record: Omit<CallRecord, 'id'>): Promise<string> {
  const db = getAdminDb()
  const docRef = await db
    .collection('clients')
    .doc(clientId)
    .collection('calls')
    .add({
      ...record,
      createdAt: new Date().toISOString(),
    })
  return docRef.id
}

// ========== GOOGLE CALENDAR ==========

async function getCalendarClient() {
  if (!GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error('GOOGLE_OAUTH_REFRESH_TOKEN não configurado')
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET
  )

  oauth2Client.setCredentials({
    refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
  })

  return google.calendar({ version: 'v3', auth: oauth2Client })
}

// Helper: criar data em São Paulo (UTC-3)
function createSaoPauloDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const date = new Date(Date.UTC(year, month, day, hour + 3, minute, 0, 0))
  return date
}

// Helper: obter data atual em São Paulo
function getNowInSaoPaulo(): Date {
  const now = new Date()
  const spString = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  return new Date(spString)
}

// Formatar slot para fala (TTS-friendly)
export function formatSlotForSpeech(date: Date): string {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  const spDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))

  const diaSemana = dias[spDate.getDay()]
  const diaMes = spDate.getDate()
  const hora = spDate.getHours()
  const minutos = spDate.getMinutes()

  const horaFormatada = minutos === 0 ? `${hora} horas` : `${hora} e ${minutos}`

  return `${diaSemana} dia ${diaMes} às ${horaFormatada}`
}

export async function getAvailableSlots(daysAhead = 7, orgId?: string): Promise<AvailableSlot[]> {
  const config = await getCallRoutingConfig(orgId)
  const calendar = await getCalendarClient()
  const calendarId = config?.calendar?.googleCalendarId || GOOGLE_CALENDAR_ID

  const now = new Date()
  const nowSP = getNowInSaoPaulo()
  const timeMin = now.toISOString()
  const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString()

  // Buscar eventos existentes
  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const busySlots = (response.data.items || []).map(event => ({
    start: new Date(event.start?.dateTime || event.start?.date || ''),
    end: new Date(event.end?.dateTime || event.end?.date || ''),
  }))

  // Configurações de horário
  const workStart = config?.schedule?.startHour ?? 9
  const workEnd = config?.schedule?.endHour ?? 18
  const slotDuration = config?.schedule?.slotDuration ?? 30
  const workDays = config?.schedule?.workDays ?? [1, 2, 3, 4, 5]
  const bufferDays = config?.calendar?.bufferDays ?? 1

  const availableSlots: AvailableSlot[] = []

  // Começar após buffer days
  for (let d = bufferDays; d < daysAhead; d++) {
    const targetDate = new Date(nowSP)
    targetDate.setDate(targetDate.getDate() + d)

    // Pular dias não úteis
    if (!workDays.includes(targetDate.getDay())) continue

    const year = targetDate.getFullYear()
    const month = targetDate.getMonth()
    const day = targetDate.getDate()

    // Gerar slots do dia
    for (let hour = workStart; hour < workEnd; hour++) {
      for (let min = 0; min < 60; min += slotDuration) {
        const slotStart = createSaoPauloDate(year, month, day, hour, min)
        const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000)

        // Verificar se o slot está no passado
        if (slotStart < now) continue

        // Verificar se conflita com algum evento
        const isBusy = busySlots.some(
          busy =>
            (slotStart >= busy.start && slotStart < busy.end) ||
            (slotEnd > busy.start && slotEnd <= busy.end)
        )

        if (!isBusy) {
          availableSlots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            formatted: formatSlotForSpeech(slotStart),
          })
        }
      }
    }
  }

  return availableSlots
}

export async function createCalendarMeeting(
  startTime: string,
  prospectName: string,
  prospectCompany: string,
  prospectPhone?: string,
  prospectEmail?: string,
  orgId?: string
): Promise<{ id: string; htmlLink: string }> {
  const config = await getCallRoutingConfig(orgId)
  const calendar = await getCalendarClient()
  const calendarId = config?.calendar?.googleCalendarId || GOOGLE_CALENDAR_ID
  const slotDuration = config?.schedule?.slotDuration ?? 30

  const start = new Date(startTime)
  const end = new Date(start.getTime() + slotDuration * 60 * 1000)

  const event = {
    summary: `Reunião Voxium - ${prospectCompany}`,
    description: `Reunião de apresentação com ${prospectName} da ${prospectCompany}\nTelefone: ${prospectPhone || 'N/A'}`,
    start: {
      dateTime: start.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    attendees: prospectEmail ? [{ email: prospectEmail, displayName: prospectName }] : [],
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: prospectEmail ? 'all' : 'none',
  })

  return {
    id: response.data.id || '',
    htmlLink: response.data.htmlLink || '',
  }
}

// ========== VAPI INTEGRATION ==========

// Monta o system prompt completo usando agentKnowledge
function buildSystemPrompt(config: CallRoutingConfig, prospect: {
  name: string
  company?: string
  industry?: string
}): string | undefined {
  const knowledge = config.agentKnowledge
  if (!knowledge?.systemPrompt) return undefined

  const firstName = (prospect.name || '').split(' ')[0]

  // Montar contexto adicional
  const contextParts: string[] = []

  if (knowledge.agentName || knowledge.agentRole) {
    contextParts.push(`Voce e ${knowledge.agentName || 'um agente'}, ${knowledge.agentRole || 'consultor'} da ${knowledge.companyName || 'empresa'}.`)
  }

  if (knowledge.companyDescription) {
    contextParts.push(`Sobre a empresa: ${knowledge.companyDescription}`)
  }

  if (knowledge.productsServices) {
    contextParts.push(`Produtos/Servicos oferecidos: ${knowledge.productsServices}`)
  }

  if (knowledge.valueProposition) {
    contextParts.push(`Proposta de valor: ${knowledge.valueProposition}`)
  }

  if (knowledge.competitiveDifferentials) {
    contextParts.push(`Diferenciais: ${knowledge.competitiveDifferentials}`)
  }

  if (knowledge.targetAudience) {
    contextParts.push(`Publico-alvo: ${knowledge.targetAudience}`)
  }

  if (knowledge.toneOfVoice) {
    contextParts.push(`Tom de voz: ${knowledge.toneOfVoice}`)
  }

  if (knowledge.languageStyle) {
    contextParts.push(`Estilo de linguagem: ${knowledge.languageStyle}`)
  }

  if (knowledge.keyPhrases && knowledge.keyPhrases.length > 0) {
    contextParts.push(`Frases importantes para usar: ${knowledge.keyPhrases.join('; ')}`)
  }

  if (knowledge.forbiddenPhrases && knowledge.forbiddenPhrases.length > 0) {
    contextParts.push(`Frases PROIBIDAS (nunca use): ${knowledge.forbiddenPhrases.join('; ')}`)
  }

  if (knowledge.commonObjections && knowledge.commonObjections.length > 0) {
    const objections = knowledge.commonObjections
      .map(o => `- Se disser "${o.objection}": responda "${o.response}"`)
      .join('\n')
    contextParts.push(`Como lidar com objecoes:\n${objections}`)
  }

  if (knowledge.faqItems && knowledge.faqItems.length > 0) {
    const faqs = knowledge.faqItems
      .map(f => `- "${f.question}": ${f.answer}`)
      .join('\n')
    contextParts.push(`Perguntas frequentes:\n${faqs}`)
  }

  // Contexto do prospect atual
  contextParts.push(`\nInformacoes do prospect atual:`)
  contextParts.push(`- Nome: ${firstName}`)
  if (prospect.company) contextParts.push(`- Empresa: ${prospect.company}`)
  if (prospect.industry) contextParts.push(`- Setor: ${prospect.industry}`)

  // Montar prompt final
  const context = contextParts.length > 0 ? `\n\n### CONTEXTO ###\n${contextParts.join('\n\n')}` : ''

  return `${knowledge.systemPrompt}${context}`
}

// Monta a primeira mensagem usando agentKnowledge
function buildFirstMessage(config: CallRoutingConfig, prospect: {
  name: string
  company?: string
  partners?: string
}, contactName?: string): string | undefined {
  const knowledge = config.agentKnowledge
  if (!knowledge?.firstMessage) return undefined

  const firstName = (prospect.name || '').split(' ')[0]
  const greeting = getGreeting()
  const resolvedContactName = contactName || firstName

  // Substituir placeholders comuns
  return knowledge.firstMessage
    .replace(/\[Nome\]/gi, firstName)
    .replace(/\[Contato\]/gi, resolvedContactName)
    .replace(/\[Empresa\]/gi, knowledge.companyName || '')
    .replace(/\[EmpresaProspect\]/gi, prospect.company || 'sua empresa')
    .replace(/\[Saudacao\]/gi, greeting)
    .replace(/\{Nome\}/gi, firstName)
    .replace(/\{Contato\}/gi, resolvedContactName)
    .replace(/\{Empresa\}/gi, knowledge.companyName || '')
    .replace(/\{EmpresaProspect\}/gi, prospect.company || 'sua empresa')
    .replace(/\{Saudacao\}/gi, greeting)
}

/**
 * Garante que o assistant do Vapi tem o serverUrl configurado para receber webhooks.
 * Usa PATCH na API do Vapi para atualizar o assistant. Executa apenas 1x por instância.
 */
async function ensureVapiAssistantWebhook(assistantId: string): Promise<void> {
  if (_vapiAssistantServerUrlConfigured || !VAPI_API_KEY || !APP_URL) return

  const webhookUrl = `${APP_URL.replace(/\/$/, '')}/api/vapi/webhook`

  try {
    console.log(`[VAPI-CONFIG] Configurando serverUrl no assistant ${assistantId}: ${webhookUrl}`)

    const response = await vapiFetchWithRetry(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ serverUrl: webhookUrl }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[VAPI-CONFIG] Erro ao configurar serverUrl: ${response.status} - ${error}`)
      return
    }

    const result = await response.json()
    console.log(`[VAPI-CONFIG] serverUrl configurada com sucesso no assistant. serverUrl atual: ${result.serverUrl}`)
    _vapiAssistantServerUrlConfigured = true
  } catch (error) {
    console.error('[VAPI-CONFIG] Erro ao configurar assistant:', error)
  }
}

export async function makeVapiCall(prospect: {
  id: string
  name: string
  phone: string
  company?: string
  industry?: string
  partners?: string
  phoneIndex?: number // índice do telefone a usar (para multi-phone)
}, orgId?: string, cadenceOverrides?: {
  systemPrompt?: string
  firstMessage?: string
}): Promise<{ id: string; status: string }> {
  if (!VAPI_API_KEY) {
    throw new Error('VAPI_API_KEY não configurada')
  }

  // Parse múltiplos telefones
  const phones = parseMultiplePhones(prospect.phone)
  if (phones.length === 0) {
    throw new Error(
      `Nenhum telefone válido encontrado: "${prospect.phone}" - deve ter DDD + número (10-11 dígitos)`
    )
  }

  // Determinar qual telefone usar
  const phoneIndex = prospect.phoneIndex ?? 0
  if (phoneIndex >= phones.length) {
    throw new Error(
      `Índice de telefone ${phoneIndex} fora do range (total: ${phones.length} telefones)`
    )
  }

  const formattedPhone = phones[phoneIndex]
  const totalPhones = phones.length

  console.log(`[VAPI-CALL] Calling ${prospect.name} at ${formattedPhone} (phone ${phoneIndex + 1}/${totalPhones})`)

  const config = await getCallRoutingConfig(orgId)
  if (!config?.voiceAgent) {
    throw new Error('Configuração do agente de voz não encontrada')
  }

  // Garantir que o assistant do Vapi tem o serverUrl configurado para webhooks
  await ensureVapiAssistantWebhook(config.voiceAgent.vapiAssistantId)

  const greeting = getGreeting()
  const firstName = (prospect.name || '').split(' ')[0]
  const todayDate = getTodayFormatted()

  // Primeiro sócio do prospect (se houver)
  const partnerFirstName = prospect.partners
    ? (prospect.partners.split(',')[0] || '').trim().split(' ')[0]
    : ''
  // contactName: usa nome do sócio se disponível, senão usa nome do prospect
  const contactName = partnerFirstName || firstName

  // Montar overrides baseado no agentKnowledge
  const customFirstMessage = buildFirstMessage(config, prospect, contactName)
  const customSystemPrompt = buildSystemPrompt(config, prospect)

  const assistantOverrides: Record<string, any> = {
    variableValues: {
      greeting,
      todayDate,
      prospectName: contactName,
      contactName,
      prospectCompany: prospect.company || 'sua empresa',
      prospectIndustry: prospect.industry || 'seu setor',
      // Adicionar variaveis do agentKnowledge
      agentName: config.agentKnowledge?.agentName || '',
      companyName: config.agentKnowledge?.companyName || '',
    },
    metadata: {
      clientId: prospect.id,
      prospectName: prospect.name,
      prospectCompany: prospect.company || '',
      // Multi-phone support: incluir todos os telefones e índice atual
      phones: phones,
      currentPhoneIndex: phoneIndex,
    },
  }

  // Cadence overrides have priority over global config
  const finalFirstMessage = cadenceOverrides?.firstMessage || customFirstMessage
  const finalSystemPrompt = cadenceOverrides?.systemPrompt || customSystemPrompt

  // Adicionar firstMessage customizado se existir
  if (finalFirstMessage) {
    assistantOverrides.firstMessage = finalFirstMessage
    console.log(`[VAPI-CALL] Using ${cadenceOverrides?.firstMessage ? 'cadence step' : 'CRM config'} firstMessage`)
  }

  // Adicionar systemPrompt customizado se existir
  if (finalSystemPrompt) {
    // Determinar o provider baseado no nome do modelo
    const llmModel = config.voiceAgent.llmModel || 'gpt-4o'
    let provider = 'openai'
    if (llmModel.startsWith('claude') || llmModel.includes('anthropic')) {
      provider = 'anthropic'
    } else if (llmModel.startsWith('gemini') || llmModel.includes('google')) {
      provider = 'google'
    } else if (llmModel.startsWith('deepseek') || llmModel.includes('deep-seek')) {
      provider = 'deep-seek'
    } else if (llmModel.includes('groq')) {
      provider = 'groq'
    }

    assistantOverrides.model = {
      provider,
      model: llmModel,
      messages: [
        {
          role: 'system',
          content: finalSystemPrompt,
        },
      ],
    }
    console.log(`[VAPI-CALL] Using ${cadenceOverrides?.systemPrompt ? 'cadence step' : 'CRM config'} systemPrompt (provider: ${provider}, model: ${llmModel})`)
  }

  // Adicionar mensagem de despedida se existir
  if (config.agentKnowledge?.endCallMessage) {
    assistantOverrides.endCallMessage = config.agentKnowledge.endCallMessage
  }

  // Configurar messagePlan para idle messages (falar novamente quando cliente fica em silencio)
  const idleMessages = config.agentKnowledge?.idleMessages?.filter(m => m.trim())
  if (idleMessages && idleMessages.length > 0) {
    assistantOverrides.messagePlan = {
      idleMessages,
      idleTimeoutSeconds: config.agentKnowledge?.idleTimeoutSeconds ?? 5,
      idleMessageMaxSpokenCount: config.agentKnowledge?.idleMessageMaxSpokenCount ?? 3,
    }
    // Mensagem antes de encerrar por silencio
    if (config.agentKnowledge?.silenceTimeoutMessage) {
      assistantOverrides.messagePlan.silenceTimeoutMessage = config.agentKnowledge.silenceTimeoutMessage
    }
    console.log(`[VAPI-CALL] Idle messages configuradas: timeout=${config.agentKnowledge?.idleTimeoutSeconds ?? 5}s, max=${config.agentKnowledge?.idleMessageMaxSpokenCount ?? 3}`)
  }

  // Story 12.7: Override de voz se configurado
  if (config.voiceAgent.voiceId) {
    assistantOverrides.voice = {
      provider: '11labs',
      voiceId: config.voiceAgent.voiceId,
    }
  }

  // Montar payload da chamada
  const callPayload: Record<string, any> = {
    assistantId: config.voiceAgent.vapiAssistantId,
    phoneNumberId: config.voiceAgent.vapiPhoneNumberId,
    customer: { number: formattedPhone },
    assistantOverrides,
  }

  console.log('[VAPI-CALL] Payload:', JSON.stringify({
    assistantId: callPayload.assistantId,
    phoneNumberId: callPayload.phoneNumberId,
    customer: callPayload.customer,
    metadata: assistantOverrides.metadata,
  }))

  const response = await vapiFetchWithRetry('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(callPayload),
  })

  if (!response.ok) {
    const error = await response.text()
    if (response.status === 404) {
      console.error(`[VAPI-CALL] 404 - Verifique se assistantId (${callPayload.assistantId}) e phoneNumberId (${callPayload.phoneNumberId}) existem no dashboard VAPI`)
      throw new Error(`Vapi 404: assistantId ou phoneNumberId não encontrado. Verifique a configuração do agente de voz no admin.`)
    }
    throw new Error(`Vapi error: ${response.status} - ${error}`)
  }

  const result = await response.json()
  console.log(`[VAPI-CALL] Resposta Vapi:`, JSON.stringify({ id: result.id, status: result.status }))
  return result
}

/**
 * Tenta ligar para o próximo número de telefone disponível.
 * Usado pelo webhook quando uma chamada falha e há mais números para tentar.
 *
 * Esta função faz a chamada diretamente para a VAPI API, mantendo os metadados
 * corretos (array de phones e índice atual) para permitir retries subsequentes.
 */
export async function retryCallWithNextPhone(
  clientId: string,
  prospectName: string,
  prospectCompany: string | undefined,
  phones: string[],
  currentPhoneIndex: number,
  orgId?: string
): Promise<{ id: string; status: string; nextPhoneIndex: number } | null> {
  if (!VAPI_API_KEY) {
    throw new Error('VAPI_API_KEY não configurada')
  }

  const nextIndex = currentPhoneIndex + 1

  // Verificar se há mais telefones para tentar
  if (nextIndex >= phones.length) {
    console.log(`[VAPI-RETRY] Sem mais telefones para tentar (${currentPhoneIndex + 1}/${phones.length})`)
    return null
  }

  const nextPhone = phones[nextIndex]
  console.log(`[VAPI-RETRY] Tentando telefone ${nextIndex + 1}/${phones.length}: ${nextPhone}`)

  const config = await getCallRoutingConfig(orgId)
  if (!config?.voiceAgent) {
    throw new Error('Configuração do agente de voz não encontrada')
  }

  const greeting = getGreeting()
  const firstName = (prospectName || '').split(' ')[0]
  const todayDate = getTodayFormatted()

  // Montar overrides mantendo os metadados de multi-phone
  const assistantOverrides: Record<string, any> = {
    variableValues: {
      greeting,
      todayDate,
      prospectName: firstName,
      prospectCompany: prospectCompany || 'sua empresa',
      agentName: config.agentKnowledge?.agentName || '',
      companyName: config.agentKnowledge?.companyName || '',
    },
    metadata: {
      clientId,
      prospectName,
      prospectCompany: prospectCompany || '',
      // IMPORTANTE: Manter o array completo de telefones e atualizar o índice
      phones: phones,
      currentPhoneIndex: nextIndex,
    },
  }

  // Adicionar mensagem de despedida se existir
  if (config.agentKnowledge?.endCallMessage) {
    assistantOverrides.endCallMessage = config.agentKnowledge.endCallMessage
  }

  // Adicionar firstMessage se existir
  if (config.agentKnowledge?.firstMessage) {
    const customFirstMessage = config.agentKnowledge.firstMessage
      .replace(/\[Nome\]/gi, firstName)
      .replace(/\[Empresa\]/gi, config.agentKnowledge.companyName || '')
      .replace(/\[EmpresaProspect\]/gi, prospectCompany || 'sua empresa')
      .replace(/\[Saudacao\]/gi, greeting)
      .replace(/\{Nome\}/gi, firstName)
      .replace(/\{Empresa\}/gi, config.agentKnowledge.companyName || '')
      .replace(/\{EmpresaProspect\}/gi, prospectCompany || 'sua empresa')
      .replace(/\{Saudacao\}/gi, greeting)
    assistantOverrides.firstMessage = customFirstMessage
  }

  // Configurar messagePlan para idle messages (falar novamente quando cliente fica em silencio)
  const retryIdleMessages = config.agentKnowledge?.idleMessages?.filter(m => m.trim())
  if (retryIdleMessages && retryIdleMessages.length > 0) {
    assistantOverrides.messagePlan = {
      idleMessages: retryIdleMessages,
      idleTimeoutSeconds: config.agentKnowledge?.idleTimeoutSeconds ?? 5,
      idleMessageMaxSpokenCount: config.agentKnowledge?.idleMessageMaxSpokenCount ?? 3,
    }
    if (config.agentKnowledge?.silenceTimeoutMessage) {
      assistantOverrides.messagePlan.silenceTimeoutMessage = config.agentKnowledge.silenceTimeoutMessage
    }
  }

  const retryPayload: Record<string, any> = {
    assistantId: config.voiceAgent.vapiAssistantId,
    phoneNumberId: config.voiceAgent.vapiPhoneNumberId,
    customer: { number: nextPhone },
    assistantOverrides,
  }

  const response = await vapiFetchWithRetry('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(retryPayload),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Vapi retry error: ${response.status} - ${error}`)
  }

  const result = await response.json()
  return { ...result, nextPhoneIndex: nextIndex }
}

export async function getVapiCalls(limit = 50): Promise<unknown[]> {
  if (!VAPI_API_KEY) {
    throw new Error('VAPI_API_KEY não configurada')
  }

  const response = await vapiFetchWithRetry(`https://api.vapi.ai/call?limit=${limit}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  })

  if (!response.ok) throw new Error('Erro ao buscar ligações')

  return response.json()
}

/**
 * Busca detalhes de uma ligação específica na API do Vapi.
 * Usa throttling para evitar enviar muitas requests em paralelo
 * e retry com backoff em caso de 429.
 */
export async function getVapiCallDetails(callId: string): Promise<Record<string, unknown> | null> {
  if (!VAPI_API_KEY) return null

  return throttledPoll(async () => {
    const response = await vapiFetchWithRetry(`https://api.vapi.ai/call/${callId}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    })

    if (response.status === 404) {
      // Call may not be indexed yet - return null to trigger retry on next poll cycle
      console.warn(`[VAPI-POLL] Call ${callId} not found (404) - may still be initializing`)
      return null
    }

    if (!response.ok) {
      console.error(`[VAPI-POLL] Erro ao buscar call ${callId}: ${response.status}`)
      return null
    }

    return response.json()
  })
}


// ========== CLASSIFICAÇÃO POR IA ==========

export async function classifyCallResult(
  summary: string,
  endedReason: string
): Promise<CallOutcomeCode> {
  // Classificação simples primeiro (fallback)
  const simpleResult = classifyCallResultSimple(summary, endedReason)

  if (!OPENAI_API_KEY) {
    return simpleResult
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um classificador de resultados de ligações de vendas. Com base no resumo da ligação, classifique em UMA das categorias:

1. TELEFONE_INDISPONIVEL - Não conseguiu falar (caixa postal, não atendeu, linha ocupada, ligação caiu)
2. REUNIAO_AGENDADA - Cliente aceitou agendar reunião/conversa/demo
3. ENVIAR_EMAIL - Cliente pediu para enviar material/proposta por email
4. SEM_INTERESSE - Cliente disse que não tem interesse, não é prioridade, ou recusou

Responda APENAS com uma dessas palavras: TELEFONE_INDISPONIVEL, REUNIAO_AGENDADA, ENVIAR_EMAIL, SEM_INTERESSE`,
          },
          {
            role: 'user',
            content: `Motivo do encerramento: ${endedReason}\n\nResumo da ligação:\n${summary}`,
          },
        ],
        temperature: 0,
        max_tokens: 50,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`)
    }

    const data = await response.json()
    const classification = data.choices[0]?.message?.content
      ?.trim()
      .toUpperCase() as CallOutcomeCode

    if (['TELEFONE_INDISPONIVEL', 'REUNIAO_AGENDADA', 'ENVIAR_EMAIL', 'SEM_INTERESSE'].includes(classification)) {
      return classification
    }

    return simpleResult
  } catch (error) {
    console.error('Erro na classificação IA:', error)
    return simpleResult
  }
}

function classifyCallResultSimple(summary: string, endedReason: string): CallOutcomeCode {
  const summaryLower = (summary || '').toLowerCase()

  // Verificar se não conseguiu falar (incluindo caixa postal)
  const isVoicemail = VOICEMAIL_PHRASES.some(phrase => summaryLower.includes(phrase))
  if (NOT_CONNECTED_REASONS.includes(endedReason) || isVoicemail) {
    return 'TELEFONE_INDISPONIVEL'
  }

  // Verificar se agendou
  if (
    summaryLower.includes('agendou') ||
    summaryLower.includes('agendada') ||
    summaryLower.includes('agendamento') ||
    summaryLower.includes('marcou reunião') ||
    summaryLower.includes('confirmou horário')
  ) {
    return 'REUNIAO_AGENDADA'
  }

  // Verificar se pediu email
  if (
    summaryLower.includes('enviar por email') ||
    summaryLower.includes('manda por email') ||
    summaryLower.includes('envia material')
  ) {
    return 'ENVIAR_EMAIL'
  }

  return 'SEM_INTERESSE'
}

// ========== CRM INTEGRATION ==========

/**
 * Busca um cliente pelo número de telefone (fallback quando metadata não contém clientId).
 * Tenta encontrar pelo número exato ou parcial (últimos 8-9 dígitos).
 */
export async function findClientByPhone(phone: string): Promise<{ id: string; name: string } | null> {
  const db = getAdminDb()
  const digits = phone.replace(/\D/g, '')

  // Extrair últimos 8-9 dígitos para comparação parcial (sem código do país)
  const searchDigits = digits.length > 9 ? digits.slice(-9) : digits

  // Buscar em batches de 5000 para suportar bases grandes (3600+ contatos)
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null
  const batchSize = 5000

  while (true) {
    let query: FirebaseFirestore.Query = db.collection('clients').limit(batchSize)
    if (lastDoc) {
      query = query.startAfter(lastDoc)
    }
    const snapshot = await query.get()

    if (snapshot.empty) break

    for (const doc of snapshot.docs) {
      const data = doc.data()
      const clientPhone = (data.phone || '').replace(/\D/g, '')
      if (!clientPhone) continue

      // Comparação exata
      if (clientPhone === digits || clientPhone === `55${digits}` || `55${clientPhone}` === digits) {
        return { id: doc.id, name: data.name || '' }
      }

      // Comparação parcial (últimos 9 dígitos - DDD + número sem 9 ou com 9)
      const clientDigits = clientPhone.length > 9 ? clientPhone.slice(-9) : clientPhone
      if (clientDigits === searchDigits && clientDigits.length >= 8) {
        return { id: doc.id, name: data.name || '' }
      }

      // Também verificar phone2
      const clientPhone2 = (data.phone2 || '').replace(/\D/g, '')
      if (clientPhone2) {
        if (clientPhone2 === digits || clientPhone2 === `55${digits}` || `55${clientPhone2}` === digits) {
          return { id: doc.id, name: data.name || '' }
        }
        const client2Digits = clientPhone2.length > 9 ? clientPhone2.slice(-9) : clientPhone2
        if (client2Digits === searchDigits && client2Digits.length >= 8) {
          return { id: doc.id, name: data.name || '' }
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.docs.length < batchSize) break
  }

  return null
}

export async function getActiveProspects(limit = 500, orgId?: string): Promise<{
  clients: Array<{
    id: string
    name: string
    phone: string
    company?: string
    industry?: string
    email?: string
    lastFollowUpAt?: string
    partners?: string
  }>
}> {
  const db = getAdminDb()

  // Buscar ID da etapa "Prospecção ativa"
  const stageSnapshot = await db
    .collection('funnelStages')
    .where('name', '==', 'Prospecção ativa')
    .limit(1)
    .get()

  if (stageSnapshot.empty) {
    return { clients: [] }
  }

  const stageId = stageSnapshot.docs[0].id

  // Buscar clientes nessa etapa, filtrados por org se orgId fornecido
  let clientsQuery = db
    .collection('clients')
    .where('funnelStage', '==', stageId)
  if (orgId) {
    clientsQuery = clientsQuery.where('orgId', '==', orgId)
  }
  const clientsSnapshot = await clientsQuery
    .limit(limit * 2) // buscar mais para ordenar depois
    .get()

  const clients = clientsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as Array<{
    id: string
    name: string
    phone: string
    company?: string
    industry?: string
    email?: string
    lastFollowUpAt?: string
    partners?: string
  }>

  // Ordenar por lastFollowUpAt (mais antigo primeiro)
  clients.sort((a, b) => {
    const dateA = a.lastFollowUpAt ? new Date(a.lastFollowUpAt).getTime() : 0
    const dateB = b.lastFollowUpAt ? new Date(b.lastFollowUpAt).getTime() : 0
    return dateA - dateB
  })

  return { clients: clients.slice(0, limit) }
}

export async function addFollowUp(
  clientId: string,
  text: string,
  author = 'agente-voz',
  recordingUrl?: string
): Promise<void> {
  const db = getAdminDb()
  const followupData: Record<string, unknown> = {
    text,
    author,
    createdAt: new Date().toISOString(),
    type: 'call',
  }
  if (recordingUrl) {
    followupData.recordingUrl = recordingUrl
  }
  await db.collection('clients').doc(clientId).collection('followups').add(followupData)

  // Atualizar lastFollowUpAt no cliente
  await db.collection('clients').doc(clientId).update({
    lastFollowUpAt: new Date().toISOString(),
  })
}

export async function addLog(
  clientId: string,
  message: string,
  source = 'prospeccao-voz'
): Promise<void> {
  const db = getAdminDb()
  await db.collection('clients').doc(clientId).collection('logs').add({
    message,
    source,
    createdAt: new Date().toISOString(),
  })
}

export async function updateFunnelStage(
  clientId: string,
  stageId: string
): Promise<void> {
  const db = getAdminDb()
  await db.collection('clients').doc(clientId).update({
    funnelStage: stageId,
    funnelStageUpdatedAt: new Date().toISOString(),
  })
}

export function getTargetStageForOutcome(outcome: CallOutcomeCode): string {
  switch (outcome) {
    case 'TELEFONE_INDISPONIVEL':
      return FUNNEL_STAGES.TELEFONE_INDISPONIVEL
    case 'REUNIAO_AGENDADA':
      return FUNNEL_STAGES.REUNIAO_BRIEFING
    case 'ENVIAR_EMAIL':
      return FUNNEL_STAGES.ENVIAR_APRESENTACAO
    case 'SEM_INTERESSE':
      return FUNNEL_STAGES.SEM_INTERESSE
    default:
      return FUNNEL_STAGES.PROSPECCAO_ATIVA
  }
}

// ========== WHATSAPP NOTIFICATIONS ==========

export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('Twilio não configurado, pulando envio de WhatsApp')
    return
  }

  const formattedTo = to.replace(/\D/g, '')
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`

  const params = new URLSearchParams()
  params.append('From', `whatsapp:${TWILIO_PHONE_NUMBER}`)
  params.append('To', `whatsapp:+${formattedTo}`)
  params.append('Body', message)

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Twilio error: ${response.status} - ${error}`)
  }
}

export async function sendDailyReport(tracker: CallBatchTracker, orgId?: string): Promise<void> {
  const config = await getCallRoutingConfig(orgId)

  if (!config?.notifications?.whatsappReportEnabled || !config.notifications.whatsappNumber) {
    console.log('Relatório WhatsApp desabilitado')
    return
  }

  const { date, results, prospects, started } = tracker

  if (started === 0) {
    console.log('Nenhuma ligação para reportar')
    return
  }

  const outcomeLabels: Record<string, string> = {
    REUNIAO_AGENDADA: 'Reunião agendada',
    ENVIAR_EMAIL: 'Enviar e-mail',
    SEM_INTERESSE: 'Sem interesse',
    TELEFONE_INDISPONIVEL: 'Telefone indisponível',
  }

  let msg = `*RESUMO PROSPECAO - ${date}*\n\n`
  msg += `*Total de ligacoes:* ${started}\n`
  msg += `*Atenderam:* ${results.atendeu}\n`
  msg += `*Nao atenderam:* ${results.naoAtendeu}\n\n`

  if (results.atendeu > 0 && Object.keys(results.outcomes).length > 0) {
    msg += `*Resultados:*\n`
    for (const [outcome, count] of Object.entries(results.outcomes)) {
      const label = outcomeLabels[outcome] || outcome
      msg += `  ${label}: ${count}\n`
    }
  }

  msg += `\n*Detalhes:*\n`
  for (const p of prospects.slice(0, 20)) {
    const emoji = p.status === 'atendeu' ? 'V' : 'X'
    const outcome = p.outcome ? ` -> ${outcomeLabels[p.outcome] || p.outcome}` : ''
    msg += `${emoji} ${p.name}${outcome}\n`
  }

  if (prospects.length > 20) {
    msg += `... e mais ${prospects.length - 20} ligacoes\n`
  }

  await sendWhatsAppMessage(config.notifications.whatsappNumber, msg)
}

// ========== HELPERS ==========

export function getGreeting(): string {
  const hour = parseInt(
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    })
  )
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function getTodayFormatted(): string {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }
  return now.toLocaleDateString('pt-BR', options)
}

export function formatPhone(phone: string): string {
  if (!phone) return ''

  // Reject strings that are clearly not phone numbers (emails, URLs, names with letters)
  // Allow: digits, spaces, dashes, dots, parens, plus sign (common phone formatting)
  if (/[a-zA-Z@]/.test(phone)) {
    console.warn(`[CALL-ROUTING] Not a phone number, contains letters/email chars: "${phone}"`)
    return ''
  }

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')

  // If it already starts with country code 55, just add +
  if (digits.startsWith('55') && digits.length >= 12) {
    return '+' + digits
  }

  // Brazilian numbers: 10 digits (landline) or 11 digits (mobile with 9)
  // DDD (2 digits) + number (8-9 digits)
  if (digits.length === 10 || digits.length === 11) {
    return '+55' + digits
  }

  // If number has 8 or 9 digits (no DDD), we can't call it properly
  // Return empty to skip this contact
  if (digits.length < 10) {
    console.warn(`[CALL-ROUTING] Phone number too short: ${phone} -> ${digits}`)
    return ''
  }

  // For longer numbers, assume country code is already included
  if (digits.length > 11) {
    return '+' + digits
  }

  return '+55' + digits
}

export function isValidE164Phone(phone: string): boolean {
  // E.164 format: + followed by 10-15 digits
  const formatted = formatPhone(phone)
  return /^\+[1-9]\d{10,14}$/.test(formatted)
}

/**
 * Separa uma string com múltiplos telefones (separados por vírgula) em um array
 * de telefones formatados em E.164. Filtra telefones inválidos.
 *
 * Exemplo: "(11) 96724-5599,(11) 96724-6120" => ["+5511967245599", "+5511967246120"]
 */
export function parseMultiplePhones(phoneString: string): string[] {
  if (!phoneString) return []

  // Separar por vírgula, ponto e vírgula, ou barra
  const rawPhones = phoneString.split(/[,;\/]/).map(p => p.trim()).filter(Boolean)

  // Formatar e filtrar telefones válidos
  const validPhones: string[] = []
  for (const raw of rawPhones) {
    const formatted = formatPhone(raw)
    if (formatted && isValidE164Phone(raw)) {
      validPhones.push(formatted)
    } else {
      console.warn(`[MULTI-PHONE] Telefone inválido ignorado: "${raw}"`)
    }
  }

  // Remover duplicatas mantendo a ordem
  return [...new Set(validPhones)]
}

/**
 * Verifica se o contato tem múltiplos telefones
 */
export function hasMultiplePhones(phoneString: string): boolean {
  return parseMultiplePhones(phoneString).length > 1
}

/**
 * Obtém o telefone no índice especificado (com fallback para o primeiro)
 */
export function getPhoneAtIndex(phoneString: string, index: number): string | null {
  const phones = parseMultiplePhones(phoneString)
  if (phones.length === 0) return null
  if (index >= phones.length) return null
  return phones[index]
}

export function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  if (min === 0) return `${sec}s`
  return sec > 0 ? `${min}min${sec}s` : `${min}min`
}

export function getEndedReasonText(reason: string): string {
  return ENDED_REASON_MAP[reason] || reason
}
