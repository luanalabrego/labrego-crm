'use client'

import { useState, useEffect, useCallback } from 'react'
import { auth } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'

type EmailProviderId = 'gmail' | 'resend' | 'sendgrid'

const PROVIDER_OPTIONS: { id: EmailProviderId; label: string; description: string }[] = [
  { id: 'gmail', label: 'Gmail (SMTP)', description: 'Configure seu email e senha de app do Google' },
  { id: 'resend', label: 'Resend', description: 'API moderna de email transacional' },
  { id: 'sendgrid', label: 'SendGrid', description: 'Plataforma de email da Twilio' },
]

interface EmailProviderSectionProps {
  defaultExpanded?: boolean
}

export default function EmailProviderSection({ defaultExpanded = false }: EmailProviderSectionProps) {
  const { orgId } = useCrmUser()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    primaryProvider: 'gmail' as EmailProviderId,
    fallbackProvider: '' as EmailProviderId | '',
    fromName: 'Voxium',
    fromEmail: '',
    gmailUser: '',
    hasGmailCredentials: false,
    hasResendKey: false,
    hasSendgridKey: false,
  })
  const [gmailAppPassword, setGmailAppPassword] = useState('')
  const [resendApiKey, setResendApiKey] = useState('')
  const [sendgridApiKey, setSendgridApiKey] = useState('')
  const [expanded, setExpanded] = useState(defaultExpanded)

  const loadConfig = useCallback(async () => {
    if (!orgId) return
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch(`/api/admin/email-provider?orgId=${orgId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
      }
    } catch (err) {
      console.error('Error loading email config:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const saveConfig = async () => {
    if (!orgId) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        orgId,
        primaryProvider: config.primaryProvider,
        fallbackProvider: config.fallbackProvider || undefined,
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        gmailUser: config.gmailUser || undefined,
      }
      if (gmailAppPassword) body.gmailAppPassword = gmailAppPassword
      if (resendApiKey) body.resendApiKey = resendApiKey
      if (sendgridApiKey) body.sendgridApiKey = sendgridApiKey

      const token = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/admin/email-provider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setGmailAppPassword('')
        setResendApiKey('')
        setSendgridApiKey('')
        await loadConfig()
      }
    } catch (err) {
      console.error('Error saving email config:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors"
      >
        <div>
          <h3 className="text-lg font-semibold text-slate-900 text-left">Provedor de Email</h3>
          <p className="mt-0.5 text-sm text-slate-500 text-left">
            Configure o provedor de envio de emails para campanhas e cadencias.
          </p>
        </div>
        <svg className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-slate-100 pt-4 space-y-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">Carregando...</div>
          ) : (
            <>
              {/* Primary provider */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Provedor primario</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PROVIDER_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setConfig(prev => ({ ...prev, primaryProvider: opt.id }))}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${config.primaryProvider === opt.id ? 'border-primary-400 bg-primary-50/50 ring-1 ring-primary-200' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{opt.description}</p>
                      {opt.id === 'gmail' && config.hasGmailCredentials && (
                        <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Credenciais configuradas</span>
                      )}
                      {opt.id === 'resend' && config.hasResendKey && (
                        <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">API Key configurada</span>
                      )}
                      {opt.id === 'sendgrid' && config.hasSendgridKey && (
                        <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">API Key configurada</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fallback provider */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Provedor de fallback (opcional)</label>
                <select
                  value={config.fallbackProvider}
                  onChange={e => setConfig(prev => ({ ...prev, fallbackProvider: e.target.value as EmailProviderId | '' }))}
                  className="w-full md:w-64 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Nenhum</option>
                  {PROVIDER_OPTIONS.filter(o => o.id !== config.primaryProvider).map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Se o provedor primario falhar, o email sera enviado pelo fallback</p>
              </div>

              {/* From config */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome do remetente</label>
                  <input
                    value={config.fromName}
                    onChange={e => setConfig(prev => ({ ...prev, fromName: e.target.value }))}
                    placeholder="Voxium"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email do remetente</label>
                  <input
                    value={config.fromEmail}
                    onChange={e => setConfig(prev => ({ ...prev, fromEmail: e.target.value }))}
                    placeholder="contato@suaempresa.com"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Gmail Credentials */}
              {(config.primaryProvider === 'gmail' || config.fallbackProvider === 'gmail') && (
                <div className="space-y-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-sm font-medium text-slate-700">Credenciais Gmail (SMTP)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Email Gmail</label>
                      <input
                        type="email"
                        value={config.gmailUser}
                        onChange={e => setConfig(prev => ({ ...prev, gmailUser: e.target.value }))}
                        placeholder="seuemail@gmail.com"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Senha de App {config.hasGmailCredentials && <span className="text-emerald-600">(configurada)</span>}
                      </label>
                      <input
                        type="password"
                        value={gmailAppPassword}
                        onChange={e => setGmailAppPassword(e.target.value)}
                        placeholder={config.hasGmailCredentials ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Use uma <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary-500 underline hover:text-primary-600">Senha de App do Google</a> (requer verificacao em duas etapas). Nao use sua senha normal.
                  </p>
                </div>
              )}

              {/* Resend API Key */}
              {(config.primaryProvider === 'resend' || config.fallbackProvider === 'resend') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Resend API Key {config.hasResendKey && <span className="text-emerald-600 text-xs">(configurada)</span>}
                  </label>
                  <input
                    type="password"
                    value={resendApiKey}
                    onChange={e => setResendApiKey(e.target.value)}
                    placeholder={config.hasResendKey ? '••••••••••••••••' : 're_xxxxxxxxxxxxxxxxxxxxxxxx'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}

              {/* SendGrid API Key */}
              {(config.primaryProvider === 'sendgrid' || config.fallbackProvider === 'sendgrid') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    SendGrid API Key {config.hasSendgridKey && <span className="text-emerald-600 text-xs">(configurada)</span>}
                  </label>
                  <input
                    type="password"
                    value={sendgridApiKey}
                    onChange={e => setSendgridApiKey(e.target.value)}
                    placeholder={config.hasSendgridKey ? '••••••••••••••••' : 'SG.xxxxxxxxxxxxxxxxxxxxxxxx'}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={saveConfig}
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-all"
                >
                  {saving ? 'Salvando...' : 'Salvar configuracao'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
