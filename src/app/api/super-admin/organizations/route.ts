import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/superAdmin'
import { getAdminDb } from '@/lib/firebaseAdmin'

async function requireSuperAdmin(req: NextRequest): Promise<string | NextResponse> {
  const email = req.headers.get('x-user-email')?.toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!(await isSuperAdmin(email))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return email
}

export async function GET(req: NextRequest) {
  const result = await requireSuperAdmin(req)
  if (result instanceof NextResponse) return result

  try {
    const db = getAdminDb()
    const snap = await db.collection('organizations').orderBy('createdAt', 'desc').get()
    const orgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    return NextResponse.json({ orgs })
  } catch (error: any) {
    console.error('[super-admin/organizations] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const result = await requireSuperAdmin(req)
  if (result instanceof NextResponse) return result

  try {
    const { name, plan, adminEmail, status } = await req.json()
    if (!name || !plan || !adminEmail) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const db = getAdminDb()
    const orgRef = db.collection('organizations').doc()
    const now = new Date().toISOString()

    await orgRef.set({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      plan,
      status: status || 'active',
      settings: { timezone: 'America/Sao_Paulo', currency: 'BRL' },
      limits: { maxUsers: 10, maxFunnels: 3, maxContacts: 2000 },
      createdAt: now,
      updatedAt: now,
    })

    // Create credits/balance doc
    await orgRef.collection('credits').doc('balance').set({
      balance: 0,
      totalPurchased: 0,
      totalConsumed: 0,
    })

    // Add admin member
    await orgRef.collection('members').doc().set({
      userId: '',
      email: adminEmail.toLowerCase(),
      displayName: adminEmail.split('@')[0],
      role: 'admin',
      permissions: {
        pages: ['/contatos', '/funil', '/funil/produtividade', '/conversao', '/cadencia', '/ligacoes', '/admin/usuarios', '/admin/creditos', '/admin/plano'],
        actions: {
          canCreateContacts: true,
          canEditContacts: true,
          canDeleteContacts: true,
          canCreateProposals: true,
          canExportData: true,
          canManageFunnels: true,
          canManageUsers: true,
          canTriggerCalls: true,
          canViewReports: true,
          canManageSettings: true,
        },
        viewScope: 'all',
      },
      status: 'active',
      joinedAt: now,
      invitedBy: result,
    })

    return NextResponse.json({ orgId: orgRef.id })
  } catch (error: any) {
    console.error('[super-admin/organizations] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const result = await requireSuperAdmin(req)
  if (result instanceof NextResponse) return result

  try {
    const { orgId, name, plan, status } = await req.json()
    if (!orgId) return NextResponse.json({ error: 'missing orgId' }, { status: 400 })

    const db = getAdminDb()
    const update: Record<string, any> = { updatedAt: new Date().toISOString() }
    if (name) update.name = name
    if (plan) update.plan = plan
    if (status) update.status = status

    await db.collection('organizations').doc(orgId).update(update)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[super-admin/organizations] PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
