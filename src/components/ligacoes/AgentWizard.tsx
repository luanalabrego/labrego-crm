'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import type { AgentWizardAnswers } from '@/types/callRouting'
import { calculateAgentStrength, assemblePromptFromWizard, migrateKnowledgeToWizard } from '@/lib/promptAssembler'
import type { CallAgentKnowledge } from '@/types/callRouting'
import WizardProgress from './WizardProgress'
import PromptPreview from './PromptPreview'
import {
  SparklesIcon,
  BuildingOfficeIcon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  LightBulbIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PlusIcon,
  XMarkIcon,
  DocumentTextIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

/* ================================= Constants ================================= */

const EMPTY_WIZARD_ANSWERS: AgentWizardAnswers = {
  agentName: '',
  agentRole: '',
  companyName: '',
  toneDescription: '',
  whatYouSell: '',
  idealCustomer: '',
  differentials: '',
  valueProposition: '',
  openingApproach: '',
  hookStrategy: '',
  discoveryQuestions: [],
  qualificationCriteria: '',
  solutionBridge: '',
  specialistName: '',
  meetingDuration: 30,
  objections: [],
  forbiddenWords: '',
  keyExpressions: '',
  behaviorRules: '',
  completedPhases: [],
  strengthScore: 0,
  lastUpdated: new Date().toISOString(),
  manuallyEdited: false,
}

const PHASE_COMPLETION_MESSAGES: Record<number, string> = {
  1: 'Identidade definida! Seu agente tem nome e personalidade.',
  2: 'Negocio mapeado! O agente entende sua proposta de valor.',
  3: 'Abertura configurada! Os primeiros 30 segundos vao impressionar.',
  4: 'Investigacao pronta! Seu agente sabe o que perguntar.',
  5: 'Proposta de valor conectada! O agente sabe como vender.',
  6: 'Objecoes mapeadas! Seu agente sabe lidar com resistencia.',
  7: 'Regras definidas! O agente esta completo e pronto.',
}

const DEFAULT_OBJECTION_SUGGESTIONS = [
  'Nao tenho tempo',
  'Manda por email',
  'Ja tenho sistema',
  'Esta caro',
  'Vou pensar',
]

interface PhaseConfig {
  number: number
  title: string
  subtitle: string
  icon: React.ReactNode
}

const PHASES: PhaseConfig[] = [
  {
    number: 1,
    title: 'Vamos dar vida ao seu agente!',
    subtitle: 'Defina a identidade e personalidade do seu agente de voz.',
    icon: <SparklesIcon className="w-6 h-6" />,
  },
  {
    number: 2,
    title: 'Me conta sobre seu negócio',
    subtitle: 'Aqui você descreve o que faz e pra quem faz.',
    icon: <BuildingOfficeIcon className="w-6 h-6" />,
  },
  {
    number: 3,
    title: 'A primeira impressão',
    subtitle: 'Como o agente deve iniciar a conversa nos primeiros 30 segundos.',
    icon: <ChatBubbleLeftRightIcon className="w-6 h-6" />,
  },
  {
    number: 4,
    title: 'Descobrindo a dor do prospect',
    subtitle: 'Quais perguntas o agente deve fazer para entender o problema.',
    icon: <MagnifyingGlassIcon className="w-6 h-6" />,
  },
  {
    number: 5,
    title: 'Conectando dor à solução',
    subtitle: 'Como apresentar sua solução e agendar uma reunião.',
    icon: <LightBulbIcon className="w-6 h-6" />,
  },
  {
    number: 6,
    title: 'Preparando para objeções',
    subtitle: 'Como o agente deve reagir quando o prospect resistir.',
    icon: <ShieldCheckIcon className="w-6 h-6" />,
  },
  {
    number: 7,
    title: 'Regras finais',
    subtitle: 'Defina palavras proibidas, expressões-chave e regras de comportamento.',
    icon: <BookOpenIcon className="w-6 h-6" />,
  },
]

/* ================================= Component ================================= */

interface AgentWizardProps {
  orgId: string
  initialAnswers?: AgentWizardAnswers
  existingKnowledge?: CallAgentKnowledge
  onKnowledgeUpdate?: (updatedKnowledge: Partial<CallAgentKnowledge>) => void
}

export default function AgentWizard({ orgId, initialAnswers, existingKnowledge, onKnowledgeUpdate }: AgentWizardProps) {
  const [answers, setAnswers] = useState<AgentWizardAnswers>(initialAnswers || EMPTY_WIZARD_ANSWERS)
  const [currentPhase, setCurrentPhase] = useState(1)
  const [saving, setSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [advancedMode, setAdvancedMode] = useState(false)
  const [advancedPrompt, setAdvancedPrompt] = useState('')
  const [customPrompt, setCustomPrompt] = useState<string | undefined>(
    existingKnowledge?.wizardAnswers?.manuallyEdited ? existingKnowledge?.systemPrompt : undefined
  )

  // Check if user has existing config but no wizard answers (migration candidate)
  const showMigrationBanner = !initialAnswers && !!existingKnowledge && !!(
    existingKnowledge.agentName || existingKnowledge.productsServices || existingKnowledge.systemPrompt
  )

  // Sync when initialAnswers changes (e.g., from parent load)
  useEffect(() => {
    if (initialAnswers) {
      setAnswers(initialAnswers)
    }
  }, [initialAnswers])

  // Auto-save to Firestore on blur
  const handleFieldBlur = useCallback(async () => {
    if (!orgId) return
    setSaving(true)
    try {
      const updated = {
        ...answers,
        lastUpdated: new Date().toISOString(),
      }
      const configRef = doc(db, 'callRoutingConfig', orgId)
      await updateDoc(configRef, { 'agentKnowledge.wizardAnswers': updated })
      setAnswers(updated)
    } catch (error) {
      console.error('Error saving wizard answers:', error)
    } finally {
      setSaving(false)
    }
  }, [orgId, answers])

  // Update a single field
  const updateField = useCallback((field: keyof AgentWizardAnswers, value: string | number) => {
    setAnswers(prev => ({ ...prev, [field]: value }))
  }, [])

  // Calculate strength score in real-time
  const strengthScore = useMemo(() => calculateAgentStrength(answers), [answers])

  // Compute completed phases
  const getCompletedPhases = useCallback((): number[] => {
    const completed: number[] = []

    // Phase 1: all 4 fields filled
    if (answers.agentName.trim() && answers.agentRole.trim() && answers.companyName.trim() && answers.toneDescription.trim()) {
      completed.push(1)
    }
    // Phase 2: all 4 fields filled
    if (answers.whatYouSell.trim() && answers.idealCustomer.trim() && answers.differentials.trim() && answers.valueProposition.trim()) {
      completed.push(2)
    }
    // Phase 3: both fields filled
    if (answers.openingApproach.trim() && answers.hookStrategy.trim()) {
      completed.push(3)
    }
    // Phase 4: at least 1 question + qualification criteria
    if (answers.discoveryQuestions.some(q => q.trim()) && answers.qualificationCriteria.trim()) {
      completed.push(4)
    }
    // Phase 5: all 3 fields
    if (answers.solutionBridge.trim() && answers.specialistName.trim() && answers.meetingDuration > 0) {
      completed.push(5)
    }
    // Phase 6: at least 1 objection with both fields
    if (answers.objections.some(o => o.objection.trim() && o.response.trim())) {
      completed.push(6)
    }
    // Phase 7: at least 1 of the 3 fields
    if (answers.forbiddenWords.trim() || answers.keyExpressions.trim() || answers.behaviorRules.trim()) {
      completed.push(7)
    }

    return completed
  }, [answers])

  const completedPhases = getCompletedPhases()

  // Navigation
  const canGoNext = currentPhase < 7
  const canGoBack = currentPhase > 1

  const handleNext = () => {
    if (canGoNext) setCurrentPhase(prev => prev + 1)
  }

  const handleBack = () => {
    if (canGoBack) setCurrentPhase(prev => prev - 1)
  }

  // Handle migration from old knowledge to wizard answers
  const handleMigrate = useCallback(() => {
    if (!existingKnowledge) return
    const migrated = migrateKnowledgeToWizard(existingKnowledge)
    setAnswers(migrated)
    // Save immediately
    setTimeout(handleFieldBlur, 100)
  }, [existingKnowledge, handleFieldBlur])

  // Toggle advanced mode
  const toggleAdvancedMode = useCallback(() => {
    if (!advancedMode) {
      // Entering advanced mode — populate textarea with current prompt
      setAdvancedPrompt(assemblePromptFromWizard(answers))
    }
    setAdvancedMode(prev => !prev)
  }, [advancedMode, answers])

  // Save Agent — persists wizardAnswers + assembled prompt to Firestore
  const handleSaveAgent = useCallback(async () => {
    if (!orgId) return
    setSaving(true)
    try {
      const prompt = advancedMode ? advancedPrompt : assemblePromptFromWizard(answers)
      const strength = calculateAgentStrength(answers)
      const isManual = advancedMode
      const updatedAnswers: AgentWizardAnswers = {
        ...answers,
        strengthScore: strength,
        completedPhases: getCompletedPhases(),
        lastUpdated: new Date().toISOString(),
        manuallyEdited: isManual,
      }

      // Track custom prompt locally
      setCustomPrompt(isManual ? prompt : undefined)

      const configRef = doc(db, 'callRoutingConfig', orgId)
      await updateDoc(configRef, {
        'agentKnowledge.wizardAnswers': updatedAnswers,
        'agentKnowledge.systemPrompt': prompt,
        'agentKnowledge.agentName': answers.agentName,
        'agentKnowledge.agentRole': answers.agentRole,
        'agentKnowledge.companyName': answers.companyName,
        'agentKnowledge.productsServices': answers.whatYouSell,
        'agentKnowledge.targetAudience': answers.idealCustomer,
        'agentKnowledge.valueProposition': answers.valueProposition,
        'agentKnowledge.competitiveDifferentials': answers.differentials,
      })

      setAnswers(updatedAnswers)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)

      // Propagate to parent state
      onKnowledgeUpdate?.({
        wizardAnswers: updatedAnswers,
        systemPrompt: prompt,
        agentName: answers.agentName,
        agentRole: answers.agentRole,
        companyName: answers.companyName,
        productsServices: answers.whatYouSell,
        targetAudience: answers.idealCustomer,
        valueProposition: answers.valueProposition,
        competitiveDifferentials: answers.differentials,
      })
    } catch (error) {
      console.error('Error saving agent:', error)
    } finally {
      setSaving(false)
    }
  }, [orgId, answers, advancedMode, advancedPrompt, getCompletedPhases, onKnowledgeUpdate])

  // Save edited prompt directly from PromptPreview drawer
  const handleSaveEditedPrompt = useCallback(async (editedPrompt: string) => {
    if (!orgId) return
    try {
      const updatedAnswers: AgentWizardAnswers = {
        ...answers,
        lastUpdated: new Date().toISOString(),
        manuallyEdited: true,
      }

      const configRef = doc(db, 'callRoutingConfig', orgId)
      await updateDoc(configRef, {
        'agentKnowledge.wizardAnswers': updatedAnswers,
        'agentKnowledge.systemPrompt': editedPrompt,
      })

      setAnswers(updatedAnswers)
      setCustomPrompt(editedPrompt)

      // Propagate to parent state
      onKnowledgeUpdate?.({
        wizardAnswers: updatedAnswers,
        systemPrompt: editedPrompt,
      })
    } catch (error) {
      console.error('Error saving edited prompt:', error)
      throw error
    }
  }, [orgId, answers, onKnowledgeUpdate])

  const currentConfig = PHASES.find(p => p.number === currentPhase)

  return (
    <div className="space-y-6">
      {/* Migration banner for existing users without wizard */}
      {showMigrationBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800">Seu agente esta configurado!</p>
            <p className="text-xs text-amber-600 mt-0.5">Use o wizard para melhorar ainda mais. Seus dados atuais podem ser migrados automaticamente.</p>
          </div>
          <button onClick={handleMigrate} className="btn-primary text-xs whitespace-nowrap">
            Migrar para o Wizard
          </button>
        </div>
      )}

      {/* Progress bar with strength */}
      <WizardProgress currentPhase={currentPhase} completedPhases={completedPhases} strengthScore={strengthScore} />

      {/* Phase completion message */}
      {completedPhases.includes(currentPhase) && PHASE_COMPLETION_MESSAGES[currentPhase] && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700 flex items-center gap-2">
          <SparklesIcon className="w-4 h-4 flex-shrink-0" />
          {PHASE_COMPLETION_MESSAGES[currentPhase]}
        </div>
      )}

      {/* Phase content */}
      {currentConfig && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          {/* Phase header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-amber-400 flex items-center justify-center text-white">
              {currentConfig.icon}
            </div>
            <div>
              <h2 className="font-bold text-slate-800">{currentConfig.title}</h2>
              <p className="text-sm text-slate-500">{currentConfig.subtitle}</p>
            </div>
            {saving && (
              <span className="ml-auto text-xs text-slate-400 animate-pulse">Salvando...</span>
            )}
          </div>

          {/* Phase fields */}
          {currentPhase === 1 && (
            <Phase1Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} />
          )}
          {currentPhase === 2 && (
            <Phase2Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} />
          )}
          {currentPhase === 3 && (
            <Phase3Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} />
          )}
          {currentPhase === 4 && (
            <Phase4Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} setAnswers={setAnswers} />
          )}
          {currentPhase === 5 && (
            <Phase5Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} />
          )}
          {currentPhase === 6 && (
            <Phase6Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} setAnswers={setAnswers} />
          )}
          {currentPhase === 7 && (
            <Phase7Fields answers={answers} updateField={updateField} onBlur={handleFieldBlur} />
          )}

          {/* Navigation + Actions */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
            <button
              onClick={handleBack}
              disabled={!canGoBack}
              className="btn disabled:opacity-30"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Voltar
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewOpen(true)}
                className="btn text-xs gap-1.5"
              >
                <DocumentTextIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Ver Prompt</span>
              </button>
              <button
                onClick={handleSaveAgent}
                disabled={saving}
                className={`btn-primary text-xs gap-1.5 ${saveSuccess ? '!bg-emerald-600' : ''}`}
              >
                {saveSuccess ? (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    Salvo!
                  </>
                ) : (
                  saving ? 'Salvando...' : 'Salvar Agente'
                )}
              </button>
            </div>

            <button
              onClick={handleNext}
              disabled={!canGoNext}
              className="btn-primary disabled:opacity-30"
            >
              Próximo
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Advanced Mode Toggle */}
      <div className="flex items-center justify-end">
        <button
          onClick={toggleAdvancedMode}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          {advancedMode ? 'Voltar ao Wizard' : 'Modo Avancado'}
        </button>
      </div>

      {/* Advanced Mode — Direct prompt editing */}
      {advancedMode && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800">Edicao Direta do Prompt</h3>
              <p className="text-xs text-slate-500">Edite o prompt completo diretamente. Alteracoes manuais sobrescrevem o wizard.</p>
            </div>
            <button
              onClick={() => {
                setAdvancedPrompt(assemblePromptFromWizard(answers))
                setAnswers(prev => ({ ...prev, manuallyEdited: false }))
              }}
              className="btn text-xs"
            >
              Regenerar do Wizard
            </button>
          </div>

          {answers.manuallyEdited && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-700">
              O prompt foi editado manualmente. Gerar novamente pelo wizard vai sobrescrever as edicoes.
            </div>
          )}

          <textarea
            value={advancedPrompt}
            onChange={(e) => setAdvancedPrompt(e.target.value)}
            rows={20}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xs font-mono leading-relaxed focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all resize-y"
          />

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{advancedPrompt.length.toLocaleString()} caracteres</span>
            <button onClick={handleSaveAgent} disabled={saving} className="btn-primary text-xs">
              {saving ? 'Salvando...' : 'Salvar Prompt'}
            </button>
          </div>
        </div>
      )}

      {/* Prompt Preview Drawer */}
      <PromptPreview
        answers={answers}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onSave={handleSaveEditedPrompt}
        savedCustomPrompt={customPrompt}
      />
    </div>
  )
}

/* ================================= Shared Components ================================= */

interface PhaseFieldsProps {
  answers: AgentWizardAnswers
  updateField: (field: keyof AgentWizardAnswers, value: string | number) => void
  onBlur: () => void
}

interface DynamicPhaseFieldsProps extends PhaseFieldsProps {
  setAnswers: React.Dispatch<React.SetStateAction<AgentWizardAnswers>>
}

function WizardInput({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (val: string) => void
  onBlur: () => void
  placeholder: string
  type?: 'text' | 'textarea'
}) {
  const inputClass = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all'

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={3}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  )
}

/* ================================= Phase 1: Identidade ================================= */

function Phase1Fields({ answers, updateField, onBlur }: PhaseFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WizardInput
          label="Qual nome o seu agente vai ter?"
          value={answers.agentName}
          onChange={(val) => updateField('agentName', val)}
          onBlur={onBlur}
          placeholder="Ex: Leo, Carol, Rafael"
        />
        <WizardInput
          label="Qual sera o cargo dele na empresa?"
          value={answers.agentRole}
          onChange={(val) => updateField('agentRole', val)}
          onBlur={onBlur}
          placeholder="Ex: SDR Senior, Consultor de Vendas"
        />
      </div>
      <WizardInput
        label="Qual o nome da sua empresa?"
        value={answers.companyName}
        onChange={(val) => updateField('companyName', val)}
        onBlur={onBlur}
        placeholder="Ex: Voxium"
      />
      <WizardInput
        label="Como voce quer que ele fale? Descreva o tom de voz"
        value={answers.toneDescription}
        onChange={(val) => updateField('toneDescription', val)}
        onBlur={onBlur}
        placeholder="Ex: Confiante e direto, com calor humano. Fala como alguem que ja viu centenas de operacoes..."
        type="textarea"
      />
    </div>
  )
}

/* ================================= Phase 2: Negocio ================================= */

function Phase2Fields({ answers, updateField, onBlur }: PhaseFieldsProps) {
  return (
    <div className="space-y-4">
      <WizardInput
        label="O que sua empresa vende ou oferece?"
        value={answers.whatYouSell}
        onChange={(val) => updateField('whatYouSell', val)}
        onBlur={onBlur}
        placeholder="Ex: Automacao de processos com IA para empresas medias que ainda dependem de planilhas..."
        type="textarea"
      />
      <WizardInput
        label="Quem e seu cliente ideal? Descreva o perfil"
        value={answers.idealCustomer}
        onChange={(val) => updateField('idealCustomer', val)}
        onBlur={onBlur}
        placeholder="Ex: Empresas de 10 a 200 funcionarios com processos manuais repetitivos..."
        type="textarea"
      />
      <WizardInput
        label="O que diferencia voces da concorrencia?"
        value={answers.differentials}
        onChange={(val) => updateField('differentials', val)}
        onBlur={onBlur}
        placeholder="Ex: Implementacao em 2 semanas, suporte dedicado, ROI comprovado em 90 dias..."
        type="textarea"
      />
      <WizardInput
        label="Qual o principal beneficio para quem contrata voces?"
        value={answers.valueProposition}
        onChange={(val) => updateField('valueProposition', val)}
        onBlur={onBlur}
        placeholder="Ex: Reducao de 70% no tempo gasto com processos manuais..."
        type="textarea"
      />
    </div>
  )
}

/* ================================= Phase 3: Abertura ================================= */

function Phase3Fields({ answers, updateField, onBlur }: PhaseFieldsProps) {
  return (
    <div className="space-y-4">
      <WizardInput
        label="Como o agente deve se apresentar nos primeiros 30 segundos?"
        value={answers.openingApproach}
        onChange={(val) => updateField('openingApproach', val)}
        onBlur={onBlur}
        placeholder="Ex: Ola {{contactName}}, aqui e o Leo da Voxium. Me da 30 segundos pra explicar porque estou te ligando..."
        type="textarea"
      />
      <WizardInput
        label="Qual gancho usar para prender a atencao do prospect?"
        value={answers.hookStrategy}
        onChange={(val) => updateField('hookStrategy', val)}
        onBlur={onBlur}
        placeholder="Ex: A gente ajuda empresas como a {{prospectCompany}} a automatizar processos que consomem tempo da equipe..."
        type="textarea"
      />
    </div>
  )
}

/* ================================= Phase 4: Investigacao ================================= */

function Phase4Fields({ answers, updateField, onBlur, setAnswers }: DynamicPhaseFieldsProps) {
  const addQuestion = () => {
    if (answers.discoveryQuestions.length >= 8) return
    setAnswers(prev => ({
      ...prev,
      discoveryQuestions: [...prev.discoveryQuestions, ''],
    }))
  }

  const removeQuestion = (index: number) => {
    setAnswers(prev => ({
      ...prev,
      discoveryQuestions: prev.discoveryQuestions.filter((_, i) => i !== index),
    }))
    setTimeout(onBlur, 100)
  }

  const updateQuestion = (index: number, value: string) => {
    setAnswers(prev => ({
      ...prev,
      discoveryQuestions: prev.discoveryQuestions.map((q, i) => i === index ? value : q),
    }))
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-700">
            Quais perguntas o agente deve fazer para entender o problema do prospect?
          </label>
          <span className="text-xs text-slate-400">{answers.discoveryQuestions.length}/8</span>
        </div>

        <div className="space-y-2">
          {answers.discoveryQuestions.map((q, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={q}
                onChange={(e) => updateQuestion(index, e.target.value)}
                onBlur={onBlur}
                placeholder="Ex: Como funciona a prospecção de novos clientes hoje?"
                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
              <button
                type="button"
                onClick={() => removeQuestion(index)}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {answers.discoveryQuestions.length < 8 && (
          <button
            type="button"
            onClick={addQuestion}
            className="mt-2 flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Adicionar pergunta
          </button>
        )}
      </div>

      <WizardInput
        label="Quais criterios o prospect precisa ter para ser qualificado?"
        value={answers.qualificationCriteria}
        onChange={(val) => updateField('qualificationCriteria', val)}
        onBlur={onBlur}
        placeholder="Ex: Empresa media (10-200 funcionarios), processos manuais, decisor na linha, buscando resolver agora"
        type="textarea"
      />
    </div>
  )
}

/* ================================= Phase 5: Proposta & Agendamento ================================= */

function Phase5Fields({ answers, updateField, onBlur }: PhaseFieldsProps) {
  return (
    <div className="space-y-4">
      <WizardInput
        label="Como o agente deve conectar o problema do prospect a sua solucao?"
        value={answers.solutionBridge}
        onChange={(val) => updateField('solutionBridge', val)}
        onBlur={onBlur}
        placeholder="Ex: Faz sentido o que voce esta me dizendo. E exatamente esse tipo de processo que resolvemos..."
        type="textarea"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WizardInput
          label="Qual o nome do especialista que fara a reuniao?"
          value={answers.specialistName}
          onChange={(val) => updateField('specialistName', val)}
          onBlur={onBlur}
          placeholder="Ex: Lucas"
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Duracao ideal da reuniao
          </label>
          <select
            value={answers.meetingDuration}
            onChange={(e) => {
              updateField('meetingDuration', Number(e.target.value))
              setTimeout(onBlur, 100)
            }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all bg-white"
          >
            <option value={15}>15 minutos</option>
            <option value={30}>30 minutos</option>
            <option value={45}>45 minutos</option>
            <option value={60}>60 minutos</option>
          </select>
        </div>
      </div>
    </div>
  )
}

/* ================================= Phase 6: Objecoes ================================= */

function Phase6Fields({ answers, onBlur, setAnswers }: DynamicPhaseFieldsProps) {
  const addObjection = () => {
    if (answers.objections.length >= 10) return
    setAnswers(prev => ({
      ...prev,
      objections: [...prev.objections, { objection: '', response: '' }],
    }))
  }

  const removeObjection = (index: number) => {
    setAnswers(prev => ({
      ...prev,
      objections: prev.objections.filter((_, i) => i !== index),
    }))
    setTimeout(onBlur, 100)
  }

  const updateObjection = (index: number, field: 'objection' | 'response', value: string) => {
    setAnswers(prev => ({
      ...prev,
      objections: prev.objections.map((o, i) =>
        i === index ? { ...o, [field]: value } : o
      ),
    }))
  }

  const addSuggestion = (suggestion: string) => {
    if (answers.objections.length >= 10) return
    if (answers.objections.some(o => o.objection === suggestion)) return
    setAnswers(prev => ({
      ...prev,
      objections: [...prev.objections, { objection: suggestion, response: '' }],
    }))
  }

  const usedSuggestions = new Set(answers.objections.map(o => o.objection))

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-700">
            Quais objecoes seus prospects mais fazem?
          </label>
          <span className="text-xs text-slate-400">{answers.objections.length}/10</span>
        </div>

        <div className="space-y-3">
          {answers.objections.map((obj, index) => (
            <div key={index} className="border border-slate-100 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={obj.objection}
                  onChange={(e) => updateObjection(index, 'objection', e.target.value)}
                  onBlur={onBlur}
                  placeholder="Ex: Nao tenho tempo"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all"
                />
                <button
                  type="button"
                  onClick={() => removeObjection(index)}
                  className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
              <textarea
                value={obj.response}
                onChange={(e) => updateObjection(index, 'response', e.target.value)}
                onBlur={onBlur}
                placeholder="Ex: Eu entendo a correria. Me responde uma coisa so..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all resize-none"
              />
            </div>
          ))}
        </div>

        {answers.objections.length < 10 && (
          <button
            type="button"
            onClick={addObjection}
            className="mt-2 flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Adicionar objecao
          </button>
        )}

        {/* Suggestion chips */}
        {answers.objections.length < 10 && DEFAULT_OBJECTION_SUGGESTIONS.filter(s => !usedSuggestions.has(s)).length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-400 mb-1.5">Sugestoes rapidas:</p>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_OBJECTION_SUGGESTIONS.filter(s => !usedSuggestions.has(s)).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => addSuggestion(suggestion)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-full text-slate-600 hover:border-primary hover:text-primary transition-colors"
                >
                  + {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================= Phase 7: Linguagem & Regras ================================= */

function Phase7Fields({ answers, updateField, onBlur }: PhaseFieldsProps) {
  return (
    <div className="space-y-4">
      <WizardInput
        label="Quais palavras ou expressoes o agente NUNCA deve usar?"
        value={answers.forbiddenWords}
        onChange={(val) => updateField('forbiddenWords', val)}
        onBlur={onBlur}
        placeholder="Ex: rapidinho, minutinho, precinho, at, dot"
        type="textarea"
      />
      <WizardInput
        label="Quais expressoes-chave o agente deve usar?"
        value={answers.keyExpressions}
        onChange={(val) => updateField('keyExpressions', val)}
        onBlur={onBlur}
        placeholder="Ex: estrategico, otimizar, previsibilidade"
        type="textarea"
      />
      <WizardInput
        label="Alguma regra extra de comportamento?"
        value={answers.behaviorRules}
        onChange={(val) => updateField('behaviorRules', val)}
        onBlur={onBlur}
        placeholder="Ex: Nunca insistir mais de 2 vezes na mesma objecao"
        type="textarea"
      />
    </div>
  )
}
