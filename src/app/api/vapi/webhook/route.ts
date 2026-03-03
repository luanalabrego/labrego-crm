import { NextRequest, NextResponse } from 'next/server'
import {
  classifyCallResult,
  addFollowUp,
  addLog,
  updateFunnelStage,
  getTargetStageForOutcome,
  saveCallRecord,
  formatDuration,
  getEndedReasonText,
  getAvailableSlots,
  createCalendarMeeting,
  formatSlotForSpeech,
  retryCallWithNextPhone,
  findClientByPhone,
} from '@/lib/callRouting'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { onCallCompleted, onCallFailed } from '@/lib/callQueue'
import {
  VapiToolCallRequest,
  VapiEndOfCallReport,
  VapiToolResponse,
  NOT_CONNECTED_REASONS,
  CallOutcomeCode,
} from '@/types/callRouting'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolve orgId from the client document being updated.
 * Webhooks don't have user auth, so we extract orgId from the client's data.
 */
async function resolveOrgIdFromClient(clientId: string): Promise<string> {
  try {
    const db = getAdminDb()
    const clientDoc = await db.collection('clients').doc(clientId).get()
    if (clientDoc.exists) {
      const orgId = clientDoc.data()?.orgId
      if (orgId) return orgId
    }
  } catch (error) {
    console.error('[VAPI WEBHOOK] Error resolving orgId from client:', error)
  }
  const fallback = process.env.DEFAULT_ORG_ID || ''
  if (fallback) {
    console.warn('[VAPI WEBHOOK] Using DEFAULT_ORG_ID fallback for client:', clientId)
  }
  return fallback
}

// GET - Health check para verificar se o webhook está acessível
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/vapi/webhook',
    timestamp: new Date().toISOString(),
    message: 'Webhook do Vapi está ativo e pronto para receber chamadas',
  })
}

// POST - Webhook principal do Vapi
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messageType = body.message?.type

    // Tool calls - consultar agenda ou agendar reunião
    if (messageType === 'tool-calls') {
      return handleToolCalls(body as VapiToolCallRequest)
    }

    // End of call - registrar resultado no CRM
    if (messageType === 'end-of-call-report') {
      return handleEndOfCall(body as VapiEndOfCallReport)
    }

    // Outros eventos (assistant-request, status-update, etc.)
    return NextResponse.json({ status: 'received' })
  } catch (error) {
    console.error('[VAPI WEBHOOK] ❌ ERRO FATAL no webhook:', error)
    return NextResponse.json({ status: 'error', message: String(error) })
  }
}

// Handle tool calls (getAvailableSlots, scheduleMeeting)
async function handleToolCalls(body: VapiToolCallRequest): Promise<NextResponse<VapiToolResponse>> {
  const toolCall = body.message?.toolCallList?.[0]
  const functionName = toolCall?.function?.name
  const toolCallId = toolCall?.id
  const args = toolCall?.function?.arguments || {}

  // Multi-tenant: resolve orgId from call metadata or client doc
  const callMetadata = body.message?.call?.metadata || body.message?.call?.assistantOverrides?.metadata || {}
  let orgId = (callMetadata as Record<string, unknown>).orgId as string | undefined
  if (!orgId && (callMetadata as Record<string, unknown>).clientId) {
    orgId = await resolveOrgIdFromClient((callMetadata as Record<string, unknown>).clientId as string) || undefined
  }
  if (!orgId) {
    orgId = process.env.DEFAULT_ORG_ID || undefined
    if (orgId) console.warn('[VAPI WEBHOOK] handleToolCalls: Using DEFAULT_ORG_ID fallback')
  }

  // Buscar horários disponíveis
  if (functionName === 'getAvailableSlots') {
    try {
      const slots = await getAvailableSlots(7, orgId)
      const nextSlots = slots.slice(0, 3)

      const responseText =
        nextSlots.length > 0
          ? `Tenho três opções: ${nextSlots.map((s, i) => `${i + 1}, ${s.formatted}`).join('. ')}. Qual funciona melhor pra você?`
          : 'No momento não tenho horários disponíveis. Posso te retornar quando tiver uma vaga?'

      return NextResponse.json({
        results: [{ toolCallId: toolCallId || '', result: responseText }],
      })
    } catch (error) {
      console.error('[VAPI WEBHOOK] Error getting slots:', error)
      return NextResponse.json({
        results: [
          {
            toolCallId: toolCallId || '',
            result: 'Desculpe, não consegui acessar a agenda no momento. Podemos confirmar o horário por WhatsApp?',
          },
        ],
      })
    }
  }

  // Agendar reunião
  if (functionName === 'scheduleMeeting') {
    try {
      const meetingMetadata = body.message?.call?.metadata || body.message?.call?.assistantOverrides?.metadata || {}
      const customerPhone = body.message?.call?.customer?.number

      const startTime = args.startTime as string
      const prospectEmail = args.prospectEmail as string | undefined
      const prospectName = (args.prospectName as string) || meetingMetadata.prospectName || 'Prospect'
      const prospectCompany = (args.prospectCompany as string) || meetingMetadata.prospectCompany || 'Empresa'
      const prospectPhone = (args.prospectPhone as string) || customerPhone

      if (!startTime) {
        return NextResponse.json({
          results: [
            {
              toolCallId: toolCallId || '',
              result: 'Preciso do horário para agendar. Qual horário você prefere?',
            },
          ],
        })
      }

      const event = await createCalendarMeeting(
        startTime,
        prospectName,
        prospectCompany,
        prospectPhone,
        prospectEmail,
        orgId
      )

      const meetingDate = new Date(startTime)
      const formatted = formatSlotForSpeech(meetingDate)
      const confirmationMsg = prospectEmail
        ? `Você vai receber o convite no seu email ${prospectEmail}.`
        : `Vou enviar uma confirmação por WhatsApp.`

      const responseText = `Reunião agendada com sucesso para ${formatted}. ${confirmationMsg}`

      return NextResponse.json({
        results: [{ toolCallId: toolCallId || '', result: responseText }],
      })
    } catch (error) {
      console.error('[VAPI WEBHOOK] Error scheduling meeting:', error)
      return NextResponse.json({
        results: [
          {
            toolCallId: toolCallId || '',
            result: 'Houve um problema ao agendar. Vou confirmar o horário por WhatsApp, ok?',
          },
        ],
      })
    }
  }

  // Tool não reconhecida
  return NextResponse.json({
    results: [
      {
        toolCallId: toolCallId || '',
        result: 'Função não reconhecida.',
      },
    ],
  })
}

// Handle end of call report
async function handleEndOfCall(body: VapiEndOfCallReport): Promise<NextResponse> {
  try {
    const message = body.message || {}
    const call = message.call

    const callId = call?.id

    // Vapi promove assistantOverrides.metadata para call.metadata no webhook
    // Checar ambos os caminhos para garantir compatibilidade
    const metadata = call?.metadata || call?.assistantOverrides?.metadata || {}
    let { clientId } = metadata
    const { prospectName, prospectCompany, phones, currentPhoneIndex } = metadata

    // Multi-tenant: resolve orgId from metadata or client doc (for logging/context)
    let orgId = (metadata as Record<string, unknown>).orgId as string | undefined

    // ===== EXTRAIR DADOS DE TODOS OS CAMINHOS POSSÍVEIS =====
    // O Vapi envia summary e transcript tanto no nível da mensagem quanto dentro de call.analysis
    // Priorizar message-level (mais confiável) com fallback para call.analysis
    const summary = message.summary || call?.analysis?.summary || ''
    const transcript = message.transcript || ''
    const endedReason = message.endedReason || call?.endedReason || 'unknown'
    const recordingUrl = message.recordingUrl || ''

    // Calcular duração
    let durationSec = 0
    if (call?.startedAt && call?.endedAt) {
      durationSec = Math.round(
        (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      )
    }

    const reasonText = getEndedReasonText(endedReason)
    const notConnected = NOT_CONNECTED_REASONS.includes(endedReason)

    // Se teve conversa (resumo ou transcript existe, ou duração > 10s), a ligação conectou
    // mesmo que endedReason indique erro (ex: pipeline-error após conexão)
    const callHadConversation = summary.length > 0 || transcript.length > 0 || durationSec > 10

    // ===== FALLBACK: BUSCAR clientId PELO TELEFONE =====
    // Se metadata não contém clientId (Vapi pode não promover assistantOverrides.metadata),
    // tentar encontrar o cliente pelo número de telefone
    const customerPhone = call?.customer?.number
    if (!clientId && customerPhone) {
      try {
        const foundClient = await findClientByPhone(customerPhone)
        if (foundClient) {
          clientId = foundClient.id
        }
      } catch (lookupError) {
        console.error('[VAPI WEBHOOK] Error looking up client by phone:', lookupError)
      }
    }

    // Multi-tenant: resolve orgId from client doc if not in metadata
    if (!orgId && clientId) {
      orgId = await resolveOrgIdFromClient(clientId) || undefined
    }
    if (!orgId) {
      orgId = process.env.DEFAULT_ORG_ID || undefined
      if (orgId) console.warn('[VAPI WEBHOOK] handleEndOfCall: Using DEFAULT_ORG_ID fallback')
    }

    // Multi-phone info
    const phoneIndex = currentPhoneIndex ?? 0
    const totalPhones = phones?.length ?? 1
    const hasMorePhones = phones && phones.length > 0 && phoneIndex < phones.length - 1

    // ===== MULTI-PHONE FALLBACK =====
    // Só tenta próximo telefone se realmente não conectou (sem conversa)
    // Se a ligação teve conversa e caiu, registra resultado em vez de tentar outro telefone
    if (notConnected && !callHadConversation && hasMorePhones && clientId && phones) {

      try {
        const retryResult = await retryCallWithNextPhone(
          clientId,
          prospectName || 'Prospect',
          prospectCompany,
          phones,
          phoneIndex
        )

        if (retryResult) {
          // Registrar log da tentativa
          await addLog(
            clientId,
            `Telefone ${phoneIndex + 1}/${totalPhones} não atendeu (${reasonText}). Tentando telefone ${phoneIndex + 2}/${totalPhones}...`,
            'vapi-webhook-retry'
          )

          return NextResponse.json({
            status: 'received',
            retry: {
              initiated: true,
              newCallId: retryResult.id,
              phoneIndex: retryResult.nextPhoneIndex,
              totalPhones,
            },
          })
        }
      } catch (retryError) {
        console.error('[VAPI WEBHOOK] Erro ao tentar próximo telefone:', retryError)
        // Continua o fluxo normal se o retry falhar
      }
    }

    // ===== REGISTRAR RESULTADO NO CRM (SEMPRE) =====
    if (clientId) {
      // Classificar resultado usando IA
      let classification: CallOutcomeCode = 'TELEFONE_INDISPONIVEL'
      try {
        // Usar summary e transcript para classificação mais precisa
        const classificationInput = summary || transcript
        classification = await classifyCallResult(classificationInput, endedReason)
      } catch (classifyError) {
        // Fallback: se não conectou = TELEFONE_INDISPONIVEL, senão = SEM_INTERESSE
        classification = notConnected && !callHadConversation ? 'TELEFONE_INDISPONIVEL' : 'SEM_INTERESSE'
        console.error('[VAPI WEBHOOK] Error classifying, using fallback:', classification, classifyError)
      }

      // Mapear classificação para resultado
      let resultado: string
      switch (classification) {
        case 'TELEFONE_INDISPONIVEL':
          resultado = `Não foi possível falar (${reasonText})`
          if (totalPhones > 1) {
            resultado += ` - tentou ${phoneIndex + 1}/${totalPhones} telefones`
          }
          break
        case 'REUNIAO_AGENDADA':
          resultado = 'Cliente aceitou agendar reunião'
          break
        case 'ENVIAR_EMAIL':
          resultado = 'Cliente pediu para enviar material por email'
          break
        case 'SEM_INTERESSE':
        default:
          resultado = 'Sem interesse no momento'
          break
      }

      // Montar follow-up apenas com resumo (transcricao completa fica no CallRecord)
      const phoneInfo = totalPhones > 1 ? `\nTelefone: ${phoneIndex + 1}/${totalPhones}` : ''

      const followupParts = [
        `Ligação de prospecção`,
        ``,
        `Duração: ${formatDuration(durationSec)}`,
        `Resultado: ${resultado}${phoneInfo}`,
      ]

      if (summary) {
        followupParts.push(``, `Resumo: ${summary}`)
      } else {
        followupParts.push(``, `Resumo: Não disponível`)
      }

      const followupText = followupParts.join('\n')

      // Cada operação CRM isolada para que uma falha não impeça as demais

      // 1. Registrar follow-up
      try {
        await addFollowUp(clientId, followupText, 'agente-voz', recordingUrl || undefined)
      } catch (followupError) {
        console.error('[VAPI WEBHOOK] Error adding follow-up:', followupError)
      }

      // 2. Mover lead para próxima etapa (respeitar cadência)
      try {
        const db = getAdminDb()
        const clientDoc = await db.collection('clients').doc(clientId).get()
        const clientData = clientDoc.data()
        const isInCadence = !!clientData?.currentCadenceStepId

        if (isInCadence) {
          // Contato em cadência — NÃO mover automaticamente
          if (classification !== 'TELEFONE_INDISPONIVEL') {
            // Houve conversa — marcar como respondeu + salvar dados para IA decidir etapa
            await db.collection('clients').doc(clientId).update({
              lastCadenceStepResponded: true,
              cadencePendingCallResult: false,
              lastCadenceOutcome: classification,
              lastCadenceCallSummary: (summary || transcript).slice(0, 500),
            })
            console.log(`[VAPI WEBHOOK] Cadence contact responded: ${classification} — IA will decide stage`)
          } else {
            // Não atendeu — liberar cadência para avançar no próximo cron
            await db.collection('clients').doc(clientId).update({
              cadencePendingCallResult: false,
            })
            console.log(`[VAPI WEBHOOK] Cadence contact not reached (${endedReason}) — cadence will advance`)
          }
        } else {
          // Fora de cadência — comportamento legado (hardcoded)
          const nextStage = getTargetStageForOutcome(classification)
          await updateFunnelStage(clientId, nextStage)
        }
      } catch (stageError) {
        console.error('[VAPI WEBHOOK] Error moving stage:', stageError)
      }

      // 3. Registrar log
      try {
        await addLog(clientId, `Ligação: ${resultado}`, 'vapi-webhook')
      } catch (logError) {
        console.error('[VAPI WEBHOOK] Error adding log:', logError)
      }

      // 4. Salvar registro da ligação
      try {
        await saveCallRecord(clientId, {
          clientId,
          vapiCallId: callId || '',
          startedAt: call?.startedAt || new Date().toISOString(),
          endedAt: call?.endedAt,
          duration: durationSec,
          outcome: classification,
          outcomeLabel: resultado,
          transcript,
          summary,
          endedReason,
          metadata: {
            prospectName,
            prospectCompany,
            prospectPhone: customerPhone,
            phoneIndex,
            totalPhones,
          },
          createdAt: new Date().toISOString(),
        })
      } catch (recordError) {
        console.error('[VAPI WEBHOOK] Error saving call record:', recordError)
      }

    } else {
      console.error('[VAPI WEBHOOK] No clientId found, skipping CRM update')
    }

    // ===== AVANÇAR FILA DE LIGAÇÕES =====
    // Notifica o sistema de fila que esta ligação terminou,
    // para que a próxima ligação pendente seja disparada automaticamente
    if (callId) {
      try {
        const classification = clientId
          ? await classifyCallResult(summary || transcript, endedReason).catch(() => 'TELEFONE_INDISPONIVEL' as CallOutcomeCode)
          : ('TELEFONE_INDISPONIVEL' as CallOutcomeCode)

        if (notConnected && !callHadConversation) {
          await onCallFailed({ vapiCallId: callId, error: reasonText })
        } else {
          await onCallCompleted({
            vapiCallId: callId,
            outcome: classification,
            outcomeLabel: reasonText,
            duration: durationSec,
          })
        }
      } catch (queueError) {
        console.error('[VAPI WEBHOOK] Erro ao avançar fila:', queueError)
      }
    }

    return NextResponse.json({ status: 'received' })
  } catch (error) {
    console.error('[VAPI WEBHOOK] Error processing end of call:', error)
    return NextResponse.json({ status: 'error', message: String(error) })
  }
}
