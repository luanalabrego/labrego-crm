import { NextRequest, NextResponse } from 'next/server'
import { makeVapiCall } from '@/lib/callRouting'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { resolveOrgByEmail, getOrgIdFromHeaders } from '@/lib/orgResolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolve orgId from request: x-user-email > x-org-id header > DEFAULT_ORG_ID */
async function resolveOrgId(req: NextRequest): Promise<string> {
  const email = req.headers.get('x-user-email')
  if (email) {
    const ctx = await resolveOrgByEmail(email)
    if (ctx) return ctx.orgId
  }
  const fromHeader = getOrgIdFromHeaders(req.headers)
  if (fromHeader) return fromHeader
  const fallback = process.env.DEFAULT_ORG_ID || ''
  if (fallback) {
    console.warn('[CALL-CONTACT] Using DEFAULT_ORG_ID fallback')
  } else {
    console.warn('[CALL-CONTACT] No orgId resolved')
  }
  return fallback
}

// POST - Disparar ligação para um contato específico
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { clientId, name, phone, company, industry, partners } = body

    // Resolve orgId: body > headers > email lookup > fallback
    let orgId = body.orgId || null
    if (!orgId) orgId = await resolveOrgId(req)
    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    if (!clientId || !name || !phone) {
      return NextResponse.json(
        { error: 'clientId, name e phone são obrigatórios' },
        { status: 400 }
      )
    }

    // Validate client belongs to this org
    const db = getAdminDb()
    const clientDoc = await db.collection('clients').doc(clientId).get()
    if (!clientDoc.exists) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }
    const clientData = clientDoc.data()
    if (clientData?.orgId && clientData.orgId !== orgId) {
      return NextResponse.json({ error: 'Cliente não pertence a esta organização' }, { status: 403 })
    }

    console.log(`[CALL-CONTACT] Iniciando ligação para ${name} (${clientId}) orgId=${orgId}`)

    const call = await makeVapiCall({
      id: clientId,
      name,
      phone,
      company,
      industry,
      partners,
    }, orgId)

    console.log(`[CALL-CONTACT] Ligação iniciada: ${call.id}`)

    return NextResponse.json({
      success: true,
      callId: call.id,
      status: call.status,
      message: `Ligação iniciada para ${name}`,
    })
  } catch (error) {
    console.error('[CALL-CONTACT] Error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}
