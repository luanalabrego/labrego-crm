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
  const tz = config.timezone || 'America/Sao_Paulo'
  const localTime = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  const [localHours, localMinutes] = localTime.split(':').map(Number)
  const currentTime = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(2, '0')}`
  return currentTime >= config.workHoursStart && currentTime <= config.workHoursEnd
}

function getTodayStartISO(): string {
  // Get today's date in São Paulo timezone, then midnight BRT as ISO
  const now = new Date()
  const spDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD
  return new Date(spDate + 'T00:00:00-03:00').toISOString()
}

export async function getTodayActionCount(orgId: string): Promise<number> {
  const db = getAdminDb()
  const todayStr = getTodayStartISO()

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
  const todayStr = getTodayStartISO()

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

export async function getTodayPhoneCallCountByStage(orgId: string): Promise<Map<string, number>> {
  const db = getAdminDb()
  const todayStr = getTodayStartISO()

  try {
    const snap = await db
      .collection('organizations').doc(orgId).collection('cadenceExecutionLog')
      .where('executedAt', '>=', todayStr)
      .get()

    const counts = new Map<string, number>()
    for (const doc of snap.docs) {
      const data = doc.data()
      if (data.channel === 'phone' && (data.status === 'success' || data.status === 'failed')) {
        const stageId = (data.stageId as string) || '__unknown__'
        counts.set(stageId, (counts.get(stageId) || 0) + 1)
      }
    }
    return counts
  } catch (error) {
    console.warn(`getTodayPhoneCallCountByStage failed for org ${orgId}:`, error instanceof Error ? error.message : error)
    return new Map()
  }
}
