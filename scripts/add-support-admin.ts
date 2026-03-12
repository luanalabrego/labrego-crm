/**
 * Script: Add support user as admin
 *
 * Adds the specified email as:
 *   1. Super Admin (superAdmins collection)
 *   2. Admin role (userRoles collection)
 *   3. Admin member in all active organizations (organizations/{orgId}/members)
 *
 * Usage:
 *   npx ts-node --skip-project scripts/add-support-admin.ts <email>
 *
 * Example:
 *   npx ts-node --skip-project scripts/add-support-admin.ts suporte@labregoia.com.br
 */

import * as admin from 'firebase-admin'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET } = process.env

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local')
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  storageBucket: FIREBASE_STORAGE_BUCKET || NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
})

const db = admin.firestore()

const EMAIL = (process.argv[2] || 'suporte@labregoia.com.br').toLowerCase()

async function main() {
  const now = new Date().toISOString()

  console.log('===========================================')
  console.log('  Add Support Admin Script')
  console.log('===========================================')
  console.log(`  Email: ${EMAIL}`)
  console.log('===========================================\n')

  // 1. Add to superAdmins collection
  await db.collection('superAdmins').doc(EMAIL).set({
    role: 'super_admin',
    createdAt: now,
  })
  console.log('  + Added to superAdmins collection')

  // 2. Add to userRoles collection
  await db.collection('userRoles').doc(EMAIL).set({
    role: 'admin',
    createdAt: now,
  })
  console.log('  + Added to userRoles collection (role: admin)')

  // 3. Add as admin member in all active organizations
  const orgsSnap = await db.collection('organizations').where('status', '==', 'active').get()
  console.log(`\n  Found ${orgsSnap.size} active organization(s)`)

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id
    const orgName = orgDoc.data().name || orgId

    // Check if already a member
    const existingMembers = await db
      .collection('organizations')
      .doc(orgId)
      .collection('members')
      .where('email', '==', EMAIL)
      .get()

    if (!existingMembers.empty) {
      // Update existing member to admin
      const memberDoc = existingMembers.docs[0]
      await memberDoc.ref.update({
        role: 'admin',
        permissions: {
          pages: [
            '/contatos', '/funil', '/funil/produtividade', '/conversao',
            '/cadencia', '/ligacoes', '/admin/usuarios', '/admin/creditos', '/admin/plano',
          ],
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
        updatedAt: now,
      })
      console.log(`  ~ Updated to admin in org: ${orgName} (${orgId})`)
    } else {
      // Add as new admin member
      const memberRef = db.collection('organizations').doc(orgId).collection('members').doc()
      await memberRef.set({
        id: memberRef.id,
        userId: EMAIL,
        email: EMAIL,
        role: 'admin',
        displayName: 'Suporte Labrego IA',
        permissions: {
          pages: [
            '/contatos', '/funil', '/funil/produtividade', '/conversao',
            '/cadencia', '/ligacoes', '/admin/usuarios', '/admin/creditos', '/admin/plano',
          ],
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
      })
      console.log(`  + Added as admin in org: ${orgName} (${orgId})`)
    }
  }

  console.log('\n===========================================')
  console.log('  DONE')
  console.log('===========================================')
  console.log(`  ${EMAIL} now has full admin access:`)
  console.log('    - Super Admin (platform level)')
  console.log('    - Admin role (userRoles)')
  console.log(`    - Admin member in ${orgsSnap.size} organization(s)`)
  console.log('===========================================')

  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
