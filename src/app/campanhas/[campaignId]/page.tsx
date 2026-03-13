'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import PlanGate from '@/components/PlanGate'
import { formatDate, formatDateTimeAt } from '@/lib/format'
import { toast } from 'sonner'
import {
  type Campaign,
  type CampaignRecipient,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_TYPE_LABELS,
  RECURRENCE_LABELS,
} from '@/types/campaign'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  EyeIcon,
  CursorArrowRaysIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { type EmailEvent, calcEngagement, EMPTY_ENGAGEMENT } from '@/types/email'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

/* ================================= Component ================================= */

function CampaignDetailsContent() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.campaignId as string
  const { orgId } = useCrmUser()

  /* ----------------------------- State ---------------------------------- */

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([])
  const [loading, setLoading] = useState(true)
  const [recipientFilter, setRecipientFilter] = useState<'' | 'sent' | 'failed' | 'pending'>('')
  const [resending, setResending] = useState(false)
  const [emailEvents, setEmailEvents] = useState<EmailEvent[]>([])
  const [engagementTab, setEngagementTab] = useState<'metrics' | 'timeline' | 'contacts'>('metrics')

  /* ---------------------- Real-time subscriptions ----------------------- */

  useEffect(() => {
    if (!orgId || !campaignId) return

    // Campaign data
    const campaignRef = doc(db, 'organizations', orgId, 'campaigns', campaignId)
    const unsubCampaign = onSnapshot(
      campaignRef,
      (snap) => {
        if (snap.exists()) {
          setCampaign({ id: snap.id, ...snap.data() } as Campaign)
        }
        setLoading(false)
      },
      (error) => {
        console.error('Error loading campaign:', error)
        toast.error('Erro ao carregar campanha')
        setLoading(false)
      },
    )

    // Recipients data
    const recipientsRef = collection(db, 'organizations', orgId, 'campaigns', campaignId, 'recipients')
    const unsubRecipients = onSnapshot(
      query(recipientsRef),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CampaignRecipient[]
        setRecipients(items)
      },
      (error) => {
        console.error('Error loading recipients:', error)
      },
    )

    // Email engagement events
    const eventsQuery = query(
      collection(db, 'emailEvents'),
      where('orgId', '==', orgId),
      where('campaignId', '==', campaignId),
    )
    const unsubEvents = onSnapshot(
      eventsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as EmailEvent[]
        setEmailEvents(items)
      },
      (error) => {
        console.error('Error loading email events:', error)
      },
    )

    return () => {
      unsubCampaign()
      unsubRecipients()
      unsubEvents()
    }
  }, [orgId, campaignId])

  /* ----------------------------- Derived -------------------------------- */

  const filteredRecipients = useMemo(() => {
    if (!recipientFilter) return recipients
    return recipients.filter((r) => r.status === recipientFilter)
  }, [recipients, recipientFilter])

  const counts = useMemo(() => {
    let sent = 0
    let failed = 0
    let pending = 0
    recipients.forEach((r) => {
      if (r.status === 'sent') sent++
      else if (r.status === 'failed') failed++
      else pending++
    })
    return { sent, failed, pending, total: recipients.length }
  }, [recipients])

  const engagement = useMemo(() => {
    if (emailEvents.length === 0) return EMPTY_ENGAGEMENT
    return calcEngagement(emailEvents, counts.sent)
  }, [emailEvents, counts.sent])

  const timelineData = useMemo(() => {
    if (emailEvents.length === 0) return []
    const byDate: Record<string, { date: string; opens: number; clicks: number; delivered: number }> = {}
    for (const ev of emailEvents) {
      const date = (ev.timestamp || '').split('T')[0]
      if (!date) continue
      if (!byDate[date]) byDate[date] = { date, opens: 0, clicks: 0, delivered: 0 }
      if (ev.type === 'opened') byDate[date].opens++
      else if (ev.type === 'clicked') byDate[date].clicks++
      else if (ev.type === 'delivered') byDate[date].delivered++
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  }, [emailEvents])

  const engagedContacts = useMemo(() => {
    const map: Record<string, { contactId: string; email: string; opened: boolean; clicked: boolean; lastEvent: string }> = {}
    for (const ev of emailEvents) {
      if (ev.type !== 'opened' && ev.type !== 'clicked') continue
      if (!map[ev.contactId]) {
        map[ev.contactId] = { contactId: ev.contactId, email: ev.recipientEmail, opened: false, clicked: false, lastEvent: ev.timestamp }
      }
      if (ev.type === 'opened') map[ev.contactId].opened = true
      if (ev.type === 'clicked') map[ev.contactId].clicked = true
      if (ev.timestamp > map[ev.contactId].lastEvent) map[ev.contactId].lastEvent = ev.timestamp
    }
    return Object.values(map).sort((a, b) => b.lastEvent.localeCompare(a.lastEvent))
  }, [emailEvents])

  /* ----------------------------- Handlers ------------------------------- */

  const handleResendFailed = async () => {
    if (!orgId || !campaignId || counts.failed === 0) return
    setResending(true)
    try {
      // Reset failed recipients to pending on server side
      const response = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, orgId }),
      })

      if (!response.ok) throw new Error('Failed to trigger resend')

      toast.success('Reenvio iniciado para destinatários com falha')
    } catch (error) {
      console.error('Error resending:', error)
      toast.error('Erro ao reenviar')
    }
    setResending(false)
  }

  /* ================================= Render ================================= */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Campanha não encontrada</p>
        <button onClick={() => router.push('/campanhas')} className="mt-4 text-primary-600 font-medium text-sm">
          Voltar para campanhas
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/campanhas')} className="rounded-lg p-2 hover:bg-slate-100 transition-colors">
          <ArrowLeftIcon className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_COLORS[campaign.status]}`}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{campaign.subject}</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Tipo</p>
          <p className="text-sm font-semibold text-slate-900">{CAMPAIGN_TYPE_LABELS[campaign.type]}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Destinatários</p>
          <p className="text-sm font-semibold text-slate-900">{counts.total}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Enviados</p>
          <p className="text-sm font-semibold text-emerald-600">{counts.sent}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Falhos</p>
          <p className="text-sm font-semibold text-red-600">{counts.failed}</p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Pendentes</p>
          <p className="text-sm font-semibold text-amber-600">{counts.pending}</p>
        </div>
      </div>

      {/* Engagement section */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Engajamento</h3>
          <div className="flex items-center gap-1">
            {(['metrics', 'timeline', 'contacts'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setEngagementTab(tab)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  engagementTab === tab ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab === 'metrics' ? 'Métricas' : tab === 'timeline' ? 'Timeline' : 'Contatos'}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {engagementTab === 'metrics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                    <p className="text-xs text-emerald-600 font-medium">Delivered</p>
                  </div>
                  <p className="text-lg font-bold text-emerald-700">{engagement.delivered}</p>
                  <p className="text-xs text-emerald-500">{engagement.deliveryRate.toFixed(1)}% taxa</p>
                </div>
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <EyeIcon className="h-4 w-4 text-blue-600" />
                    <p className="text-xs text-blue-600 font-medium">Opens</p>
                  </div>
                  <p className="text-lg font-bold text-blue-700">{engagement.opened}</p>
                  <p className="text-xs text-blue-500">{engagement.openRate.toFixed(1)}% open rate ({engagement.uniqueOpens} únicos)</p>
                </div>
                <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CursorArrowRaysIcon className="h-4 w-4 text-violet-600" />
                    <p className="text-xs text-violet-600 font-medium">Clicks</p>
                  </div>
                  <p className="text-lg font-bold text-violet-700">{engagement.clicked}</p>
                  <p className="text-xs text-violet-500">{engagement.clickRate.toFixed(1)}% click rate ({engagement.uniqueClicks} únicos)</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />
                    <p className="text-xs text-red-600 font-medium">Bounces</p>
                  </div>
                  <p className="text-lg font-bold text-red-700">{engagement.bounced}</p>
                  <p className="text-xs text-red-500">{engagement.bounceRate.toFixed(1)}% bounce rate</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <EnvelopeIcon className="h-4 w-4 text-amber-600" />
                    <p className="text-xs text-amber-600 font-medium">Spam</p>
                  </div>
                  <p className="text-lg font-bold text-amber-700">{engagement.complained}</p>
                  <p className="text-xs text-amber-500">reclamações</p>
                </div>
              </div>
              {emailEvents.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-4">Nenhum evento de engajamento recebido ainda. Os dados aparecerão conforme os destinatários interagirem com o email.</p>
              )}
            </div>
          )}

          {engagementTab === 'timeline' && (
            <div>
              {timelineData.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">Sem dados de timeline ainda</p>
              ) : (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        labelFormatter={(v) => `Data: ${v}`}
                      />
                      <Line type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2} name="Delivered" dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="opens" stroke="#3b82f6" strokeWidth={2} name="Opens" dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="clicks" stroke="#8b5cf6" strokeWidth={2} name="Clicks" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {engagementTab === 'contacts' && (
            <div>
              {engagedContacts.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">Nenhum contato engajou ainda</p>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Email</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Abriu</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Clicou</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Último evento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {engagedContacts.map((c) => (
                        <tr key={c.contactId} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-sm text-slate-900">{c.email}</td>
                          <td className="px-4 py-2 text-center">
                            {c.opened ? <EyeIcon className="h-4 w-4 text-blue-500 mx-auto" /> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {c.clicked ? <CursorArrowRaysIcon className="h-4 w-4 text-violet-500 mx-auto" /> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-500">{formatDateTimeAt(c.lastEvent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-slate-400 text-center py-2">{engagedContacts.length} contato(s) engajado(s)</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Campaign info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Details */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Detalhes</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Criado por</span>
              <span className="font-medium text-slate-900">{campaign.createdByName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Criado em</span>
              <span className="font-medium text-slate-900">{formatDateTimeAt(campaign.createdAt)}</span>
            </div>
            {campaign.scheduledAt && (
              <div className="flex justify-between">
                <span className="text-slate-500">Agendado para</span>
                <span className="font-medium text-slate-900">{formatDateTimeAt(campaign.scheduledAt)}</span>
              </div>
            )}
            {campaign.lastSentAt && (
              <div className="flex justify-between">
                <span className="text-slate-500">Último envio</span>
                <span className="font-medium text-slate-900">{formatDateTimeAt(campaign.lastSentAt)}</span>
              </div>
            )}
            {campaign.recurrence && (
              <div className="flex justify-between">
                <span className="text-slate-500">Recorrência</span>
                <span className="font-medium text-slate-900">
                  {RECURRENCE_LABELS[campaign.recurrence.frequency]}
                </span>
              </div>
            )}
          </div>

          {/* Filters used */}
          {campaign.filters && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2">Filtros usados</p>
              <div className="flex flex-wrap gap-1">
                {campaign.filters.funnelId && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Funil selecionado
                  </span>
                )}
                {campaign.filters.status?.map((s) => (
                  <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {s}
                  </span>
                ))}
                {campaign.filters.leadSource?.map((s) => (
                  <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {s}
                  </span>
                ))}
                {campaign.filters.leadType?.map((s) => (
                  <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {s}
                  </span>
                ))}
                {campaign.filters.industry && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {campaign.filters.industry}
                  </span>
                )}
                {campaign.filters.hasEmail && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    Com email
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Email preview */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Preview do email</h3>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 max-h-[300px] overflow-y-auto">
            <p className="text-xs text-slate-400 mb-2">Assunto: {campaign.subject}</p>
            <hr className="mb-3" />
            <div className="text-sm text-slate-600 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: campaign.body }} />
          </div>
        </div>
      </div>

      {/* Recipients table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-700">Destinatários</h3>
            <div className="flex items-center gap-1">
              {(['', 'sent', 'failed', 'pending'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setRecipientFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    recipientFilter === f ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f === '' ? `Todos (${counts.total})` : f === 'sent' ? `Enviados (${counts.sent})` : f === 'failed' ? `Falhos (${counts.failed})` : `Pendentes (${counts.pending})`}
                </button>
              ))}
            </div>
          </div>

          {counts.failed > 0 && (
            <button
              onClick={handleResendFailed}
              disabled={resending}
              className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
              {resending ? 'Reenviando...' : `Reenviar falhos (${counts.failed})`}
            </button>
          )}
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Nenhum destinatário encontrado
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Nome</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 hidden md:table-cell">Empresa</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 hidden md:table-cell">Enviado em</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 hidden lg:table-cell">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRecipients.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      {r.status === 'sent' ? (
                        <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
                      ) : r.status === 'failed' ? (
                        <XCircleIcon className="h-5 w-5 text-red-500" />
                      ) : (
                        <ClockIcon className="h-5 w-5 text-amber-500" />
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-900">{r.name}</td>
                    <td className="px-4 py-2 text-sm text-slate-500">{r.email}</td>
                    <td className="px-4 py-2 text-sm text-slate-500 hidden md:table-cell">{r.company || '—'}</td>
                    <td className="px-4 py-2 text-sm text-slate-500 hidden md:table-cell">
                      {r.sentAt ? formatDateTimeAt(r.sentAt) : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-red-500 hidden lg:table-cell max-w-[200px] truncate">
                      {r.error || '—'}
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

/* ================================= Page Export ================================= */

export default function CampaignDetailsPage() {
  return (
    <PlanGate feature="email_automation">
      <CampaignDetailsContent />
    </PlanGate>
  )
}
