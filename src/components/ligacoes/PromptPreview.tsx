'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { XMarkIcon, DocumentTextIcon, PencilSquareIcon, EyeIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/outline'
import type { AgentWizardAnswers } from '@/types/callRouting'
import { assemblePromptFromWizard } from '@/lib/promptAssembler'

/* ================================= Types ================================= */

interface PromptPreviewProps {
  answers: AgentWizardAnswers
  open: boolean
  onClose: () => void
  onSave?: (editedPrompt: string) => Promise<void>
  savedCustomPrompt?: string
}

/* ================================= Component ================================= */

export default function PromptPreview({ answers, open, onClose, onSave, savedCustomPrompt }: PromptPreviewProps) {
  // Debounce prompt assembly by 500ms
  const [debouncedAnswers, setDebouncedAnswers] = useState(answers)
  const [editing, setEditing] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAnswers(answers), 500)
    return () => clearTimeout(timer)
  }, [answers])

  const generatedPrompt = useMemo(() => assemblePromptFromWizard(debouncedAnswers), [debouncedAnswers])
  const isCustom = !!(answers.manuallyEdited && savedCustomPrompt)
  const promptText = isCustom ? savedCustomPrompt : generatedPrompt
  const displayText = editing ? editedPrompt : promptText
  const charCount = displayText.length
  const estimatedTokens = Math.ceil(charCount / 4)

  // Reset editing state when drawer closes
  useEffect(() => {
    if (!open) {
      setEditing(false)
      setSaveSuccess(false)
    }
  }, [open])

  const handleStartEditing = useCallback(() => {
    setEditedPrompt(promptText)
    setEditing(true)
  }, [promptText])

  const handleRegenerate = useCallback(() => {
    setEditedPrompt(generatedPrompt)
  }, [generatedPrompt])

  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(editedPrompt)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      console.error('Error saving prompt:', error)
    } finally {
      setSaving(false)
    }
  }, [onSave, editedPrompt])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <DocumentTextIcon className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-slate-800">
              {editing ? 'Editar Prompt' : isCustom ? 'Prompt Customizado' : 'Prompt Gerado'}
            </h3>
            {!editing && isCustom && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded-full">
                Editado
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {onSave && (
              <button
                onClick={editing ? () => setEditing(false) : handleStartEditing}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                title={editing ? 'Voltar ao preview' : 'Editar prompt'}
              >
                {editing ? (
                  <EyeIcon className="w-5 h-5 text-slate-500" />
                ) : (
                  <PencilSquareIcon className="w-5 h-5 text-slate-500" />
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {editing ? (
            <div className="h-full flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Edite o prompt e salve para aplicar nas proximas ligacoes.</p>
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  title="Regenerar do wizard"
                >
                  <ArrowPathIcon className="w-3.5 h-3.5" />
                  Regenerar
                </button>
              </div>
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="flex-1 min-h-[400px] w-full px-3 py-3 border border-slate-200 rounded-xl text-xs font-mono leading-relaxed focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary/30 transition-all resize-none"
              />
            </div>
          ) : charCount > 0 ? (
            <PromptRenderer text={displayText} />
          ) : (
            <div className="text-center py-12 text-slate-400">
              <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Preencha as fases do wizard para ver o prompt gerado.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{charCount.toLocaleString()} caracteres | ~{estimatedTokens.toLocaleString()} tokens</span>
          {editing && onSave && (
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-1.5 rounded-lg text-white text-xs font-medium transition-colors ${
                saveSuccess
                  ? 'bg-emerald-600'
                  : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {saveSuccess ? (
                <span className="flex items-center gap-1">
                  <CheckCircleIcon className="w-3.5 h-3.5" />
                  Salvo!
                </span>
              ) : saving ? 'Salvando...' : 'Salvar Prompt'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================= Prompt Renderer ================================= */

function PromptRenderer({ text }: { text: string }) {
  const lines = text.split('\n')

  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        // H2 headers (## IDENTIDADE)
        if (line.startsWith('## ')) {
          return (
            <h3
              key={i}
              className="text-sm font-bold text-slate-800 mt-5 mb-1.5 pb-1 border-b border-slate-100 first:mt-0"
            >
              {line.replace('## ', '')}
            </h3>
          )
        }

        // H3 headers (### Abertura)
        if (line.startsWith('### ')) {
          return (
            <h4 key={i} className="text-xs font-semibold text-slate-700 mt-3 mb-1">
              {line.replace('### ', '')}
            </h4>
          )
        }

        // Numbered list items (1. ESCUTA ATIVA: ...)
        if (/^\d+\.\s/.test(line)) {
          return (
            <p key={i} className="text-xs text-slate-600 pl-3 py-0.5">
              <BoldRenderer text={line} />
            </p>
          )
        }

        // Bullet list items (- "pergunta")
        if (line.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-1.5 pl-3 py-0.5">
              <span className="text-slate-400 text-xs mt-0.5">&#8226;</span>
              <span className="text-xs text-slate-600">
                <BoldRenderer text={line.replace(/^- /, '')} />
              </span>
            </div>
          )
        }

        // Empty line
        if (line.trim() === '') {
          return <div key={i} className="h-1.5" />
        }

        // Regular text with bold rendering
        return (
          <p key={i} className="text-xs text-slate-600 py-0.5">
            <BoldRenderer text={line} />
          </p>
        )
      })}
    </div>
  )
}

/* ================================= Bold Renderer ================================= */

function BoldRenderer({ text }: { text: string }) {
  // Split on **bold** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="text-slate-700 font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
