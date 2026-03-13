'use client'

import { useState, useEffect } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { usePermissions } from '@/hooks/usePermissions'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  FunnelIcon,
  TagIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import {
  IcpProfile,
  IcpCriteria,
  EMPTY_ICP_PROFILE,
  EMPTY_ICP_CRITERIA,
  ICP_COLORS,
  PORTE_EMPRESA_OPTIONS,
  ESTADOS_BR,
} from '@/types/icp'

type FunnelItem = { id: string; name: string; color: string }
type ProductItem = { id: string; name: string }

export default function AdminIcpPage() {
  const { orgId } = useCrmUser()
  const { can } = usePermissions()

  const [profiles, setProfiles] = useState<IcpProfile[]>([])
  const [funnels, setFunnels] = useState<FunnelItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_ICP_PROFILE)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  })

  // Load data
  useEffect(() => {
    if (!orgId) return
    const unsubs: (() => void)[] = []

    unsubs.push(
      onSnapshot(
        query(collection(db, 'icpProfiles'), where('orgId', '==', orgId)),
        (snap) => {
          const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as IcpProfile))
          setProfiles(data.sort((a, b) => a.priority - b.priority))
          setLoading(false)
        },
        (err) => {
          console.error('ICP profiles listener error:', err)
          setLoading(false)
        }
      )
    )

    unsubs.push(
      onSnapshot(
        query(collection(db, 'organizations', orgId, 'funnels')),
        (snap) => {
          setFunnels(
            snap.docs.map((d) => ({
              id: d.id,
              name: d.data().name || '',
              color: d.data().color || '#4f46e5',
            }))
          )
        },
        (err) => { console.error('Funnels listener error:', err) }
      )
    )

    unsubs.push(
      onSnapshot(
        query(collection(db, 'organizations', orgId, 'products')),
        (snap) => {
          setProducts(
            snap.docs.map((d) => ({
              id: d.id,
              name: d.data().name || '',
            }))
          )
        },
        (err) => { console.error('Products listener error:', err) }
      )
    )

    return () => unsubs.forEach((u) => u())
  }, [orgId])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_ICP_PROFILE, criteria: { ...EMPTY_ICP_CRITERIA } })
    setShowModal(true)
  }

  const openEdit = (profile: IcpProfile) => {
    setEditingId(profile.id)
    setForm({
      name: profile.name,
      description: profile.description,
      color: profile.color,
      criteria: { ...profile.criteria },
      funnelIds: [...profile.funnelIds],
      productIds: [...profile.productIds],
      isActive: profile.isActive,
      priority: profile.priority,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!orgId || !form.name.trim()) {
      toast.error('Nome do perfil ICP e obrigatorio')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const data = {
        orgId,
        name: form.name.trim(),
        description: form.description.trim(),
        color: form.color,
        criteria: form.criteria,
        funnelIds: form.funnelIds,
        productIds: form.productIds,
        isActive: form.isActive,
        priority: form.priority,
        updatedAt: now,
      }

      if (editingId) {
        await updateDoc(doc(db, 'icpProfiles', editingId), data)
        toast.success('Perfil ICP atualizado')
      } else {
        await addDoc(collection(db, 'icpProfiles'), {
          ...data,
          createdAt: now,
        })
        toast.success('Perfil ICP criado')
      }
      setShowModal(false)
    } catch (error) {
      console.error('Error saving ICP:', error)
      toast.error('Erro ao salvar perfil ICP')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteConfirm({ open: true, id })
  }

  const confirmDelete = async () => {
    if (!deleteConfirm.id) return
    try {
      await deleteDoc(doc(db, 'icpProfiles', deleteConfirm.id))
      toast.success('Perfil ICP excluido')
    } catch (error) {
      console.error('Error deleting ICP:', error)
      toast.error('Erro ao excluir')
    } finally {
      setDeleteConfirm({ open: false, id: null })
    }
  }

  const toggleArrayItem = (
    field: keyof IcpCriteria,
    value: string
  ) => {
    setForm((prev) => {
      const arr = prev.criteria[field] as string[]
      const updated = arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value]
      return {
        ...prev,
        criteria: { ...prev.criteria, [field]: updated },
      }
    })
  }

  const toggleFunnel = (funnelId: string) => {
    setForm((prev) => ({
      ...prev,
      funnelIds: prev.funnelIds.includes(funnelId)
        ? prev.funnelIds.filter((id) => id !== funnelId)
        : [...prev.funnelIds, funnelId],
    }))
  }

  const toggleProduct = (productId: string) => {
    setForm((prev) => ({
      ...prev,
      productIds: prev.productIds.includes(productId)
        ? prev.productIds.filter((id) => id !== productId)
        : [...prev.productIds, productId],
    }))
  }

  if (!can('canManageFunnels') && !can('canManageSettings')) {
    return (
      <div className="p-8 text-center text-neutral-500">
        Sem permissao para acessar esta pagina.
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            Perfis ICP
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Defina seus Perfis de Cliente Ideal para segmentacao e roteamento automatico
          </p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          Novo Perfil
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-neutral-400">Carregando...</div>
      )}

      {/* Empty state */}
      {!loading && profiles.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-neutral-200 rounded-2xl">
          <TagIcon className="w-12 h-12 mx-auto text-neutral-300 mb-4" />
          <h3 className="text-lg font-semibold text-neutral-700 mb-2">
            Nenhum perfil ICP criado
          </h3>
          <p className="text-sm text-neutral-500 mb-6 max-w-md mx-auto">
            Crie perfis de cliente ideal para segmentar seus leads e direciona-los
            automaticamente para os funis corretos.
          </p>
          <button onClick={openCreate} className="btn-primary">
            Criar primeiro perfil
          </button>
        </div>
      )}

      {/* Profile cards */}
      {!loading && profiles.length > 0 && (
        <div className="grid gap-4">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="bg-white rounded-xl border border-neutral-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: profile.color }}
                  />
                  <div>
                    <h3 className="font-semibold text-neutral-900">
                      {profile.name}
                      {!profile.isActive && (
                        <span className="ml-2 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">
                          Inativo
                        </span>
                      )}
                    </h3>
                    {profile.description && (
                      <p className="text-sm text-neutral-500 mt-0.5">
                        {profile.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(profile)}
                    className="p-2 text-neutral-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Criteria tags */}
              <div className="flex flex-wrap gap-2 mt-3">
                {profile.criteria.industries.map((i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                    {i}
                  </span>
                ))}
                {profile.criteria.porteEmpresa.map((p) => (
                  <span key={p} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md">
                    {p}
                  </span>
                ))}
                {profile.criteria.estados.map((e) => (
                  <span key={e} className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-md">
                    {e}
                  </span>
                ))}
                {profile.criteria.leadTypes.map((t) => (
                  <span key={t} className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-md">
                    {t}
                  </span>
                ))}
              </div>

              {/* Funnel associations */}
              {profile.funnelIds.length > 0 && (
                <div className="flex items-center gap-2 mt-3 text-xs text-neutral-500">
                  <FunnelIcon className="w-3.5 h-3.5" />
                  <span>
                    {profile.funnelIds
                      .map((fid) => funnels.find((f) => f.id === fid)?.name || fid)
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Popup */}
      {deleteConfirm.open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={() => setDeleteConfirm({ open: false, id: null })}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-neutral-900">
                  Excluir perfil ICP
                </h3>
                <p className="mt-2 text-sm text-neutral-600">
                  Tem certeza que deseja excluir este perfil ICP? Esta acao nao pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setDeleteConfirm({ open: false, id: null })}
                className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Sim, excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="flex items-center justify-between p-5 border-b border-neutral-200">
              <h2 className="text-lg font-semibold">
                {editingId ? 'Editar Perfil ICP' : 'Novo Perfil ICP'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-neutral-400 hover:text-neutral-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Name + Color */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Nome do Perfil *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Ex: PME Tech SP"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Cor
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICP_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, color: c }))
                        }
                        className={`w-7 h-7 rounded-full border-2 transition-all ${
                          form.color === c
                            ? 'border-neutral-900 scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Descricao
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Descreva o perfil ideal de cliente..."
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Criteria: Porte */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Porte da Empresa
                </label>
                <div className="flex flex-wrap gap-2">
                  {PORTE_EMPRESA_OPTIONS.map((p) => (
                    <button
                      key={p}
                      onClick={() => toggleArrayItem('porteEmpresa', p)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        form.criteria.porteEmpresa.includes(p)
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                      }`}
                    >
                      {form.criteria.porteEmpresa.includes(p) && (
                        <CheckIcon className="w-3 h-3 inline mr-1" />
                      )}
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Criteria: Estados */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Estados
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ESTADOS_BR.map((e) => (
                    <button
                      key={e}
                      onClick={() => toggleArrayItem('estados', e)}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        form.criteria.estados.includes(e)
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Criteria: Industries (free text comma separated) */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Segmentos/Industrias
                </label>
                <input
                  type="text"
                  value={form.criteria.industries.join(', ')}
                  onChange={(e) => {
                    const values = e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean)
                    setForm((prev) => ({
                      ...prev,
                      criteria: { ...prev.criteria, industries: values },
                    }))
                  }}
                  placeholder="Tecnologia, Saude, Financeiro (separados por virgula)"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Criteria: Lead Type */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Tipo de Lead
                </label>
                <div className="flex gap-2">
                  {(['Inbound', 'Outbound'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleArrayItem('leadTypes', t)}
                      className={`px-4 py-1.5 text-xs rounded-lg border transition-colors ${
                        form.criteria.leadTypes.includes(t)
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Criteria: Natureza Juridica (free text comma separated) */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Natureza Jurídica
                </label>
                <input
                  type="text"
                  value={form.criteria.naturezaJuridica.join(', ')}
                  onChange={(e) => {
                    const values = e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean)
                    setForm((prev) => ({
                      ...prev,
                      criteria: { ...prev.criteria, naturezaJuridica: values },
                    }))
                  }}
                  placeholder="MEI, LTDA, S.A., EIRELI (separados por vírgula)"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Criteria: Lead Sources (free text comma separated) */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Fontes de Lead
                </label>
                <input
                  type="text"
                  value={form.criteria.leadSources.join(', ')}
                  onChange={(e) => {
                    const values = e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean)
                    setForm((prev) => ({
                      ...prev,
                      criteria: { ...prev.criteria, leadSources: values },
                    }))
                  }}
                  placeholder="Site, Google Ads, Indicação (separados por vírgula)"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Criteria: Capital Social Range */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Capital Social Min (R$)
                  </label>
                  <input
                    type="number"
                    value={form.criteria.capitalSocialMin || ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        criteria: {
                          ...prev.criteria,
                          capitalSocialMin: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      }))
                    }
                    placeholder="0"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Capital Social Max (R$)
                  </label>
                  <input
                    type="number"
                    value={form.criteria.capitalSocialMax || ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        criteria: {
                          ...prev.criteria,
                          capitalSocialMax: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      }))
                    }
                    placeholder="Sem limite"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {/* Associated Funnels */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Funis Associados
                </label>
                {funnels.length === 0 ? (
                  <p className="text-xs text-neutral-400">Nenhum funil encontrado</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {funnels.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => toggleFunnel(f.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          form.funnelIds.includes(f.id)
                            ? 'bg-primary-50 border-primary-300 text-primary-700'
                            : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        }`}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: f.color }}
                        />
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Associated Products */}
              {products.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Produtos Associados
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => toggleProduct(p.id)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          form.productIds.includes(p.id)
                            ? 'bg-primary-50 border-primary-300 text-primary-700'
                            : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active toggle */}
              <div className="flex items-center gap-3 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, isActive: !prev.isActive }))
                  }
                  className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                    form.isActive ? 'bg-primary-600' : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      form.isActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-sm text-neutral-700">
                  Perfil {form.isActive ? 'ativo' : 'inativo'}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-4 sm:p-5 border-t border-neutral-200">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Criar Perfil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
