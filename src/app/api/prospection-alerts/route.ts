import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { getEmailProviderConfig, createProvider } from '@/lib/email/emailProvider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const THRESHOLDS = [300, 200, 100, 0]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { orgId, funnelId } = body as { orgId: string; funnelId: string }

    if (!orgId || !funnelId) {
      return NextResponse.json({ error: 'orgId and funnelId are required' }, { status: 400 })
    }

    const db = getAdminDb()

    // Find the prospection stage for this funnel
    const stagesSnap = await db.collection('funnelStages')
      .where('orgId', '==', orgId)
      .where('funnelId', '==', funnelId)
      .where('isProspectionStage', '==', true)
      .get()

    if (stagesSnap.empty) {
      return NextResponse.json({ message: 'No prospection stage configured' })
    }

    const prospectionStage = stagesSnap.docs[0]
    const stageId = prospectionStage.id
    const stageName = prospectionStage.data().name || 'Prospecção'

    // Count contacts in this stage
    const clientsSnap = await db.collection('clients')
      .where('orgId', '==', orgId)
      .where('funnelId', '==', funnelId)
      .where('funnelStage', '==', stageId)
      .get()

    const contactCount = clientsSnap.size

    // Check thresholds
    const alertsRef = db.collection('organizations').doc(orgId).collection('prospectionAlerts')
    const alertKey = `${funnelId}_${stageId}`

    // Get last alert sent
    const lastAlertSnap = await alertsRef.doc(alertKey).get()
    const lastThreshold = lastAlertSnap.exists ? (lastAlertSnap.data()?.lastThreshold as number) : null

    // Find which threshold was crossed
    let crossedThreshold: number | null = null
    for (const threshold of THRESHOLDS) {
      if (contactCount <= threshold) {
        if (lastThreshold === null || threshold < lastThreshold) {
          crossedThreshold = threshold
        }
      }
    }

    if (crossedThreshold === null) {
      return NextResponse.json({ message: 'No threshold crossed', contactCount })
    }

    // Get funnel info
    const funnelSnap = await db.collection('funnels').doc(funnelId).get()
    const funnelName = funnelSnap.exists ? (funnelSnap.data()?.name || 'Funil') : 'Funil'

    // Get org members to notify
    const membersSnap = await db.collection('organizations').doc(orgId).collection('members').get()
    const memberEmails: string[] = []
    membersSnap.docs.forEach((doc) => {
      const data = doc.data()
      if (data.email && data.status !== 'inactive') {
        memberEmails.push(data.email as string)
      }
    })

    if (memberEmails.length === 0) {
      return NextResponse.json({ message: 'No members to notify', contactCount })
    }

    // Send email alerts
    const emailConfig = await getEmailProviderConfig(orgId)
    const provider = createProvider(emailConfig.primaryProvider, emailConfig)
    const from = emailConfig.fromEmail
      ? `${emailConfig.fromName || 'Voxium'} <${emailConfig.fromEmail}>`
      : undefined

    const subject = contactCount === 0
      ? `Lista de prospecção esgotada — ${funnelName}`
      : `Alerta: Apenas ${contactCount} contatos restantes — ${funnelName}`

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #13DEFC, #8B5CF6); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">Voxium CRM</h1>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">
            ${contactCount === 0 ? 'Lista de Prospecção Esgotada' : 'Alerta de Prospecção'}
          </h2>
          <p style="color: #475569; line-height: 1.6;">
            ${contactCount === 0
              ? `A lista de prospecção na etapa <strong>"${stageName}"</strong> do funil <strong>"${funnelName}"</strong> está vazia. Adicione novos contatos para manter o fluxo de vendas ativo.`
              : `Restam apenas <strong>${contactCount} contatos</strong> na etapa <strong>"${stageName}"</strong> do funil <strong>"${funnelName}"</strong>. Considere adicionar mais prospects para manter o fluxo de vendas.`
            }
          </p>
          <div style="background: ${contactCount === 0 ? '#fef2f2' : '#fffbeb'}; border: 1px solid ${contactCount === 0 ? '#fecaca' : '#fde68a'}; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0; color: ${contactCount === 0 ? '#991b1b' : '#92400e'}; font-weight: 600;">
              ${contactCount === 0 ? 'Ação necessária: Adicione novos contatos à etapa de prospecção.' : `Contatos restantes: ${contactCount}`}
            </p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
            Este é um alerta automático do Voxium CRM.
          </p>
        </div>
      </div>
    `

    let sentCount = 0
    for (const email of memberEmails) {
      try {
        await provider.send(email, subject, html, from)
        sentCount++
      } catch (err) {
        console.error(`Failed to send prospection alert to ${email}:`, err)
      }
    }

    // Save the alert record
    await alertsRef.doc(alertKey).set({
      lastThreshold: crossedThreshold,
      contactCount,
      sentAt: new Date().toISOString(),
      sentTo: memberEmails,
      funnelId,
      stageId,
    })

    return NextResponse.json({
      success: true,
      contactCount,
      threshold: crossedThreshold,
      sentTo: sentCount,
    })
  } catch (error) {
    console.error('Prospection alert error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
