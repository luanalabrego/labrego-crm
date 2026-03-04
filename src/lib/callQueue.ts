// src/lib/callQueue.ts
// Sistema de fila de ligações com controle de concorrência
// Garante no máximo N ligações simultâneas no VAPI, avançando automaticamente
//
// NOTA: Todas as queries usam no máximo 1 campo where/orderBy para evitar
// necessidade de composite indexes no Firestore. Filtragem e ordenação
// adicionais são feitas em memória (volumes pequenos, max ~200 itens).

import { getAdminDb } from './firebaseAdmin'
import { makeVapiCall, getActiveProspects, parseMultiplePhones, getVapiCallDetails, classifyCallResult } from './callRouting'
import { canMakeCall, deductAction } from './credits'
import {
  CallQueue,
  CallQueueItem,
  CallQueueItemStatus,
  CallQueueStatus,
} from '@/types/callRouting'

const COLLECTION_QUEUE = 'callQueues'
const COLLECTION_QUEUE_ITEMS = 'callQueueItems'
const DEFAULT_MAX_CONCURRENT = 10
const STUCK_CALL_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutos: auto-fail chamadas travadas

// ========== QUEUE MANAGEMENT ==========

/**
 * Cria uma nova fila de ligações a partir dos prospects ativos.
 * Retorna o ID da fila criada.
 */
export async function createCallQueue(options: {
  limit?: number
  maxConcurrent?: number
  orgId?: string
}): Promise<{ queueId: string; totalItems: number }> {
  const db = getAdminDb()
  const limit = options.limit || 50
  const maxConcurrent = options.maxConcurrent || DEFAULT_MAX_CONCURRENT
  const orgId = options.orgId

  // Buscar prospects ativos (filtrados por org se orgId fornecido)
  const { clients } = await getActiveProspects(limit * 2, orgId)

  // Filtrar apenas quem tem telefone válido
  const clientsToCall = clients
    .filter(c => {
      if (!c.phone) return false
      const validPhones = parseMultiplePhones(c.phone)
      return validPhones.length > 0
    })
    .slice(0, limit)

  if (clientsToCall.length === 0) {
    throw new Error('Nenhum prospect com telefone válido em Prospecção Ativa')
  }

  // Criar documento da fila
  const now = new Date().toISOString()
  const queueRef = db.collection(COLLECTION_QUEUE).doc()
  const queueId = queueRef.id

  const queue: Omit<CallQueue, 'id'> & { orgId?: string } = {
    status: 'running',
    maxConcurrent,
    totalItems: clientsToCall.length,
    completedItems: 0,
    failedItems: 0,
    activeCallsCount: 0,
    createdAt: now,
    updatedAt: now,
    ...(orgId ? { orgId } : {}),
  }

  await queueRef.set({ ...queue, id: queueId })

  // Criar itens da fila em batch (Firestore batch limit = 500)
  const batchSize = 450
  for (let batchStart = 0; batchStart < clientsToCall.length; batchStart += batchSize) {
    const batch = db.batch()
    const batchEnd = Math.min(batchStart + batchSize, clientsToCall.length)
    for (let i = batchStart; i < batchEnd; i++) {
      const client = clientsToCall[i]
      const itemRef = db.collection(COLLECTION_QUEUE_ITEMS).doc()
      const item: Omit<CallQueueItem, 'id'> = {
        queueId,
        clientId: client.id,
        name: client.name,
        phone: client.phone,
        ...(client.company != null && { company: client.company }),
        ...(client.industry != null && { industry: client.industry }),
        status: 'pending',
        position: i,
        createdAt: now,
        updatedAt: now,
      }
      batch.set(itemRef, { ...item, id: itemRef.id })
    }
    await batch.commit()
  }

  console.log(`[CALL-QUEUE] Fila ${queueId} criada com ${clientsToCall.length} itens (max concurrent: ${maxConcurrent})`)

  return { queueId, totalItems: clientsToCall.length }
}

/**
 * Cria uma fila de ligações para contatos da cadência.
 * Aceita uma lista de contatos já filtrados com metadata de cadência.
 */
export async function createCadenceCallQueue(options: {
  contacts: Array<{
    id: string
    name: string
    phone: string
    company?: string
    industry?: string
    partners?: string
    stageId?: string
    cadenceStepId: string
    cadenceOverrides?: { systemPrompt?: string; firstMessage?: string }
  }>
  maxConcurrent?: number
  orgId: string
  callStaggerDelayMs?: number
}): Promise<{ queueId: string; totalItems: number }> {
  const db = getAdminDb()
  const maxConcurrent = options.maxConcurrent || DEFAULT_MAX_CONCURRENT

  if (options.contacts.length === 0) {
    throw new Error('Nenhum contato para enfileirar')
  }

  const now = new Date().toISOString()
  const queueRef = db.collection(COLLECTION_QUEUE).doc()
  const queueId = queueRef.id

  const queue: Omit<CallQueue, 'id'> & { orgId: string; callStaggerDelayMs?: number; lastCallStartedAt?: string } = {
    status: 'running',
    type: 'cadence',
    maxConcurrent,
    totalItems: options.contacts.length,
    completedItems: 0,
    failedItems: 0,
    activeCallsCount: 0,
    createdAt: now,
    updatedAt: now,
    orgId: options.orgId,
    ...(options.callStaggerDelayMs ? { callStaggerDelayMs: options.callStaggerDelayMs } : {}),
  }

  await queueRef.set({ ...queue, id: queueId })

  // Criar itens em batches de 450
  const batchSize = 450
  for (let batchStart = 0; batchStart < options.contacts.length; batchStart += batchSize) {
    const batch = db.batch()
    const batchEnd = Math.min(batchStart + batchSize, options.contacts.length)
    for (let i = batchStart; i < batchEnd; i++) {
      const c = options.contacts[i]
      const itemRef = db.collection(COLLECTION_QUEUE_ITEMS).doc()
      const item: Omit<CallQueueItem, 'id'> = {
        queueId,
        clientId: c.id,
        name: c.name,
        phone: c.phone,
        ...(c.company != null && { company: c.company }),
        ...(c.industry != null && { industry: c.industry }),
        ...(c.partners != null && { partners: c.partners }),
        status: 'pending',
        position: i,
        createdAt: now,
        updatedAt: now,
        ...(c.stageId && { stageId: c.stageId }),
        cadenceStepId: c.cadenceStepId,
        ...(c.cadenceOverrides && { cadenceOverrides: c.cadenceOverrides }),
      }
      batch.set(itemRef, { ...item, id: itemRef.id })
    }
    await batch.commit()
  }

  console.log(`[CALL-QUEUE] Cadence queue ${queueId} created with ${options.contacts.length} contacts (max concurrent: ${maxConcurrent})`)

  return { queueId, totalItems: options.contacts.length }
}

/**
 * Busca a fila ativa (ou uma fila específica por ID).
 * Usa query simples (single field) para evitar necessidade de composite index.
 */
export async function getCallQueue(queueId?: string, orgId?: string): Promise<CallQueue | null> {
  const db = getAdminDb()

  if (queueId) {
    const doc = await db.collection(COLLECTION_QUEUE).doc(queueId).get()
    if (!doc.exists) return null
    const data = doc.data() as CallQueue
    // Validate org ownership if orgId provided
    const dataRaw = data as unknown as Record<string, unknown>
    if (orgId && dataRaw.orgId && dataRaw.orgId !== orgId) return null
    return data
  }

  // Buscar filas com status "running" (single field query)
  const snapshot = await db
    .collection(COLLECTION_QUEUE)
    .where('status', '==', 'running')
    .get()

  if (!snapshot.empty) {
    // Ordenar por createdAt em memória e pegar a mais recente
    let queues = snapshot.docs.map(d => d.data() as CallQueue)
    // Multi-tenant: filtrar pela org em memória
    if (orgId) {
      queues = queues.filter(q => (q as unknown as Record<string, unknown>).orgId === orgId)
    }
    queues.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (queues.length === 0) return null
    const queue = queues[0]

    // Auto-detect stuck queues: if "running" but no pending/active items, mark complete
    const items = await getQueueItems(queue.id)
    const hasActive = items.some(
      i => i.status === 'pending' || i.status === 'calling' || i.status === 'in_progress'
    )
    if (!hasActive && items.length > 0) {
      console.log(`[CALL-QUEUE] Auto-completing stuck queue ${queue.id} (no active items)`)
      await markQueueCompleted(queue.id)
      return { ...queue, status: 'completed' as CallQueueStatus }
    }

    return queue
  }

  return null
}

/**
 * Busca todos os itens de uma fila.
 * Query simples por queueId, ordenação por position em memória.
 */
export async function getQueueItems(queueId: string): Promise<CallQueueItem[]> {
  const db = getAdminDb()
  const snapshot = await db
    .collection(COLLECTION_QUEUE_ITEMS)
    .where('queueId', '==', queueId)
    .get()

  const items = snapshot.docs.map(doc => doc.data() as CallQueueItem)
  items.sort((a, b) => a.position - b.position)
  return items
}

/**
 * Busca um item da fila pelo vapiCallId.
 */
export async function getQueueItemByCallId(vapiCallId: string): Promise<CallQueueItem | null> {
  const db = getAdminDb()
  const snapshot = await db
    .collection(COLLECTION_QUEUE_ITEMS)
    .where('vapiCallId', '==', vapiCallId)
    .limit(1)
    .get()

  if (snapshot.empty) return null
  return snapshot.docs[0].data() as CallQueueItem
}

// ========== QUEUE PROCESSING ==========

/**
 * Processa a fila: dispara ligações até atingir o limite de concorrência.
 * Retorna quantas ligações foram iniciadas nesta execução.
 */
export async function processQueue(queueId: string): Promise<{
  started: number
  errors: number
  remaining: number
  activeCalls: number
}> {
  const db = getAdminDb()
  const queue = await getCallQueue(queueId)

  if (!queue || queue.status !== 'running') {
    return { started: 0, errors: 0, remaining: 0, activeCalls: 0 }
  }

  // Extrair orgId da fila para passar ao makeVapiCall
  const orgId = (queue as unknown as Record<string, unknown>).orgId as string | undefined

  // Buscar todos os itens da fila de uma vez (single query, no composite index)
  const allItems = await getQueueItems(queueId)

  // ===== STUCK CALL DETECTION =====
  // Auto-fail chamadas que ficaram em calling/in_progress por mais de 15 minutos
  // Isso acontece quando o webhook do VAPI não retorna (timeout, erro de rede, etc.)
  const now = Date.now()
  const stuckItems = allItems.filter(i => {
    if (i.status !== 'calling' && i.status !== 'in_progress') return false
    const updatedAt = new Date(i.updatedAt || i.startedAt || i.createdAt).getTime()
    return !isNaN(updatedAt) && (now - updatedAt) > STUCK_CALL_TIMEOUT_MS
  })

  if (stuckItems.length > 0) {
    console.log(`[CALL-QUEUE] Detectadas ${stuckItems.length} chamadas travadas (> ${STUCK_CALL_TIMEOUT_MS / 60000}min), tentando recuperar via VAPI API`)
    const nowISO = new Date().toISOString()
    let recoveredCount = 0
    let failedCount = 0

    for (const item of stuckItems) {
      // Tentar recuperar resultado real da chamada via VAPI API
      let recovered = false
      if (item.vapiCallId) {
        try {
          const vapiCall = await getVapiCallDetails(item.vapiCallId)
          if (vapiCall && vapiCall.status === 'ended') {
            // Chamada completou no VAPI — recuperar resultado
            const summary = (vapiCall.analysis as Record<string, unknown>)?.summary as string || ''
            const transcript = vapiCall.transcript as string || ''
            const endedReason = vapiCall.endedReason as string || 'unknown'
            const durationSec = vapiCall.startedAt && vapiCall.endedAt
              ? Math.round((new Date(vapiCall.endedAt as string).getTime() - new Date(vapiCall.startedAt as string).getTime()) / 1000)
              : 0

            let outcome: string = 'TELEFONE_INDISPONIVEL'
            try {
              outcome = await classifyCallResult(summary || transcript, endedReason)
            } catch { /* use default */ }

            await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
              status: 'completed' as CallQueueItemStatus,
              outcome,
              duration: durationSec,
              updatedAt: nowISO,
              endedAt: nowISO,
            })

            recovered = true
            recoveredCount++
            console.log(`[CALL-QUEUE] Recuperada via VAPI API: ${item.name} (${item.vapiCallId}) — ${outcome}`)
          }
        } catch (pollError) {
          console.warn(`[CALL-QUEUE] Erro ao consultar VAPI para ${item.vapiCallId}:`, pollError)
        }
      }

      if (!recovered) {
        // Não conseguiu recuperar — marcar como failed
        await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
          status: 'failed' as CallQueueItemStatus,
          error: 'Timeout: webhook do VAPI não retornou',
          updatedAt: nowISO,
          endedAt: nowISO,
        })
        failedCount++
      }

      // Liberar cadencePendingCallResult do contato se aplicável
      if (item.cadenceStepId) {
        try {
          await db.collection('clients').doc(item.clientId).update({
            cadencePendingCallResult: false,
          })
        } catch { /* ignore */ }
      }
    }

    // Atualizar contadores da fila
    await db.collection(COLLECTION_QUEUE).doc(queueId).update({
      completedItems: (queue.completedItems || 0) + recoveredCount,
      failedItems: (queue.failedItems || 0) + failedCount,
      activeCallsCount: Math.max(0, (queue.activeCallsCount || 0) - stuckItems.length),
      updatedAt: new Date().toISOString(),
    })

    if (recoveredCount > 0) {
      console.log(`[CALL-QUEUE] Recuperadas ${recoveredCount} chamadas via VAPI API, ${failedCount} marcadas como failed`)
    }
  }

  // Contar ligações atualmente ativas (excluindo as que acabamos de marcar como failed)
  const stuckIds = new Set(stuckItems.map(i => i.id))
  let activeCalls = allItems.filter(
    i => (i.status === 'calling' || i.status === 'in_progress') && !stuckIds.has(i.id)
  ).length

  // Quantas vagas temos?
  const slotsAvailable = Math.max(0, queue.maxConcurrent - activeCalls)

  if (slotsAvailable === 0) {
    const pendingCount = allItems.filter(i => i.status === 'pending').length
    console.log(`[CALL-QUEUE] Sem vagas disponíveis (${activeCalls}/${queue.maxConcurrent} ativas, ${pendingCount} pendentes)`)
    return { started: 0, errors: 0, remaining: pendingCount, activeCalls }
  }

  // Stagger delay: se configurado, iniciar no máximo 1 ligação por invocação
  // e respeitar o intervalo desde a última ligação iniciada
  const staggerDelay = (queue as unknown as Record<string, unknown>).callStaggerDelayMs as number | undefined
  const lastCallStarted = (queue as unknown as Record<string, unknown>).lastCallStartedAt as string | undefined

  let maxToStart = slotsAvailable
  if (staggerDelay && staggerDelay > 0) {
    // Com stagger, iniciar no máximo 1 por invocação
    maxToStart = 1
    // Verificar se já passou tempo suficiente desde a última ligação
    // MAS: se não há nenhuma ligação ativa, ignorar stagger (fila pode estar travada)
    if (lastCallStarted && activeCalls > 0) {
      const elapsed = Date.now() - new Date(lastCallStarted).getTime()
      if (elapsed < staggerDelay) {
        const pendingCount = allItems.filter(i => i.status === 'pending').length
        console.log(`[CALL-QUEUE] Stagger delay: aguardando ${staggerDelay - elapsed}ms (${elapsed}ms desde última)`)
        return { started: 0, errors: 0, remaining: pendingCount, activeCalls }
      }
    }
  }

  // Pegar próximos itens pendentes (já ordenados por position)
  const pendingItems = allItems
    .filter(i => i.status === 'pending')
    .slice(0, maxToStart)

  if (pendingItems.length === 0) {
    // Verificar se a fila acabou
    const hasActive = allItems.some(
      i => i.status === 'pending' || i.status === 'calling' || i.status === 'in_progress'
    )
    if (!hasActive) {
      await markQueueCompleted(queueId)
    }
    return { started: 0, errors: 0, remaining: 0, activeCalls }
  }

  let started = 0
  let errors = 0

  // Carregar configs de etapa para validação de horário (se for fila de cadência)
  let stageConfigs: Map<string, { callStartHour?: string; callEndHour?: string }> | null = null
  if (queue.type === 'cadence' && orgId) {
    try {
      const stagesSnap = await db.collection('organizations').doc(orgId).collection('funnelStages').get()
      stageConfigs = new Map()
      for (const doc of stagesSnap.docs) {
        const data = doc.data()
        if (data.automationConfig) {
          stageConfigs.set(doc.id, {
            callStartHour: data.automationConfig.callStartHour,
            callEndHour: data.automationConfig.callEndHour,
          })
        }
      }
    } catch { /* ignore, proceed without stage validation */ }
  }

  // Disparar ligações para cada item pendente
  for (const item of pendingItems) {
    const now = new Date().toISOString()

    // Verificar créditos antes de cada ligação (ação + minutos)
    if (orgId) {
      const creditCheck = await canMakeCall(orgId)
      if (!creditCheck.allowed) {
        console.log(`[CALL-QUEUE] Créditos insuficientes para ${item.name}: ${creditCheck.reason}`)
        await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
          status: 'cancelled' as CallQueueItemStatus,
          error: creditCheck.reason || 'Créditos insuficientes',
          updatedAt: now,
          endedAt: now,
        })
        continue
      }
      // Debitar 1 ação antes de iniciar a ligação
      await deductAction(orgId, 'call', item.clientId, `Ligação fila: ${item.name}`)
    }

    // Per-stage validation: verificar se a etapa ainda está dentro do horário
    const itemStageId = (item as unknown as Record<string, unknown>).stageId as string | undefined
    if (itemStageId && stageConfigs) {
      const stageConf = stageConfigs.get(itemStageId)
      if (stageConf && stageConf.callStartHour && stageConf.callEndHour) {
        const nowDate = new Date()
        const currentTime = `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`
        if (currentTime < stageConf.callStartHour || currentTime > stageConf.callEndHour) {
          // Fora do horário — cancelar este item
          await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
            status: 'cancelled' as CallQueueItemStatus,
            error: `Janela de horário encerrada (${stageConf.callStartHour}-${stageConf.callEndHour})`,
            updatedAt: now,
            endedAt: now,
          })
          console.log(`[CALL-QUEUE] ${item.name} cancelado: fora do horário da etapa (${currentTime} vs ${stageConf.callStartHour}-${stageConf.callEndHour})`)
          continue
        }
      }
    }

    try {
      // Marcar como "calling" antes de fazer a chamada
      await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
        status: 'calling' as CallQueueItemStatus,
        updatedAt: now,
        startedAt: now,
      })

      // Fazer a chamada VAPI (com overrides de cadência se existirem)
      const call = await makeVapiCall({
        id: item.clientId,
        name: item.name,
        phone: item.phone,
        company: item.company,
        industry: item.industry,
        partners: item.partners,
      }, orgId, item.cadenceOverrides || undefined)

      // Atualizar com o callId do VAPI
      await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
        status: 'in_progress' as CallQueueItemStatus,
        vapiCallId: call.id,
        updatedAt: new Date().toISOString(),
      })

      activeCalls++
      started++
      console.log(`[CALL-QUEUE] Ligação iniciada: ${item.name} (${call.id}) - ${activeCalls}/${queue.maxConcurrent} ativas`)
    } catch (error) {
      // Marcar como falha
      await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
        status: 'failed' as CallQueueItemStatus,
        error: String(error),
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      })

      errors++
      console.error(`[CALL-QUEUE] Erro ao ligar para ${item.name}:`, error)
    }
  }

  // Atualizar contadores na fila
  const queueUpdate: Record<string, unknown> = {
    activeCallsCount: activeCalls,
    failedItems: (queue.failedItems || 0) + errors,
    updatedAt: new Date().toISOString(),
  }
  // Registrar timestamp da última ligação iniciada (para stagger delay)
  if (started > 0) {
    queueUpdate.lastCallStartedAt = new Date().toISOString()
  }
  await db.collection(COLLECTION_QUEUE).doc(queueId).update(queueUpdate)

  const remaining = allItems.filter(i => i.status === 'pending').length - pendingItems.length + errors
  console.log(`[CALL-QUEUE] Processamento: ${started} iniciadas, ${errors} erros, ${remaining} pendentes, ${activeCalls} ativas`)

  return { started, errors, remaining, activeCalls }
}

/**
 * Chamado quando uma ligação termina (via webhook ou poll).
 * Atualiza o item da fila e dispara a próxima ligação se houver vaga.
 */
export async function onCallCompleted(params: {
  vapiCallId: string
  outcome?: string
  outcomeLabel?: string
  duration?: number
}): Promise<{ nextStarted: boolean; queueFinished: boolean }> {
  const db = getAdminDb()

  // Buscar o item da fila por vapiCallId
  const item = await getQueueItemByCallId(params.vapiCallId)
  if (!item) {
    // Não faz parte de nenhuma fila (pode ser ligação manual)
    return { nextStarted: false, queueFinished: false }
  }

  // Já foi processado? (evitar duplicatas)
  if (item.status === 'completed' || item.status === 'failed') {
    return { nextStarted: false, queueFinished: false }
  }

  const now = new Date().toISOString()

  // Atualizar item como completo
  const updateData: Record<string, string | number> = {
    status: 'completed' as CallQueueItemStatus,
    updatedAt: now,
    endedAt: now,
  }
  if (params.outcome) updateData.outcome = params.outcome
  if (params.outcomeLabel) updateData.outcomeLabel = params.outcomeLabel
  if (params.duration != null) updateData.duration = params.duration
  await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update(updateData)

  // Atualizar contadores da fila
  const queue = await getCallQueue(item.queueId)
  if (!queue) {
    return { nextStarted: false, queueFinished: false }
  }

  const newCompleted = (queue.completedItems || 0) + 1
  const newActiveCalls = Math.max(0, (queue.activeCallsCount || 0) - 1)

  await db.collection(COLLECTION_QUEUE).doc(item.queueId).update({
    completedItems: newCompleted,
    activeCallsCount: newActiveCalls,
    updatedAt: now,
  })

  console.log(`[CALL-QUEUE] Ligação concluída: ${item.name} (${params.vapiCallId}) - ${params.outcome || 'sem outcome'}`)

  // Verificar se a fila terminou
  const allItems = await getQueueItems(item.queueId)
  const hasActive = allItems.some(
    i => i.status === 'pending' || i.status === 'calling' || i.status === 'in_progress'
  )

  if (!hasActive) {
    await markQueueCompleted(item.queueId)
    return { nextStarted: false, queueFinished: true }
  }

  // Disparar próxima ligação da fila
  const result = await processQueue(item.queueId)

  return { nextStarted: result.started > 0, queueFinished: false }
}

/**
 * Chamado quando uma ligação falha.
 */
export async function onCallFailed(params: {
  vapiCallId: string
  error?: string
}): Promise<void> {
  const db = getAdminDb()

  const item = await getQueueItemByCallId(params.vapiCallId)
  if (!item) return

  if (item.status === 'completed' || item.status === 'failed') return

  const now = new Date().toISOString()

  await db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id).update({
    status: 'failed' as CallQueueItemStatus,
    error: params.error || 'Unknown error',
    updatedAt: now,
    endedAt: now,
  })

  const queue = await getCallQueue(item.queueId)
  if (!queue) return

  await db.collection(COLLECTION_QUEUE).doc(item.queueId).update({
    failedItems: (queue.failedItems || 0) + 1,
    activeCallsCount: Math.max(0, (queue.activeCallsCount || 0) - 1),
    updatedAt: now,
  })

  console.log(`[CALL-QUEUE] Ligação falhou: ${item.name} (${params.vapiCallId}) - ${params.error}`)

  // Verificar se a fila terminou e avançar
  const allItems = await getQueueItems(item.queueId)
  const hasActive = allItems.some(
    i => i.status === 'pending' || i.status === 'calling' || i.status === 'in_progress'
  )

  if (!hasActive) {
    await markQueueCompleted(item.queueId)
  } else {
    await processQueue(item.queueId)
  }
}

/**
 * Cancela a fila, parando todos os processamentos pendentes.
 */
export async function cancelQueue(queueId: string): Promise<void> {
  const db = getAdminDb()
  const now = new Date().toISOString()

  // Marcar fila como cancelada
  await db.collection(COLLECTION_QUEUE).doc(queueId).update({
    status: 'cancelled' as CallQueueStatus,
    updatedAt: now,
    completedAt: now,
  })

  // Buscar itens pendentes (single field query) e filtrar em memória
  const allItems = await getQueueItems(queueId)
  const pendingItems = allItems.filter(i => i.status === 'pending')

  if (pendingItems.length > 0) {
    // Batch update em grupos de 450
    for (let i = 0; i < pendingItems.length; i += 450) {
      const batch = db.batch()
      const chunk = pendingItems.slice(i, i + 450)
      for (const item of chunk) {
        batch.update(db.collection(COLLECTION_QUEUE_ITEMS).doc(item.id), {
          status: 'cancelled' as CallQueueItemStatus,
          updatedAt: now,
        })
      }
      await batch.commit()
    }
  }

  console.log(`[CALL-QUEUE] Fila ${queueId} cancelada (${pendingItems.length} itens pendentes cancelados)`)
}

// ========== HELPERS ==========

async function markQueueCompleted(queueId: string): Promise<void> {
  const db = getAdminDb()
  const now = new Date().toISOString()
  await db.collection(COLLECTION_QUEUE).doc(queueId).update({
    status: 'completed' as CallQueueStatus,
    activeCallsCount: 0,
    updatedAt: now,
    completedAt: now,
  })
  console.log(`[CALL-QUEUE] Fila ${queueId} concluída!`)
}
