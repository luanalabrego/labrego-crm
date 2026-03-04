'use client'

import { useCrmUser } from '@/contexts/CrmUserContext'
import { PLAN_FEATURES, PLAN_LIMITS, PLAN_DISPLAY, type FeatureKey, type PlanId } from '@/types/plan'

const DEFAULT_PLAN: PlanId = 'direct_starter'

function isValidPlan(plan: string): plan is PlanId {
  return plan in PLAN_LIMITS
}

export function usePlan() {
  const { orgPlan } = useCrmUser()
  const plan: PlanId = orgPlan && isValidPlan(orgPlan) ? orgPlan : DEFAULT_PLAN

  const hasFeature = (feature: FeatureKey): boolean => {
    return PLAN_FEATURES[plan]?.includes(feature) ?? false
  }

  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS[DEFAULT_PLAN]
  const display = PLAN_DISPLAY[plan] ?? PLAN_DISPLAY[DEFAULT_PLAN]

  return { plan, hasFeature, limits, display }
}
