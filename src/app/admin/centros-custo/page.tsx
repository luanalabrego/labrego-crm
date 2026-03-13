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
  BuildingOfficeIcon,
} from '@heroicons/react/24/outline'

const COST_CENTER_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#13DEFC', '#6366F1', '#14B8A6',
  '#84CC16', '#A855F7',
]

interface CostCenter {
  id: string
  name: string
  description: string
  color: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface CostCenterForm {
  name: string
  description: string
  color: string
  isActive: boolean
}

const EMPTY_FORM: CostCenterForm = {
  name: '',
  description: '',
  color: COST_CENTER_COLORS[0],
  isActive: true,
}

export default function AdminCentrosCustoPage() {
  const { orgId } = useCrmUser()
  const { can } = usePermissions()

  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CostCenterForm>(EMPTY_FORM)

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Load data
  useEffect(() => {
    if (!orgId) return
    const unsubs: (() => void)[] = []

    // Load cost centers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'organizations', orgId, 'costCenters')),
        (snap) => {
          const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CostCenter))
          setCostCenters(data)
          setLoading(false)
        },
        (err) => {
          console.error('Cost centers listener error:', err)
          setLoading(false)
        }
      )
    )

    // Load client counts per cost center
    unsubs.push(
      onSnapshot(
        query(collection(db, 'clients'), where('orgId', '==', orgId)),
        (snap) => {
          const counts: Record<string, number> = {}
          snap.docs.forEach((d) => {
            const ccId = d.data().costCenterId
            if (ccId) counts[ccId] = (counts[ccId] || 0) + 1
          })
          setClientCounts(counts)
        },
        (err) => {
          console.error('Client counts listener error:', err)
        }
      )
    )

    return () => unsubs.forEach((u) => u())
  }, [orgId])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  const openEdit = (cc: CostCenter) => {
    setEditingId(cc.id)
    setForm({
      name: cc.name,
      description: cc.description || '',
      color: cc.color,
      isActive: cc.isActive,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!orgId || !form.name.trim()) {
      toast.error('Nome do centro de custo e obrigatorio')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const data = {
        name: form.name.trim(),
        description: form.description.trim(),
        color: form.color,
        isActive: form.isActive,
        updatedAt: now,
      }

      if (editingId) {
        await updateDoc(doc(db, 'organizations', orgId, 'costCenters', editingId), data)
        toast.success('Centro de custo atualizado')
      } else {
        await addDoc(collection(db, 'organizations', orgId, 'costCenters'), {
          ...data,
          createdAt: now,
        })
        toast.success('Centro de custo criado')
      }
      setShowModal(false)
    } catch (error) {
      console.error('Error saving cost center:', error)
      toast.error('Erro ao salvar centro de custo')
    } finally {
      setSaving(false)
    }
  }

  const openDeleteConfirm = (cc: CostCenter) => {
    setDeleteTarget(cc)
  }

  const handleDelete = async () => {
    if (!orgId || !deleteTarget) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'costCenters', deleteTarget.id))
      toast.success('Centro de custo excluido')
      setDeleteTarget(null)
    } catch (error) {
      console.error('Error deleting cost center:', error)
      toast.error('Erro ao excluir centro de custo')
    } finally {
      setDeleting(false)
    }
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
            Centros de Custo
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Gerencie os centros de custo para categorizar e organizar seus clientes
          </p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          Novo Centro de Custo
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-neutral-400">Carregando...</div>
      )}

      {/* Empty state */}
      {!loading && costCenters.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-neutral-200 rounded-2xl">
          <BuildingOfficeIcon className="w-12 h-12 mx-auto text-neutral-300 mb-4" />
          <h3 className="text-lg font-semibold text-neutral-700 mb-2">
            Nenhum centro de custo criado
          </h3>
          <p className="text-sm text-neutral-500 mb-6 max-w-md mx-auto">
            Crie centros de custo para organizar e categorizar seus clientes
            por area ou departamento.
          </p>
          <button onClick={openCreate} className="btn-primary">
            Criar primeiro centro de custo
          </button>
        </div>
      )}

      {/* Cost center cards */}
      {!loading && costCenters.length > 0 && (
        <div className="grid gap-4">
          {costCenters.map((cc) => (
            <div
              key={cc.id}
              className="bg-white rounded-xl border border-neutral-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cc.color }}
                  />
                  <div>
                    <h3 className="font-semibold text-neutral-900">
                      {cc.name}
                      {!cc.isActive && (
                        <span className="ml-2 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">
                          Inativo
                        </span>
                      )}
                    </h3>
                    {cc.description && (
                      <p className="text-sm text-neutral-500 mt-0.5">
                        {cc.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400">
                    {clientCounts[cc.id] || 0} cliente{(clientCounts[cc.id] || 0) !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(cc)}
                      className="p-2 text-neutral-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openDeleteConfirm(cc)}
                      className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
            <div className="flex items-center justify-between p-5 border-b border-neutral-200">
              <h2 className="text-lg font-semibold">
                {editingId ? 'Editar Centro de Custo' : 'Novo Centro de Custo'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-neutral-400 hover:text-neutral-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Nome *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Ex: Marketing Digital"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
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
                  rows={3}
                  placeholder="Descreva o centro de custo..."
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Cor
                </label>
                <div className="flex flex-wrap gap-2">
                  {COST_CENTER_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, color: c }))
                      }
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        form.color === c
                          ? 'border-neutral-900 scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Active toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isActive}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, isActive: !prev.isActive }))
                  }
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                    form.isActive ? 'bg-primary-600' : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      form.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-neutral-700">
                  Centro de custo {form.isActive ? 'ativo' : 'inativo'}
                </span>
              </label>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-5 border-t border-neutral-200">
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
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Criar Centro de Custo'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
                <TrashIcon className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">
                Excluir centro de custo
              </h3>
              <p className="text-sm text-neutral-500">
                {(clientCounts[deleteTarget.id] || 0) > 0
                  ? <>Este centro de custo tem <strong>{clientCounts[deleteTarget.id]}</strong> cliente(s) associado(s). Deseja excluir mesmo assim?</>
                  : <>Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>? Esta acao nao pode ser desfeita.</>
                }
              </p>
            </div>
            <div className="flex border-t border-neutral-200">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 border-l border-neutral-200 transition-colors"
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
