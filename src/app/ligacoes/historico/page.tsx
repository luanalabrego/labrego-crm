'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { db } from '@/lib/firebaseClient'
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  Timestamp,
} from 'firebase/firestore'
import { useCrmUser } from '@/contexts/CrmUserContext'
import {
  PhoneIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

interface CallRecord {
  id: string
  clientId: string
  contactName: string
  company: string
  funnelId: string
  phone: string
  duration: number
  result: string
  recordingUrl: string
  createdAt: Date
  summary: string
}

interface FunnelOption {
  id: string
  name: string
}

interface Filters {
  search: string
  dateFrom: string
  dateTo: string
  funnelId: string
}

export default function HistoricoLigacoesPage() {
  const { orgId } = useCrmUser()
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [funnels, setFunnels] = useState<FunnelOption[]>([])
  const [downloading, setDownloading] = useState(false)
  const [filters, setFilters] = useState<Filters>({
    search: '',
    dateFrom: '',
    dateTo: '',
    funnelId: '',
  })

  // Load funnels
  useEffect(() => {
    if (!orgId) return
    const loadFunnels = async () => {
      try {
        const funnelsSnap = await getDocs(
          collection(db, 'organizations', orgId, 'funnels')
        )
        const funnelList: FunnelOption[] = funnelsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name || d.id,
        }))
        setFunnels(funnelList)
      } catch (err) {
        console.error('[historico] Erro ao carregar funis:', err)
      }
    }
    loadFunnels()
  }, [orgId])

  // Load calls
  const loadCalls = useCallback(async () => {
    if (!orgId) return
    setLoading(true)

    try {
      // Step 1: Load all clients for this org
      const clientsSnap = await getDocs(
        query(collection(db, 'clients'), where('orgId', '==', orgId))
      )

      const clientsMap = new Map<
        string,
        { name: string; company: string; funnelId: string; phone: string }
      >()
      clientsSnap.docs.forEach((d) => {
        const data = d.data()
        clientsMap.set(d.id, {
          name: data.name || data.nome || '',
          company: data.company || data.empresa || '',
          funnelId: data.funnelId || '',
          phone: data.phone || data.telefone || '',
        })
      })

      // Step 2: Load calls for all clients in parallel batches
      const allCalls: CallRecord[] = []
      const clientIds = Array.from(clientsMap.keys())

      for (let i = 0; i < clientIds.length; i += 10) {
        const batch = clientIds.slice(i, i + 10)
        const results = await Promise.all(
          batch.map((cid) =>
            getDocs(
              query(
                collection(db, 'clients', cid, 'calls'),
                orderBy('createdAt', 'desc'),
                limit(50)
              )
            ).catch(() => null)
          )
        )

        results.forEach((snap, idx) => {
          if (!snap) return
          const clientId = batch[idx]
          const client = clientsMap.get(clientId)

          snap.docs.forEach((doc) => {
            const data = doc.data()
            const createdAt = data.createdAt instanceof Timestamp
              ? data.createdAt.toDate()
              : data.createdAt
                ? new Date(data.createdAt)
                : new Date()

            allCalls.push({
              id: doc.id,
              clientId,
              contactName: client?.name || 'Desconhecido',
              company: client?.company || '',
              funnelId: client?.funnelId || '',
              phone: data.phone || client?.phone || '',
              duration: data.duration || 0,
              result: data.result || data.outcome || data.status || '',
              recordingUrl: data.recordingUrl || data.recording_url || '',
              createdAt,
              summary: data.summary || data.resultado || '',
            })
          })
        })
      }

      // Step 3: Also check followups with recording URLs
      for (let i = 0; i < clientIds.length; i += 10) {
        const batch = clientIds.slice(i, i + 10)
        const results = await Promise.all(
          batch.map((cid) =>
            getDocs(
              query(
                collection(db, 'clients', cid, 'followups'),
                orderBy('createdAt', 'desc'),
                limit(20)
              )
            ).catch(() => null)
          )
        )

        results.forEach((snap, idx) => {
          if (!snap) return
          const clientId = batch[idx]
          const client = clientsMap.get(clientId)

          snap.docs.forEach((doc) => {
            const data = doc.data()
            // Only include followups that have recording URLs
            const recordingUrl = data.recordingUrl || data.recording_url || ''
            if (!recordingUrl) return

            // Avoid duplicates - check if we already have this recording
            if (allCalls.some((c) => c.recordingUrl === recordingUrl)) return

            const createdAt = data.createdAt instanceof Timestamp
              ? data.createdAt.toDate()
              : data.createdAt
                ? new Date(data.createdAt)
                : new Date()

            allCalls.push({
              id: doc.id,
              clientId,
              contactName: client?.name || 'Desconhecido',
              company: client?.company || '',
              funnelId: client?.funnelId || '',
              phone: data.phone || client?.phone || '',
              duration: data.duration || 0,
              result: data.result || data.outcome || 'followup',
              recordingUrl,
              createdAt,
              summary: data.summary || data.text || '',
            })
          })
        })
      }

      // Sort by date descending
      allCalls.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      setCalls(allCalls)
    } catch (err) {
      console.error('[historico] Erro ao carregar ligacoes:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    loadCalls()
  }, [loadCalls])

  // Apply filters
  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      // Search filter (case insensitive)
      if (filters.search) {
        const search = filters.search.toLowerCase()
        const matchesName = call.contactName.toLowerCase().includes(search)
        const matchesCompany = call.company.toLowerCase().includes(search)
        const matchesPhone = call.phone.includes(search)
        if (!matchesName && !matchesCompany && !matchesPhone) return false
      }

      // Date from filter
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom)
        from.setHours(0, 0, 0, 0)
        if (call.createdAt < from) return false
      }

      // Date to filter
      if (filters.dateTo) {
        const to = new Date(filters.dateTo)
        to.setHours(23, 59, 59, 999)
        if (call.createdAt > to) return false
      }

      // Funnel filter
      if (filters.funnelId && call.funnelId !== filters.funnelId) return false

      return true
    })
  }, [calls, filters])

  // Format duration
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '--'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Format date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Download ZIP
  const handleDownloadZip = async () => {
    const recordingsToDownload = filteredCalls.filter((c) => c.recordingUrl)
    if (recordingsToDownload.length === 0) {
      alert('Nenhuma gravacao encontrada nos resultados filtrados.')
      return
    }

    setDownloading(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      let downloaded = 0
      for (const call of recordingsToDownload) {
        try {
          const response = await fetch(call.recordingUrl)
          if (!response.ok) continue
          const blob = await response.blob()

          const safeName = call.contactName.replace(/[^a-zA-Z0-9_-]/g, '_')
          const dateStr = call.createdAt
            .toISOString()
            .split('T')[0]
          const ext = call.recordingUrl.includes('.mp3') ? 'mp3' : 'wav'
          zip.file(`${safeName}_${dateStr}_${downloaded + 1}.${ext}`, blob)
          downloaded++
        } catch (err) {
          console.error(`[historico] Erro ao baixar gravacao de ${call.contactName}:`, err)
        }
      }

      if (downloaded === 0) {
        alert('Nao foi possivel baixar nenhuma gravacao.')
        setDownloading(false)
        return
      }

      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `gravacoes_${new Date().toISOString().split('T')[0]}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[historico] Erro ao gerar ZIP:', err)
      alert('Erro ao gerar arquivo ZIP: ' + String(err))
    } finally {
      setDownloading(false)
    }
  }

  // Clear filters
  const clearFilters = () => {
    setFilters({ search: '', dateFrom: '', dateTo: '', funnelId: '' })
  }

  const hasActiveFilters = filters.search || filters.dateFrom || filters.dateTo || filters.funnelId

  return (
    <div className="h-full bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link
            href="/ligacoes/configuracao"
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 text-slate-600" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <PhoneIcon className="w-5 h-5 text-[#13DEFC]" />
              Historico de Ligacoes
            </h1>
            <p className="text-sm text-slate-500">
              Visualize e baixe gravacoes de todas as ligacoes
            </p>
          </div>
          <button
            onClick={handleDownloadZip}
            disabled={downloading || filteredCalls.filter((c) => c.recordingUrl).length === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#13DEFC] text-white font-medium rounded-xl hover:bg-[#11c8e3] disabled:opacity-50 transition-colors"
          >
            {downloading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Baixando...
              </>
            ) : (
              <>
                <ArrowDownTrayIcon className="w-4 h-4" />
                Baixar Gravacoes (.zip)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Buscar contato
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, search: e.target.value }))
                  }
                  placeholder="Nome, empresa ou telefone..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/30 focus:border-[#13DEFC]"
                />
              </div>
            </div>

            {/* Date from */}
            <div className="min-w-[150px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Data inicio
              </label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateFrom: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/30 focus:border-[#13DEFC]"
              />
            </div>

            {/* Date to */}
            <div className="min-w-[150px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Data fim
              </label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateTo: e.target.value }))
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/30 focus:border-[#13DEFC]"
              />
            </div>

            {/* Funnel */}
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Funil
              </label>
              <div className="relative">
                <FunnelIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={filters.funnelId}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, funnelId: e.target.value }))
                  }
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/30 focus:border-[#13DEFC] appearance-none bg-white"
                >
                  <option value="">Todos os funis</option>
                  {funnels.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-500">
            {loading
              ? 'Carregando...'
              : `${filteredCalls.length} ligacao${filteredCalls.length !== 1 ? 'es' : ''} encontrada${filteredCalls.length !== 1 ? 's' : ''}`}
            {filteredCalls.filter((c) => c.recordingUrl).length > 0 && (
              <span className="ml-2 text-[#13DEFC]">
                ({filteredCalls.filter((c) => c.recordingUrl).length} com gravacao)
              </span>
            )}
          </p>
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-3 border-slate-200 border-t-[#13DEFC] rounded-full animate-spin mb-4" />
            <p className="text-sm text-slate-500">Carregando historico de ligacoes...</p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center">
            <PhoneIcon className="w-12 h-12 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">
              {hasActiveFilters
                ? 'Nenhuma ligacao encontrada com os filtros aplicados.'
                : 'Nenhuma ligacao registrada ainda.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Data/Hora
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Contato
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Empresa
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Duracao
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Resultado
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">
                      Gravacao
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCalls.map((call) => (
                    <tr
                      key={`${call.clientId}-${call.id}`}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                        {formatDate(call.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {call.contactName}
                          </p>
                          {call.phone && (
                            <p className="text-xs text-slate-400">{call.phone}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {call.company || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {formatDuration(call.duration)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            call.result === 'completed' || call.result === 'atendeu'
                              ? 'bg-green-50 text-green-700'
                              : call.result === 'no_answer' || call.result === 'nao_atendeu'
                                ? 'bg-orange-50 text-orange-700'
                                : call.result === 'error'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {call.result || '--'}
                        </span>
                        {call.summary && (
                          <p className="text-xs text-slate-400 mt-1 max-w-[200px] truncate">
                            {call.summary}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {call.recordingUrl ? (
                          <audio
                            controls
                            preload="none"
                            className="h-8 max-w-[220px]"
                          >
                            <source src={call.recordingUrl} />
                          </audio>
                        ) : (
                          <span className="text-xs text-slate-400">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
