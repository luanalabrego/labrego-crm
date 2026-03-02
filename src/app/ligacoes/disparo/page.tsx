'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useCrmUser } from '@/contexts/CrmUserContext'
import {
  ReloadIcon,
  PlayIcon,
} from '@radix-ui/react-icons'
import {
  PhoneIcon,
  ClockIcon,
  ChartBarIcon,
  RocketLaunchIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'

type TabType = 'trigger' | 'reports'

export default function DisparoPage() {
  const { orgId } = useCrmUser()
  const [activeTab, setActiveTab] = useState<TabType>('trigger')

  // Trigger state (queue-based)
  const [triggerLimit, setTriggerLimit] = useState(30)
  const [maxConcurrent, setMaxConcurrent] = useState(5)
  const [triggering, setTriggering] = useState(false)
  const [triggerCalls, setTriggerCalls] = useState<Array<{
    prospect: string
    phone: string
    company: string
    clientId: string
    status: 'waiting' | 'calling' | 'queued' | 'error' | 'in_progress' | 'completed' | 'no_answer' | 'cancelled'
    callId?: string
    error?: string
    outcome?: string
    duration?: number
  }>>([])
  const [triggerProgress, setTriggerProgress] = useState<{
    phase: 'idle' | 'preparing' | 'calling' | 'done' | 'error'
    current: number
    total: number
    queued: number
    errors: number
    answered: number
    notAnswered: number
    activeCalls: number
    message?: string
  }>({ phase: 'idle', current: 0, total: 0, queued: 0, errors: 0, answered: 0, notAnswered: 0, activeCalls: 0 })

  // Report state
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0])
  const [reportLoading, setReportLoading] = useState(false)
  const [report, setReport] = useState<{
    date: string
    total: number
    atenderam: number
    naoAtenderam: number
    outcomes: Record<string, number>
    details: Array<{ name: string; status: string; outcome?: string; duration?: number }>
  } | null>(null)

  // Refs
  const abortRef = useRef<AbortController | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const callsRef = useRef(triggerCalls)
  callsRef.current = triggerCalls

  // Poll individual call statuses via /api/vapi/poll-call
  const pollCallStatuses = useCallback(async () => {
    const calls = callsRef.current
    const pendingCalls = calls.filter(c =>
      (c.status === 'queued' || c.status === 'in_progress') && c.callId && c.clientId
    )

    if (pendingCalls.length === 0) {
      // All calls resolved — stop polling
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
      // Check if all calls are done (no more waiting/calling either)
      const stillDispatching = calls.some(c => c.status === 'waiting' || c.status === 'calling')
      if (!stillDispatching) {
        setTriggerProgress(prev => ({
          ...prev,
          phase: 'done',
          message: `Concluido! ${prev.answered} atenderam, ${prev.notAnswered} nao atenderam`,
        }))
        setTriggering(false)
      }
      return
    }

    // Poll each pending call in parallel
    const results = await Promise.allSettled(
      pendingCalls.map(async (call) => {
        const params = new URLSearchParams({
          callId: call.callId!,
          clientId: call.clientId,
        })
        if (call.prospect) params.set('prospectName', call.prospect)
        if (call.company) params.set('prospectCompany', call.company)

        const res = await fetch(`/api/vapi/poll-call?${params}`)
        const data = await res.json()
        return { callId: call.callId, ...data }
      })
    )

    let newAnswered = 0
    let newNotAnswered = 0

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const data = result.value

      if (data.status === 'in_progress') {
        // Still in progress — update to in_progress in UI
        setTriggerCalls(prev =>
          prev.map(c => c.callId === data.callId && c.status === 'queued'
            ? { ...c, status: 'in_progress' as const }
            : c
          )
        )
      } else if (data.status === 'completed') {
        const isNoAnswer = data.classification === 'TELEFONE_INDISPONIVEL'
        if (isNoAnswer) newNotAnswered++
        else newAnswered++

        setTriggerCalls(prev =>
          prev.map(c => c.callId === data.callId
            ? {
                ...c,
                status: isNoAnswer ? 'no_answer' as const : 'completed' as const,
                outcome: data.resultado,
                duration: data.duration,
              }
            : c
          )
        )
      } else if (data.status === 'retry') {
        // Multi-phone retry — update callId to the new one
        setTriggerCalls(prev =>
          prev.map(c => c.callId === data.callId
            ? { ...c, callId: data.newCallId, status: 'in_progress' as const }
            : c
          )
        )
      } else if (data.status === 'error') {
        newNotAnswered++
        setTriggerCalls(prev =>
          prev.map(c => c.callId === data.callId
            ? { ...c, status: 'error' as const, error: data.message }
            : c
          )
        )
      }
    }

    if (newAnswered > 0 || newNotAnswered > 0) {
      setTriggerProgress(prev => ({
        ...prev,
        answered: prev.answered + newAnswered,
        notAnswered: prev.notAnswered + newNotAnswered,
        activeCalls: Math.max(0, prev.activeCalls - newAnswered - newNotAnswered),
      }))
    }
  }, [])

  const startStatusPolling = useCallback(() => {
    if (pollingRef.current) return // already polling
    pollingRef.current = setInterval(pollCallStatuses, 15000)
  }, [pollCallStatuses])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Trigger calls via streaming /api/call-routing/trigger
  const handleTriggerCalls = async () => {
    if (abortRef.current) abortRef.current.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setTriggering(true)
    setTriggerCalls([])
    setTriggerProgress({ phase: 'preparing', current: 0, total: 0, queued: 0, errors: 0, answered: 0, notAnswered: 0, activeCalls: 0 })

    try {
      const response = await fetch('/api/call-routing/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: triggerLimit,
          maxConcurrent,
          intervalMs: 5000,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setTriggerProgress({
          phase: 'error',
          current: 0,
          total: 0,
          queued: 0,
          errors: 0,
          answered: 0,
          notAnswered: 0,
          activeCalls: 0,
          message: data.message || data.error || 'Erro ao disparar ligacoes',
        })
        setTriggering(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setTriggering(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)

            if (event.type === 'start') {
              setTriggerProgress(prev => ({
                ...prev,
                phase: 'calling',
                total: event.total,
              }))
              setTriggerCalls(
                event.prospects.map((p: { id: string; name: string; phone: string; company: string }) => ({
                  prospect: p.name,
                  phone: p.phone,
                  company: p.company,
                  clientId: p.id,
                  status: 'waiting' as const,
                }))
              )
            } else if (event.type === 'calling') {
              setTriggerCalls(prev =>
                prev.map((c, idx) => idx === event.index ? { ...c, status: 'calling' as const } : c)
              )
              setTriggerProgress(prev => ({
                ...prev,
                activeCalls: event.activeCalls ?? prev.activeCalls,
              }))
            } else if (event.type === 'result') {
              setTriggerCalls(prev =>
                prev.map((c, idx) =>
                  idx === event.index
                    ? {
                        ...c,
                        status: event.status === 'queued' ? 'queued' as const : 'error' as const,
                        callId: event.callId,
                        error: event.error,
                      }
                    : c
                )
              )
              setTriggerProgress(prev => ({
                ...prev,
                current: prev.current + (event.status === 'queued' ? 1 : 0),
                errors: prev.errors + (event.status === 'error' ? 1 : 0),
                activeCalls: event.activeCalls ?? prev.activeCalls,
              }))
              // Start polling call statuses as soon as first call is dispatched
              if (event.status === 'queued') {
                startStatusPolling()
              }
            } else if (event.type === 'rate_limit') {
              setTriggerProgress(prev => ({
                ...prev,
                message: event.message || `Rate limit - aguardando ${Math.round((event.cooldownMs || 10000) / 1000)}s...`,
              }))
            } else if (event.type === 'waiting') {
              setTriggerProgress(prev => ({
                ...prev,
                activeCalls: event.activeCalls ?? prev.activeCalls,
                message: `Aguardando vaga (${event.activeCalls}/${event.maxConcurrent} ativas)...`,
              }))
            } else if (event.type === 'done' || event.type === 'cancelled') {
              setTriggerProgress(prev => ({
                ...prev,
                phase: 'calling',
                message: event.type === 'cancelled'
                  ? 'Disparo cancelado'
                  : `Todas as ${event.queued} ligacoes disparadas. Aguardando resultados...`,
              }))
              // Don't stop triggering — polling will continue tracking call statuses
              // triggering will be set to false when all calls resolve
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }

      // Stream ended — dispatch is done, but calls may still be in progress
      // Polling will continue tracking call outcomes
      setTriggerProgress(prev => prev.phase === 'preparing'
        ? { ...prev, phase: 'done', message: 'Disparo concluido!' }
        : { ...prev, message: prev.message || 'Aguardando resultados das ligacoes...' }
      )
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setTriggerProgress({
        phase: 'error',
        current: 0,
        total: 0,
        queued: 0,
        errors: 0,
        answered: 0,
        notAnswered: 0,
        activeCalls: 0,
        message: 'Erro ao disparar ligacoes: ' + String(error),
      })
      setTriggering(false)
    }
  }

  const handleCancelTrigger = async () => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = null
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    setTriggering(false)

    try {
      await fetch('/api/call-routing/trigger', { method: 'DELETE' })
    } catch {
      // Ignorar erro de cancel
    }

    setTriggerProgress(prev => ({ ...prev, phase: 'done', message: 'Disparo cancelado' }))
  }

  // Load report
  const handleLoadReport = async () => {
    setReportLoading(true)
    try {
      const response = await fetch(`/api/call-routing/reports?date=${reportDate}&source=vapi`)
      const data = await response.json()
      if (data.success) {
        setReport(data.report)
      } else {
        alert('Erro ao carregar relatorio: ' + data.error)
      }
    } catch (error) {
      alert('Erro ao carregar relatorio: ' + String(error))
    } finally {
      setReportLoading(false)
    }
  }

  return (
    <div className="h-full bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {/* Left: back + title (fixed width) */}
          <div className="flex items-center gap-4 flex-shrink-0 w-56">
            <Link
              href="/ligacoes/configuracao"
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 text-slate-600" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <RocketLaunchIcon className="w-5 h-5 text-green-600" />
                Disparo Massivo de Ligacoes
              </h1>
              <p className="text-sm text-slate-500">
                Dispare e acompanhe ligacoes em massa
              </p>
            </div>
          </div>

          {/* Center: Tabs (fills remaining space, centered) */}
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-lg overflow-x-auto">
              <button
                onClick={() => setActiveTab('trigger')}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'trigger'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <RocketLaunchIcon className="w-4 h-4" />
                Disparar
              </button>
              <button
                onClick={() => setActiveTab('reports')}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'reports'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <ChartBarIcon className="w-4 h-4" />
                Relatorios
              </button>
            </div>
          </div>

          {/* Right: spacer to balance layout */}
          <div className="flex-shrink-0 w-56 flex justify-end">
            <div />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Trigger Tab */}
        {activeTab === 'trigger' && (
          <div className="space-y-6">
            {/* Controles */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <RocketLaunchIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Disparar Ligacoes</h2>
                  <p className="text-sm text-slate-500">
                    Inicie um lote de ligacoes manualmente
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Total de ligacoes
                    </label>
                    <input
                      type="number"
                      value={triggerLimit}
                      onChange={e => setTriggerLimit(parseInt(e.target.value))}
                      min={1}
                      max={500}
                      disabled={triggering}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Simultaneas (max VAPI)
                    </label>
                    <input
                      type="number"
                      value={maxConcurrent}
                      onChange={e => setMaxConcurrent(parseInt(e.target.value))}
                      min={1}
                      max={20}
                      disabled={triggering}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="p-4 bg-primary-50 border border-primary-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <SparklesIcon className="w-5 h-5 text-primary-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-primary-700 font-medium">
                        Disparo com controle de concorrencia
                      </p>
                      <p className="text-sm text-primary-600 mt-1">
                        Dispara 1 ligacao a cada 3 segundos, com no maximo {maxConcurrent} simultaneas.
                        O status de cada ligacao e atualizado a cada 10 segundos.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-amber-700 font-medium">
                        Atencao
                      </p>
                      <p className="text-sm text-amber-600 mt-1">
                        As ligacoes serao feitas para prospects na etapa
                        &quot;Prospeccao Ativa&quot;, ordenados por ultimo contato.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleTriggerCalls}
                    disabled={triggering}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {triggering && triggerProgress.phase === 'preparing' ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Preparando...
                      </>
                    ) : triggering && triggerProgress.phase === 'calling' ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {triggerProgress.current} disparadas | {triggerProgress.activeCalls} ativas | {triggerProgress.errors} erros
                      </>
                    ) : (
                      <>
                        <PlayIcon className="w-5 h-5" />
                        Disparar {triggerLimit} Ligacoes
                      </>
                    )}
                  </button>
                  {triggering && (
                    <button
                      onClick={handleCancelTrigger}
                      className="px-4 py-3 bg-red-100 text-red-700 font-medium rounded-xl hover:bg-red-200 transition-colors"
                      title="Cancelar"
                    >
                      <XCircleIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Mensagem de erro/info */}
            {triggerProgress.phase === 'error' && triggerProgress.message && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{triggerProgress.message}</p>
                </div>
              </div>
            )}

            {triggerProgress.phase === 'done' && triggerProgress.total === 0 && triggerProgress.message && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <p className="text-sm text-amber-700">{triggerProgress.message}</p>
                </div>
              </div>
            )}

            {/* Progresso e lista de ligacoes */}
            {(triggerProgress.phase === 'calling' || triggerProgress.phase === 'done') && triggerCalls.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                {/* Header com status */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      {triggerProgress.phase === 'calling' && (
                        <>
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          {triggerProgress.current < triggerProgress.total
                            ? `Disparando - ${triggerProgress.current} de ${triggerProgress.total}`
                            : `Monitorando - ${triggerProgress.answered + triggerProgress.notAnswered} de ${triggerProgress.total} finalizadas`
                          }
                        </>
                      )}
                      {triggerProgress.phase === 'done' && (
                        <>
                          <CheckCircleIcon className="w-5 h-5 text-green-600" />
                          {triggerProgress.message || 'Concluido'}
                        </>
                      )}
                    </h3>
                    <div className="flex items-center gap-2">
                      {triggerProgress.phase === 'calling' && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                          Atualiza a cada 10s
                        </span>
                      )}
                      <span className="text-sm text-slate-500">
                        {triggerProgress.answered} atenderam | {triggerProgress.notAnswered} nao atenderam
                      </span>
                    </div>
                  </div>
                  {/* Barra de progresso */}
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div className="h-2.5 flex">
                      {/* Barra de concluidas (verde) */}
                      <div
                        className="h-2.5 bg-green-500 transition-all duration-500"
                        style={{
                          width: triggerProgress.total > 0
                            ? `${(triggerProgress.current / triggerProgress.total) * 100}%`
                            : '0%',
                        }}
                      />
                      {/* Barra de ativas (azul) */}
                      <div
                        className="h-2.5 bg-blue-500 transition-all duration-500 animate-pulse"
                        style={{
                          width: triggerProgress.total > 0
                            ? `${(triggerProgress.activeCalls / triggerProgress.total) * 100}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Contadores em tempo real */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-slate-800">
                      {triggerProgress.total}
                    </p>
                    <p className="text-xs text-slate-500">Total</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {triggerProgress.activeCalls}
                    </p>
                    <p className="text-xs text-slate-500">Ativas</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-amber-600">
                      {triggerProgress.queued}
                    </p>
                    <p className="text-xs text-slate-500">Na fila</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {triggerProgress.answered}
                    </p>
                    <p className="text-xs text-slate-500">Atenderam</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-orange-600">
                      {triggerProgress.notAnswered}
                    </p>
                    <p className="text-xs text-slate-500">Nao atenderam</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-red-600">
                      {triggerProgress.errors}
                    </p>
                    <p className="text-xs text-slate-500">Erros</p>
                  </div>
                </div>

                {/* Botao de cancelar disparo */}
                {triggerProgress.phase === 'calling' && (
                  <div className="mb-4">
                    <button
                      onClick={handleCancelTrigger}
                      className="text-sm text-red-500 hover:text-red-700 underline"
                    >
                      Cancelar disparo (ligacoes ja iniciadas continuam, pendentes sao canceladas)
                    </button>
                  </div>
                )}

                {/* Lista de ligacoes em tempo real */}
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {triggerCalls.map((call, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 p-3 rounded-xl text-sm transition-all duration-300 ${
                        call.status === 'completed'
                          ? 'bg-green-50 border border-green-100'
                          : call.status === 'no_answer'
                          ? 'bg-orange-50 border border-orange-100'
                          : call.status === 'error'
                          ? 'bg-red-50 border border-red-100'
                          : call.status === 'in_progress'
                          ? 'bg-blue-50 border border-blue-200'
                          : call.status === 'calling'
                          ? 'bg-primary-50 border border-primary-200'
                          : call.status === 'queued'
                          ? 'bg-amber-50 border border-amber-100'
                          : call.status === 'cancelled'
                          ? 'bg-slate-50 border border-slate-100 opacity-50'
                          : 'bg-slate-50 border border-slate-100'
                      }`}
                    >
                      {/* Icone de status */}
                      <div className="flex-shrink-0">
                        {call.status === 'waiting' && (
                          <ClockIcon className="w-5 h-5 text-slate-400" />
                        )}
                        {call.status === 'calling' && (
                          <div className="w-5 h-5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
                        )}
                        {call.status === 'queued' && (
                          <PhoneIcon className="w-5 h-5 text-amber-600" />
                        )}
                        {call.status === 'in_progress' && (
                          <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                        )}
                        {call.status === 'completed' && (
                          <CheckCircleIcon className="w-5 h-5 text-green-600" />
                        )}
                        {call.status === 'no_answer' && (
                          <XCircleIcon className="w-5 h-5 text-orange-500" />
                        )}
                        {call.status === 'error' && (
                          <XCircleIcon className="w-5 h-5 text-red-600" />
                        )}
                        {call.status === 'cancelled' && (
                          <ClockIcon className="w-5 h-5 text-slate-300" />
                        )}
                      </div>

                      {/* Numero */}
                      <span className="text-xs text-slate-400 font-mono w-6 text-right flex-shrink-0">
                        {i + 1}
                      </span>

                      {/* Info do prospect */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 truncate">
                          {call.prospect}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {call.phone}
                          {call.company ? ` - ${call.company}` : ''}
                        </p>
                      </div>

                      {/* Status + outcome */}
                      <div className="flex-shrink-0 text-right max-w-[200px]">
                        {call.status === 'waiting' && (
                          <span className="text-xs text-slate-400">Aguardando</span>
                        )}
                        {call.status === 'calling' && (
                          <span className="text-xs text-primary-600 font-medium">Disparando...</span>
                        )}
                        {call.status === 'queued' && (
                          <span className="text-xs text-amber-600 font-medium">Ligando...</span>
                        )}
                        {call.status === 'in_progress' && (
                          <span className="text-xs text-blue-600 font-medium">Em andamento</span>
                        )}
                        {call.status === 'completed' && (
                          <div>
                            <span className="text-xs text-green-600 font-medium block truncate">
                              {call.outcome || 'Concluida'}
                            </span>
                            {call.duration !== undefined && call.duration > 0 && (
                              <span className="text-xs text-slate-400">
                                {Math.floor(call.duration / 60)}:{(call.duration % 60).toString().padStart(2, '0')}
                              </span>
                            )}
                          </div>
                        )}
                        {call.status === 'no_answer' && (
                          <span className="text-xs text-orange-600 font-medium block truncate">
                            {call.outcome || 'Nao atendeu'}
                          </span>
                        )}
                        {call.status === 'error' && (
                          <span className="text-xs text-red-600 font-medium block truncate">
                            {call.error || 'Erro'}
                          </span>
                        )}
                        {call.status === 'cancelled' && (
                          <span className="text-xs text-slate-400 font-medium block truncate">
                            Cancelada
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center">
                    <ChartBarIcon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800">Relatorio Diario</h2>
                    <p className="text-sm text-slate-500">
                      Visualize os resultados das ligacoes
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={reportDate}
                    onChange={e => setReportDate(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleLoadReport}
                    disabled={reportLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  >
                    {reportLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <ReloadIcon className="w-4 h-4" />
                    )}
                    Carregar
                  </button>
                </div>
              </div>

              {report ? (
                <div className="space-y-6">
                  {/* KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-3xl font-bold text-slate-800">
                        {report.total}
                      </p>
                      <p className="text-sm text-slate-500">Total de ligacoes</p>
                    </div>
                    <div className="bg-green-50 rounded-xl p-4">
                      <p className="text-3xl font-bold text-green-600">
                        {report.atenderam}
                      </p>
                      <p className="text-sm text-slate-500">Atenderam</p>
                    </div>
                    <div className="bg-red-50 rounded-xl p-4">
                      <p className="text-3xl font-bold text-red-600">
                        {report.naoAtenderam}
                      </p>
                      <p className="text-sm text-slate-500">Nao atenderam</p>
                    </div>
                    <div className="bg-primary-50 rounded-xl p-4">
                      <p className="text-3xl font-bold text-primary-600">
                        {report.total > 0
                          ? Math.round((report.atenderam / report.total) * 100)
                          : 0}
                        %
                      </p>
                      <p className="text-sm text-slate-500">Taxa de atendimento</p>
                    </div>
                  </div>

                  {/* Outcomes */}
                  {Object.keys(report.outcomes).length > 0 && (
                    <div>
                      <h3 className="font-semibold text-slate-800 mb-3">
                        Resultados
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {Object.entries(report.outcomes).map(([outcome, count]) => (
                          <div
                            key={outcome}
                            className="bg-slate-50 rounded-lg p-3"
                          >
                            <p className="text-lg font-bold text-slate-800">
                              {count}
                            </p>
                            <p className="text-xs text-slate-500">{outcome}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Details */}
                  {report.details.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-slate-800 mb-3">
                        Detalhes
                      </h3>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {report.details.map((detail, i) => (
                          <div
                            key={i}
                            className={`flex items-center justify-between p-3 rounded-lg ${
                              detail.status === 'atendeu'
                                ? 'bg-green-50'
                                : 'bg-red-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {detail.status === 'atendeu' ? (
                                <CheckCircleIcon className="w-5 h-5 text-green-600" />
                              ) : (
                                <XCircleIcon className="w-5 h-5 text-red-600" />
                              )}
                              <span className="font-medium text-slate-800">
                                {detail.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              {detail.duration && (
                                <span className="text-sm text-slate-500">
                                  {Math.floor(detail.duration / 60)}:
                                  {(detail.duration % 60)
                                    .toString()
                                    .padStart(2, '0')}
                                </span>
                              )}
                              {detail.outcome && (
                                <span className="text-sm font-medium text-slate-600">
                                  {detail.outcome}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <ChartBarIcon className="w-12 h-12 mx-auto mb-3" />
                  <p>Selecione uma data e clique em Carregar</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
