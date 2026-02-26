import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isSuperAdmin } from '@/lib/superAdmin'
import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin'
import { sendWithFallback } from '@/lib/email/emailProvider'

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildWelcomeEmailHtml(orgName: string, email: string, tempPassword: string, loginUrl: string): string {
  const safeOrgName = escapeHtml(orgName)
  const safeEmail = escapeHtml(email)

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#13DEFC,#09B00F);padding:32px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:28px;">Voxium CRM</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Bem-vindo ao Voxium CRM!</h2>
          <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 12px;">
            A empresa <strong>${safeOrgName}</strong> foi criada e sua conta de administrador está pronta.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 8px;color:#555;font-size:14px;"><strong>E-mail:</strong> ${safeEmail}</p>
              <p style="margin:0;color:#555;font-size:14px;"><strong>Senha temporária:</strong> ${escapeHtml(tempPassword)}</p>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin:24px auto;">
            <tr><td style="background:#09B00F;border-radius:8px;">
              <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px;">Acessar o sistema</a>
            </td></tr>
          </table>
          <p style="color:#888;font-size:13px;line-height:1.5;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px;">
            Por segurança, recomendamos que você altere sua senha no primeiro acesso.
            Utilize a opção "Esqueci minha senha" na tela de login para criar uma nova senha.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
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
    const adminAuth = getAdminAuth()
    const orgRef = db.collection('organizations').doc()
    const now = new Date().toISOString()
    const normalizedEmail = adminEmail.toLowerCase()

    // 1. Generate secure temporary password
    const tempPassword = crypto.randomBytes(16).toString('base64url').slice(0, 12)

    // 2. Create Firebase Auth user (or use existing)
    let userId: string
    let adminCreated = true

    try {
      const userRecord = await adminAuth.createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: name + ' Admin',
      })
      userId = userRecord.uid
    } catch (authError: any) {
      if (authError.code === 'auth/email-already-exists') {
        const existingUser = await adminAuth.getUserByEmail(normalizedEmail)
        userId = existingUser.uid
        adminCreated = false
      } else {
        throw authError
      }
    }

    // 3. Create organization
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

    // 4. Create credits/balance doc
    await orgRef.collection('credits').doc('balance').set({
      balance: 0,
      totalPurchased: 0,
      totalConsumed: 0,
    })

    // 5. Add admin member with real userId
    await orgRef.collection('members').doc().set({
      userId,
      email: normalizedEmail,
      displayName: name,
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

    // 6. Send welcome email only for newly created users (non-blocking)
    let emailSent = false
    if (adminCreated) {
      try {
        const loginUrl = `${req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://app.voxium.com.br'}/login`
        const html = buildWelcomeEmailHtml(name, normalizedEmail, tempPassword, loginUrl)
        const emailResult = await sendWithFallback(orgRef.id, normalizedEmail, 'Bem-vindo ao Voxium CRM', html)
        emailSent = emailResult.success
        if (!emailResult.success) {
          console.error('[super-admin/organizations] Welcome email failed:', emailResult.error)
        }
      } catch (emailError) {
        console.error('[super-admin/organizations] Welcome email error:', emailError)
      }
    }

    // 7. Return response
    const response: Record<string, unknown> = { orgId: orgRef.id, adminCreated, emailSent }
    if (adminCreated && !emailSent) {
      response.tempPassword = tempPassword
    }

    return NextResponse.json(response)
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
