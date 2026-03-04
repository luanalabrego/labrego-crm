import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { executeCadenceStep, logCadenceExecution } from '@/lib/cadenceExecutors'
import { createCadenceCallQueue, processQueue } from '@/lib/callQueue'
import { getAutomationConfig } from '@/lib/automationConfig'
import type { CadenceStep } from '@/types/cadence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/cadence/force-stage
 * Force cadence execution for a specific stage.
 * Picks the oldest contacts first and executes their next cadence step.
 */
export async function POST(req: NextRequest) {
  try {
    const { orgId, stageId, limit: maxContacts } = await req.json()

    if (!orgId || !stageId || !maxContacts) {
      return NextResponse.json({ error: 'orgId, stageId e limit sao obrigatorios' }, { status: 400 })
    }

    const db = getAdminDb()
    const now = new Date()

    // Get active cadence steps for this stage
    const stepsSnap = await db.collection('cadenceSteps')
      .where('orgId', '==', orgId)
      .get()

    const allSteps = stepsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as CadenceStep))
      .filter(s => s.isActive)

    const stageSteps = allSteps.filter(s => s.stageId === stageId)
    if (stageSteps.length === 0) {
      return NextResponse.json({ error: 'Nenhum step de cadencia ativo nesta etapa' }, { status: 400 })
    }

    const stepMap = new Map<string, CadenceStep>()
    for (const s of allSteps) stepMap.set(s.id, s)

    // Find first step (lowest order, no parent)
    const rootSteps = stageSteps.filter(s => !s.parentStepId).sort((a, b) => a.order - b.order)
    const firstStep = rootSteps[0]
    if (!firstStep) {
      return NextResponse.json({ error: 'Nenhum step raiz encontrado' }, { status: 400 })
    }

    // Get stage info
    const stageDoc = await db.collection('funnelStages').doc(stageId).get()
    const stageName = stageDoc.exists ? (stageDoc.data()?.name || 'Etapa') : 'Etapa'

    // Get contacts in this stage, ordered by oldest first
    const clientsSnap = await db.collection('clients')
      .where('orgId', '==', orgId)
      .get()

    const stageContacts = clientsSnap.docs
      .filter(d => d.data().funnelStage === stageId)
      .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }))
      .sort((a, b) => {
        const aDate = (a.funnelStageUpdatedAt as string) || (a.createdAt as string) || ''
        const bDate = (b.funnelStageUpdatedAt as string) || (b.createdAt as string) || ''
        return aDate.localeCompare(bDate) // oldest first
      })
      .slice(0, maxContacts)

    if (stageContacts.length === 0) {
      return NextResponse.json({ error: 'Nenhum contato nesta etapa' }, { status: 400 })
    }

    // Enroll contacts that don't have a cadence step assigned
    const nowStr = now.toISOString()
    for (const contact of stageContacts) {
      if (!contact.currentCadenceStepId) {
        await db.collection('clients').doc(contact.id).update({
          currentCadenceStepId: firstStep.id,
          lastCadenceActionAt: nowStr,
          lastCadenceStepResponded: false,
        })
        contact.currentCadenceStepId = firstStep.id
      }
    }

    // Determine each contact's current step
    const contactsWithSteps = stageContacts.map(contact => {
      const step = stepMap.get(contact.currentCadenceStepId as string) || firstStep
      return { contact, step }
    })

    // Separate phone vs non-phone
    const phoneContacts = contactsWithSteps.filter(c => c.step.contactMethod === 'phone')
    const nonPhoneContacts = contactsWithSteps.filter(c => c.step.contactMethod !== 'phone')

    const results = { total: stageContacts.length, phoneQueued: 0, nonPhoneExecuted: 0, failed: 0 }

    // Phone contacts: create call queue
    if (phoneContacts.length > 0) {
      const config = await getAutomationConfig(orgId)
      const queueContacts = phoneContacts.map(({ contact, step }) => {
        const cadenceOverrides = (step.vapiSystemPrompt || step.vapiFirstMessage)
          ? { systemPrompt: step.vapiSystemPrompt || undefined, firstMessage: step.vapiFirstMessage || undefined }
          : undefined
        return {
          id: contact.id,
          name: (contact.name as string) || '',
          phone: (contact.phone as string) || '',
          company: (contact.company as string) || undefined,
          industry: (contact.industry as string) || undefined,
          partners: (contact.partners as string) || undefined,
          stageId,
          cadenceStepId: step.id,
          cadenceOverrides,
        }
      })

      const { queueId, totalItems } = await createCadenceCallQueue({
        contacts: queueContacts,
        maxConcurrent: config.maxConcurrentCalls ?? 10,
        orgId,
        callStaggerDelayMs: config.callStaggerDelayMs ?? 10000,
      })

      // Mark as pending call result
      for (let i = 0; i < phoneContacts.length; i += 450) {
        const batch = db.batch()
        const chunk = phoneContacts.slice(i, i + 450)
        for (const { contact } of chunk) {
          batch.update(db.collection('clients').doc(contact.id), {
            cadencePendingCallResult: true,
            lastCadenceActionAt: nowStr,
          })
        }
        await batch.commit()
      }

      // Log executions
      for (const { contact, step } of phoneContacts) {
        await logCadenceExecution(db, orgId, contact.id, {
          stepId: step.id, stepName: step.name, channel: 'phone',
          stageId, stageName, success: true,
        })
      }

      await processQueue(queueId)
      results.phoneQueued = totalItems
      console.log(`[FORCE-CADENCE] Phone queue ${queueId} started with ${totalItems} contacts`)
    }

    // Non-phone contacts: execute directly
    for (const { contact, step } of nonPhoneContacts) {
      const result = await executeCadenceStep(
        step,
        contact as Record<string, unknown> & { id: string },
        orgId,
      )

      await logCadenceExecution(db, orgId, contact.id, {
        stepId: step.id, stepName: step.name, channel: step.contactMethod,
        stageId, stageName, success: result.success, error: result.error,
      })

      if (result.success) {
        results.nonPhoneExecuted++
        // Update lastCadenceActionAt
        await db.collection('clients').doc(contact.id).update({
          lastCadenceActionAt: nowStr,
        })
      } else {
        results.failed++
      }
    }

    console.log(`[FORCE-CADENCE] Stage "${stageName}" processed: ${results.phoneQueued} phone, ${results.nonPhoneExecuted} non-phone, ${results.failed} failed`)

    return NextResponse.json({
      success: true,
      message: `Cadencia forcada para ${results.total} contatos na etapa "${stageName}"`,
      ...results,
    })
  } catch (error) {
    console.error('[FORCE-CADENCE] Error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
