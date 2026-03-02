import { getAdminDb } from './firebaseAdmin'
import { makeVapiCall, sendWhatsAppMessage } from './callRouting'
import { sendEmail } from './email'
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
      return executeWhatsAppStep(step, contact)
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

  try {
    await makeVapiCall({
      id: contact.id,
      name: (contact.name as string) || '',
      phone,
      company: (contact.company as string) || undefined,
      industry: (contact.industry as string) || undefined,
    }, orgId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro na ligação VAPI' }
  }
}

async function executeWhatsAppStep(step: CadenceStep, contact: Contact): Promise<ExecutionResult> {
  const phone = contact.phone as string
  if (!phone) return { success: false, error: 'Contato sem telefone' }

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
    createdAt: new Date().toISOString(),
  })
}
