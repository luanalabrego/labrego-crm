import { getAdminDb } from './firebaseAdmin'
import type { AutomationConfig } from '@/types/cadence'
import { DEFAULT_AUTOMATION_CONFIG } from '@/types/cadence'

function getConfigRef(orgId: string) {
  return getAdminDb().collection('organizations').doc(orgId).collection('automationConfig').doc('global')
}

export async function getAutomationConfig(orgId: string): Promise<AutomationConfig> {
  const doc = await getConfigRef(orgId).get()
  if (!doc.exists) return { ...DEFAULT_AUTOMATION_CONFIG }
  return { ...DEFAULT_AUTOMATION_CONFIG, ...doc.data() } as AutomationConfig
}

export async function updateAutomationConfig(
  orgId: string,
  data: Partial<AutomationConfig>
): Promise<void> {
  await getConfigRef(orgId).set(data, { merge: true })
}

export async function isAutomationEnabled(orgId: string): Promise<boolean> {
  const config = await getAutomationConfig(orgId)
  return config.enabled
}

export async function isWithinWorkHours(orgId: string): Promise<boolean> {
  const config = await getAutomationConfig(orgId)
  const now = new Date()
  // Use simple hour comparison (timezone handled by cron scheduling)
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  return currentTime >= config.workHoursStart && currentTime <= config.workHoursEnd
}

export async function getTodayActionCount(orgId: string): Promise<number> {
  const db = getAdminDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()

  try {
    const snap = await db
      .collection('organizations').doc(orgId).collection('cadenceExecutionLog')
      .where('executedAt', '>=', todayStr)
      .where('status', 'in', ['success', 'failed'])
      .get()

    return snap.size
  } catch (error) {
    // Index might not exist yet — allow execution with count 0
    console.warn(`getTodayActionCount failed for org ${orgId}, assuming 0:`, error instanceof Error ? error.message : error)
    return 0
  }
}

export async function getTodayPhoneCallCount(orgId: string): Promise<number> {
  const db = getAdminDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString()

  try {
    const snap = await db
      .collection('organizations').doc(orgId).collection('cadenceExecutionLog')
      .where('executedAt', '>=', todayStr)
      .get()

    return snap.docs.filter(d => {
      const data = d.data()
      return data.channel === 'phone' && (data.status === 'success' || data.status === 'failed')
    }).length
  } catch (error) {
    console.warn(`getTodayPhoneCallCount failed for org ${orgId}, assuming 0:`, error instanceof Error ? error.message : error)
    return 0
  }
}
