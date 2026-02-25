import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/superAdmin'
import { addCredits } from '@/lib/credits'
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
    const orgId = req.nextUrl.searchParams.get('orgId')
    const adminDb = getAdminDb()

    if (!orgId) {
      // Retorna lista de orgs
      const snap = await adminDb.collection('organizations').orderBy('name').get()
      const orgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      return NextResponse.json({ orgs })
    }

    // Retorna saldo + transações de uma org
    const balanceDoc = await adminDb.doc(`organizations/${orgId}/credits/balance`).get()
    const balance = balanceDoc.exists ? balanceDoc.data() : null

    const txSnap = await adminDb
      .collection(`organizations/${orgId}/creditTransactions`)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

    return NextResponse.json({ balance, transactions })
  } catch (error: any) {
    console.error('[super-admin/credits] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const result = await requireSuperAdmin(req)
  if (result instanceof NextResponse) return result

  try {
    const { orgId, amount, description } = await req.json()
    if (!orgId || typeof amount !== 'number' || amount === 0) {
      return NextResponse.json({ error: 'missing orgId or invalid amount' }, { status: 400 })
    }

    await addCredits(
      orgId,
      amount,
      'adjustment',
      description || (amount > 0 ? 'Creditos adicionados via Super Admin' : 'Creditos removidos via Super Admin'),
      result
    )

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[super-admin/credits] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
