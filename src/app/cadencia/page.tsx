'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  orderBy,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import PlanGate from '@/components/PlanGate'
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  VideoCameraIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  BoltIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  CONTACT_METHOD_LABELS,
  CONTACT_METHOD_COLORS,
  CADENCE_VARIABLES,
  DEFAULT_AUTOMATION_CONFIG,
  type ContactMethod,
  type CadenceExhaustedAction,
  type AutomationConfig,
} from '@/types/cadence'

/* ═══════════════════════════════════════════════════════════ */
/*  TYPES                                                     */
/* ═══════════════════════════════════════════════════════════ */

type CadenceStep = {
  id: string
  stageId: string
  order: number
  name: string
  contactMethod: ContactMethod
  daysAfterPrevious: number
  objective?: string
  messageTemplate?: string
  twilioTemplateSid?: string
  isActive: boolean
  parentStepId?: string | null
  condition?: 'responded' | 'not_responded' | null
  emailSubject?: string
  emailBody?: string
  vapiSystemPrompt?: string
  vapiFirstMessage?: string
}

type FunnelStage = {
  id: string
  name: string
  order: number
  color?: string
  maxDays?: number
  cadenceExhaustedAction?: CadenceExhaustedAction
  cadenceExhaustedTargetStageId?: string
  funnelId: string
}

type Funnel = { id: string; name: string }

type ExecutionLog = {
  id: string
  clientId: string
  clientName: string
  stepName: string
  stageName: string
  channel: ContactMethod
  status: 'success' | 'failed' | 'retry_pending' | 'retry_failed'
  error?: string
  executedAt: string
}

type MainTab = 'config' | 'execution'

/* ═══════════════════════════════════════════════════════════ */
/*  HELPERS                                                   */
/* ═══════════════════════════════════════════════════════════ */

const CHANNEL_ICONS: Record<ContactMethod, typeof PhoneIcon> = {
  whatsapp: ChatBubbleLeftRightIcon,
  email: EnvelopeIcon,
  phone: PhoneIcon,
  meeting: VideoCameraIcon,
}

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                 */
/* ═══════════════════════════════════════════════════════════ */

export default function CadenciaPage() {
  return (
    <PlanGate feature="cadence" showUpgrade>
      <CadenciaDashboard />
    </PlanGate>
  )
}

function CadenciaDashboard() {
  const { orgId } = useCrmUser()
  const [mainTab, setMainTab] = useState<MainTab>('config')
  const [loading, setLoading] = useState(true)

  // Data
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [steps, setSteps] = useState<CadenceStep[]>([])
  const [selectedFunnel, setSelectedFunnel] = useState<string>('')

  // Automation config
  const [autoConfig, setAutoConfig] = useState<AutomationConfig>(DEFAULT_AUTOMATION_CONFIG)

  // Load data
  useEffect(() => {
    if (!orgId) return
    const loadData = async () => {
      try {
        // Load funnels
        const funnelsSnap = await getDocs(collection(db, 'organizations', orgId, 'funnels'))
        const funnelsData = funnelsSnap.docs.map(d => ({ id: d.id, name: d.data().name }))
        setFunnels(funnelsData)
        if (funnelsData.length > 0) setSelectedFunnel(funnelsData[0].id)

        // Load stages (from funnelStages collection)
        const stagesSnap = await getDocs(
          query(collection(db, 'funnelStages'), where('orgId', '==', orgId), orderBy('order', 'asc'))
        )
        setStages(stagesSnap.docs.map(d => ({ id: d.id, ...d.data() } as FunnelStage)))

        // Load cadence steps
        const stepsSnap = await getDocs(
          query(collection(db, 'cadenceSteps'), where('orgId', '==', orgId), orderBy('order', 'asc'))
        )
        setSteps(stepsSnap.docs.map(d => ({ id: d.id, ...d.data() } as CadenceStep)))

        // Load automation config
        const configSnap = await getDocs(query(collection(db, 'organizations', orgId, 'automationConfig')))
        if (!configSnap.empty) {
          setAutoConfig({ ...DEFAULT_AUTOMATION_CONFIG, ...configSnap.docs[0].data() } as AutomationConfig)
        }
      } catch (err) {
        console.error('Error loading cadence data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [orgId])

  const filteredStages = useMemo(() => {
    if (!selectedFunnel) return stages
    return stages.filter(s => s.funnelId === selectedFunnel)
  }, [stages, selectedFunnel])

  if (!orgId) return null

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Cadência de Vendas</h1>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${autoConfig.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              <span className={`w-2 h-2 rounded-full ${autoConfig.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              {autoConfig.enabled ? 'Automação ativa' : 'Automação pausada'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select value={selectedFunnel} onChange={e => setSelectedFunnel(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700">
              {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          <button onClick={() => setMainTab('config')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${mainTab === 'config' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Cog6ToothIcon className="w-4 h-4" /> Configuração
          </button>
          <button onClick={() => setMainTab('execution')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${mainTab === 'execution' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <BoltIcon className="w-4 h-4" /> Execução
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 md:p-8">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-2xl h-32 border border-slate-100" />)}
          </div>
        ) : mainTab === 'config' ? (
          <ConfigTab orgId={orgId} stages={filteredStages} allStages={stages} steps={steps} setSteps={setSteps}
            autoConfig={autoConfig} setAutoConfig={setAutoConfig} />
        ) : (
          <ExecutionTab orgId={orgId} stages={filteredStages} steps={steps} autoConfig={autoConfig} setAutoConfig={setAutoConfig} />
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  CONFIG TAB                                                */
/* ═══════════════════════════════════════════════════════════ */

function ConfigTab({ orgId, stages, allStages, steps, setSteps, autoConfig, setAutoConfig }: {
  orgId: string; stages: FunnelStage[]; allStages: FunnelStage[]; steps: CadenceStep[]
  setSteps: React.Dispatch<React.SetStateAction<CadenceStep[]>>
  autoConfig: AutomationConfig; setAutoConfig: React.Dispatch<React.SetStateAction<AutomationConfig>>
}) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [editStep, setEditStep] = useState<CadenceStep | null>(null)
  const [addingToStage, setAddingToStage] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const toggleStage = (id: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getStageSteps = (stageId: string) =>
    steps.filter(s => s.stageId === stageId && !s.parentStepId).sort((a, b) => a.order - b.order)

  const handleDeleteStep = async (stepId: string) => {
    await deleteDoc(doc(db, 'cadenceSteps', stepId))
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  const handleToggleStep = async (stepId: string, isActive: boolean) => {
    await updateDoc(doc(db, 'cadenceSteps', stepId), { isActive: !isActive })
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, isActive: !isActive } : s))
  }

  const saveAutomationConfig = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...autoConfig, ...updates }
    setAutoConfig(newConfig)
    await setDoc(doc(db, 'organizations', orgId, 'automationConfig', 'global'), newConfig, { merge: true })
  }

  const handleSaveExhaustedAction = async (stageId: string, action: CadenceExhaustedAction, targetId?: string) => {
    await updateDoc(doc(db, 'funnelStages', stageId), {
      cadenceExhaustedAction: action,
      ...(targetId ? { cadenceExhaustedTargetStageId: targetId } : {}),
    })
  }

  return (
    <div className="space-y-4">
      {/* Settings bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{stages.length} etapas • {steps.length} steps configurados</p>
        <button onClick={() => setShowSettings(!showSettings)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
          <Cog6ToothIcon className="w-4 h-4" /> Configurações gerais
        </button>
      </div>

      {/* Global settings panel */}
      {showSettings && (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Configurações de Automação</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Horário de início</label>
              <input type="time" value={autoConfig.workHoursStart}
                onChange={e => saveAutomationConfig({ workHoursStart: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Horário de término</label>
              <input type="time" value={autoConfig.workHoursEnd}
                onChange={e => saveAutomationConfig({ workHoursEnd: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Máx. ações/dia</label>
              <input type="number" value={autoConfig.maxActionsPerDay} min={1} max={5000}
                onChange={e => saveAutomationConfig({ maxActionsPerDay: parseInt(e.target.value) || 100 })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Máx. ligações simultâneas</label>
              <input type="number" value={autoConfig.maxConcurrentCalls ?? 10} min={1} max={50}
                onChange={e => saveAutomationConfig({ maxConcurrentCalls: parseInt(e.target.value) || 10 })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-slate-400 mt-0.5">Limite VAPI (free: 10)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Máx. ligações/dia</label>
              <input type="number" value={autoConfig.maxCallsPerDay ?? 300} min={1} max={5000}
                onChange={e => saveAutomationConfig({ maxCallsPerDay: parseInt(e.target.value) || 300 })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-slate-400 mt-0.5">Independente do limite total de ações</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm text-slate-600">Automação ativa</span>
            <button onClick={() => saveAutomationConfig({ enabled: !autoConfig.enabled })}
              className={`relative w-11 h-6 rounded-full transition-colors ${autoConfig.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoConfig.enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Stages list */}
      {stages.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-100 text-center">
          <p className="text-slate-400">Nenhuma etapa configurada neste funil</p>
        </div>
      ) : (
        stages.sort((a, b) => a.order - b.order).map(stage => {
          const stageSteps = getStageSteps(stage.id)
          const isExpanded = expandedStages.has(stage.id)
          const isPaused = autoConfig.pausedStageIds.includes(stage.id)

          return (
            <div key={stage.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Stage header */}
              <button onClick={() => toggleStage(stage.id)}
                className="w-full flex items-center justify-between p-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-primary-400" />
                  <h3 className="text-sm font-semibold text-slate-800">{stage.name}</h3>
                  <span className="text-xs text-slate-400">{stageSteps.length} steps</span>
                  {isPaused && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600">
                      <PauseIcon className="w-3 h-3" /> Pausada
                    </span>
                  )}
                </div>
                {isExpanded ? <ChevronUpIcon className="w-4 h-4 text-slate-400" /> : <ChevronDownIcon className="w-4 h-4 text-slate-400" />}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-5 pb-5 border-t border-slate-50">
                  {/* Timeline */}
                  <div className="relative mt-4">
                    {stageSteps.length > 0 && <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200" />}

                    {stageSteps.map((step, i) => {
                      const Icon = CHANNEL_ICONS[step.contactMethod]
                      return (
                        <div key={step.id} className="relative flex items-start gap-4 mb-4 last:mb-0">
                          {/* Timeline dot */}
                          <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${step.isActive ? 'bg-primary-50 border-primary-300' : 'bg-slate-50 border-slate-200'}`}>
                            <Icon className={`w-4 h-4 ${step.isActive ? 'text-primary-600' : 'text-slate-400'}`} />
                          </div>

                          {/* Step card */}
                          <div className={`flex-1 p-4 rounded-xl border transition-all ${step.isActive ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-slate-800">{step.name}</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${CONTACT_METHOD_COLORS[step.contactMethod]}`}>
                                    {CONTACT_METHOD_LABELS[step.contactMethod]}
                                  </span>
                                  {i > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                      <ClockIcon className="w-3 h-3" /> Após {step.daysAfterPrevious}d
                                    </span>
                                  )}
                                  {i === 0 && step.daysAfterPrevious > 0 && (
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                      <ClockIcon className="w-3 h-3" /> Após {step.daysAfterPrevious}d
                                    </span>
                                  )}
                                </div>
                                {step.messageTemplate && (
                                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">{step.messageTemplate.slice(0, 100)}</p>
                                )}
                                {step.vapiSystemPrompt && (
                                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">Speech: {step.vapiSystemPrompt.slice(0, 80)}</p>
                                )}
                                {step.emailSubject && (
                                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">Assunto: {step.emailSubject}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={(e) => { e.stopPropagation(); handleToggleStep(step.id, step.isActive) }}
                                  className={`p-1.5 rounded-lg transition-colors ${step.isActive ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                                  title={step.isActive ? 'Desativar' : 'Ativar'}>
                                  {step.isActive ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setEditStep(step) }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                                  <PencilSquareIcon className="w-4 h-4" />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteStep(step.id) }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Add step button */}
                  <button onClick={() => setAddingToStage(stage.id)}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 transition-all">
                    <PlusIcon className="w-4 h-4" /> Adicionar step
                  </button>

                  {/* Exhausted action config */}
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-slate-500">Ao esgotar cadência:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['keep', 'move', 'notify'] as CadenceExhaustedAction[]).map(action => (
                        <button key={action} onClick={() => handleSaveExhaustedAction(stage.id, action)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${(stage.cadenceExhaustedAction || 'keep') === action ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                          {action === 'keep' && 'Manter na etapa'}
                          {action === 'move' && 'Mover para etapa'}
                          {action === 'notify' && 'Notificar responsável'}
                        </button>
                      ))}
                      {stage.cadenceExhaustedAction === 'move' && (
                        <select
                          value={stage.cadenceExhaustedTargetStageId || ''}
                          onChange={e => handleSaveExhaustedAction(stage.id, 'move', e.target.value)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                          <option value="">Selecionar etapa...</option>
                          {allStages.filter(s => s.id !== stage.id).map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Pause toggle for this stage */}
                  <div className="mt-3 flex items-center gap-2">
                    <button onClick={() => {
                      const newPaused = isPaused
                        ? autoConfig.pausedStageIds.filter(id => id !== stage.id)
                        : [...autoConfig.pausedStageIds, stage.id]
                      saveAutomationConfig({ pausedStageIds: newPaused })
                    }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${isPaused ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                      {isPaused ? <><PlayIcon className="w-3 h-3" /> Retomar cadência</> : <><PauseIcon className="w-3 h-3" /> Pausar cadência</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* Add/Edit Step Modal */}
      {(addingToStage || editStep) && (
        <StepModal
          orgId={orgId}
          stageId={addingToStage || editStep!.stageId}
          step={editStep}
          existingSteps={steps}
          onClose={() => { setAddingToStage(null); setEditStep(null) }}
          onSaved={(newStep) => {
            if (editStep) {
              setSteps(prev => prev.map(s => s.id === newStep.id ? newStep : s))
            } else {
              setSteps(prev => [...prev, newStep])
            }
            setAddingToStage(null)
            setEditStep(null)
          }}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  STEP MODAL                                                */
/* ═══════════════════════════════════════════════════════════ */

function StepModal({ orgId, stageId, step, existingSteps, onClose, onSaved }: {
  orgId: string; stageId: string; step: CadenceStep | null; existingSteps: CadenceStep[]
  onClose: () => void; onSaved: (step: CadenceStep) => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: step?.name || '',
    contactMethod: (step?.contactMethod || 'whatsapp') as ContactMethod,
    daysAfterPrevious: step?.daysAfterPrevious ?? 1,
    objective: step?.objective || '',
    messageTemplate: step?.messageTemplate || '',
    emailSubject: step?.emailSubject || '',
    emailBody: step?.emailBody || '',
    vapiSystemPrompt: step?.vapiSystemPrompt || '',
    vapiFirstMessage: step?.vapiFirstMessage || '',
    isActive: step?.isActive ?? true,
  })

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const data: Record<string, unknown> = {
        stageId,
        name: form.name,
        contactMethod: form.contactMethod,
        daysAfterPrevious: form.daysAfterPrevious,
        objective: form.objective,
        messageTemplate: form.messageTemplate,
        emailSubject: form.emailSubject,
        emailBody: form.emailBody,
        vapiSystemPrompt: form.vapiSystemPrompt,
        vapiFirstMessage: form.vapiFirstMessage,
        isActive: form.isActive,
        orgId,
      }

      if (step) {
        await updateDoc(doc(db, 'cadenceSteps', step.id), data)
        onSaved({ ...step, ...data } as CadenceStep)
      } else {
        const stageSteps = existingSteps.filter(s => s.stageId === stageId)
        data.order = stageSteps.length + 1
        data.parentStepId = null
        data.condition = null
        const ref = await addDoc(collection(db, 'cadenceSteps'), data)
        onSaved({ id: ref.id, ...data } as CadenceStep)
      }
    } catch (err) {
      console.error('Error saving step:', err)
    } finally {
      setSaving(false)
    }
  }

  const insertVariable = (key: string, field: 'messageTemplate' | 'emailSubject' | 'emailBody' | 'vapiSystemPrompt' | 'vapiFirstMessage') => {
    setForm(prev => ({ ...prev, [field]: prev[field] + key }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-slate-900">{step ? 'Editar Step' : 'Novo Step'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><XMarkIcon className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome do step</label>
            <input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: WhatsApp de apresentação"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
          </div>

          {/* Channel */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Canal</label>
            <div className="flex gap-2">
              {(['whatsapp', 'email', 'phone', 'meeting'] as ContactMethod[]).map(method => {
                const Icon = CHANNEL_ICONS[method]
                return (
                  <button key={method} onClick={() => setForm(prev => ({ ...prev, contactMethod: method }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all ${form.contactMethod === method ? `${CONTACT_METHOD_COLORS[method]} border-current` : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Icon className="w-4 h-4" /> {CONTACT_METHOD_LABELS[method]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Após X dias</label>
              <input type="number" value={form.daysAfterPrevious} min={0}
                onChange={e => setForm(prev => ({ ...prev, daysAfterPrevious: parseInt(e.target.value) || 0 }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Objetivo</label>
              <input value={form.objective} onChange={e => setForm(prev => ({ ...prev, objective: e.target.value }))}
                placeholder="Ex: Qualificar interesse"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Channel-specific fields */}
          {form.contactMethod === 'whatsapp' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Template da mensagem</label>
              <textarea value={form.messageTemplate} onChange={e => setForm(prev => ({ ...prev, messageTemplate: e.target.value }))}
                rows={4} placeholder="Olá {{nome}}, tudo bem? Sou da {{empresa}}..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
              <VariableButtons onInsert={(key) => insertVariable(key, 'messageTemplate')} />
            </div>
          )}

          {form.contactMethod === 'phone' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Speech / Roteiro do agente (System Prompt)</label>
                <textarea value={form.vapiSystemPrompt} onChange={e => setForm(prev => ({ ...prev, vapiSystemPrompt: e.target.value }))}
                  rows={5} placeholder="Você é um consultor de vendas. Seu objetivo é..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
                <VariableButtons onInsert={(key) => insertVariable(key, 'vapiSystemPrompt')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Mensagem inicial do agente</label>
                <input value={form.vapiFirstMessage} onChange={e => setForm(prev => ({ ...prev, vapiFirstMessage: e.target.value }))}
                  placeholder="Bom dia {{nome}}, aqui é da..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}

          {form.contactMethod === 'email' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Assunto do email</label>
                <input value={form.emailSubject} onChange={e => setForm(prev => ({ ...prev, emailSubject: e.target.value }))}
                  placeholder="{{nome}}, temos uma proposta para você"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                <VariableButtons onInsert={(key) => insertVariable(key, 'emailSubject')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Corpo do email (HTML)</label>
                <textarea value={form.emailBody} onChange={e => setForm(prev => ({ ...prev, emailBody: e.target.value }))}
                  rows={6} placeholder="<p>Olá {{nome}},</p><p>Gostaríamos de apresentar...</p>"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none" />
                <VariableButtons onInsert={(key) => insertVariable(key, 'emailBody')} />
              </div>
            </>
          )}

          {form.contactMethod === 'meeting' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Mensagem de convite</label>
              <textarea value={form.messageTemplate} onChange={e => setForm(prev => ({ ...prev, messageTemplate: e.target.value }))}
                rows={3} placeholder="Gostaria de agendar uma reunião para..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
          )}

          {/* Active toggle */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm text-slate-600">Step ativo</span>
            <button onClick={() => setForm(prev => ({ ...prev, isActive: !prev.isActive }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-50 rounded-xl hover:bg-slate-100">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50">
            {saving ? 'Salvando...' : step ? 'Salvar' : 'Criar Step'}
          </button>
        </div>
      </div>
    </div>
  )
}

function VariableButtons({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {CADENCE_VARIABLES.map(v => (
        <button key={v.key} onClick={() => onInsert(v.key)} type="button"
          className="px-2 py-0.5 text-xs bg-primary-50 text-primary-600 rounded hover:bg-primary-100 transition-colors">
          {v.key}
        </button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════ */
/*  EXECUTION TAB                                             */
/* ═══════════════════════════════════════════════════════════ */

function ExecutionTab({ orgId, stages, steps, autoConfig, setAutoConfig }: {
  orgId: string; stages: FunnelStage[]; steps: CadenceStep[]; autoConfig: AutomationConfig
  setAutoConfig: React.Dispatch<React.SetStateAction<AutomationConfig>>
}) {
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return

    // Listen to execution logs (last 24h)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString()

    const unsubLogs = onSnapshot(
      query(
        collection(db, 'organizations', orgId, 'cadenceExecutionLog'),
        where('executedAt', '>=', yesterdayStr),
        orderBy('executedAt', 'desc')
      ),
      snap => {
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExecutionLog)))
        setLoading(false)
      }
    )

    // Count active cadence contacts per stage
    const loadActiveCounts = async () => {
      const clientsSnap = await getDocs(
        query(
          collection(db, 'organizations', orgId, 'clients'),
          where('currentCadenceStepId', '!=', '')
        )
      )
      const counts: Record<string, number> = {}
      clientsSnap.docs.forEach(d => {
        const data = d.data()
        const stepId = data.currentCadenceStepId
        const step = steps.find(s => s.id === stepId)
        if (step) {
          counts[step.stageId] = (counts[step.stageId] || 0) + 1
        }
      })
      setActiveCounts(counts)
    }
    loadActiveCounts()

    return () => unsubLogs()
  }, [orgId, steps])

  const todayLogs = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString()
    return logs.filter(l => l.executedAt >= todayStr)
  }, [logs])

  const successToday = todayLogs.filter(l => l.status === 'success')
  const failedRecent = logs.filter(l => l.status === 'failed' || l.status === 'retry_failed')
  const totalActive = Object.values(activeCounts).reduce((a, b) => a + b, 0)

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of successToday) {
      counts[l.channel] = (counts[l.channel] || 0) + 1
    }
    return counts
  }, [successToday])

  const saveAutomationConfig = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...autoConfig, ...updates }
    setAutoConfig(newConfig)
    await setDoc(doc(db, 'organizations', orgId, 'automationConfig', 'global'), newConfig, { merge: true })
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button onClick={() => saveAutomationConfig({ enabled: !autoConfig.enabled })}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${autoConfig.enabled ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}>
          {autoConfig.enabled ? <><PauseIcon className="w-4 h-4" /> Pausar toda automação</> : <><PlayIcon className="w-4 h-4" /> Retomar automação</>}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">Em cadência ativa</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalActive}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">Ações hoje</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{successToday.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">de {autoConfig.maxActionsPerDay} max</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">Ligações hoje</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{channelCounts['phone'] || 0}</p>
          <p className="text-xs text-slate-400 mt-0.5">de {autoConfig.maxCallsPerDay ?? 300} max</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">Falhas (24h)</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{failedRecent.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-500">Por canal hoje</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(channelCounts).map(([ch, count]) => (
              <span key={ch} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CONTACT_METHOD_COLORS[ch as ContactMethod]}`}>
                {count} {CONTACT_METHOD_LABELS[ch as ContactMethod]}
              </span>
            ))}
            {Object.keys(channelCounts).length === 0 && <span className="text-xs text-slate-400">Nenhuma ação</span>}
          </div>
        </div>
      </div>

      {/* Active by stage */}
      {Object.keys(activeCounts).length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Contatos em cadência por etapa</h3>
          <div className="space-y-2">
            {Object.entries(activeCounts).map(([stageId, count]) => {
              const stage = stages.find(s => s.id === stageId)
              return (
                <div key={stageId} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <span className="text-sm text-slate-600">{stage?.name || stageId}</span>
                  <span className="text-sm font-semibold text-slate-800">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent execution logs */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Ações recentes (últimas 24h)</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nenhuma ação registrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="text-left p-3 font-medium">Contato</th>
                  <th className="text-left p-3 font-medium">Step</th>
                  <th className="text-left p-3 font-medium">Etapa</th>
                  <th className="text-center p-3 font-medium">Canal</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Hora</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 50).map(log => (
                  <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="p-3">
                      <a href={`/contatos/${log.clientId}`} className="text-primary-600 hover:text-primary-800 font-medium">{log.clientName || '—'}</a>
                    </td>
                    <td className="p-3 text-slate-600">{log.stepName}</td>
                    <td className="p-3 text-slate-600">{log.stageName}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CONTACT_METHOD_COLORS[log.channel]}`}>
                        {CONTACT_METHOD_LABELS[log.channel]}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                          <CheckCircleIcon className="w-3 h-3" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700" title={log.error}>
                          <XCircleIcon className="w-3 h-3" /> Falha
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right text-slate-500 text-xs">
                      {new Date(log.executedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
