'use client'

import { useState, useEffect } from 'react'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { usePermissions } from '@/hooks/usePermissions'
import { usePlan } from '@/hooks/usePlan'
import { db } from '@/lib/firebaseClient'
import { collection, query, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore'
import { ROLE_PRESETS, ALL_PAGES, ALL_ACTIONS, type RolePreset } from '@/types/permissions'
import type { OrgMember, MemberPermissions, MemberActions } from '@/types/organization'
import { toast } from 'sonner'
import PermissionGate from '@/components/PermissionGate'
import Modal from '@/components/Modal'

/* -------------------------------- Helpers -------------------------------- */

const ROLE_LABELS: Record<RolePreset, string> = {
  admin: 'Admin',
  manager: 'Gerente',
  seller: 'Vendedor',
  viewer: 'Visualizador',
}

const ROLE_BADGE: Record<RolePreset, string> = {
  admin: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  seller: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-800',
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  invited: 'bg-amber-100 text-amber-800',
  suspended: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  invited: 'Convidado',
  suspended: 'Suspenso',
}

function formatJoinedDate(iso: string): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return '--'
  }
}

function defaultActions(): MemberActions {
  return {
    canCreateContacts: false,
    canEditContacts: false,
    canDeleteContacts: false,
    canCreateProposals: false,
    canExportData: false,
    canManageFunnels: false,
    canManageUsers: false,
    canTriggerCalls: false,
    canViewReports: false,
    canManageSettings: false,
    canTransferLeads: false,
  }
}

function defaultPermissions(): MemberPermissions {
  return {
    pages: [],
    actions: defaultActions(),
    viewScope: 'own',
  }
}

/* -------------------------------- Styles -------------------------------- */

const ui = {
  btn: `inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3.5 py-2 text-sm
        font-medium text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition active:scale-[0.99]`,
  btnPrimary: `inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold
        text-white bg-primary-600 hover:bg-primary-700 shadow-sm transition active:scale-[0.99]`,
  btnDanger: `inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold
        text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition active:scale-[0.99]`,
  input: `w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800
        placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300`,
  select: `w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800
        focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300`,
  card: 'bg-white rounded-2xl shadow-sm ring-1 ring-gray-200',
  label: 'block text-sm font-medium text-gray-700 mb-1',
}

/* ============================== Component =============================== */

export default function UsuariosPage() {
  const { orgId, userUid, userEmail } = useCrmUser()
  const { can } = usePermissions()
  const { limits } = usePlan()

  /* ----------------------------- State ---------------------------------- */

  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', displayName: '', role: 'seller' as RolePreset })
  const [addLoading, setAddLoading] = useState(false)

  // Edit modal
  const [editMember, setEditMember] = useState<OrgMember | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editRole, setEditRole] = useState<RolePreset>('viewer')
  const [editPermissions, setEditPermissions] = useState<MemberPermissions>(defaultPermissions())
  const [editLoading, setEditLoading] = useState(false)

  // Delete confirmation
  const [deleteMember, setDeleteMember] = useState<OrgMember | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  /* ---------------------- Real-time subscription ------------------------ */

  useEffect(() => {
    if (!orgId) return
    const q = query(collection(db, 'organizations', orgId, 'members'))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: OrgMember[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as OrgMember[]
        items.sort((a, b) => {
          const roleOrder: Record<string, number> = { admin: 0, manager: 1, seller: 2, viewer: 3 }
          return (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4)
        })
        setMembers(items)
        setLoading(false)
      },
      (error) => {
        console.error('Error loading members:', error)
        toast.error('Erro ao carregar membros')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [orgId])

  /* ---------------------- Add member handler ---------------------------- */

  const handleAdd = async () => {
    if (!orgId || !userEmail) return
    if (!addForm.email.trim() || !addForm.displayName.trim()) {
      toast.error('Preencha todos os campos obrigatorios')
      return
    }

    const emailExists = members.some(
      (m) => m.email.toLowerCase() === addForm.email.trim().toLowerCase(),
    )
    if (emailExists) {
      toast.error('Este email ja esta cadastrado na organizacao')
      return
    }

    setAddLoading(true)
    try {
      const res = await fetch('/api/admin/members/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({
          orgId,
          email: addForm.email.trim(),
          displayName: addForm.displayName.trim(),
          role: addForm.role,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao convidar membro')
      }

      toast.success(`Convite enviado para ${addForm.email.trim()} com credenciais de acesso`)
      setAddForm({ email: '', displayName: '', role: 'seller' })
      setShowAddModal(false)
    } catch (error: unknown) {
      console.error('Error adding member:', error)
      const message = error instanceof Error ? error.message : 'Erro ao adicionar membro'
      toast.error(message)
    } finally {
      setAddLoading(false)
    }
  }

  /* ---------------------- Edit member handler --------------------------- */

  const openEditModal = (member: OrgMember) => {
    setEditMember(member)
    setEditDisplayName(member.displayName || '')
    const validRoles: RolePreset[] = ['admin', 'manager', 'seller', 'viewer']
    const role = validRoles.includes(member.role as RolePreset)
      ? (member.role as RolePreset)
      : 'viewer'
    setEditRole(role)
    setEditPermissions({
      pages: [...(member.permissions?.pages || [])],
      actions: { ...defaultActions(), ...(member.permissions?.actions || {}) },
      viewScope: member.permissions?.viewScope || 'own',
    })
  }

  const handleRoleChange = (role: RolePreset) => {
    setEditRole(role)
    const preset = ROLE_PRESETS[role]
    setEditPermissions({
      pages: [...preset.pages],
      actions: { ...preset.actions },
      viewScope: preset.viewScope,
    })
  }

  const togglePage = (path: string) => {
    setEditPermissions((prev) => ({
      ...prev,
      pages: prev.pages.includes(path)
        ? prev.pages.filter((p) => p !== path)
        : [...prev.pages, path],
    }))
  }

  const toggleAction = (key: keyof MemberActions) => {
    setEditPermissions((prev) => ({
      ...prev,
      actions: { ...prev.actions, [key]: !prev.actions[key] },
    }))
  }

  const handleSaveEdit = async () => {
    if (!orgId || !editMember) return
    const validRoles: RolePreset[] = ['admin', 'manager', 'seller', 'viewer']
    if (!editRole || !validRoles.includes(editRole)) {
      toast.error('Selecione um cargo valido')
      return
    }
    if (!editDisplayName.trim()) {
      toast.error('O nome do usuario e obrigatorio')
      return
    }
    setEditLoading(true)
    try {
      await updateDoc(doc(db, 'organizations', orgId, 'members', editMember.id), {
        displayName: editDisplayName.trim(),
        role: editRole,
        permissions: editPermissions,
      })
      toast.success(`${editDisplayName.trim()} atualizado com sucesso`)
      setEditMember(null)
    } catch (error) {
      console.error('Error updating member:', error)
      toast.error('Erro ao atualizar permissoes')
    } finally {
      setEditLoading(false)
    }
  }

  /* ---------------------- Delete member handler ------------------------- */

  const handleDelete = async () => {
    if (!orgId || !deleteMember) return
    setDeleteLoading(true)
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'members', deleteMember.id))
      toast.success(`${deleteMember.displayName} removido da organizacao`)
      setDeleteMember(null)
    } catch (error) {
      console.error('Error deleting member:', error)
      toast.error('Erro ao remover membro')
    } finally {
      setDeleteLoading(false)
    }
  }

  /* ---------------------- Computed values ------------------------------- */

  const memberCount = members.length
  const maxUsers = limits.maxUsers
  const atLimit = memberCount >= maxUsers

  /* ============================== Render ================================ */

  return (
    <PermissionGate
      action="canManageUsers"
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className={`${ui.card} p-8 text-center max-w-md`}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Acesso restrito</h3>
            <p className="text-sm text-gray-500">Sem permissao para gerenciar usuarios</p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* =================== Header =================== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Usuarios</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Gerencie os membros da sua organizacao, convites e permissoes.
            </p>
          </div>
          <button
            type="button"
            disabled={atLimit}
            onClick={() => setShowAddModal(true)}
            className={`${ui.btnPrimary} ${atLimit ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={atLimit ? 'Limite do plano atingido' : 'Adicionar membro'}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Adicionar membro
          </button>
        </div>

        {/* =================== Plan limit bar =================== */}
        <div className={`${ui.card} px-5 py-4`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Membros: {memberCount} / {maxUsers}
            </span>
            {atLimit && (
              <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">
                Limite atingido
              </span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                atLimit ? 'bg-amber-500' : 'bg-primary-500'
              }`}
              style={{ width: `${Math.min((memberCount / maxUsers) * 100, 100)}%` }}
            />
          </div>
          {atLimit && (
            <p className="text-xs text-gray-500 mt-2">
              Faca upgrade do plano para adicionar mais membros.
            </p>
          )}
        </div>

        {/* =================== Member list =================== */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : members.length === 0 ? (
          <div className={`${ui.card} p-12 text-center`}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <svg className="h-7 w-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H9m6 0a5.972 5.972 0 00-.786-3.07M9 19.128v-.003c0-1.113.285-2.16.786-3.07M9 19.128H3.375a4.125 4.125 0 017.533-2.493M9 19.128a5.972 5.972 0 01.786-3.07m4.428 0a9.36 9.36 0 00-4.428 0M12 10.5a3 3 0 100-6 3 3 0 000 6z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">Nenhum membro encontrado</h3>
            <p className="text-sm text-gray-500 mt-1">Adicione o primeiro membro da organizacao.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className={`${ui.card} hidden sm:block overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-slate-50/80">
                      <th className="px-5 py-3 text-left font-medium text-gray-600">Membro</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-600">Email</th>
                      <th className="px-5 py-3 text-center font-medium text-gray-600">Cargo</th>
                      <th className="px-5 py-3 text-center font-medium text-gray-600">Status</th>
                      <th className="px-5 py-3 text-center font-medium text-gray-600">Entrada</th>
                      <th className="px-5 py-3 text-center font-medium text-gray-600">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {members.map((m) => {
                      const initials = (m.displayName || '')
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? '')
                        .join('')
                      const isSelf = m.userId === userUid

                      return (
                        <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              {m.photoUrl ? (
                                <img
                                  src={m.photoUrl}
                                  alt={m.displayName}
                                  className="h-9 w-9 rounded-full object-cover ring-1 ring-gray-200"
                                />
                              ) : (
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 ring-1 ring-primary-200">
                                  {initials || '?'}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">
                                  {m.displayName}
                                  {isSelf && (
                                    <span className="ml-1.5 text-xs text-gray-400">(voce)</span>
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{m.email}</td>
                          <td className="px-5 py-3 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[m.role as RolePreset] || 'bg-gray-100 text-gray-800'}`}
                            >
                              {ROLE_LABELS[m.role as RolePreset] || m.role}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[m.status] || 'bg-gray-100 text-gray-800'}`}
                            >
                              {STATUS_LABELS[m.status] || m.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center text-gray-500">
                            {formatJoinedDate(m.joinedAt)}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(m)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-primary-50 hover:text-primary-700 transition"
                                title="Editar usuario"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteMember(m)}
                                disabled={isSelf}
                                className={`rounded-lg p-1.5 transition ${
                                  isSelf
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-gray-500 hover:bg-red-50 hover:text-red-600'
                                }`}
                                title={isSelf ? 'Voce nao pode se remover' : 'Remover membro'}
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {members.map((m) => {
                const initials = (m.displayName || '')
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? '')
                  .join('')
                const isSelf = m.userId === userUid

                return (
                  <div key={m.id} className={`${ui.card} p-4 space-y-3`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {m.photoUrl ? (
                          <img
                            src={m.photoUrl}
                            alt={m.displayName}
                            className="h-10 w-10 rounded-full object-cover ring-1 ring-gray-200"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 ring-1 ring-primary-200 shrink-0">
                            {initials || '?'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {m.displayName}
                            {isSelf && (
                              <span className="ml-1.5 text-xs text-gray-400">(voce)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{m.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[m.role as RolePreset] || 'bg-gray-100 text-gray-800'}`}>
                          {ROLE_LABELS[m.role as RolePreset] || m.role}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[m.status] || 'bg-gray-100 text-gray-800'}`}>
                          {STATUS_LABELS[m.status] || m.status}
                        </span>
                        <span className="text-gray-400">{formatJoinedDate(m.joinedAt)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(m)}
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-primary-50 hover:text-primary-700 transition"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteMember(m)}
                          disabled={isSelf}
                          className={`rounded-lg p-1.5 transition ${
                            isSelf ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-red-50 hover:text-red-600'
                          }`}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* =================== Add Member Modal =================== */}
        {showAddModal && (
          <Modal isOpen onClose={() => setShowAddModal(false)} size="md" centered>
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Adicionar membro</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Convide um novo membro para a organizacao.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="add-name" className={ui.label}>
                    Nome
                  </label>
                  <input
                    id="add-name"
                    type="text"
                    value={addForm.displayName}
                    onChange={(e) => setAddForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="Nome do membro"
                    className={ui.input}
                  />
                </div>

                <div>
                  <label htmlFor="add-email" className={ui.label}>
                    Email
                  </label>
                  <input
                    id="add-email"
                    type="email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="email@empresa.com"
                    className={ui.input}
                  />
                </div>

                <div>
                  <label htmlFor="add-role" className={ui.label}>
                    Cargo
                  </label>
                  <select
                    id="add-role"
                    value={addForm.role}
                    onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as RolePreset }))}
                    className={ui.select}
                  >
                    {(Object.keys(ROLE_LABELS) as RolePreset[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    As permissoes serao preenchidas com base no cargo selecionado.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowAddModal(false)} className={ui.btn}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={addLoading}
                  className={`${ui.btnPrimary} ${addLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {addLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar convite'
                  )}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* =================== Edit Permissions Modal =================== */}
        {editMember && (
          <Modal isOpen onClose={() => setEditMember(null)} size="xl" centered>
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Editar usuario - {editMember.displayName}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{editMember.email}</p>
              </div>

              {/* Display name */}
              <div>
                <label htmlFor="edit-displayName" className={ui.label}>
                  Nome
                </label>
                <input
                  id="edit-displayName"
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Nome do usuario"
                  className={ui.input}
                />
              </div>

              {/* Role selector */}
              <div>
                <label htmlFor="edit-role" className={ui.label}>
                  Cargo
                </label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => handleRoleChange(e.target.value as RolePreset)}
                  className={ui.select}
                >
                  {(Object.keys(ROLE_LABELS) as RolePreset[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Alterar o cargo redefine as permissoes para o padrao. Voce pode personalizar abaixo.
                </p>
              </div>

              {/* View scope */}
              <div>
                <span className={ui.label}>Escopo de visualizacao</span>
                <div className="flex items-center gap-4 mt-1.5">
                  {(['own', 'team', 'all'] as const).map((scope) => {
                    const scopeLabels = { own: 'Proprio', team: 'Equipe', all: 'Todos' }
                    return (
                      <label key={scope} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="viewScope"
                          value={scope}
                          checked={editPermissions.viewScope === scope}
                          onChange={() =>
                            setEditPermissions((prev) => ({ ...prev, viewScope: scope }))
                          }
                          className="h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">{scopeLabels[scope]}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Pages checklist */}
              <div>
                <span className={ui.label}>Paginas permitidas</span>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-3 bg-slate-50/50">
                  {ALL_PAGES.map((page) => (
                    <label
                      key={page.path}
                      className="flex items-center gap-2 cursor-pointer py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={editPermissions.pages.includes(page.path)}
                        onChange={() => togglePage(page.path)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">{page.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions checklist */}
              <div>
                <span className={ui.label}>Acoes permitidas</span>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-3 bg-slate-50/50">
                  {ALL_ACTIONS.map((action) => (
                    <label
                      key={action.key}
                      className="flex items-center gap-2 cursor-pointer py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={editPermissions.actions[action.key]}
                        onChange={() => toggleAction(action.key)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setEditMember(null)} className={ui.btn}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={editLoading}
                  className={`${ui.btnPrimary} ${editLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {editLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Salvando...
                    </>
                  ) : (
                    'Salvar alteracoes'
                  )}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* =================== Delete Confirmation Modal =================== */}
        {deleteMember && (
          <Modal isOpen onClose={() => setDeleteMember(null)} size="sm" centered>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 shrink-0">
                  <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Remover membro</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Tem certeza que deseja remover{' '}
                    <span className="font-medium text-gray-700">{deleteMember.displayName}</span>{' '}
                    ({deleteMember.email}) da organizacao? Esta acao nao pode ser desfeita.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setDeleteMember(null)} className={ui.btn}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className={`${ui.btnDanger} ${deleteLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {deleteLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Removendo...
                    </>
                  ) : (
                    'Remover membro'
                  )}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </PermissionGate>
  )
}
