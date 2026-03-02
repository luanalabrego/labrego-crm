'use client'

import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { Cross2Icon } from '@radix-ui/react-icons'
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'

type MemberOption = {
  id: string
  displayName: string
  email: string
  role: string
}

type TransferLeadModalProps = {
  clientId: string
  clientName: string
  currentAssignedTo?: string | null
  currentAssignedToName?: string | null
  onClose: () => void
  onTransferred?: () => void
}

export default function TransferLeadModal({
  clientId,
  clientName,
  currentAssignedTo,
  currentAssignedToName,
  onClose,
  onTransferred,
}: TransferLeadModalProps) {
  const { orgId, member } = useCrmUser()
  const [members, setMembers] = useState<MemberOption[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    const unsub = onSnapshot(
      query(collection(db, 'organizations', orgId, 'members'), where('status', '==', 'active')),
      (snap) => {
        setMembers(
          snap.docs
            .map((d) => {
              const data = d.data()
              return {
                id: d.id,
                displayName: data.displayName || data.email,
                email: data.email,
                role: data.role,
              }
            })
            .filter((m) => m.id !== currentAssignedTo)
        )
      }
    )
    return () => unsub()
  }, [orgId, currentAssignedTo])

  const handleTransfer = async () => {
    if (!orgId || !selectedMemberId || reason.trim().length < 10) return
    setSaving(true)
    try {
      const toMember = members.find((m) => m.id === selectedMemberId)
      if (!toMember) return

      const now = new Date().toISOString()
      const authorName = member?.displayName || auth.currentUser?.email || 'Sistema'

      // Update client
      await updateDoc(doc(db, 'clients', clientId), {
        assignedTo: toMember.id,
        assignedToName: toMember.displayName,
        assignedAt: now,
        updatedAt: now,
      })

      // Create audit log
      await addDoc(collection(db, 'clients', clientId, 'logs'), {
        action: 'lead_transfer',
        message: `Lead transferido de ${currentAssignedToName || 'Sem responsável'} para ${toMember.displayName}`,
        type: 'audit',
        author: authorName,
        authorId: member?.id || auth.currentUser?.uid || '',
        orgId,
        metadata: {
          fromMemberId: currentAssignedTo || '',
          toMemberId: toMember.id,
          fromMemberName: currentAssignedToName || 'Sem responsável',
          toMemberName: toMember.displayName,
          reason: reason.trim(),
        },
        createdAt: serverTimestamp(),
      })

      toast.success(`Lead transferido para ${toMember.displayName}`)
      onTransferred?.()
      onClose()
    } catch (error) {
      console.error('Error transferring lead:', error)
      toast.error('Erro ao transferir lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <ArrowsRightLeftIcon className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Transferir Lead</h3>
              <p className="text-xs text-slate-500 truncate max-w-[250px]">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <Cross2Icon className="w-4 h-4" />
          </button>
        </div>

        {currentAssignedToName && (
          <div className="mb-4 px-3 py-2 bg-slate-50 rounded-lg text-sm">
            <span className="text-slate-500">Responsável atual:</span>{' '}
            <span className="font-medium text-slate-700">{currentAssignedToName}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Novo responsável *</label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="">Selecionar membro...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Motivo da transferência * <span className="text-slate-400 font-normal">(min. 10 caracteres)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da transferência..."
              rows={3}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleTransfer}
            disabled={saving || !selectedMemberId || reason.trim().length < 10}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Transferindo...' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  )
}
