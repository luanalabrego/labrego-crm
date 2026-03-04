import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { getAutomationConfig, getTodayActionCount, getTodayPhoneCallCount, getTodayPhoneCallCountByStage } from '@/lib/automationConfig'
import { executeCadenceStep, logCadenceExecution, determineBestStage } from '@/lib/cadenceExecutors'
import { createCadenceCallQueue, getCallQueue, processQueue } from '@/lib/callQueue'
import type { CadenceStep, CadenceExecutionLog, AutomationConfig } from '@/types/cadence'

const BATCH_SIZE = 20
const BATCH_DELAY_MS = 5000

/**
 * POST /api/cadence/process
 * Called by cron every 15 minutes.
 * Processes eligible cadence steps for all organizations.
 */
export async function POST(request: NextRequest) {
  // Optional auth
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = getAdminDb()
  const now = new Date()
  const results = { enrolled: 0, processed: 0, success: 0, failed: 0, skipped: 0, errors: [] as string[] }

  try {
    // Get all organizations
    const orgsSnap = await db.collection('organizations').get()

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id

      try {
        const config = await getAutomationConfig(orgId)
        if (!config.enabled) continue

        // Check work hours using org timezone
        const tz = config.timezone || 'America/Sao_Paulo'
        const localTime = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
        const [localHours, localMinutes] = localTime.split(':').map(Number)
        const currentTime = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(2, '0')}`
        if (currentTime < config.workHoursStart || currentTime > config.workHoursEnd) {
          continue
        }

        // Check daily limit
        const todayCount = await getTodayActionCount(orgId)
        if (todayCount >= config.maxActionsPerDay) {
          continue
        }

        const remaining = config.maxActionsPerDay - todayCount

        // Auto-enroll contacts in stages with cadence steps
        await enrollUnenrolledContacts(db, orgId, config.pausedStageIds, results)

        await processOrg(db, orgId, config, remaining, results)

        // Salvar stats do último processamento no automationConfig para visibilidade no frontend
        await db.collection('organizations').doc(orgId).collection('automationConfig').doc('global').set({
          lastCronRunAt: now.toISOString(),
          lastCronStats: {
            enrolled: results.enrolled,
            processed: results.processed,
            success: results.success,
            failed: results.failed,
            skipped: results.skipped,
            todayActions: todayCount + results.success,
            maxActionsPerDay: config.maxActionsPerDay,
          },
        }, { merge: true })
      } catch (orgError) {
        console.error(`Cadence error for org ${orgId}:`, orgError)
        results.failed++
        results.errors.push(`${orgId}: ${orgError instanceof Error ? orgError.message : String(orgError)}`)
      }
    }

    return NextResponse.json({
      message: 'Cadence processing complete',
      ...results,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('Cadence process error:', error)
    const details = error instanceof Error
      ? { message: error.message, stack: error.stack?.split('\n').slice(0, 3) }
      : String(error)
    return NextResponse.json(
      { error: 'Failed to process cadences', details },
      { status: 500 }
    )
  }
}

/**
 * Auto-enroll contacts that are in stages with cadence steps but not yet enrolled.
 * Runs before processing to ensure new contacts get picked up.
 */
async function enrollUnenrolledContacts(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  pausedStageIds: string[],
  results: { enrolled: number }
) {
  // Get cadence steps for this org (single-field query, filter isActive in code)
  const stepsSnap = await db.collection('cadenceSteps')
    .where('orgId', '==', orgId)
    .get()

  if (stepsSnap.empty) return

  const steps = stepsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as CadenceStep))
    .filter(s => s.isActive)

  if (steps.length === 0) return

  // Find first step per stage (lowest order)
  const stageFirstSteps = new Map<string, CadenceStep>()
  for (const step of steps) {
    if (pausedStageIds.includes(step.stageId)) continue
    // Only consider root steps (no parentStepId)
    if (step.parentStepId) continue
    const existing = stageFirstSteps.get(step.stageId)
    if (!existing || step.order < existing.order) {
      stageFirstSteps.set(step.stageId, step)
    }
  }

  const now = new Date().toISOString()

  // Single query — load all org clients and filter in code to avoid composite index
  const clientsSnap = await db.collection('clients')
    .where('orgId', '==', orgId)
    .get()

  for (const [stageId, firstStep] of stageFirstSteps) {
    // Filter contacts in this stage without cadence enrollment
    const unenrolled = clientsSnap.docs.filter(d => {
      const data = d.data()
      return data.funnelStage === stageId && !data.currentCadenceStepId
    })

    if (unenrolled.length === 0) continue

    // Enroll in batches of 500
    for (let i = 0; i < unenrolled.length; i += 500) {
      const batch = db.batch()
      const chunk = unenrolled.slice(i, i + 500)
      for (const contactDoc of chunk) {
        batch.update(contactDoc.ref, {
          currentCadenceStepId: firstStep.id,
          lastCadenceActionAt: now,
          lastCadenceStepResponded: false,
        })
      }
      await batch.commit()
    }

    results.enrolled += unenrolled.length
  }
}

async function processOrg(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  config: AutomationConfig,
  maxActions: number,
  results: { processed: number; success: number; failed: number; skipped: number }
) {
  const pausedStageIds = config.pausedStageIds
  const now = new Date()
  let actionsLeft = maxActions

  // Get cadence steps for this org (single-field query, filter in code)
  const stepsSnap = await db.collection('cadenceSteps')
    .where('orgId', '==', orgId)
    .get()

  if (stepsSnap.empty) return

  const steps = stepsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as CadenceStep))
    .filter(s => s.isActive)

  if (steps.length === 0) return

  const stepMap = new Map<string, CadenceStep>()
  for (const s of steps) stepMap.set(s.id, s)

  // Get stages info
  const stagesSnap = await db.collection('funnelStages')
    .where('orgId', '==', orgId)
    .get()
  const stageMap = new Map<string, { id: string; name: string; funnelId: string }>()
  stagesSnap.docs.forEach(d => stageMap.set(d.id, { id: d.id, name: d.data().name, funnelId: d.data().funnelId || '' }))

  // Find eligible contacts — single-field query to avoid composite index requirement
  type ContactDoc = Record<string, unknown> & { id: string }
  const eligible: { contact: ContactDoc; step: CadenceStep; stage: { id: string; name: string } }[] = []

  const clientsSnap = await db.collection('clients')
    .where('orgId', '==', orgId)
    .get()

  for (const contactDoc of clientsSnap.docs) {
    const contact: ContactDoc = { id: contactDoc.id, ...contactDoc.data() }
    const stepId = contact.currentCadenceStepId as string
    if (!stepId) continue

    // Check if responded — AI determines best stage
    if (contact.lastCadenceStepResponded) {
      await handleRespondedContact(db, orgId, contact, stageMap)
      results.processed++
      results.success++
      continue
    }

    const step = stepMap.get(stepId)
    if (!step || !step.isActive) continue

    // Check if waiting for phone call result from webhook
    if (contact.cadencePendingCallResult === true) {
      // Webhook hasn't fired yet — skip, wait for next cron cycle
      continue
    }

    // Phone step completed, webhook confirmed not answered — advance now
    if (contact.cadencePendingCallResult === false && step.contactMethod === 'phone') {
      await db.collection('clients').doc(contact.id).update({
        cadencePendingCallResult: null,
      })
      const stage = stageMap.get(step.stageId)
      if (stage) {
        await advanceToNextStep(db, orgId, contact, step, steps, stageMap)
        results.processed++
      }
      continue
    }

    // Check if stage is paused
    if (pausedStageIds.includes(step.stageId)) continue

    const stage = stageMap.get(step.stageId)
    if (!stage) continue

    // Check timing: lastCadenceActionAt + daysAfterPrevious <= now
    // Usa comparação por dias corridos (meia-noite) para evitar pular steps
    // por diferença de horas. Ex: D0 executou 14h → D1 elegível a partir de meia-noite do dia seguinte.
    const lastAction = contact.lastCadenceActionAt as string
    if (lastAction && step.daysAfterPrevious > 0) {
      const lastActionDate = new Date(lastAction)
      // Normalizar para meia-noite UTC do dia da última ação
      const lastActionDay = new Date(Date.UTC(
        lastActionDate.getUTCFullYear(),
        lastActionDate.getUTCMonth(),
        lastActionDate.getUTCDate()
      ))
      const nowDay = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ))
      const daysDiff = Math.floor((nowDay.getTime() - lastActionDay.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff < step.daysAfterPrevious) continue
    }
    // If daysAfterPrevious === 0 or no lastCadenceActionAt, executes immediately

    eligible.push({ contact, step, stage })
  }

  // ---- SEPARATE PHONE vs NON-PHONE ----
  const phoneEligible = eligible.filter(e => e.step.contactMethod === 'phone')
  const nonPhoneEligible = eligible.filter(e => e.step.contactMethod !== 'phone')

  // ---- PHONE: Power Dialer via CallQueue ----
  // SEMPRE verificar se há fila running para avançar (independente de novos elegíveis)
  const existingQueue = await getCallQueue(undefined, orgId)
  const hasCadenceQueue = existingQueue && existingQueue.status === 'running' &&
    (existingQueue as unknown as Record<string, unknown>).type === 'cadence'

  if (hasCadenceQueue) {
    // Queue já existe — chamar processQueue para avançar
    // (detecta chamadas travadas e dispara novas se houver vagas)
    console.log(`[CADENCE] Cadence queue already running (${existingQueue.id}), processing to unstick/advance`)
    await processQueue(existingQueue.id)
    results.skipped += phoneEligible.length
  } else if (phoneEligible.length > 0) {
    // Calculate per-stage phone budgets
    const stagePhoneCounts = await getTodayPhoneCallCountByStage(orgId)
    const todayPhoneCount = await getTodayPhoneCallCount(orgId)
    const globalMaxPhoneDaily = config.maxCallsPerDay ?? 300
    const globalPhoneBudget = Math.max(0, globalMaxPhoneDaily - todayPhoneCount)

    if (globalPhoneBudget === 0) {
      console.log(`[CADENCE] Global daily phone limit reached (${todayPhoneCount}/${globalMaxPhoneDaily}), skipping phone steps`)
      results.skipped += phoneEligible.length
    } else {
      // Filter by per-stage hours and daily limits
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const stageBudgetsUsed = new Map<string, number>()

      const phoneFiltered = phoneEligible.filter(({ step, stage }) => {
        const stageData = stage as unknown as Record<string, unknown>
        const stageStartHour = (stageData.callStartHour as string) || config.workHoursStart
        const stageEndHour = (stageData.callEndHour as string) || config.workHoursEnd
        const stageMaxCalls = (stageData.maxCallsPerDay as number) || globalMaxPhoneDaily

        // Check per-stage hours
        if (currentTime < stageStartHour || currentTime > stageEndHour) return false

        // Check per-stage daily limit
        const stageUsedToday = (stagePhoneCounts.get(stage.id) || 0) + (stageBudgetsUsed.get(stage.id) || 0)
        if (stageUsedToday >= stageMaxCalls) return false

        // Track usage
        stageBudgetsUsed.set(stage.id, (stageBudgetsUsed.get(stage.id) || 0) + 1)
        return true
      })

      // Limit to global budget
      const phonesToEnqueue = phoneFiltered.slice(0, Math.min(globalPhoneBudget, actionsLeft))
      const skippedCount = phoneEligible.length - phonesToEnqueue.length

      // Build contacts for queue
      const queueContacts = phonesToEnqueue.map(({ contact, step }) => {
        const cadenceOverrides = (step.vapiSystemPrompt || step.vapiFirstMessage)
          ? {
              systemPrompt: step.vapiSystemPrompt || undefined,
              firstMessage: step.vapiFirstMessage || undefined,
            }
          : undefined

        return {
          id: contact.id,
          name: (contact.name as string) || '',
          phone: (contact.phone as string) || '',
          company: (contact.company as string) || undefined,
          industry: (contact.industry as string) || undefined,
          partners: (contact.partners as string) || undefined,
          stageId: step.stageId,
          cadenceStepId: step.id,
          cadenceOverrides,
        }
      })

      // Create queue and start processing
      const maxConcurrent = config.maxConcurrentCalls ?? 10
      const callStaggerDelayMs = config.callStaggerDelayMs ?? 10000
      const { queueId, totalItems } = await createCadenceCallQueue({
        contacts: queueContacts,
        maxConcurrent,
        orgId,
        callStaggerDelayMs,
      })

      // Mark all enqueued contacts as pending call result
      const nowStr = new Date().toISOString()
      for (let i = 0; i < phonesToEnqueue.length; i += 450) {
        const writeBatch = db.batch()
        const chunk = phonesToEnqueue.slice(i, i + 450)
        for (const { contact } of chunk) {
          writeBatch.update(db.collection('clients').doc(contact.id), {
            cadencePendingCallResult: true,
            lastCadenceActionAt: nowStr,
          })
        }
        await writeBatch.commit()
      }

      // Log cadence executions for enqueued contacts
      for (const { contact, step, stage } of phonesToEnqueue) {
        await logCadenceExecution(db, orgId, contact.id, {
          stepId: step.id,
          stepName: step.name,
          channel: 'phone',
          stageId: stage.id,
          stageName: stage.name,
          success: true,
          error: '',
          templatePreview: step.name.slice(0, 100),
        })

        const logEntry: Omit<CadenceExecutionLog, 'id'> = {
          orgId,
          clientId: contact.id,
          clientName: (contact.name as string) || '',
          stepId: step.id,
          stepName: step.name,
          stageId: stage.id,
          stageName: stage.name,
          channel: 'phone',
          status: 'success',
          error: '',
          executedAt: now.toISOString(),
          retryCount: 0,
        }
        await db.collection('organizations').doc(orgId).collection('cadenceExecutionLog').add(logEntry)
      }

      results.processed += totalItems
      results.success += totalItems
      actionsLeft -= totalItems
      results.skipped += skippedCount

      // Start the power dialer — fills maxConcurrent slots immediately
      // Subsequent calls are triggered by webhook → onCallCompleted → processQueue
      await processQueue(queueId)

      console.log(`[CADENCE] Power dialer started: queue ${queueId} with ${totalItems} contacts, ${maxConcurrent} concurrent, ${skippedCount} deferred`)
    }
  }

  // ---- NON-PHONE: Process normally in batches ----
  for (let i = 0; i < nonPhoneEligible.length && actionsLeft > 0; i += BATCH_SIZE) {
    const batch = nonPhoneEligible.slice(i, i + BATCH_SIZE)

    for (const { contact, step, stage } of batch) {
      if (actionsLeft <= 0) break
      results.processed++
      actionsLeft--

      const result = await executeCadenceStep(
        step,
        contact as Record<string, unknown> & { id: string },
        orgId
      )

      // Log execution
      await logCadenceExecution(db, orgId, contact.id, {
        stepId: step.id,
        stepName: step.name,
        channel: step.contactMethod,
        stageId: stage.id,
        stageName: stage.name,
        success: result.success,
        error: result.error || '',
        templatePreview: (step.messageTemplate || step.emailSubject || step.name).slice(0, 100),
      })

      const logEntry: Omit<CadenceExecutionLog, 'id'> = {
        orgId,
        clientId: contact.id,
        clientName: (contact.name as string) || '',
        stepId: step.id,
        stepName: step.name,
        stageId: stage.id,
        stageName: stage.name,
        channel: step.contactMethod,
        status: result.success ? 'success' : 'failed',
        error: result.error || '',
        executedAt: now.toISOString(),
        retryCount: 0,
      }
      await db.collection('organizations').doc(orgId).collection('cadenceExecutionLog').add(logEntry)

      if (result.success) {
        results.success++
        await advanceToNextStep(db, orgId, contact, step, steps, stageMap)
      } else {
        results.failed++
        await handleFailedStep(db, orgId, contact, step, logEntry, steps, stageMap)
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < nonPhoneEligible.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }
}

/**
 * Handle a contact that responded to a cadence step.
 * Uses AI to determine the best funnel stage and moves the contact there.
 */
async function handleRespondedContact(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  contact: { id: string } & Record<string, unknown>,
  stageMap: Map<string, { id: string; name: string; funnelId: string }>
) {
  const outcome = (contact.lastCadenceOutcome as string) || ''
  const callSummary = (contact.lastCadenceCallSummary as string) || ''
  const currentFunnelId = contact.funnelId as string

  // Get stages for the contact's current funnel
  const funnelStages = Array.from(stageMap.values())
    .filter(s => s.funnelId === currentFunnelId)

  if (funnelStages.length === 0) {
    console.warn(`[CADENCE] No stages found for funnel ${currentFunnelId}, clearing cadence`)
    await db.collection('clients').doc(contact.id).update({
      currentCadenceStepId: '',
      lastCadenceActionAt: new Date().toISOString(),
      lastCadenceStepResponded: false,
      lastCadenceOutcome: '',
      lastCadenceCallSummary: '',
    })
    return
  }

  // AI determines the best stage
  const bestStageId = await determineBestStage(outcome, callSummary, funnelStages)
  const bestStage = stageMap.get(bestStageId)

  const clientRef = db.collection('clients').doc(contact.id)
  await clientRef.update({
    funnelStage: bestStageId || contact.funnelStage,
    funnelId: bestStage?.funnelId || currentFunnelId,
    funnelStageUpdatedAt: new Date().toISOString(),
    currentCadenceStepId: '',
    lastCadenceActionAt: new Date().toISOString(),
    lastCadenceStepResponded: false,
    lastCadenceOutcome: '',
    lastCadenceCallSummary: '',
  })

  // Log the AI-driven move
  await db.collection('clients').doc(contact.id).collection('logs').add({
    action: 'cadence_ai_stage_move',
    message: `Cadência: contato respondeu (${outcome}) — IA moveu para ${bestStage?.name || 'etapa'}`,
    type: 'cadence',
    author: 'Sistema (Cadência IA)',
    metadata: {
      outcome,
      bestStageId: bestStageId || '',
      bestStageName: bestStage?.name || '',
      callSummary: callSummary.slice(0, 100),
    },
    createdAt: new Date().toISOString(),
    orgId,
  })

  console.log(`[CADENCE] AI moved contact ${contact.id} to stage "${bestStage?.name}" (outcome: ${outcome})`)
}

async function advanceToNextStep(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  contact: { id: string } & Record<string, unknown>,
  currentStep: CadenceStep,
  allSteps: CadenceStep[],
  stageMap: Map<string, { id: string; name: string; funnelId: string }>
) {
  // Find next step in the same stage with higher order
  const stageSteps = allSteps
    .filter(s => s.stageId === currentStep.stageId && s.isActive)
    .sort((a, b) => a.order - b.order)

  const currentIndex = stageSteps.findIndex(s => s.id === currentStep.id)
  const nextStep = stageSteps[currentIndex + 1]

  const clientRef = db.collection('clients').doc(contact.id)

  if (nextStep) {
    // Advance to next step
    await clientRef.update({
      currentCadenceStepId: nextStep.id,
      lastCadenceActionAt: new Date().toISOString(),
    })
  } else {
    // Cadence exhausted — check stage config
    const stageRef = db.collection('funnelStages').doc(currentStep.stageId)
    const stageDoc = await stageRef.get()
    const stageData = stageDoc.data()

    const exhaustedAction = stageData?.cadenceExhaustedAction || 'keep'

    if (exhaustedAction === 'move' && stageData?.cadenceExhaustedTargetStageId) {
      // Move contact to target stage
      const targetStage = stageMap.get(stageData.cadenceExhaustedTargetStageId)
      await clientRef.update({
        funnelStage: stageData.cadenceExhaustedTargetStageId,
        funnelId: targetStage?.funnelId || '',
        funnelStageUpdatedAt: new Date().toISOString(),
        currentCadenceStepId: '',
        lastCadenceActionAt: new Date().toISOString(),
      })

      // Log the move
      await db.collection('clients').doc(contact.id).collection('logs').add({
        action: 'cadence_exhausted_move',
        message: `Cadência esgotada — movido para ${targetStage?.name || 'outra etapa'}`,
        type: 'cadence',
        author: 'Sistema (Cadência automática)',
        createdAt: new Date().toISOString(),
        orgId,
      })
    } else if (exhaustedAction === 'notify') {
      const assignedTo = contact.assignedTo as string
      if (assignedTo) {
        await db.collection('organizations').doc(orgId).collection('notifications').add({
          userId: assignedTo,
          type: 'cadence_exhausted',
          title: 'Cadência esgotada',
          message: `Cadência de ${(contact.name as string) || 'contato'} esgotou sem resposta`,
          contactId: contact.id,
          read: false,
          createdAt: new Date().toISOString(),
        })
      }
      await clientRef.update({
        currentCadenceStepId: '',
        lastCadenceActionAt: new Date().toISOString(),
      })
    } else {
      // Keep — just clear the cadence step
      await clientRef.update({
        currentCadenceStepId: '',
        lastCadenceActionAt: new Date().toISOString(),
      })
    }
  }
}

async function handleFailedStep(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  contact: { id: string } & Record<string, unknown>,
  step: CadenceStep,
  logEntry: Omit<CadenceExecutionLog, 'id'>,
  allSteps: CadenceStep[],
  stageMap: Map<string, { id: string; name: string; funnelId: string }>
) {
  const retryCount = (step.retryCount || 0) + 1

  if (retryCount <= 2) {
    // Schedule retry — mark as retry_pending
    await db.collection('cadenceSteps').doc(step.id).update({
      retryCount,
      lastRetryAt: new Date().toISOString(),
    })
  } else {
    // Max retries exceeded — log and advance to next step
    await db.collection('clients').doc(contact.id).collection('logs').add({
      action: 'cadence_auto_error',
      message: `Cadência falhou após ${retryCount} tentativas: ${step.name} — avançando para próximo step`,
      type: 'cadence',
      author: 'Sistema (Cadência automática)',
      createdAt: new Date().toISOString(),
      orgId,
    })

    // Reset retry count on the step
    await db.collection('cadenceSteps').doc(step.id).update({
      retryCount: 0,
      lastRetryAt: '',
    })

    // Advance contact to next step (or finish cadence)
    await advanceToNextStep(db, orgId, contact, step, allSteps, stageMap)
  }
}

// Also support GET for Vercel Cron
export async function GET(request: NextRequest) {
  return POST(request)
}
