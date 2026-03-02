import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin'
import { getEmailProviderConfig, createProvider } from '@/lib/email/emailProvider'
import { ROLE_PRESETS, type RolePreset } from '@/types/permissions'

export const runtime = 'nodejs'

/**
 * POST /api/admin/members/invite
 * Creates Firebase Auth user + org member + sends invitation email.
 */
export async function POST(req: NextRequest) {
  const callerEmail = req.headers.get('x-user-email')?.toLowerCase()
  if (!callerEmail) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  try {
    const { orgId, email, displayName, role } = await req.json()

    if (!orgId || !email || !displayName || !role) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const validRoles: RolePreset[] = ['admin', 'manager', 'seller', 'viewer']
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'invalid role' }, { status: 400 })
    }

    const db = getAdminDb()

    // Verify caller is admin of this org
    const callerSnap = await db
      .collection('organizations').doc(orgId)
      .collection('members')
      .where('email', '==', callerEmail)
      .limit(1)
      .get()

    if (callerSnap.empty) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const callerMember = callerSnap.docs[0].data()
    if (callerMember.role !== 'admin') {
      return NextResponse.json({ error: 'only admins can invite members' }, { status: 403 })
    }

    // Check if email already exists in org
    const existingSnap = await db
      .collection('organizations').doc(orgId)
      .collection('members')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get()

    if (!existingSnap.empty) {
      return NextResponse.json({ error: 'email already exists in organization' }, { status: 409 })
    }

    // Get org name for the email
    const orgDoc = await db.collection('organizations').doc(orgId).get()
    const orgName = orgDoc.data()?.name || 'Voxium CRM'

    // Create Firebase Auth user
    const auth = getAdminAuth()
    const tempPassword = `Voxium@${Math.random().toString(36).slice(2, 10)}`
    let userId = ''

    try {
      const existingUser = await auth.getUserByEmail(email.toLowerCase()).catch(() => null)
      if (existingUser) {
        userId = existingUser.uid
      } else {
        const newUser = await auth.createUser({
          email: email.toLowerCase(),
          password: tempPassword,
          displayName,
        })
        userId = newUser.uid
      }
    } catch (authErr) {
      console.error('[invite] Auth user creation error:', authErr)
      return NextResponse.json({ error: 'failed to create auth user' }, { status: 500 })
    }

    // Create member document
    const now = new Date().toISOString()
    const permissions = ROLE_PRESETS[role as RolePreset]
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc()

    await memberRef.set({
      userId,
      email: email.toLowerCase(),
      displayName,
      role,
      permissions,
      status: 'invited',
      joinedAt: now,
      invitedBy: callerEmail,
    })

    // Send invitation email
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.voxium.com.br'
      const emailConfig = await getEmailProviderConfig(orgId)
      const provider = createProvider(emailConfig.primaryProvider, emailConfig)
      const from = emailConfig.fromEmail
        ? `${emailConfig.fromName || 'Voxium'} <${emailConfig.fromEmail}>`
        : undefined

      const roleLabels: Record<string, string> = {
        admin: 'Administrador',
        manager: 'Gerente',
        seller: 'Vendedor',
        viewer: 'Visualizador',
      }

      const inviteHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #13DEFC, #8B5CF6); padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Voxium CRM</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">Sua plataforma de vendas inteligente</p>
          </div>
          <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #1e293b; margin-top: 0;">Voce foi convidado!</h2>
            <p style="color: #475569; line-height: 1.6;">
              Ola <strong>${displayName}</strong>, voce foi adicionado a equipe da empresa
              <strong>${orgName}</strong> no Voxium CRM como <strong>${roleLabels[role] || role}</strong>.
            </p>
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1e293b; font-size: 14px;">Suas credenciais de acesso:</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Email:</td>
                  <td style="padding: 6px 0; color: #1e293b; font-weight: 600; font-size: 13px;">${email}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Senha temporaria:</td>
                  <td style="padding: 6px 0; color: #1e293b; font-weight: 600; font-size: 13px;">${tempPassword}</td>
                </tr>
              </table>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin: 16px 0;">
              <p style="margin: 0; color: #92400e; font-size: 13px;">
                <strong>Importante:</strong> Troque sua senha no primeiro acesso.
              </p>
            </div>
            <a href="${appUrl}/login" style="display: inline-block; background: linear-gradient(135deg, #13DEFC, #8B5CF6); color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 8px;">
              Acessar o Voxium
            </a>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; margin-bottom: 0;">
              Este e um email automatico do Voxium CRM. Nao responda a este email.
            </p>
          </div>
        </div>
      `

      await provider.send(
        email.toLowerCase(),
        `Convite — Voce foi adicionado a ${orgName} no Voxium`,
        inviteHtml,
        from
      )
    } catch (emailErr) {
      console.error('[invite] Email error:', emailErr)
      // Don't fail the request if email fails — member was already created
    }

    return NextResponse.json({ memberId: memberRef.id, userId })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[invite] Error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
