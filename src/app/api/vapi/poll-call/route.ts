import { NextRequest, NextResponse } from 'next/server'
import {
  getVapiCallDetails,
  classifyCallResult,
  addFollowUp,
  addLog,
  updateFunnelStage,
  getTargetStageForOutcome,
  saveCallRecord,
  formatDuration,
  getEndedReasonText,
  retryCallWithNextPhone,
} from '@/lib/callRouting'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { onCallCompleted, onCallFailed } from '@/lib/callQueue'
import { deductCredits } from '@/lib/credits'
import { NOT_CONNECTED_REASONS, CallOutcomeCode } from '@/types/callRouting'
import { resolveOrgByEmail, getOrgIdFromHeaders } from '@/lib/orgResolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/vapi/poll-call?callId=xxx&clientId=xxx
 *
 * Verifica status da ligação na API do Vapi.
 * Quando a ligação termina, processa o resultado e atualiza o CRM.
 * O frontend chama este endpoint periodicamente até receber status "completed".
 */
export async function GET(req: NextRequest) {
  const callId = req.nextUrl.searchParams.get('callId')
  const clientId = req.nextUrl.searchParams.get('clientId')
  const prospectName = req.nextUrl.searchParams.get('prospectName') || undefined
  const prospectCompany = req.nextUrl.searchParams.get('prospectCompany') || undefined
  const phonesParam = req.nextUrl.searchParams.get('phones') || ''
  const phoneIndex = parseInt(req.nextUrl.searchParams.get('phoneIndex') || '0', 10)

  // Multi-tenant: resolve orgId from header, query param, or client doc
  let orgId = getOrgIdFromHeaders(req.headers)
    || req.nextUrl.searchParams.get('orgId')
    || null
  const email = req.headers.get('x-user-email')
  if (!orgId && email) {
    const ctx = await resolveOrgByEmail(email)
    if (ctx) orgId = ctx.orgId
  }
  if (!orgId && clientId) {
    try {
      const db = getAdminDb()
      const clientDoc = await db.collection('clients').doc(clientId).get()
      if (clientDoc.exists) {
        orgId = clientDoc.data()?.orgId || null
      }
    } catch (err) {
      console.error('[VAPI-POLL] Error resolving orgId from client:', err)
    }
  }
  if (!orgId) {
    orgId = process.env.DEFAULT_ORG_ID || ''
    if (orgId) {
      console.warn('[VAPI-POLL] Using DEFAULT_ORG_ID fallback')
    }
  }

  console.log(`[VAPI-POLL] Requisição recebida: callId=${callId}, clientId=${clientId}, prospectName=${prospectName}, orgId=${orgId}`)

  if (!callId || !clientId) {
    console.error('[VAPI-POLL] Parâmetros faltando: callId ou clientId')
    return NextResponse.json({ error: 'callId e clientId são obrigatórios' }, { status: 400 })
  }

  try {
    // Buscar status da ligação na API do Vapi
    console.log(`[VAPI-POLL] Buscando call ${callId} na API do Vapi...`)
    const call = await getVapiCallDetails(callId)
    if (!call) {
      console.warn(`[VAPI-POLL] Call ${callId} ainda não disponível na API do Vapi (pode estar inicializando)`)
      return NextResponse.json({
        status: 'in_progress',
        callStatus: 'initializing',
        message: 'Ligação sendo inicializada...',
      })
    }

    const callStatus = call.status as string
    console.log(`[VAPI-POLL] Call ${callId} status: ${callStatus}`)

    // Se ainda não terminou, retornar status atual
    if (callStatus !== 'ended') {
      return NextResponse.json({
        status: 'in_progress',
        callStatus,
        message: 'Ligação em andamento',
      })
    }

    // === LIGAÇÃO TERMINOU - PROCESSAR RESULTADO ===
    console.log(`[VAPI-POLL] Call ${callId} terminou! Processando resultado para cliente ${clientId}...`)

    const analysis = (call.analysis || {}) as Record<string, unknown>
    const summary = (analysis.summary as string) || ''
    const transcript = (call.transcript as string) || ''
    const endedReason = (call.endedReason as string) || 'unknown'
    const recordingUrl = (call.recordingUrl as string) || ''
    const startedAt = (call.startedAt as string) || ''
    const endedAt = (call.endedAt as string) || ''
    const customerNumber = ((call.customer as Record<string, unknown>)?.number as string) || ''

    console.log(`[VAPI-POLL] Dados:`, JSON.stringify({
      callId,
      clientId,
      endedReason,
      hasSummary: summary.length > 0,
      hasTranscript: transcript.length > 0,
      hasRecording: recordingUrl.length > 0,
      summaryPreview: summary.substring(0, 200),
    }))

    // Calcular duração
    let durationSec = 0
    if (startedAt && endedAt) {
      durationSec = Math.round(
        (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
      )
    }

    const reasonText = getEndedReasonText(endedReason)
    const notConnected = NOT_CONNECTED_REASONS.includes(endedReason)
    const callHadConversation = summary.length > 0 || transcript.length > 0 || durationSec > 10

    const phones = phonesParam ? phonesParam.split(',').filter(Boolean) : []
    const totalPhones = phones.length || 1
    const hasMorePhones = phones.length > 0 && phoneIndex < phones.length - 1

    // Multi-phone fallback
    if (notConnected && !callHadConversation && hasMorePhones && phones.length > 0) {
      console.log(`[VAPI-POLL] Não conectou, tentando próximo telefone (${phoneIndex + 2}/${totalPhones})`)
      try {
        const retryResult = await retryCallWithNextPhone(
          clientId,
          prospectName || 'Prospect',
          prospectCompany,
          phones,
          phoneIndex
        )
        if (retryResult) {
          await addLog(clientId, `Telefone ${phoneIndex + 1}/${totalPhones} não atendeu (${reasonText}). Tentando telefone ${phoneIndex + 2}/${totalPhones}...`, 'vapi-poll-retry')
          return NextResponse.json({
            status: 'retry',
            newCallId: retryResult.id,
            phoneIndex: retryResult.nextPhoneIndex,
            message: `Tentando próximo telefone (${retryResult.nextPhoneIndex + 1}/${totalPhones})`,
          })
        }
      } catch (retryError) {
        console.error('[VAPI-POLL] Erro no retry:', retryError)
      }
    }

    // === ATUALIZAR CRM ===
    let classification: CallOutcomeCode = 'TELEFONE_INDISPONIVEL'
    try {
      const classificationInput = summary || transcript
      classification = await classifyCallResult(classificationInput, endedReason)
      console.log('[VAPI-POLL] Classificação:', classification)
    } catch {
      classification = notConnected && !callHadConversation ? 'TELEFONE_INDISPONIVEL' : 'SEM_INTERESSE'
    }

    // Resultado em texto
    let resultado: string
    switch (classification) {
      case 'TELEFONE_INDISPONIVEL':
        resultado = `Não foi possível falar (${reasonText})`
        if (totalPhones > 1) resultado += ` - tentou ${phoneIndex + 1}/${totalPhones} telefones`
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

    // Montar follow-up
    const phoneInfo = totalPhones > 1 ? `\nTelefone: ${phoneIndex + 1}/${totalPhones}` : ''
    let transcriptExcerpt = ''
    if (transcript) {
      transcriptExcerpt = transcript.length > 1500 ? transcript.substring(0, 1500) + '...' : transcript
    }

    const followupParts = [
      `Ligação de prospecção`,
      ``,
      `Duração: ${formatDuration(durationSec)}`,
      `Resultado: ${resultado}${phoneInfo}`,
    ]
    if (summary) followupParts.push(``, `Resumo: ${summary}`)
    if (transcriptExcerpt) followupParts.push(``, `Transcrição:`, transcriptExcerpt)
    if (!summary && !transcriptExcerpt) followupParts.push(``, `Resumo: Não disponível`)
    if (recordingUrl) followupParts.push(``, `Gravação: ${recordingUrl}`)

    const followupText = followupParts.join('\n')

    // Executar operações CRM em paralelo (cada uma isolada)
    const results = await Promise.allSettled([
      addFollowUp(clientId, followupText, 'agente-voz', recordingUrl || undefined),
      updateFunnelStage(clientId, getTargetStageForOutcome(classification)),
      addLog(clientId, `Ligação: ${resultado}`, 'vapi-poll'),
      saveCallRecord(clientId, {
        clientId,
        vapiCallId: callId,
        startedAt: startedAt || new Date().toISOString(),
        endedAt,
        duration: durationSec,
        outcome: classification,
        outcomeLabel: resultado,
        transcript,
        summary,
        endedReason,
        ...(recordingUrl ? { recordingUrl } : {}),
        metadata: {
          prospectName,
          prospectCompany,
          prospectPhone: customerNumber,
          phoneIndex,
          totalPhones,
        },
        createdAt: new Date().toISOString(),
      }),
    ])

    const errors = results.filter(r => r.status === 'rejected')
    if (errors.length > 0) {
      console.error('[VAPI-POLL] Alguns updates falharam:', errors)
    }

    console.log(`[VAPI-POLL] ✅ CRM atualizado para ${prospectName} (${clientId}) - ${classification}`)

    // ===== DEBITAR CRÉDITOS DE MINUTOS =====
    if (orgId && durationSec > 0) {
      try {
        const minutes = Math.ceil(durationSec / 60)
        await deductCredits(orgId, minutes, callId, `Ligação ${prospectName || clientId}: ${minutes} min`)
        console.log(`[VAPI-POLL] Debitados ${minutes} minutos de crédito para org ${orgId}`)
      } catch (creditError) {
        console.error('[VAPI-POLL] Erro ao debitar créditos:', creditError)
      }
    }

    // ===== AVANÇAR FILA DE LIGAÇÕES =====
    try {
      if (notConnected && !callHadConversation) {
        await onCallFailed({ vapiCallId: callId, error: resultado })
      } else {
        await onCallCompleted({
          vapiCallId: callId,
          outcome: classification,
          outcomeLabel: resultado,
          duration: durationSec,
        })
      }
    } catch (queueError) {
      console.error('[VAPI-POLL] Erro ao avançar fila:', queueError)
    }

    return NextResponse.json({
      status: 'completed',
      classification,
      resultado,
      summary: summary.substring(0, 300),
      duration: durationSec,
      message: `Resultado registrado: ${resultado}`,
    })
  } catch (error) {
    console.error('[VAPI-POLL] Erro:', error)
    return NextResponse.json({ status: 'error', message: String(error) }, { status: 500 })
  }
}
