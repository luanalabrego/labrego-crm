'use client'

import { usePlan } from '@/hooks/usePlan'
import { FEATURE_LABELS, PLAN_DISPLAY, type FeatureKey, type PlanId, PLAN_FEATURES } from '@/types/plan'

interface UpgradePromptProps {
  feature: FeatureKey
  className?: string
}

function getMinPlanForFeature(feature: FeatureKey): PlanId {
  const plans: PlanId[] = ['agency_start', 'direct_starter', 'agency_pro', 'direct_growth', 'agency_scale', 'direct_scale']
  for (const p of plans) {
    if (PLAN_FEATURES[p]?.includes(feature)) return p
  }
  return 'direct_starter'
}

export default function UpgradePrompt({ feature, className = '' }: UpgradePromptProps) {
  const { plan } = usePlan()
  const requiredPlan = getMinPlanForFeature(feature)
  const featureLabel = FEATURE_LABELS[feature]
  const planInfo = PLAN_DISPLAY[requiredPlan]

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 ${className}`}>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
        <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Recurso indisponivel no seu plano
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          <strong>{featureLabel}</strong> esta disponivel a partir do plano{' '}
          <span className="font-semibold text-primary-600">{planInfo.displayName}</span>.
        </p>
        <p className="text-xs text-gray-500 mb-6">
          Seu plano atual: <span className="font-medium capitalize">{PLAN_DISPLAY[plan]?.displayName || plan}</span>
        </p>
        <a
          href="/admin/plano"
          className="inline-flex items-center px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
        >
          Ver planos disponiveis
        </a>
      </div>
    </div>
  )
}
