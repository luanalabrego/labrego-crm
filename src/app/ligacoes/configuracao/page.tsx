'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { db } from '@/lib/firebaseClient'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useCrmUser } from '@/contexts/CrmUserContext'
import {
  ArrowLeftIcon,
  CheckIcon,
  GearIcon,
} from '@radix-ui/react-icons'
import {
  PhoneIcon,
  CalendarDaysIcon,
  ClockIcon,
  BellIcon,
  Cog6ToothIcon,
  SparklesIcon,
  BookOpenIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  LinkIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { CallRoutingConfig, CallAgentKnowledge, DEFAULT_AGENT_KNOWLEDGE } from '@/types/callRouting'
import { assemblePromptFromWizard } from '@/lib/promptAssembler'
import AgentWizard from '@/components/ligacoes/AgentWizard'
import IntegrationsPanel from '@/components/ligacoes/IntegrationsPanel'
import VoiceSelector from '@/components/ligacoes/VoiceSelector'

const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terca' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sabado' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}))

type TabType = 'config' | 'knowledge' | 'integrations'

function ExpandableTextarea({
  value,
  onChange,
  rows = 2,
  className = '',
  placeholder,
  fieldId,
  expandedFields,
  onToggleExpand,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  rows?: number
  className?: string
  placeholder?: string
  fieldId: string
  expandedFields: Set<string>
  onToggleExpand: (fieldId: string) => void
}) {
  const isExpanded = expandedFields.has(fieldId)
  const expandedRows = Math.max(rows * 3, 10)

  return (
    <div className="relative group">
      <textarea
        value={value}
        onChange={onChange}
        rows={isExpanded ? expandedRows : rows}
        className={`${className} pr-9 transition-all duration-200`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => onToggleExpand(fieldId)}
        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
        title={isExpanded ? 'Reduzir campo' : 'Expandir campo'}
      >
        {isExpanded ? (
          <ArrowsPointingInIcon className="w-4 h-4" />
        ) : (
          <ArrowsPointingOutIcon className="w-4 h-4" />
        )}
      </button>
    </div>
  )
}

export default function ConfiguracaoPage() {
  const { orgId } = useCrmUser()
  const [activeTab, setActiveTab] = useState<TabType>('config')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<CallRoutingConfig | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((fieldId: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldId)) {
        next.delete(fieldId)
      } else {
        next.add(fieldId)
      }
      return next
    })
  }, [])

  // Load config
  useEffect(() => {
    if (!orgId) return
    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'callRoutingConfig', orgId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const data = docSnap.data() as Partial<CallRoutingConfig>
          // Garantir que sub-objetos existem (para configs parciais do seed)
          setConfig({
            schedule: {
              enabled: true, startHour: 9, endHour: 18, timezone: 'America/Sao_Paulo',
              workDays: [1, 2, 3, 4, 5], slotDuration: 30, callInterval: 30,
              ...data.schedule,
            },
            voiceAgent: {
              vapiAssistantId: '', vapiPhoneNumberId: '', llmModel: 'gpt-4o', sttProvider: 'deepgram',
              ...data.voiceAgent,
            },
            agentKnowledge: { ...DEFAULT_AGENT_KNOWLEDGE, ...data.agentKnowledge },
            calendar: {
              googleCalendarId: '', bufferDays: 1, maxSlotsToShow: 3,
              ...data.calendar,
            },
            notifications: {
              whatsappReportEnabled: true, whatsappNumber: '', emailReportEnabled: false,
              ...data.notifications,
            },
            cronEnabled: data.cronEnabled ?? false,
            cronSchedule: data.cronSchedule || '0 9 * * 1-5',
            cronLimit: data.cronLimit ?? 500,
          } as CallRoutingConfig)
        } else {
          // Configuracao padrao
          const defaultConfig: CallRoutingConfig = {
            schedule: {
              enabled: true,
              startHour: 9,
              endHour: 18,
              timezone: 'America/Sao_Paulo',
              workDays: [1, 2, 3, 4, 5],
              slotDuration: 30,
              callInterval: 30,
            },
            voiceAgent: {
              vapiAssistantId: '',
              vapiPhoneNumberId: '',
              llmModel: 'gpt-4o',
              sttProvider: 'deepgram',
            },
            agentKnowledge: { ...DEFAULT_AGENT_KNOWLEDGE },
            calendar: {
              googleCalendarId: '',
              bufferDays: 1,
              maxSlotsToShow: 3,
            },
            notifications: {
              whatsappReportEnabled: true,
              whatsappNumber: '',
              emailReportEnabled: false,
            },
            cronEnabled: false,
            cronSchedule: '0 9 * * 1-5',
            cronLimit: 500,
          }
          setConfig(defaultConfig)
        }
      } catch (error) {
        console.error('Error loading config:', error)
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [orgId])

  // Save config — regenerates prompt from wizard (reverts custom edits)
  const handleSaveConfig = async () => {
    if (!config || !orgId) return
    setSaving(true)
    try {
      const docRef = doc(db, 'callRoutingConfig', orgId)

      // Regenerate prompt from wizard answers, resetting any custom edits
      const wizardAnswers = config.agentKnowledge?.wizardAnswers
      const regeneratedPrompt = wizardAnswers
        ? assemblePromptFromWizard(wizardAnswers)
        : config.agentKnowledge?.systemPrompt

      const updatedConfig = {
        ...config,
        agentKnowledge: {
          ...config.agentKnowledge,
          systemPrompt: regeneratedPrompt,
          wizardAnswers: wizardAnswers ? {
            ...wizardAnswers,
            manuallyEdited: false,
            lastUpdated: new Date().toISOString(),
          } : wizardAnswers,
        },
        orgId,
        updatedAt: new Date().toISOString(),
      }

      await setDoc(docRef, updatedConfig)
      setConfig(updatedConfig as CallRoutingConfig)
      setHasChanges(false)
      alert('Configuracoes salvas com sucesso!')
    } catch (error) {
      console.error('Error saving config:', error)
      alert('Erro ao salvar configuracoes')
    } finally {
      setSaving(false)
    }
  }

  // Callback for AgentWizard to propagate knowledge changes to parent state
  const handleKnowledgeUpdate = useCallback((updatedKnowledge: Partial<CallAgentKnowledge>) => {
    setConfig(prev => {
      if (!prev) return prev
      return {
        ...prev,
        agentKnowledge: { ...prev.agentKnowledge, ...updatedKnowledge },
      }
    })
  }, [])

  // Update config field
  const updateConfig = useCallback((path: string, value: unknown) => {
    setConfig(prev => {
      if (!prev) return prev
      const newConfig = { ...prev }
      const parts = path.split('.')
      let current: Record<string, unknown> = newConfig
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]] as Record<string, unknown>
      }
      current[parts[parts.length - 1]] = value
      return newConfig as CallRoutingConfig
    })
    setHasChanges(true)
  }, [])

  // Toggle workday
  const toggleWorkDay = (day: number) => {
    if (!config) return
    const currentDays = config.schedule.workDays
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort()
    updateConfig('schedule.workDays', newDays)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="h-full bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {/* Left: back + title (fixed width) */}
          <div className="flex items-center gap-4 flex-shrink-0 w-56">
            <Link
              href="/funil"
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 text-slate-600" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <PhoneIcon className="w-5 h-5 text-amber-600" />
                <Cog6ToothIcon className="w-5 h-5 text-slate-500" />
                Configuracao do Agente
              </h1>
              <p className="text-sm text-slate-500">
                Configure o agente de voz IA
              </p>
            </div>
          </div>

          {/* Center: Tabs (fills remaining space, centered) */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-lg overflow-x-auto">
              <button
                onClick={() => setActiveTab('config')}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'config'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <Cog6ToothIcon className="w-4 h-4" />
                Configuracoes
              </button>
              <button
                onClick={() => setActiveTab('knowledge')}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'knowledge'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <BookOpenIcon className="w-4 h-4" />
                Conhecimento
              </button>
              <button
                onClick={() => setActiveTab('integrations')}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'integrations'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                Integracoes
              </button>
            </div>
          </div>

          {/* Right: Save button (fixed width to balance layout) */}
          <div className="flex-shrink-0 w-56 flex justify-end">
            {(activeTab === 'config' || activeTab === 'knowledge') ? (
              <button
                onClick={handleSaveConfig}
                disabled={!hasChanges || saving}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  hasChanges
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Salvar
              </button>
            ) : (
              <div />
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Config Tab */}
        {activeTab === 'config' && config && (
          <div className="space-y-6">
            {/* Horarios */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                  <ClockIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Horarios</h2>
                  <p className="text-sm text-slate-500">
                    Configure quando as ligacoes podem ser feitas
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    Ligacoes automaticas habilitadas
                  </span>
                  <button
                    onClick={() =>
                      updateConfig('schedule.enabled', !config.schedule.enabled)
                    }
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      config.schedule.enabled ? 'bg-green-500' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        config.schedule.enabled ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Horario inicio
                    </label>
                    <select
                      value={config.schedule.startHour}
                      onChange={e =>
                        updateConfig('schedule.startHour', parseInt(e.target.value))
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      {HOURS.map(h => (
                        <option key={h.value} value={h.value}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Horario fim
                    </label>
                    <select
                      value={config.schedule.endHour}
                      onChange={e =>
                        updateConfig('schedule.endHour', parseInt(e.target.value))
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      {HOURS.map(h => (
                        <option key={h.value} value={h.value}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">
                    Dias da semana
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map(day => (
                      <button
                        key={day.value}
                        onClick={() => toggleWorkDay(day.value)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          config.schedule.workDays.includes(day.value)
                            ? 'bg-primary-100 border-primary-300 text-primary-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Duracao do slot (minutos)
                    </label>
                    <input
                      type="number"
                      value={config.schedule.slotDuration}
                      onChange={e =>
                        updateConfig('schedule.slotDuration', parseInt(e.target.value))
                      }
                      min={15}
                      max={60}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Intervalo entre ligacoes (segundos)
                    </label>
                    <input
                      type="number"
                      value={config.schedule.callInterval}
                      onChange={e =>
                        updateConfig('schedule.callInterval', parseInt(e.target.value))
                      }
                      min={10}
                      max={120}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Agente de Voz */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Agente de Voz</h2>
                  <p className="text-sm text-slate-500">
                    Configuracoes do agente e LLM
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Assistant ID
                  </label>
                  <input
                    type="text"
                    value={config.voiceAgent.vapiAssistantId}
                    onChange={e =>
                      updateConfig('voiceAgent.vapiAssistantId', e.target.value)
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Phone Number ID
                  </label>
                  <input
                    type="text"
                    value={config.voiceAgent.vapiPhoneNumberId}
                    onChange={e =>
                      updateConfig('voiceAgent.vapiPhoneNumberId', e.target.value)
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Modelo LLM
                    </label>
                    <select
                      value={config.voiceAgent.llmModel}
                      onChange={e =>
                        updateConfig('voiceAgent.llmModel', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Provider STT
                    </label>
                    <select
                      value={config.voiceAgent.sttProvider}
                      onChange={e =>
                        updateConfig('voiceAgent.sttProvider', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="deepgram">Deepgram Nova-2</option>
                      <option value="openai">OpenAI Whisper</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Voice Selector */}
            {orgId && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <VoiceSelector
                  orgId={orgId}
                  selectedVoiceId={config.voiceAgent.voiceId}
                  onSelect={(voiceId) => {
                    updateConfig('voiceAgent.voiceId', voiceId)
                  }}
                />
              </div>
            )}

            {/* Google Calendar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <CalendarDaysIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Google Calendar</h2>
                  <p className="text-sm text-slate-500">
                    Configuracoes de agendamento
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Calendar ID
                  </label>
                  <input
                    type="text"
                    value={config.calendar.googleCalendarId}
                    onChange={e =>
                      updateConfig('calendar.googleCalendarId', e.target.value)
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    placeholder="email@gmail.com ou ID do calendario"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Dias de antecedencia minima
                    </label>
                    <input
                      type="number"
                      value={config.calendar.bufferDays}
                      onChange={e =>
                        updateConfig('calendar.bufferDays', parseInt(e.target.value))
                      }
                      min={0}
                      max={7}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Ex: 1 = comeca a partir de amanha
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Slots para mostrar
                    </label>
                    <input
                      type="number"
                      value={config.calendar.maxSlotsToShow}
                      onChange={e =>
                        updateConfig('calendar.maxSlotsToShow', parseInt(e.target.value))
                      }
                      min={1}
                      max={5}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Notificacoes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-primary-600 flex items-center justify-center">
                  <BellIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Notificacoes</h2>
                  <p className="text-sm text-slate-500">
                    Relatorios e alertas
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    Enviar relatorio diario via WhatsApp
                  </span>
                  <button
                    onClick={() =>
                      updateConfig(
                        'notifications.whatsappReportEnabled',
                        !config.notifications.whatsappReportEnabled
                      )
                    }
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      config.notifications.whatsappReportEnabled
                        ? 'bg-green-500'
                        : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        config.notifications.whatsappReportEnabled
                          ? 'left-7'
                          : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {config.notifications.whatsappReportEnabled && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Numero WhatsApp para relatorio
                    </label>
                    <input
                      type="text"
                      value={config.notifications.whatsappNumber || ''}
                      onChange={e =>
                        updateConfig('notifications.whatsappNumber', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="+5511999999999"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* CRON */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                  <GearIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Automacao CRON</h2>
                  <p className="text-sm text-slate-500">
                    Disparo automatico de ligacoes
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    CRON habilitado
                  </span>
                  <button
                    onClick={() => updateConfig('cronEnabled', !config.cronEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      config.cronEnabled ? 'bg-green-500' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        config.cronEnabled ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Expressao CRON
                    </label>
                    <input
                      type="text"
                      value={config.cronSchedule}
                      onChange={e => updateConfig('cronSchedule', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                      placeholder="0 9 * * 1-5"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Padrao: 09h seg-sex
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Limite de ligacoes por batch
                    </label>
                    <input
                      type="number"
                      value={config.cronLimit}
                      onChange={e =>
                        updateConfig('cronLimit', parseInt(e.target.value))
                      }
                      min={1}
                      max={500}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Knowledge Tab — Wizard Gamificado (Story 12.2+12.5) */}
        {activeTab === 'knowledge' && config && orgId && (
          <div className="space-y-4">
            {/* Custom prompt indicator */}
            {config.agentKnowledge?.wizardAnswers?.manuallyEdited && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <PencilSquareIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Prompt customizado em uso</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    O prompt foi editado manualmente. Ao clicar em &quot;Salvar&quot; no topo da pagina, o prompt sera regenerado pelo wizard.
                  </p>
                </div>
              </div>
            )}
            <AgentWizard
              orgId={orgId}
              initialAnswers={config.agentKnowledge?.wizardAnswers}
              existingKnowledge={config.agentKnowledge}
              onKnowledgeUpdate={handleKnowledgeUpdate}
            />
          </div>
        )}

        {/* Integrations Tab */}
        {activeTab === 'integrations' && config && orgId && (
          <IntegrationsPanel
            orgId={orgId}
            integrations={config.integrations || {}}
            onSave={(integrations) => setConfig(prev => prev ? { ...prev, integrations } : prev)}
          />
        )}
      </div>
    </div>
  )
}
