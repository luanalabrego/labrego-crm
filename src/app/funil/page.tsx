'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { useVisibleFunnels } from '@/hooks/useVisibleFunnels'
import { usePermissions } from '@/hooks/usePermissions'
import { usePlan } from '@/hooks/usePlan'
import UpgradePrompt from '@/components/UpgradePrompt'
import type { Funnel } from '@/types/funnel'
import type { IcpProfile } from '@/types/icp'
import {
  PlusIcon,
  Pencil1Icon,
  TrashIcon,
  DotsVerticalIcon,
  Cross2Icon,
  CheckIcon,
} from '@radix-ui/react-icons'
import {
  FunnelIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
  Squares2X2Icon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'

const FUNNEL_COLORS = [
  '#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#d97706', '#16a34a', '#0d9488', '#0284c7', '#475569',
]

type FunnelStageBasic = {
  id: string
  funnelId: string
  name: string
  order: number
}

type ClientBasic = {
  id: string
  funnelStage?: string
  funnelId?: string
  funnelStageUpdatedAt?: string
  maxDays?: number
}

export default function FunnelHubPage() {
  const router = useRouter()
  const { orgId, member } = useCrmUser()
  const { funnels, loading: loadingFunnels } = useVisibleFunnels()
  const { can } = usePermissions()
  const { limits } = usePlan()

  const canManage = can('canManageFunnels')

  // Load all stages for contact counting
  const [allStages, setAllStages] = useState<FunnelStageBasic[]>([])
  const [allClients, setAllClients] = useState<ClientBasic[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // ICP profiles
  const [icpProfiles, setIcpProfiles] = useState<Pick<IcpProfile, 'id' | 'name' | 'color' | 'funnelIds'>[]>([])

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null)
  const [deletingFunnel, setDeletingFunnel] = useState<Funnel | null>(null)
  const [deleteMode, setDeleteMode] = useState<'move' | 'discard'>('move')
  const [destFunnelId, setDestFunnelId] = useState('')
  const [destMode, setDestMode] = useState<'mirror' | 'single'>('mirror')
  const [destStageId, setDestStageId] = useState('')
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formColor, setFormColor] = useState(FUNNEL_COLORS[0])
  const [saving, setSaving] = useState(false)

  // Load stages for counting
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'funnelStages'), where('orgId', '==', orgId)), (snap) => {
      setAllStages(snap.docs.map(d => {
        const data = d.data()
        return { id: d.id, funnelId: (data.funnelId as string) || '', name: (data.name as string) || '', order: (data.order as number) ?? 0 }
      }))
    })
    return () => unsub()
  }, [orgId])

  // Load clients for counting
  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(query(collection(db, 'clients'), where('orgId', '==', orgId)), (snap) => {
      setAllClients(snap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          funnelStage: data.funnelStage,
          funnelId: data.funnelId,
          funnelStageUpdatedAt: data.funnelStageUpdatedAt,
        }
      }))
      setLoadingData(false)
    })
    return () => unsub()
  }, [orgId])

  // Load ICP profiles
  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'icpProfiles'), where('orgId', '==', orgId), where('isActive', '==', true))
    const unsub = onSnapshot(q, (snap) => {
      setIcpProfiles(snap.docs.map(d => {
        const data = d.data()
        return { id: d.id, name: data.name, color: data.color, funnelIds: data.funnelIds || [] }
      }))
    })
    return () => unsub()
  }, [orgId])

  // Build ICP-per-funnel lookup
  const icpsByFunnel = useMemo(() => {
    const map: Record<string, { name: string; color: string }[]> = {}
    for (const icp of icpProfiles) {
      for (const fid of icp.funnelIds) {
        if (!map[fid]) map[fid] = []
        map[fid].push({ name: icp.name, color: icp.color })
      }
    }
    return map
  }, [icpProfiles])

  // Compute contacts per funnel
  const funnelStats = useMemo(() => {
    const stats: Record<string, { contacts: number; stages: number }> = {}

    for (const funnel of funnels) {
      // Get stages for this funnel
      const allFunnelStages = allStages.filter(s => s.funnelId === funnel.id)
      const stageIds = new Set(allFunnelStages.map(s => s.id))

      // Count clients in these stages
      const contactCount = allClients.filter(c => c.funnelStage && stageIds.has(c.funnelStage)).length

      stats[funnel.id] = {
        contacts: contactCount,
        stages: allFunnelStages.length,
      }
    }

    return stats
  }, [funnels, allStages, allClients])

  // Check plan limit
  const atFunnelLimit = funnels.length >= limits.maxFunnels

  // Create funnel
  const handleCreate = async () => {
    if (!orgId || !formName.trim()) return
    setSaving(true)
    try {
      const funnelsRef = collection(db, 'organizations', orgId, 'funnels')
      const isFirst = funnels.length === 0
      const maxOrder = funnels.length > 0 ? Math.max(...funnels.map(f => f.order)) : -1
      const now = new Date().toISOString()

      const newFunnelRef = doc(funnelsRef)
      await setDoc(newFunnelRef, {
        orgId,
        name: formName.trim(),
        description: formDescription.trim(),
        color: formColor,
        isDefault: isFirst,
        order: maxOrder + 1,
        visibleTo: [],
        createdAt: now,
        updatedAt: now,
      })

      toast.success('Funil criado com sucesso!')
      setShowCreateModal(false)
      resetForm()
    } catch (error) {
      console.error('Error creating funnel:', error)
      toast.error('Erro ao criar funil')
    } finally {
      setSaving(false)
    }
  }

  // Update funnel
  const handleUpdate = async () => {
    if (!orgId || !editingFunnel || !formName.trim()) return
    setSaving(true)
    try {
      const funnelRef = doc(db, 'organizations', orgId, 'funnels', editingFunnel.id)
      await updateDoc(funnelRef, {
        name: formName.trim(),
        description: formDescription.trim(),
        color: formColor,
        updatedAt: new Date().toISOString(),
      })
      toast.success('Funil atualizado com sucesso!')
      setEditingFunnel(null)
      resetForm()
    } catch (error) {
      console.error('Error updating funnel:', error)
      toast.error('Erro ao atualizar funil')
    } finally {
      setSaving(false)
    }
  }

  // Stages do funil destino (para dropdown)
  const destStages = useMemo(() => {
    if (!destFunnelId) return []
    return allStages.filter(s => s.funnelId === destFunnelId).sort((a, b) => a.order - b.order)
  }, [destFunnelId, allStages])

  // Contatos do funil sendo excluido
  const deletingFunnelContacts = useMemo(() => {
    if (!deletingFunnel) return []
    const stageIds = new Set(allStages.filter(s => s.funnelId === deletingFunnel.id).map(s => s.id))
    return allClients.filter(c => c.funnelStage && stageIds.has(c.funnelStage))
  }, [deletingFunnel, allStages, allClients])

  // Delete funnel
  const handleDelete = async () => {
    if (!orgId || !deletingFunnel) return
    setSaving(true)
    try {
      const funnelId = deletingFunnel.id
      const sourceStages = allStages.filter(s => s.funnelId === funnelId).sort((a, b) => a.order - b.order)
      const contactsToMove = deletingFunnelContacts
      const now = new Date().toISOString()

      // 1. Move or unlink contacts
      if (contactsToMove.length > 0) {
        setDeleteProgress({ current: 0, total: contactsToMove.length })

        if (deleteMode === 'move' && destFunnelId) {
          const targetStages = allStages.filter(s => s.funnelId === destFunnelId).sort((a, b) => a.order - b.order)

          for (let i = 0; i < contactsToMove.length; i++) {
            const contact = contactsToMove[i]
            let targetStageId = targetStages[0]?.id || ''

            if (destMode === 'mirror') {
              // Map by position
              const sourceIdx = sourceStages.findIndex(s => s.id === contact.funnelStage)
              const mappedIdx = sourceIdx >= 0 ? Math.min(sourceIdx, targetStages.length - 1) : 0
              targetStageId = targetStages[mappedIdx]?.id || targetStages[0]?.id || ''
            } else {
              targetStageId = destStageId
            }

            await updateDoc(doc(db, 'clients', contact.id), {
              funnelId: destFunnelId,
              funnelStage: targetStageId,
              funnelStageUpdatedAt: now,
              updatedAt: now,
            })
            setDeleteProgress({ current: i + 1, total: contactsToMove.length })
          }
        } else {
          // Discard - unlink contacts
          for (let i = 0; i < contactsToMove.length; i++) {
            await updateDoc(doc(db, 'clients', contactsToMove[i].id), {
              funnelId: '',
              funnelStage: null,
              funnelStageUpdatedAt: now,
              updatedAt: now,
            })
            setDeleteProgress({ current: i + 1, total: contactsToMove.length })
          }
        }
      }

      // 2. Delete funnelStages (root collection)
      for (const stage of sourceStages) {
        await deleteDoc(doc(db, 'funnelStages', stage.id))
      }

      // 3. Delete columns subcollection
      const columnsRef = collection(db, 'organizations', orgId, 'funnels', funnelId, 'columns')
      const columnsSnap = await getDocs(columnsRef)
      for (const colDoc of columnsSnap.docs) {
        await deleteDoc(colDoc.ref)
      }

      // 4. Delete the funnel
      await deleteDoc(doc(db, 'organizations', orgId, 'funnels', funnelId))

      const movedMsg = contactsToMove.length > 0
        ? deleteMode === 'move'
          ? ` ${contactsToMove.length} contato${contactsToMove.length !== 1 ? 's' : ''} movido${contactsToMove.length !== 1 ? 's' : ''}.`
          : ` ${contactsToMove.length} contato${contactsToMove.length !== 1 ? 's' : ''} desvinculado${contactsToMove.length !== 1 ? 's' : ''}.`
        : ''
      toast.success(`Funil excluido com sucesso!${movedMsg}`)
      setDeletingFunnel(null)
      setDeleteProgress(null)
      setDeleteMode('move')
      setDestFunnelId('')
      setDestMode('mirror')
      setDestStageId('')
    } catch (error) {
      console.error('Error deleting funnel:', error)
      toast.error('Erro ao excluir funil')
      setDeleteProgress(null)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormColor(FUNNEL_COLORS[0])
  }

  const openEditModal = (funnel: Funnel) => {
    setFormName(funnel.name)
    setFormDescription(funnel.description || '')
    setFormColor(funnel.color)
    setEditingFunnel(funnel)
    setOpenMenuId(null)
  }

  const openDeleteModal = (funnel: Funnel) => {
    setDeletingFunnel(funnel)
    setDeleteMode('move')
    setDestFunnelId('')
    setDestMode('mirror')
    setDestStageId('')
    setDeleteProgress(null)
    setOpenMenuId(null)
  }

  const loading = loadingFunnels || loadingData

  // Loading state
  if (loading) {
    return (
      <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <div className="h-8 w-48 bg-slate-200 rounded-lg animate-pulse" />
            <div className="h-4 w-32 bg-slate-200 rounded mt-2 animate-pulse" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 h-44 animate-pulse">
                <div className="h-5 w-32 bg-slate-200 rounded" />
                <div className="h-4 w-24 bg-slate-200 rounded mt-3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Empty state
  if (funnels.length === 0) {
    return (
      <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 max-w-md text-center">
          <div className="w-20 h-20 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <FunnelIcon className="w-10 h-10 text-primary-500" />
          </div>
          <h3 className="text-xl font-semibold text-slate-900 mb-2">Nenhum funil criado ainda</h3>
          <p className="text-sm text-slate-500 mb-6">
            {canManage
              ? 'Crie seu primeiro funil de vendas para comecar a organizar seus leads.'
              : 'Solicite ao administrador a criacao de um funil de vendas.'}
          </p>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              Criar seu primeiro funil
            </button>
          )}
        </div>

        {/* Create Modal */}
        {showCreateModal && <FunnelModal />}
      </div>
    )
  }

  // Main render - Funnel Hub
  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 to-slate-100/50 p-6" onClick={() => setOpenMenuId(null)}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Funis de Vendas</h1>
            <p className="text-sm text-slate-500 mt-1">
              {funnels.length} funil{funnels.length !== 1 ? 's' : ''} &middot; {allClients.length} contato{allClients.length !== 1 ? 's' : ''} no total
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-3">
              {atFunnelLimit ? (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  <span>Limite de {limits.maxFunnels} funil{limits.maxFunnels !== 1 ? 's' : ''} atingido</span>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCreateModal(true) }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
                >
                  <PlusIcon className="w-4 h-4" />
                  Novo Funil
                </button>
              )}
            </div>
          )}
        </div>

        {/* Funnel Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {funnels.map(funnel => {
            const stats = funnelStats[funnel.id] || { contacts: 0, stages: 0 }
            return (
              <div
                key={funnel.id}
                className="group bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer relative"
                onClick={() => router.push(`/funil/${funnel.id}`)}
              >
                {/* Color bar */}
                <div className="h-1.5 rounded-t-xl" style={{ backgroundColor: funnel.color }} />

                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${funnel.color}15` }}>
                        <FunnelIcon className="w-5 h-5" style={{ color: funnel.color }} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-800 truncate">{funnel.name}</h3>
                        {funnel.isDefault && (
                          <span className="inline-flex items-center text-xs font-medium text-primary-600 bg-primary-50 rounded px-1.5 py-0.5 mt-0.5">
                            Default
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions menu */}
                    {canManage && (
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenMenuId(openMenuId === funnel.id ? null : funnel.id)
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <DotsVerticalIcon className="w-4 h-4" />
                        </button>

                        {openMenuId === funnel.id && (
                          <div
                            className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-30 min-w-[140px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => openEditModal(funnel)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <Pencil1Icon className="w-3.5 h-3.5" />
                              Editar
                            </button>
                            {!funnel.isDefault ? (
                              <button
                                onClick={() => openDeleteModal(funnel)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                                Excluir
                              </button>
                            ) : (
                              <div className="px-3 py-2 text-xs text-slate-400" title="Nao e possivel excluir o funil padrao">
                                <TrashIcon className="w-3.5 h-3.5 inline mr-1.5" />
                                Excluir (padrao)
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <UserGroupIcon className="w-4 h-4" />
                      <span>{stats.contacts} contato{stats.contacts !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Squares2X2Icon className="w-4 h-4" />
                      <span>{stats.stages} etapa{stats.stages !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* ICP Badges */}
                  {icpsByFunnel[funnel.id] && icpsByFunnel[funnel.id].length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {icpsByFunnel[funnel.id].map((icp, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600"
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: icp.color }}
                          />
                          {icp.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {funnel.description && (
                    <p className="text-xs text-slate-400 mt-3 line-clamp-2">{funnel.description}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && <FunnelModal />}

      {/* Edit Modal */}
      {editingFunnel && (
        <FunnelModal
          isEdit
          onClose={() => { setEditingFunnel(null); resetForm() }}
          onSave={handleUpdate}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingFunnel && (() => {
        const contactCount = deletingFunnelContacts.length
        const otherFunnels = funnels.filter(f => f.id !== deletingFunnel.id)
        const canMove = otherFunnels.length > 0 && contactCount > 0

        // Validation for move mode
        const moveValid = deleteMode === 'move' && destFunnelId && (destMode === 'mirror' || (destMode === 'single' && destStageId))

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !saving && setDeletingFunnel(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>

              {/* Progress screen */}
              {saving && deleteProgress && (
                <div className="p-10 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
                    <TrashIcon className="w-7 h-7 text-red-600 animate-pulse" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-800 mb-1">
                    {deleteMode === 'move' ? 'Movendo contatos...' : 'Desvinculando contatos...'}
                  </h4>
                  <p className="text-sm text-slate-500 mb-6">
                    {deleteProgress.current} de {deleteProgress.total} contato{deleteProgress.total !== 1 ? 's' : ''}
                  </p>
                  <div className="w-full max-w-xs">
                    <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="text-center text-sm font-semibold text-red-600 mt-2">
                      {deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0}%
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 mt-4">Nao feche esta janela</p>
                </div>
              )}

              {/* Main content */}
              {!saving && (
                <div className="p-6">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-center text-slate-900 mb-1">Excluir funil</h3>
                  <p className="text-sm text-center text-slate-500 mb-5">
                    Tem certeza que deseja excluir <strong>{deletingFunnel.name}</strong>?
                  </p>

                  {contactCount > 0 && (
                    <div className="mb-5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 text-center">
                      Este funil possui <strong>{contactCount}</strong> contato{contactCount !== 1 ? 's' : ''} vinculado{contactCount !== 1 ? 's' : ''}
                    </div>
                  )}

                  {/* Options only if there are contacts AND other funnels */}
                  {canMove && (
                    <div className="space-y-3 mb-5">
                      <p className="text-sm font-medium text-slate-700">O que fazer com os contatos?</p>

                      {/* Option: Move */}
                      <label className={`block p-3 border rounded-lg cursor-pointer transition-all ${deleteMode === 'move' ? 'border-primary-300 bg-primary-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <div className="flex items-center gap-2">
                          <input type="radio" checked={deleteMode === 'move'} onChange={() => setDeleteMode('move')} className="text-primary-600" />
                          <span className="text-sm font-medium text-slate-800">Mover para outro funil</span>
                        </div>

                        {deleteMode === 'move' && (
                          <div className="mt-3 ml-5 space-y-3">
                            {/* Dest funnel */}
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">Funil destino</label>
                              <select
                                value={destFunnelId}
                                onChange={e => { setDestFunnelId(e.target.value); setDestStageId('') }}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
                              >
                                <option value="">Selecionar funil...</option>
                                {otherFunnels.map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>

                            {destFunnelId && (
                              <div className="space-y-2">
                                {/* Mirror option */}
                                <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-all ${destMode === 'mirror' ? 'bg-primary-50' : 'hover:bg-slate-50'}`}>
                                  <input type="radio" checked={destMode === 'mirror'} onChange={() => setDestMode('mirror')} className="mt-0.5 text-primary-600" />
                                  <div>
                                    <span className="text-sm font-medium text-slate-700">Espelhar etapas</span>
                                    <p className="text-xs text-slate-400">Cada contato vai para a etapa equivalente por posicao</p>
                                  </div>
                                </label>

                                {/* Single stage option */}
                                <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-all ${destMode === 'single' ? 'bg-primary-50' : 'hover:bg-slate-50'}`}>
                                  <input type="radio" checked={destMode === 'single'} onChange={() => setDestMode('single')} className="mt-0.5 text-primary-600" />
                                  <div className="flex-1">
                                    <span className="text-sm font-medium text-slate-700">Etapa unica</span>
                                    <p className="text-xs text-slate-400 mb-2">Todos os contatos vao para uma mesma etapa</p>
                                    {destMode === 'single' && (
                                      <select
                                        value={destStageId}
                                        onChange={e => setDestStageId(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
                                      >
                                        <option value="">Selecionar etapa...</option>
                                        {destStages.map(s => (
                                          <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </label>

                      {/* Option: Discard */}
                      <label className={`block p-3 border rounded-lg cursor-pointer transition-all ${deleteMode === 'discard' ? 'border-red-300 bg-red-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <div className="flex items-center gap-2">
                          <input type="radio" checked={deleteMode === 'discard'} onChange={() => setDeleteMode('discard')} className="text-red-600" />
                          <div>
                            <span className="text-sm font-medium text-slate-800">Desvincular contatos</span>
                            <p className="text-xs text-slate-400">Os contatos ficam sem funil</p>
                          </div>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* No contacts message */}
                  {contactCount === 0 && (
                    <p className="text-sm text-slate-500 text-center mb-5">Este funil nao possui contatos vinculados.</p>
                  )}

                  {/* Contacts exist but no other funnels */}
                  {contactCount > 0 && !canMove && (
                    <p className="text-xs text-slate-400 text-center mb-5">
                      Nao ha outros funis disponiveis. Os contatos serao desvinculados.
                    </p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setDeletingFunnel(null)}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={saving || (canMove && deleteMode === 'move' && !moveValid)}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      Excluir Funil
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )

  // Funnel Create/Edit Modal component
  function FunnelModal({ isEdit = false, onClose, onSave }: { isEdit?: boolean; onClose?: () => void; onSave?: () => void }) {
    const close = onClose || (() => { setShowCreateModal(false); resetForm() })
    const save = onSave || handleCreate

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={close}>
        <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-slate-900">
              {isEdit ? 'Editar Funil' : 'Novo Funil'}
            </h3>
            <button onClick={close} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <Cross2Icon className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Ex: Funil de Vendas B2B"
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Descricao</label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Descricao opcional do funil..."
                rows={2}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Cor</label>
              <div className="flex flex-wrap gap-2">
                {FUNNEL_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setFormColor(color)}
                    className={`w-8 h-8 rounded-lg transition-all ${
                      formColor === color ? 'ring-2 ring-offset-2 ring-primary-500 scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={close}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || !formName.trim()}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar Funil'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
