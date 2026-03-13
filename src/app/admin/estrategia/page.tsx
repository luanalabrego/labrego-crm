'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import {
  BookOpenIcon,
  BuildingOfficeIcon,
  UserGroupIcon,
  SparklesIcon,
  ArrowPathRoundedSquareIcon,
  CheckBadgeIcon,
  DocumentTextIcon,
  UsersIcon,
  ClockIcon,
  ShieldExclamationIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'

type PlaybookSection = {
  key: string
  title: string
  description: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  placeholder: string
  color: string
}

const SECTIONS: PlaybookSection[] = [
  {
    key: 'empresaProduto',
    title: 'Empresa e Produto',
    description: 'Descreva sua empresa, produto/serviço e diferenciais',
    icon: BuildingOfficeIcon,
    placeholder: 'Ex: A Voxium é uma plataforma de CRM inteligente com IA para automatizar ligações de prospecção...',
    color: 'from-blue-500 to-blue-600',
  },
  {
    key: 'publicoAlvo',
    title: 'Público-Alvo e Persona',
    description: 'Defina quem é seu cliente ideal (ICP), personas e segmentos',
    icon: UserGroupIcon,
    placeholder: 'Ex: Empresas B2B de médio porte, 50-500 funcionários, segmentos de tecnologia e serviços...',
    color: 'from-purple-500 to-purple-600',
  },
  {
    key: 'propostaValor',
    title: 'Proposta de Valor',
    description: 'O que torna sua solução única e por que o cliente deve escolher você',
    icon: SparklesIcon,
    placeholder: 'Ex: Automatizamos o processo de prospecção com IA, reduzindo em 70% o tempo gasto em ligações manuais...',
    color: 'from-amber-500 to-amber-600',
  },
  {
    key: 'processoComercial',
    title: 'Processo Comercial',
    description: 'Etapas do funil de vendas, da prospecção ao fechamento',
    icon: ArrowPathRoundedSquareIcon,
    placeholder: 'Ex: 1. Prospecção → 2. Qualificação → 3. Demonstração → 4. Proposta → 5. Negociação → 6. Fechamento...',
    color: 'from-emerald-500 to-emerald-600',
  },
  {
    key: 'qualificacao',
    title: 'Qualificação',
    description: 'Critérios para qualificar leads (BANT, MEDDIC, GPCTBA/C&I)',
    icon: CheckBadgeIcon,
    placeholder: 'Ex: Critérios BANT - Budget: mínimo R$5k/mês, Authority: decisor C-level, Need: precisa automatizar...',
    color: 'from-cyan-500 to-cyan-600',
  },
  {
    key: 'roteiroVendas',
    title: 'Roteiro de Vendas',
    description: 'Script de abordagem, perguntas-chave, técnicas de fechamento',
    icon: DocumentTextIcon,
    placeholder: 'Ex: Abertura: "Olá [nome], vi que vocês trabalham com [segmento]..." | Perguntas de dor: "Como vocês..."',
    color: 'from-rose-500 to-rose-600',
  },
  {
    key: 'concorrentes',
    title: 'Concorrentes',
    description: 'Análise competitiva, diferenças e argumentos contra objeções',
    icon: UsersIcon,
    placeholder: 'Ex: Concorrente A: foco em enterprise, preço alto | Nossa vantagem: automação com IA, preço acessível...',
    color: 'from-orange-500 to-orange-600',
  },
  {
    key: 'cadencia',
    title: 'Cadência',
    description: 'Frequência e sequência de contatos por canal (calls, emails, WhatsApp)',
    icon: ClockIcon,
    placeholder: 'Ex: Dia 1: Ligação + Email | Dia 3: WhatsApp | Dia 5: Email follow-up | Dia 7: Ligação...',
    color: 'from-indigo-500 to-indigo-600',
  },
  {
    key: 'matrizObjecoes',
    title: 'Matriz de Objeções',
    description: 'Objeções comuns e respostas preparadas',
    icon: ShieldExclamationIcon,
    placeholder: 'Ex: "É muito caro" → "Entendo, mas comparando com o custo de X vendedores fazendo prospecção manual..."',
    color: 'from-red-500 to-red-600',
  },
]

type PlaybookData = Record<string, string>

export default function EstrategiaComercialPage() {
  const { orgId } = useCrmUser()
  const [data, setData] = useState<PlaybookData>({})
  const [savedData, setSavedData] = useState<PlaybookData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!orgId) return
    try {
      const docRef = doc(db, 'organizations', orgId, 'settings', 'playbook')
      const snap = await getDoc(docRef)
      if (snap.exists()) {
        const loadedData = snap.data() as PlaybookData
        setData(loadedData)
        setSavedData(loadedData)
      }
    } catch (error) {
      console.error('Erro ao carregar playbook:', error)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const hasChanges = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(data),
      ...Object.keys(savedData),
      ...SECTIONS.map((s) => s.key),
    ])
    for (const key of allKeys) {
      if (key === 'updatedAt') continue
      if ((data[key] || '') !== (savedData[key] || '')) return true
    }
    return false
  }, [data, savedData])

  const handleSave = async () => {
    if (!orgId) return
    setSaving(true)
    try {
      const docRef = doc(db, 'organizations', orgId, 'settings', 'playbook')
      await setDoc(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true })
      setSavedData({ ...data })
      toast.success('Playbook salvo com sucesso!')
    } catch (error) {
      console.error('Erro ao salvar playbook:', error)
      toast.error('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  const filledCount = SECTIONS.filter((s) => data[s.key]?.trim()).length

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-slate-600 font-medium">Carregando playbook...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl shadow-lg shadow-primary-200">
              <BookOpenIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Estratégia Comercial</h1>
              <p className="text-sm text-slate-500">Playbook de vendas da sua empresa</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {filledCount}/{SECTIONS.length} seções preenchidas
            </span>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <CheckIcon className="w-4 h-4" />
              )}
              Salvar
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6 bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700">Progresso do Playbook</p>
          <p className="text-sm font-bold text-primary-600">{Math.round((filledCount / SECTIONS.length) * 100)}%</p>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${(filledCount / SECTIONS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isFilled = !!data[section.key]?.trim()
          const isExpanded = expandedSection === section.key

          return (
            <div
              key={section.key}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden transition-all"
            >
              {/* Section Header */}
              <button
                onClick={() => setExpandedSection(isExpanded ? null : section.key)}
                className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors text-left"
              >
                <div className={`p-2 rounded-xl bg-gradient-to-br ${section.color} shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
                    {isFilled && (
                      <span className="flex items-center justify-center w-5 h-5 bg-emerald-100 rounded-full">
                        <CheckIcon className="w-3 h-3 text-emerald-600" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
                </div>
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-100">
                  <textarea
                    value={data[section.key] || ''}
                    onChange={(e) => handleChange(section.key, e.target.value)}
                    placeholder={section.placeholder}
                    rows={6}
                    className="w-full mt-3 px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 resize-y"
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    {data[section.key]?.length || 0} caracteres
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer Save */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <CheckIcon className="w-4 h-4" />
          )}
          Salvar Playbook
        </button>
      </div>
    </div>
  )
}
