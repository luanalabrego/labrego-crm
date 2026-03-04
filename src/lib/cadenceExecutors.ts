import { getAdminDb } from './firebaseAdmin'
import { makeVapiCall, sendWhatsAppMessage } from './callRouting'
import { sendEmail } from './email'
import { canMakeCall, canSendWhatsApp, deductAction } from './credits'
import { replaceCadenceVariables, type CadenceStep, type ContactMethod } from '@/types/cadence'
import React from 'react'

type Contact = Record<string, unknown> & { id: string }

export interface ExecutionResult {
  success: boolean
  error?: string
}

/**
 * Execute a cadence step for a contact using the appropriate channel.
 */
export async function executeCadenceStep(
  step: CadenceStep,
  contact: Contact,
  orgId: string
): Promise<ExecutionResult> {
  switch (step.contactMethod) {
    case 'phone':
      return executePhoneStep(step, contact, orgId)
    case 'whatsapp':
      return executeWhatsAppStep(step, contact, orgId)
    case 'email':
      return executeEmailStep(step, contact)
    case 'meeting':
      return executeMeetingStep(step, contact, orgId)
    default:
      return { success: false, error: `Canal desconhecido: ${step.contactMethod}` }
  }
}

async function executePhoneStep(step: CadenceStep, contact: Contact, orgId?: string): Promise<ExecutionResult> {
  const phone = contact.phone as string
  if (!phone) return { success: false, error: 'Contato sem telefone' }

  // Verificar créditos antes de ligar (ação + minutos)
  if (orgId) {
    const creditCheck = await canMakeCall(orgId)
    if (!creditCheck.allowed) {
      return { success: false, error: creditCheck.reason || 'Créditos insuficientes' }
    }
    // Debitar 1 ação (call) antes de iniciar
    await deductAction(orgId, 'call', contact.id, `Ligação cadência: ${contact.name || contact.id}`)
  }

  try {
    // Pass cadence step overrides for system prompt and first message
    const cadenceOverrides = (step.vapiSystemPrompt || step.vapiFirstMessage)
      ? {
          systemPrompt: step.vapiSystemPrompt || undefined,
          firstMessage: step.vapiFirstMessage || undefined,
        }
      : undefined

    await makeVapiCall({
      id: contact.id,
      name: (contact.name as string) || '',
      phone,
      company: (contact.company as string) || undefined,
      industry: (contact.industry as string) || undefined,
    }, orgId, cadenceOverrides)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro na ligação VAPI' }
  }
}

async function executeWhatsAppStep(step: CadenceStep, contact: Contact, orgId?: string): Promise<ExecutionResult> {
  const phone = contact.phone as string
  if (!phone) return { success: false, error: 'Contato sem telefone' }

  // Verificar créditos de ação antes de enviar
  if (orgId) {
    const creditCheck = await canSendWhatsApp(orgId)
    if (!creditCheck.allowed) {
      return { success: false, error: creditCheck.reason || 'Créditos insuficientes' }
    }
    await deductAction(orgId, 'whatsapp', contact.id, `WhatsApp cadência: ${contact.name || contact.id}`)
  }

  const template = step.messageTemplate || ''
  const message = replaceCadenceVariables(template, contact)

  try {
    await sendWhatsAppMessage(phone, message)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro no WhatsApp' }
  }
}

async function executeEmailStep(step: CadenceStep, contact: Contact): Promise<ExecutionResult> {
  const email = contact.email as string
  if (!email) return { success: false, error: 'Contato sem email' }

  const subject = replaceCadenceVariables(step.emailSubject || step.name || '', contact)
  const bodyHtml = replaceCadenceVariables(step.emailBody || step.messageTemplate || '', contact)

  try {
    // Create a simple HTML email element
    const emailElement = React.createElement('div', {
      dangerouslySetInnerHTML: { __html: bodyHtml },
    })
    await sendEmail({ to: email, subject, react: emailElement })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro no email' }
  }
}

async function executeMeetingStep(step: CadenceStep, contact: Contact, orgId: string): Promise<ExecutionResult> {
  // Meeting steps create a notification for the responsible user
  const db = getAdminDb()
  const assignedTo = contact.assignedTo as string

  if (assignedTo) {
    await db.collection('organizations').doc(orgId).collection('notifications').add({
      userId: assignedTo,
      type: 'cadence_meeting',
      title: 'Reunião de cadência pendente',
      message: `Agendar reunião com ${(contact.name as string) || 'contato'} — ${step.name}`,
      contactId: contact.id,
      stepId: step.id,
      read: false,
      createdAt: new Date().toISOString(),
    })
  }

  return { success: true }
}

/**
 * Use AI to determine the best funnel stage for a contact that responded to cadence.
 */
export async function determineBestStage(
  outcome: string,
  callSummary: string,
  availableStages: { id: string; name: string }[]
): Promise<string> {
  if (availableStages.length === 0) return ''

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    return fallbackStageSelection(outcome, availableStages)
  }

  const stageList = availableStages
    .map(s => `- "${s.name}" (ID: ${s.id})`)
    .join('\n')

  const prompt = `Você é um assistente de CRM de vendas. Com base no resultado da ligação, determine a etapa mais adequada do funil para mover o contato.

Resultado da ligação: ${outcome}
Resumo da conversa: ${callSummary || 'Não disponível'}

Etapas disponíveis no funil:
${stageList}

Regras:
- REUNIAO_AGENDADA → etapa de reunião/briefing/demo
- ENVIAR_EMAIL → etapa de envio de material/apresentação
- SEM_INTERESSE → etapa de sem interesse/descartado/perdido
- Se nenhuma etapa parecer adequada, escolha a mais próxima

Responda APENAS com o ID da etapa escolhida, nada mais.`

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await resp.json()
    const answer = (data.choices?.[0]?.message?.content || '').trim()

    // Validate the returned ID exists in available stages
    const validStage = availableStages.find(s => answer.includes(s.id))
    if (validStage) return validStage.id

    console.warn(`[CADENCE-AI] Invalid stage ID from AI: "${answer}", using fallback`)
    return fallbackStageSelection(outcome, availableStages)
  } catch (err) {
    console.error('[CADENCE-AI] OpenAI error, using fallback:', err)
    return fallbackStageSelection(outcome, availableStages)
  }
}

function fallbackStageSelection(
  outcome: string,
  stages: { id: string; name: string }[]
): string {
  const matchByKeywords = (keywords: string[]) =>
    stages.find(s => keywords.some(k => s.name.toLowerCase().includes(k)))

  switch (outcome) {
    case 'REUNIAO_AGENDADA':
      return matchByKeywords(['reunião', 'reuniao', 'briefing', 'demo', 'qualificado'])?.id || stages[0]?.id || ''
    case 'ENVIAR_EMAIL':
      return matchByKeywords(['email', 'apresentação', 'apresentacao', 'material', 'enviar'])?.id || stages[0]?.id || ''
    case 'SEM_INTERESSE':
      return matchByKeywords(['sem interesse', 'descartado', 'perdido', 'inativo'])?.id || stages[0]?.id || ''
    default:
      return stages[0]?.id || ''
  }
}

/**
 * Log a cadence execution in the contact's activity log.
 */
export async function logCadenceExecution(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  clientId: string,
  data: {
    stepId: string
    stepName: string
    channel: ContactMethod
    stageId: string
    stageName: string
    success: boolean
    error?: string
    templatePreview?: string
  }
): Promise<void> {
  const action = data.success
    ? `cadence_auto_${data.channel}`
    : 'cadence_auto_error'

  const message = data.success
    ? `Cadência automática: ${data.stepName} via ${data.channel}`
    : `Cadência falhou: ${data.stepName} via ${data.channel} — ${data.error}`

  const now = new Date().toISOString()

  await db.collection('clients').doc(clientId).collection('logs').add({
    action,
    message,
    type: 'cadence',
    author: 'Sistema (Cadência automática)',
    metadata: {
      stepId: data.stepId,
      stepName: data.stepName,
      channel: data.channel,
      stageId: data.stageId,
      stageName: data.stageName,
      templatePreview: data.templatePreview || '',
      error: data.error || '',
    },
    createdAt: now,
  })

  // Atualizar lastFollowUpAt para refletir atividade recente no card do funil
  if (data.success) {
    await db.collection('clients').doc(clientId).update({
      lastFollowUpAt: now,
    })
  }
}
