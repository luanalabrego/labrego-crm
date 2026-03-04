import { getAdminDb } from './firebaseAdmin'
import { FieldValue } from 'firebase-admin/firestore'
import type { CreditBalance, CreditTransaction } from '@/types/credits'

function getCreditsRef(orgId: string) {
  const db = getAdminDb()
  return db.collection('organizations').doc(orgId).collection('credits').doc('balance')
}

function getTransactionsRef(orgId: string) {
  const db = getAdminDb()
  return db.collection('organizations').doc(orgId).collection('creditTransactions')
}

// ========== READ ==========

export async function getCreditBalance(orgId: string): Promise<CreditBalance> {
  const doc = await getCreditsRef(orgId).get()
  if (!doc.exists) {
    return {
      balance: 0, totalPurchased: 0, totalConsumed: 0,
      actionBalance: 0, actionTotalPurchased: 0, actionTotalConsumed: 0,
    }
  }
  const data = doc.data()!
  return {
    balance: data.balance ?? 0,
    totalPurchased: data.totalPurchased ?? 0,
    totalConsumed: data.totalConsumed ?? 0,
    lastRechargeAt: data.lastRechargeAt,
    lastConsumedAt: data.lastConsumedAt,
    actionBalance: data.actionBalance ?? 0,
    actionTotalPurchased: data.actionTotalPurchased ?? 0,
    actionTotalConsumed: data.actionTotalConsumed ?? 0,
    lastActionConsumedAt: data.lastActionConsumedAt,
  }
}

// ========== CHECKS ==========

export async function hasCredits(orgId: string, requiredMinutes: number = 1): Promise<boolean> {
  const credits = await getCreditBalance(orgId)
  return credits.balance >= requiredMinutes
}

export async function hasActionCredits(orgId: string, required: number = 1): Promise<boolean> {
  const credits = await getCreditBalance(orgId)
  return credits.actionBalance >= required
}

/** Check if org can make a call (needs both action credit + minute credit) */
export async function canMakeCall(orgId: string): Promise<{ allowed: boolean; reason?: string }> {
  const credits = await getCreditBalance(orgId)
  if (credits.actionBalance < 1) {
    return { allowed: false, reason: 'Creditos de acoes esgotados' }
  }
  if (credits.balance < 1) {
    return { allowed: false, reason: 'Creditos de minutos esgotados' }
  }
  return { allowed: true }
}

/** Check if org can send a WhatsApp message (needs action credit) */
export async function canSendWhatsApp(orgId: string): Promise<{ allowed: boolean; reason?: string }> {
  const credits = await getCreditBalance(orgId)
  if (credits.actionBalance < 1) {
    return { allowed: false, reason: 'Creditos de acoes esgotados' }
  }
  return { allowed: true }
}

// ========== DEDUCTIONS ==========

/** Deduct minute credits (called when a call ends, based on duration) */
export async function deductCredits(orgId: string, minutes: number, callId?: string, description?: string): Promise<CreditTransaction> {
  const now = new Date().toISOString()
  const deduction = Math.ceil(minutes) // round up

  // Idempotency: check if already deducted for this callId
  if (callId) {
    const existing = await getTransactionsRef(orgId)
      .where('callId', '==', callId)
      .where('creditType', '==', 'minutes')
      .limit(1)
      .get()
    if (!existing.empty) {
      return { id: existing.docs[0].id, ...existing.docs[0].data() } as CreditTransaction
    }
  }

  // Atomic decrement
  await getCreditsRef(orgId).update({
    balance: FieldValue.increment(-deduction),
    totalConsumed: FieldValue.increment(deduction),
    lastConsumedAt: now,
  })

  const newBalance = await getCreditBalance(orgId)

  const txData = {
    orgId,
    type: 'consumption' as const,
    creditType: 'minutes' as const,
    amount: -deduction,
    balance: newBalance.balance,
    description: description || `Ligacao: ${deduction} minuto(s)`,
    callId: callId || '',
    createdAt: now,
  }

  const txRef = getTransactionsRef(orgId).doc()
  await txRef.set(txData)

  return { id: txRef.id, ...txData }
}

/** Deduct one action credit (called before initiating a call or sending WhatsApp) */
export async function deductAction(
  orgId: string,
  actionType: 'call' | 'whatsapp',
  referenceId?: string,
  description?: string
): Promise<CreditTransaction> {
  const now = new Date().toISOString()

  await getCreditsRef(orgId).update({
    actionBalance: FieldValue.increment(-1),
    actionTotalConsumed: FieldValue.increment(1),
    lastActionConsumedAt: now,
  })

  const newBalance = await getCreditBalance(orgId)

  const txData = {
    orgId,
    type: 'consumption' as const,
    creditType: 'actions' as const,
    amount: -1,
    balance: newBalance.actionBalance,
    description: description || (actionType === 'call' ? 'Ligacao realizada' : 'Mensagem WhatsApp enviada'),
    callId: referenceId || '',
    createdAt: now,
  }

  const txRef = getTransactionsRef(orgId).doc()
  await txRef.set(txData)

  return { id: txRef.id, ...txData }
}

// ========== ADDITIONS ==========

export async function addCredits(
  orgId: string,
  amount: number,
  creditType: 'minutes' | 'actions',
  type: 'purchase' | 'bonus' | 'adjustment',
  description: string,
  adminEmail?: string
): Promise<CreditTransaction> {
  const now = new Date().toISOString()

  if (creditType === 'minutes') {
    await getCreditsRef(orgId).update({
      balance: FieldValue.increment(amount),
      totalPurchased: FieldValue.increment(amount),
      lastRechargeAt: now,
    })
  } else {
    await getCreditsRef(orgId).update({
      actionBalance: FieldValue.increment(amount),
      actionTotalPurchased: FieldValue.increment(amount),
      lastRechargeAt: now,
    })
  }

  const newBalance = await getCreditBalance(orgId)

  const txData = {
    orgId,
    type,
    creditType,
    amount,
    balance: creditType === 'minutes' ? newBalance.balance : newBalance.actionBalance,
    description,
    adminEmail: adminEmail || '',
    createdAt: now,
  }

  const txRef = getTransactionsRef(orgId).doc()
  await txRef.set(txData)

  return { id: txRef.id, ...txData }
}

// ========== QUERIES ==========

export async function getTransactions(orgId: string, limit: number = 50): Promise<CreditTransaction[]> {
  const snap = await getTransactionsRef(orgId).orderBy('createdAt', 'desc').limit(limit).get()
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CreditTransaction))
}
