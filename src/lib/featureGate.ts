import { getOrganization } from './organization'
import { PLAN_FEATURES, type FeatureKey, type PlanId } from '@/types/plan'

export function planHasFeature(plan: PlanId, feature: FeatureKey): boolean {
  return PLAN_FEATURES[plan].includes(feature)
}

export async function orgHasFeature(orgId: string, feature: FeatureKey): Promise<boolean> {
  const org = await getOrganization(orgId)
  if (!org) return false
  return planHasFeature(org.plan as PlanId, feature)
}

// Map routes to required features
const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  '/cadencia': 'cadence',
  '/funil/produtividade': 'productivity',
  '/ligacoes': 'voice_agent',
  '/campanhas': 'email_automation',
  '/analytics': 'ai_reports',
}

const API_FEATURE_MAP: Record<string, FeatureKey> = {
  '/api/call-routing': 'voice_agent',
  '/api/vapi': 'voice_agent',
  '/api/send-notification': 'email_automation',
  '/api/extension': 'whatsapp_plugin',
}

export function getRequiredFeatureForRoute(path: string): FeatureKey | null {
  for (const [route, feature] of Object.entries(ROUTE_FEATURE_MAP)) {
    if (path.startsWith(route)) return feature
  }
  return null
}

export function getRequiredFeatureForApi(path: string): FeatureKey | null {
  for (const [route, feature] of Object.entries(API_FEATURE_MAP)) {
    if (path.startsWith(route)) return feature
  }
  return null
}
