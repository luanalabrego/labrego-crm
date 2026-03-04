'use client'

import { useState } from 'react'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { usePlan } from '@/hooks/usePlan'
import { useOrganization } from '@/hooks/useOrganization'
import {
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_OVERAGE,
  PLAN_CATEGORY,
  type PlanId,
  type PlanCategory,
} from '@/types/plan'
import PermissionGate from '@/components/PermissionGate'
import EmailProviderSection from '@/components/EmailProviderSection'

/* -------------------------------- Helpers -------------------------------- */

const AGENCY_PLANS: PlanId[] = ['agency_start', 'agency_pro', 'agency_scale']
const DIRECT_PLANS: PlanId[] = ['direct_starter', 'direct_growth', 'direct_scale']

const PLAN_ORDER: Record<PlanId, number> = {
  agency_start: 0, agency_pro: 1, agency_scale: 2,
  direct_starter: 0, direct_growth: 1, direct_scale: 2,
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function formatLimit(value: number): string {
  if (value >= 1000) return value.toLocaleString('pt-BR')
  return String(value)
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* -------------------------------- Page ----------------------------------- */

export default function PlanoPage() {
  const { plan: currentPlan, limits: currentLimits, display: currentDisplay } = usePlan()
  const { org, loading } = useOrganization()
  const [contactSent, setContactSent] = useState<PlanId | null>(null)
  const [viewCategory, setViewCategory] = useState<PlanCategory>(PLAN_CATEGORY[currentPlan] || 'direct')

  const currentCategory = PLAN_CATEGORY[currentPlan] || 'direct'
  const isHigherPlan = (target: PlanId) => {
    if (PLAN_CATEGORY[target] !== currentCategory) return true
    return PLAN_ORDER[target] > PLAN_ORDER[currentPlan]
  }

  const plansToShow = viewCategory === 'agency' ? AGENCY_PLANS : DIRECT_PLANS

  if (loading) {
    return (
      <PermissionGate action="canManageSettings">
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      </PermissionGate>
    )
  }

  return (
    <PermissionGate action="canManageSettings">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Plano e Assinatura</h2>
          <p className="mt-1 text-sm text-slate-500">Visualize seu plano atual e compare os recursos disponiveis.</p>
        </div>

        {/* Current Plan Card */}
        <div className="rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-primary-600">Plano atual</p>
              <h3 className="mt-1 text-3xl font-bold text-slate-900">{currentDisplay.displayName}</h3>
              <p className="mt-1 text-lg text-slate-600">
                R$ {formatCurrency(currentDisplay.price)}
                <span className="text-sm text-slate-400">/{currentCategory === 'agency' ? 'projeto' : 'mes'}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs font-medium text-slate-500">Acoes/mes</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatLimit(currentLimits.monthlyActions)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs font-medium text-slate-500">Minutos/mes</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatLimit(currentLimits.monthlyMinutes)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs font-medium text-slate-500">Agentes</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {currentLimits.maxConcurrentAgents}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs font-medium text-slate-500">Numeros</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {currentLimits.maxNumbers}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewCategory('direct')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              viewCategory === 'direct' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Planos Diretos
          </button>
          <button
            onClick={() => setViewCategory('agency')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              viewCategory === 'agency' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Planos Agency
          </button>
        </div>

        {/* Plan Comparison Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {plansToShow.map((planId) => {
            const display = PLAN_DISPLAY[planId]
            const limits = PLAN_LIMITS[planId]
            const overage = PLAN_OVERAGE[planId]
            const isCurrent = planId === currentPlan
            const isUpgrade = isHigherPlan(planId)
            const isTopPlan = planId === 'agency_scale' || planId === 'direct_scale'

            return (
              <div
                key={planId}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition ${
                  isCurrent ? 'border-primary-400 ring-2 ring-primary-200' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {isTopPlan && !isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                    Mais popular
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-3 right-4 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                    Plano atual
                  </span>
                )}

                <div className="mb-4 mt-2">
                  <h4 className="text-xl font-bold text-slate-900">{display.displayName}</h4>
                  <p className="mt-1 text-2xl font-semibold text-slate-800">
                    R$ {formatCurrency(display.price)}
                    <span className="text-sm font-normal text-slate-400">/{viewCategory === 'agency' ? 'projeto' : 'mes'}</span>
                  </p>
                </div>

                {/* Limits */}
                <div className="mb-4 space-y-2 text-sm">
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Acoes/mes</span>
                    <span className="font-semibold text-slate-800">{formatLimit(limits.monthlyActions)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Minutos falados</span>
                    <span className="font-semibold text-slate-800">{formatLimit(limits.monthlyMinutes)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Agentes simultaneos</span>
                    <span className="font-semibold text-slate-800">{limits.maxConcurrentAgents}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Numeros dedicados</span>
                    <span className="font-semibold text-slate-800">{limits.maxNumbers}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Cadencias</span>
                    <span className="font-semibold text-slate-800">{limits.maxCadences === -1 ? 'Ilimitadas' : limits.maxCadences}</span>
                  </div>
                </div>

                {/* Included */}
                <ul className="mb-4 space-y-1.5 text-sm">
                  <li className="flex items-center gap-2"><CheckIcon /><span className="text-slate-700">WhatsApp + E-mail</span></li>
                  <li className="flex items-center gap-2"><CheckIcon /><span className="text-slate-700">Integracao com CRM</span></li>
                  <li className="flex items-center gap-2"><CheckIcon /><span className="text-slate-700">Agente de voz IA</span></li>
                  <li className="flex items-center gap-2"><CheckIcon /><span className="text-slate-700">Automacao de cadencia</span></li>
                </ul>

                {/* Overage */}
                <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Excedente: R$ {formatCurrency(overage.perAction)}/acao · R$ {formatCurrency(overage.perMinute)}/min
                </div>

                {/* Action Button */}
                <div className="mt-auto">
                  {isCurrent ? (
                    <button disabled className="w-full cursor-not-allowed rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400">
                      Plano atual
                    </button>
                  ) : isUpgrade ? (
                    <button
                      onClick={() => setContactSent(planId)}
                      disabled={contactSent === planId}
                      className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98] bg-primary-600 text-white hover:bg-primary-700 ${
                        contactSent === planId ? 'cursor-not-allowed opacity-60' : ''
                      }`}
                    >
                      {contactSent === planId ? 'Solicitacao enviada' : 'Fazer upgrade'}
                    </button>
                  ) : (
                    <button disabled className="w-full cursor-not-allowed rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-400">
                      Plano inferior
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Email Provider Config */}
        <EmailProviderSection />
      </div>
    </PermissionGate>
  )
}
