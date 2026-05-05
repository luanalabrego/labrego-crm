import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { getAutomationConfig, getTodayActionCount, getTodayPhoneCallCount, getTodayPhoneCallCountByStage } from '@/lib/automationConfig'
import { executeCadenceStep, logCadenceExecution, determineBestStage } from '@/lib/cadenceExecutors'
import { createCadenceCallQueue, addItemsToCadenceQueue, getCallQueue, processQueue } from '@/lib/callQueue'
import { canMakeCall } from '@/lib/credits'
import type { CadenceStep, CadenceExecutionLog, AutomationConfig } from '@/types/cadence'

const BATCH_SIZE = 20
const BATCH_DELAY_MS = 5000

/** Log a skipped contact to cadenceExecutionLog so it shows on the Execução page */
async function logSkippedContact(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  contact: { id: string; name?: string; [k: string]: unknown },
  step: CadenceStep | null,
  stageName: string,
  stageId: string,
  reason: string,
) {
  const entry: Omit<CadenceExecutionLog, 'id'> = {
    orgId,
    clientId: contact.id,
    clientName: (contact.name as string) || '',
    stepId: step?.id || '',
    stepName: step?.name || '',
    stageId,
    stageName,
    channel: step?.contactMethod || 'whatsapp',
    status: 'skipped',
    skipReason: reason,
    executedAt: new Date().toISOString(),
    retryCount: 0,
  }
  await db.collection('organizations').doc(orgId).collection('cadenceExecutionLog').add(entry)
}

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

  console.log('[CADENCE] Cron triggered at', now.toISOString())

  try {
    // Get all organizations
    const orgsSnap = await db.collection('organizations').get()
    console.log(`[CADENCE] Found ${orgsSnap.size} organizations`)

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id

      try {
        const config = await getAutomationConfig(orgId)
        if (!config.enabled) {
          console.log(`[CADENCE] Org ${orgId}: automation disabled, skipping`)
          continue
        }

        // Check work hours using org timezone
        const tz = config.timezone || 'America/Sao_Paulo'
        const localTime = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
        const [localHours, localMinutes] = localTime.split(':').map(Number)
        const currentTime = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(2, '0')}`
        if (currentTime < config.workHoursStart || currentTime > config.workHoursEnd) {
          console.log(`[CADENCE] Org ${orgId}: outside work hours (${currentTime}, window: ${config.workHoursStart}-${config.workHoursEnd})`)
          continue
        }

        // Check daily limit
        const todayCount = await getTodayActionCount(orgId)
        if (todayCount >= config.maxActionsPerDay) {
          continue
        }

        const remaining = config.maxActionsPerDay - todayCount
        console.log(`[CADENCE] Org ${orgId}: processing (todayCount=${todayCount}, remaining=${remaining}, time=${currentTime})`)

        // Auto-enroll contacts in stages with cadence steps
        await enrollUnenrolledContacts(db, orgId, config.pausedStageIds, results)

        await processOrg(db, orgId, config, remaining, results)
        console.log(`[CADENCE] Org ${orgId}: done (enrolled=${results.enrolled}, processed=${results.processed}, success=${results.success}, failed=${results.failed})`)

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

    console.log(`[CADENCE] Complete:`, JSON.stringify(results))
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

  if (stepsSnap.empty) {
    console.log(`[CADENCE] Org ${orgId}: no cadenceSteps documents found`)
    return
  }

  const steps = stepsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as CadenceStep))
    .filter(s => s.isActive)

  console.log(`[CADENCE] Org ${orgId}: ${stepsSnap.size} cadenceSteps total, ${steps.length} active`)

  if (steps.length === 0) return

  // Find first step per stage (lowest order)
  const stageFirstSteps = new Map<string, CadenceStep>()
  const skippedPaused: string[] = []
  const skippedChild: string[] = []
  for (const step of steps) {
    if (pausedStageIds.includes(step.stageId)) { skippedPaused.push(step.id); continue }
    // Only consider root steps (no parentStepId)
    if (step.parentStepId) { skippedChild.push(step.id); continue }
    const existing = stageFirstSteps.get(step.stageId)
    if (!existing || step.order < existing.order) {
      stageFirstSteps.set(step.stageId, step)
    }
  }

  console.log(`[CADENCE] Org ${orgId}: enroll check — ${stageFirstSteps.size} stages with root steps, ${skippedPaused.length} paused, ${skippedChild.length} child steps`)

  const now = new Date().toISOString()

  // Query per stage — only load clients in stages that have cadence steps (avoids loading entire org)
  let totalChecked = 0

  for (const [stageId, firstStep] of stageFirstSteps) {
    const stageClientsSnap = await db.collection('clients')
      .where('orgId', '==', orgId)
      .where('funnelStage', '==', stageId)
      .get()

    totalChecked += stageClientsSnap.size
    const unenrolled = stageClientsSnap.docs.filter(d => !d.data().currentCadenceStepId)

    console.log(`[CADENCE] Org ${orgId}: stage ${stageId} — ${stageClientsSnap.size} contacts in stage, ${unenrolled.length} unenrolled`)

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
  results: { processed: number; success: number; failed: number; skipped: number; errors: string[] }
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

  // Get stages info (include automationConfig for per-stage call hours/limits)
  const stagesSnap = await db.collection('funnelStages')
    .where('orgId', '==', orgId)
    .get()
  const stageMap = new Map<string, { id: string; name: string; funnelId: string; callStartHour?: string; callEndHour?: string; maxCallsPerDay?: number }>()
  stagesSnap.docs.forEach(d => {
    const data = d.data()
    const ac = data.automationConfig || {}
    stageMap.set(d.id, {
      id: d.id,
      name: data.name,
      funnelId: data.funnelId || '',
      callStartHour: ac.callStartHour || undefined,
      callEndHour: ac.callEndHour || undefined,
      maxCallsPerDay: ac.maxCallsPerDay || undefined,
    })
  })

  // Only load clients with active cadence step (avoids loading entire org)
  type ContactDoc = Record<string, unknown> & { id: string }
  const eligible: { contact: ContactDoc; step: CadenceStep; stage: { id: string; name: string; funnelId: string; callStartHour?: string; callEndHour?: string; maxCallsPerDay?: number } }[] = []

  const clientsSnap = await db.collection('clients')
    .where('orgId', '==', orgId)
    .where('currentCadenceStepId', '>', '')
    .get()

  let noStepId = 0
  let responded = 0
  let stepNotFound = 0
  let pendingCall = 0
  let callCompleted = 0
  let stagePaused = 0
  let stageNotFound = 0
  let waitingDays = 0

  for (const contactDoc of clientsSnap.docs) {
    const contact: ContactDoc = { id: contactDoc.id, ...contactDoc.data() }
    const stepId = contact.currentCadenceStepId as string
    if (!stepId) { noStepId++; continue }

    // Check if responded — AI determines best stage
    if (contact.lastCadenceStepResponded) {
      responded++
      await handleRespondedContact(db, orgId, contact, stageMap)
      results.processed++
      results.success++
      continue
    }

    const step = stepMap.get(stepId)
    if (!step || !step.isActive) {
      stepNotFound++
      const stageId = (contact.funnelStage as string) || ''
      const stage = stageMap.get(stageId)
      await logSkippedContact(db, orgId, contact, null, stage?.name || '', stageId,
        `Step não encontrado ou inativo (stepId: ${stepId}). Cadência resetada para re-enrollment.`)
      // Clear stale cadence reference so contact can be re-enrolled in the correct stage
      await db.collection('clients').doc(contact.id).update({
        currentCadenceStepId: '',
        lastCadenceStepResponded: false,
      })
      continue
    }

    // Check if waiting for phone call result from webhook
    if (contact.cadencePendingCallResult === true) {
      // Timeout: if pending for more than 2 hours, unstick the contact
      const lastAction = contact.lastCadenceActionAt as string | undefined
      if (lastAction) {
        const pendingSince = new Date(lastAction).getTime()
        const twoHoursMs = 2 * 60 * 60 * 1000
        if (Date.now() - pendingSince > twoHoursMs) {
          console.log(`[CADENCE] Org ${orgId}: contact ${contact.id} pending call timed out (>2h), unsticking`)
          await db.collection('clients').doc(contact.id).update({
            cadencePendingCallResult: false,
          })
          // Let it fall through to the callCompleted check below
        } else {
          pendingCall++
          continue
        }
      } else {
        pendingCall++
        continue
      }
    }

    // Phone step completed, webhook confirmed not answered — advance now
    if (contact.cadencePendingCallResult === false && step.contactMethod === 'phone') {
      callCompleted++
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
    if (pausedStageIds.includes(step.stageId)) {
      stagePaused++
      const stage = stageMap.get(step.stageId)
      await logSkippedContact(db, orgId, contact, step, stage?.name || '', step.stageId, 'Etapa pausada')
      continue
    }

    const stage = stageMap.get(step.stageId)
    if (!stage) { stageNotFound++; continue }

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
      if (daysDiff < step.daysAfterPrevious) { waitingDays++; continue }
    }
    // If daysAfterPrevious === 0 or no lastCadenceActionAt, executes immediately

    eligible.push({ contact, step, stage })
  }

  console.log(`[CADENCE] Org ${orgId}: processOrg filter — total=${clientsSnap.size}, noStepId=${noStepId}, responded=${responded}, stepNotFound=${stepNotFound}, pendingCall=${pendingCall}, callCompleted=${callCompleted}, stagePaused=${stagePaused}, stageNotFound=${stageNotFound}, waitingDays=${waitingDays}, eligible=${eligible.length}`)

  // ---- SEPARATE PHONE vs NON-PHONE ----
  const phoneEligible = eligible.filter(e => e.step.contactMethod === 'phone')
  const nonPhoneEligible = eligible.filter(e => e.step.contactMethod !== 'phone')

  // ---- PHONE: Power Dialer via CallQueue ----
  // Verificar se há fila running para avançar (independente de novos elegíveis)
  const existingQueue = await getCallQueue(undefined, orgId)
  const hasCadenceQueue = existingQueue && existingQueue.status === 'running' &&
    (existingQueue as unknown as Record<string, unknown>).type === 'cadence'

  // Sempre avançar/destravar fila existente
  if (hasCadenceQueue) {
    console.log(`[CADENCE] Cadence queue already running (${existingQueue.id}), processing to unstick/advance`)
    await processQueue(existingQueue.id)
  }

  // Processar novos contatos elegíveis (independente de fila existente)
  if (phoneEligible.length > 0) {
    // Calculate per-stage phone budgets
    const stagePhoneCounts = await getTodayPhoneCallCountByStage(orgId)
    const todayPhoneCount = await getTodayPhoneCallCount(orgId)
    const globalMaxPhoneDaily = config.maxCallsPerDay ?? 300
    const globalPhoneBudget = Math.max(0, globalMaxPhoneDaily - todayPhoneCount)

    if (globalPhoneBudget === 0) {
      console.log(`[CADENCE] Global daily phone limit reached (${todayPhoneCount}/${globalMaxPhoneDaily}), skipping phone steps`)
      results.skipped += phoneEligible.length
      for (const { contact, step, stage } of phoneEligible) {
        await logSkippedContact(db, orgId, contact, step, stage.name, stage.id, `Limite diário de ligações atingido (${todayPhoneCount}/${globalMaxPhoneDaily})`)
      }
    } else {
      // Filter by per-stage hours and daily limits (usar timezone da org, não UTC)
      const tzForStage = config.timezone || 'America/Sao_Paulo'
      const localTimeStr = now.toLocaleString('en-US', { timeZone: tzForStage, hour: '2-digit', minute: '2-digit', hour12: false })
      const [stH, stM] = localTimeStr.split(':').map(Number)
      const currentTime = `${String(stH).padStart(2, '0')}:${String(stM).padStart(2, '0')}`
      const stageBudgetsUsed = new Map<string, number>()
      const phoneSkipped: { contact: typeof phoneEligible[0]['contact']; step: CadenceStep; stage: typeof phoneEligible[0]['stage']; reason: string }[] = []

      const phoneFiltered = phoneEligible.filter(({ contact, step, stage }) => {
        const stageStartHour = stage.callStartHour || config.workHoursStart
        const stageEndHour = stage.callEndHour || config.workHoursEnd
        const stageMaxCalls = stage.maxCallsPerDay || globalMaxPhoneDaily

        // Check per-stage hours
        if (currentTime < stageStartHour || currentTime > stageEndHour) {
          phoneSkipped.push({ contact, step, stage, reason: `Fora do horário de ligações (${stageStartHour}-${stageEndHour}, atual: ${currentTime})` })
          return false
        }

        // Check per-stage daily limit
        const stageUsedToday = (stagePhoneCounts.get(stage.id) || 0) + (stageBudgetsUsed.get(stage.id) || 0)
        if (stageUsedToday >= stageMaxCalls) {
          phoneSkipped.push({ contact, step, stage, reason: `Limite diário de ligações da etapa atingido (${stageUsedToday}/${stageMaxCalls})` })
          return false
        }

        // Track usage
        stageBudgetsUsed.set(stage.id, (stageBudgetsUsed.get(stage.id) || 0) + 1)
        return true
      })

      // Log phone skips
      for (const { contact, step, stage, reason } of phoneSkipped) {
        await logSkippedContact(db, orgId, contact, step, stage.name, stage.id, reason)
      }

      // Check credits before enqueuing calls
      const creditCheck = await canMakeCall(orgId)
      if (!creditCheck.allowed) {
        console.log(`[CADENCE] Org ${orgId}: ${creditCheck.reason} — skipping ${phoneFiltered.length} phone steps`)
        results.failed += phoneFiltered.length
        results.errors.push(creditCheck.reason || 'Sem créditos')
        for (const { contact, step, stage } of phoneFiltered) {
          await logSkippedContact(db, orgId, contact, step, stage.name, stage.id, creditCheck.reason || 'Sem créditos para ligações')
        }
        phoneFiltered.length = 0 // skip all phone steps
      }

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

      if (phonesToEnqueue.length === 0) {
        results.skipped += skippedCount
      } else if (hasCadenceQueue) {
        // Fila já existe — adicionar novos contatos à fila existente
        const added = await addItemsToCadenceQueue(existingQueue.id, queueContacts)

        if (added > 0) {
          // Mark added contacts as pending call result
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

          // Log cadence executions for added contacts
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

          results.processed += added
          results.success += added
          actionsLeft -= added
          console.log(`[CADENCE] Added ${added} contacts to existing queue ${existingQueue.id}`)
        }

        results.skipped += skippedCount + (phonesToEnqueue.length - added)

        // Process queue again to start new pending items
        await processQueue(existingQueue.id)
      } else {
      // Create new queue and start processing
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
      } // end if phonesToEnqueue.length > 0
    }
  }

  // ---- NON-PHONE: Process normally in batches ----
  for (let i = 0; i < nonPhoneEligible.length && actionsLeft > 0; i += BATCH_SIZE) {
    const batch = nonPhoneEligible.slice(i, i + BATCH_SIZE)

    for (const { contact, step, stage } of batch) {
      if (actionsLeft <= 0) {
        await logSkippedContact(db, orgId, contact, step, stage.name, stage.id, `Limite diário de ações atingido (${config.maxActionsPerDay})`)
        results.skipped++
        continue
      }
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
