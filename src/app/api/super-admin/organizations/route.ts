import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/superAdmin'
import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin'
import { getEmailProviderConfig, createProvider } from '@/lib/email/emailProvider'

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
      adminEmail: adminEmail.toLowerCase(),
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

    // Create Firebase Auth user with temporary password
    const auth = getAdminAuth()
    const tempPassword = `Voxium@${Math.random().toString(36).slice(2, 10)}`
    let userId = ''
    try {
      // Check if user already exists
      const existingUser = await auth.getUserByEmail(adminEmail.toLowerCase()).catch(() => null)
      if (existingUser) {
        userId = existingUser.uid
      } else {
        const newUser = await auth.createUser({
          email: adminEmail.toLowerCase(),
          password: tempPassword,
          displayName: adminEmail.split('@')[0],
        })
        userId = newUser.uid
      }
    } catch (authErr) {
      console.error('[super-admin] Auth user creation error:', authErr)
    }

    // Add admin member
    await orgRef.collection('members').doc().set({
      userId,
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

    // Send welcome email with credentials
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.voxium.com.br'
      const emailConfig = await getEmailProviderConfig(orgRef.id)
      const provider = createProvider(emailConfig.primaryProvider, emailConfig)
      const from = emailConfig.fromEmail
        ? `${emailConfig.fromName || 'Voxium'} <${emailConfig.fromEmail}>`
        : undefined

      const welcomeHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #13DEFC, #8B5CF6); padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Voxium CRM</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">Sua plataforma de vendas inteligente</p>
          </div>
          <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #1e293b; margin-top: 0;">Bem-vindo ao Voxium!</h2>
            <p style="color: #475569; line-height: 1.6;">
              A empresa <strong>${name}</strong> foi cadastrada com sucesso no Voxium CRM.
              Você é o administrador principal e pode gerenciar usuários, funis e configurações.
            </p>
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1e293b; font-size: 14px;">Suas credenciais de acesso:</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Email:</td>
                  <td style="padding: 6px 0; color: #1e293b; font-weight: 600; font-size: 13px;">${adminEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Senha temporária:</td>
                  <td style="padding: 6px 0; color: #1e293b; font-weight: 600; font-size: 13px;">${tempPassword}</td>
                </tr>
              </table>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin: 16px 0;">
              <p style="margin: 0; color: #92400e; font-size: 13px;">
                <strong>Importante:</strong> Troque sua senha no primeiro acesso em Configurações > Segurança.
              </p>
            </div>
            <a href="${appUrl}/login" style="display: inline-block; background: linear-gradient(135deg, #13DEFC, #8B5CF6); color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 8px;">
              Acessar o Voxium
            </a>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; margin-bottom: 0;">
              Este é um email automático do Voxium CRM. Não responda a este email.
            </p>
          </div>
        </div>
      `

      await provider.send(
        adminEmail.toLowerCase(),
        `Bem-vindo ao Voxium — Acesso criado para ${name}`,
        welcomeHtml,
        from
      )
    } catch (emailErr) {
      console.error('[super-admin] Welcome email error:', emailErr)
    }

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
