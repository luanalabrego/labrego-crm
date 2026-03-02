'use client'

import { useState, useEffect, useCallback } from 'react'
import { auth } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { usePlan } from '@/hooks/usePlan'
import { useOrganization } from '@/hooks/useOrganization'
import {
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_DISPLAY,
  FEATURE_LABELS,
  type PlanId,
  type FeatureKey,
} from '@/types/plan'
import PermissionGate from '@/components/PermissionGate'
import EmailProviderSection from '@/components/EmailProviderSection'

/* -------------------------------- Helpers -------------------------------- */

const ALL_PLANS: PlanId[] = ['basic', 'standard', 'pro']

const ALL_FEATURES: FeatureKey[] = [
  'funnel',
  'contacts',
  'proposals',
  'cadence',
  'productivity',
  'whatsapp_plugin',
  'email_automation',
  'crm_automation',
  'voice_agent',
  'whatsapp_agent',
  'ai_reports',
]

const PLAN_ORDER: Record<PlanId, number> = { basic: 0, standard: 1, pro: 2 }

function CheckIcon() {
  return (
    <svg
      className="h-5 w-5 text-emerald-500 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      className="h-5 w-5 text-red-400 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function formatLimit(value: number): string {
  if (value >= 10000) return value.toLocaleString('pt-BR')
  return String(value)
}

/* -------------------------------- Page ----------------------------------- */

export default function PlanoPage() {
  const { orgPlan } = useCrmUser()
  const { plan: currentPlan, limits: currentLimits, display: currentDisplay } = usePlan()
  const { org, loading } = useOrganization()
  const [contactSent, setContactSent] = useState<PlanId | null>(null)

  const isHigherPlan = (target: PlanId) => PLAN_ORDER[target] > PLAN_ORDER[currentPlan]

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
        {/* ---------------------- Header ---------------------- */}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Plano e Assinatura
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Visualize seu plano atual e compare os recursos disponiveis.
          </p>
        </div>

        {/* --------------- Current Plan Card --------------- */}
        <div className="rounded-2xl border-2 border-primary-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-primary-600">Plano atual</p>
              <h3 className="mt-1 text-3xl font-bold text-slate-900">
                {currentDisplay.displayName}
              </h3>
              <p className="mt-1 text-lg text-slate-600">
                R$ {currentDisplay.price}
                <span className="text-sm text-slate-400">/mes</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <UsageStat
                label="Usuarios"
                current={org?.limits?.maxUsers ?? 0}
                limit={currentLimits.maxUsers}
              />
              <UsageStat
                label="Funis"
                current={org?.limits?.maxFunnels ?? 0}
                limit={currentLimits.maxFunnels}
              />
              <UsageStat
                label="Contatos"
                current={org?.limits?.maxContacts ?? 0}
                limit={currentLimits.maxContacts}
              />
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xs font-medium text-slate-500">Creditos mensais</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {currentLimits.monthlyCredits}
                  <span className="ml-1 text-xs font-normal text-slate-400">min</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* --------------- Plan Comparison Cards --------------- */}
        <div className="grid gap-6 md:grid-cols-3">
          {ALL_PLANS.map((planId) => {
            const display = PLAN_DISPLAY[planId]
            const limits = PLAN_LIMITS[planId]
            const features = PLAN_FEATURES[planId]
            const isCurrent = planId === currentPlan
            const isUpgrade = isHigherPlan(planId)
            const isPro = planId === 'pro'

            return (
              <div
                key={planId}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition ${
                  isCurrent
                    ? 'border-primary-400 ring-2 ring-primary-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Badges */}
                {isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                    Mais popular
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-3 right-4 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                    Plano atual
                  </span>
                )}

                {/* Plan Header */}
                <div className="mb-4 mt-2">
                  <h4 className="text-xl font-bold text-slate-900">{display.displayName}</h4>
                  <p className="mt-1 text-2xl font-semibold text-slate-800">
                    R$ {display.price}
                    <span className="text-sm font-normal text-slate-400">/mes</span>
                  </p>
                </div>

                {/* Limits */}
                <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Usuarios</p>
                    <p className="font-semibold text-slate-800">ate {formatLimit(limits.maxUsers)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Funis</p>
                    <p className="font-semibold text-slate-800">ate {formatLimit(limits.maxFunnels)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Contatos</p>
                    <p className="font-semibold text-slate-800">ate {formatLimit(limits.maxContacts)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Creditos</p>
                    <p className="font-semibold text-slate-800">
                      {limits.monthlyCredits > 0 ? `${limits.monthlyCredits} min` : '--'}
                    </p>
                  </div>
                </div>

                {/* Features List */}
                <ul className="mb-6 flex-1 space-y-2">
                  {ALL_FEATURES.map((featureKey) => {
                    const included = features.includes(featureKey)
                    return (
                      <li key={featureKey} className="flex items-start gap-2 text-sm">
                        {included ? <CheckIcon /> : <XIcon />}
                        <span className={included ? 'text-slate-700' : 'text-slate-400'}>
                          {FEATURE_LABELS[featureKey]}
                        </span>
                      </li>
                    )
                  })}
                </ul>

                {/* Action Button */}
                <div className="mt-auto">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full cursor-not-allowed rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400"
                    >
                      Plano atual
                    </button>
                  ) : isUpgrade ? (
                    <div className="space-y-2">
                      <button
                        onClick={() => setContactSent(planId)}
                        disabled={contactSent === planId}
                        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98] ${
                          isPro
                            ? 'bg-primary-600 text-white hover:bg-primary-700'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        } ${contactSent === planId ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {contactSent === planId ? 'Solicitacao enviada' : 'Fazer upgrade'}
                      </button>
                      <p className="text-center text-xs text-slate-500">
                        Entre em contato com o time comercial
                      </p>
                    </div>
                  ) : (
                    <button
                      disabled
                      className="w-full cursor-not-allowed rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-400"
                    >
                      Plano inferior
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* --------------- Feature Comparison Table --------------- */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Comparativo de recursos
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Veja todos os recursos incluidos em cada plano.
            </p>
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-3 text-left font-medium text-slate-600">Recurso</th>
                  {ALL_PLANS.map((planId) => (
                    <th
                      key={planId}
                      className={`px-6 py-3 text-center font-medium ${
                        planId === currentPlan ? 'text-primary-700' : 'text-slate-600'
                      }`}
                    >
                      {PLAN_DISPLAY[planId].displayName}
                      {planId === currentPlan && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700">
                          ATUAL
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ALL_FEATURES.map((featureKey) => (
                  <tr key={featureKey} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 text-slate-700">{FEATURE_LABELS[featureKey]}</td>
                    {ALL_PLANS.map((planId) => (
                      <td key={planId} className="px-6 py-3 text-center">
                        {PLAN_FEATURES[planId].includes(featureKey) ? (
                          <span className="inline-flex justify-center">
                            <CheckIcon />
                          </span>
                        ) : (
                          <span className="inline-flex justify-center">
                            <XIcon />
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Limits rows */}
                <tr className="bg-slate-50/80">
                  <td className="px-6 py-3 font-medium text-slate-700">Usuarios</td>
                  {ALL_PLANS.map((planId) => (
                    <td key={planId} className="px-6 py-3 text-center font-semibold text-slate-800">
                      ate {formatLimit(PLAN_LIMITS[planId].maxUsers)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="px-6 py-3 font-medium text-slate-700">Funis</td>
                  {ALL_PLANS.map((planId) => (
                    <td key={planId} className="px-6 py-3 text-center font-semibold text-slate-800">
                      ate {formatLimit(PLAN_LIMITS[planId].maxFunnels)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="px-6 py-3 font-medium text-slate-700">Contatos</td>
                  {ALL_PLANS.map((planId) => (
                    <td key={planId} className="px-6 py-3 text-center font-semibold text-slate-800">
                      ate {formatLimit(PLAN_LIMITS[planId].maxContacts)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-slate-50/80">
                  <td className="px-6 py-3 font-medium text-slate-700">Creditos mensais</td>
                  {ALL_PLANS.map((planId) => (
                    <td key={planId} className="px-6 py-3 text-center font-semibold text-slate-800">
                      {PLAN_LIMITS[planId].monthlyCredits > 0
                        ? `${PLAN_LIMITS[planId].monthlyCredits} min`
                        : '--'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile stacked comparison */}
          <div className="sm:hidden divide-y divide-slate-100">
            {ALL_FEATURES.map((featureKey) => (
              <div key={featureKey} className="px-4 py-3">
                <p className="mb-2 text-sm font-medium text-slate-700">
                  {FEATURE_LABELS[featureKey]}
                </p>
                <div className="flex items-center gap-4">
                  {ALL_PLANS.map((planId) => (
                    <div key={planId} className="flex items-center gap-1 text-xs text-slate-500">
                      {PLAN_FEATURES[planId].includes(featureKey) ? <CheckIcon /> : <XIcon />}
                      <span>{PLAN_DISPLAY[planId].displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Mobile limits */}
            {(['maxUsers', 'maxFunnels', 'maxContacts', 'monthlyCredits'] as const).map(
              (limitKey) => {
                const labels: Record<string, string> = {
                  maxUsers: 'Usuarios',
                  maxFunnels: 'Funis',
                  maxContacts: 'Contatos',
                  monthlyCredits: 'Creditos mensais',
                }
                return (
                  <div key={limitKey} className="px-4 py-3 bg-slate-50/80">
                    <p className="mb-2 text-sm font-medium text-slate-700">{labels[limitKey]}</p>
                    <div className="flex items-center gap-4">
                      {ALL_PLANS.map((planId) => {
                        const val = PLAN_LIMITS[planId][limitKey]
                        return (
                          <div key={planId} className="text-xs text-slate-600">
                            <span className="font-semibold">
                              {PLAN_DISPLAY[planId].displayName}:
                            </span>{' '}
                            {limitKey === 'monthlyCredits'
                              ? val > 0
                                ? `${val} min`
                                : '--'
                              : `ate ${formatLimit(val)}`}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }
            )}
          </div>
        </div>
        {/* --------------- Email Provider Config --------------- */}
        <EmailProviderSection />
      </div>
    </PermissionGate>
  )
}

/* ---- EmailProviderSection moved to src/components/EmailProviderSection.tsx ---- */

/* ----------------------------- Sub-components ----------------------------- */

function UsageStat({
  label,
  current,
  limit,
}: {
  label: string
  current: number
  limit: number
}) {
  const ratio = limit > 0 ? current / limit : 0
  const isNearLimit = ratio >= 0.8

  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold ${
          isNearLimit ? 'text-amber-600' : 'text-slate-900'
        }`}
      >
        {formatLimit(current)}{' '}
        <span className="text-sm font-normal text-slate-400">/ {formatLimit(limit)}</span>
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all ${
            isNearLimit ? 'bg-amber-500' : 'bg-primary-500'
          }`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}
