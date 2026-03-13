'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2, Plus, Pencil, X, Mail } from 'lucide-react'
import { PLAN_DISPLAY } from '@/types/plan'
import type { Organization } from '@/types/organization'
import { useCrmUser } from '@/contexts/CrmUserContext'

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  trial: 'Trial',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  trial: 'bg-blue-100 text-blue-700',
}

interface OrgForm {
  name: string
  plan: Organization['plan']
  adminEmail: string
  status: Organization['status']
}

const emptyForm: OrgForm = {
  name: '',
  plan: 'basic',
  adminEmail: '',
  status: 'active',
}

export default function SuperAdminPage() {
  const { userEmail } = useCrmUser()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [form, setForm] = useState<OrgForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const fetchOrgs = useCallback(async () => {
    if (!userEmail) return
    try {
      const res = await fetch('/api/super-admin/organizations', {
        headers: { 'x-user-email': userEmail },
      })
      if (!res.ok) throw new Error('Erro ao carregar empresas')
      const data = await res.json()
      setOrgs(data.orgs as Organization[])
    } catch (err) {
      console.error('[super-admin] fetch orgs error:', err)
    } finally {
      setLoading(false)
    }
  }, [userEmail])

  useEffect(() => {
    fetchOrgs()
  }, [fetchOrgs])

  const openCreate = () => {
    setEditingOrg(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (org: Organization) => {
    setEditingOrg(org)
    setForm({ name: org.name, plan: org.plan, adminEmail: '', status: org.status })
    setError('')
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      if (editingOrg) {
        const res = await fetch('/api/super-admin/organizations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail || '' },
          body: JSON.stringify({ orgId: editingOrg.id, name: form.name, plan: form.plan, status: form.status }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Erro ao atualizar')
      } else {
        const res = await fetch('/api/super-admin/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail || '' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Erro ao criar')
      }
      setShowModal(false)
      fetchOrgs()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async (org: Organization) => {
    if (!userEmail) return
    const newStatus = org.status === 'active' ? 'suspended' : 'active'
    setTogglingId(org.id)
    try {
      const res = await fetch('/api/super-admin/organizations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-email': userEmail },
        body: JSON.stringify({ orgId: org.id, status: newStatus }),
      })
      if (!res.ok) throw new Error('Erro ao atualizar status')
      setOrgs(prev => prev.map(o => o.id === org.id ? { ...o, status: newStatus } : o))
    } catch (err) {
      console.error('[super-admin] toggle status error:', err)
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">Empresas</h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5 sm:mt-1">Gerencie as organizacoes cadastradas.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-medium shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nova Empresa</span>
          <span className="sm:hidden">Nova</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Nenhuma empresa cadastrada.</p>
        </div>
      ) : (
        <>
        {/* Desktop: tabela */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Admin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Plano</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{org.adminEmail || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{(PLAN_DISPLAY as Record<string, { displayName: string }>)[org.plan]?.displayName || org.plan}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleStatus(org)}
                      disabled={togglingId === org.id}
                      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50"
                      style={{ backgroundColor: org.status === 'active' ? '#22c55e' : '#d1d5db' }}
                      title={org.status === 'active' ? 'Ativo — clique para inativar' : 'Inativo — clique para ativar'}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          org.status === 'active' ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(org)} className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 transition text-sm">
                      <Pencil className="w-3.5 h-3.5" /> Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="md:hidden space-y-3">
          {orgs.map((org) => (
            <div key={org.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 truncate">{org.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 text-gray-500">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-sm truncate">{org.adminEmail || '—'}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggleStatus(org)}
                  disabled={togglingId === org.id}
                  className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: org.status === 'active' ? '#22c55e' : '#d1d5db' }}
                  title={org.status === 'active' ? 'Ativo — clique para inativar' : 'Inativo — clique para ativar'}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      org.status === 'active' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[org.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[org.status] || org.status}
                  </span>
                  <span className="text-sm text-gray-600 font-medium">
                    {(PLAN_DISPLAY as Record<string, { displayName: string }>)[org.plan]?.displayName || org.plan}
                  </span>
                </div>
                <button
                  onClick={() => openEdit(org)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition text-sm font-medium"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Editar
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">{editingOrg ? 'Editar Empresa' : 'Nova Empresa'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-gray-100 transition">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plano</label>
                <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as Organization['plan'] })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40">
                  {Object.entries(PLAN_DISPLAY).map(([key, val]) => (
                    <option key={key} value={key}>{val.displayName}</option>
                  ))}
                </select>
              </div>
              {!editingOrg && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email do admin</label>
                  <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
                </div>
              )}
              {editingOrg && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Organization['status'] })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40">
                    <option value="active">Ativo</option>
                    <option value="suspended">Suspenso</option>
                    <option value="trial">Trial</option>
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancelar</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition">
                  {submitting ? 'Salvando...' : editingOrg ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
