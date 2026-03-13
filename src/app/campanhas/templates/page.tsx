'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useCrmUser } from '@/contexts/CrmUserContext'
import { db } from '@/lib/firebaseClient'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import PlanGate from '@/components/PlanGate'
import {
  type EmailTemplate,
  type EmailBlockData,
  type TemplateCategory,
  TEMPLATE_CATEGORIES,
  blocksToHtml,
  replaceVariables,
} from '@/types/emailTemplate'
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'

/* ======================== System Templates ======================== */

const SAMPLE_VARS: Record<string, string> = {
  nome: 'João Silva',
  empresa: 'Acme Corp',
  email: 'joao@acme.com',
  funil: 'Vendas B2B',
  responsavel: 'Maria Santos',
}

function b(id: string, type: EmailBlockData['type'], props: Partial<EmailBlockData> = {}): EmailBlockData {
  return { id, type, paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16, backgroundColor: '', align: 'left', ...props }
}

const SYSTEM_TEMPLATES: Omit<EmailTemplate, 'orgId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName'>[] = [
  {
    id: 'sys-boas-vindas-1',
    name: 'Boas-vindas Calorosas',
    subject: 'Bem-vindo(a), {{nome}}!',
    category: 'boas-vindas',
    isSystem: true,
    blocks: [
      b('bv1', 'image', { src: 'https://placehold.co/600x200/13DEFC/FFF?text=Bem-vindo!', alt: 'Banner', align: 'center', imageWidth: 600, paddingBottom: 0 }),
      b('bv2', 'text', { content: 'Olá, {{nome}}! 👋', fontSize: 24, fontWeight: 'bold', color: '#1e293b', align: 'center', paddingTop: 24 }),
      b('bv3', 'text', { content: 'Estamos muito felizes em ter você conosco! Sua conta em {{empresa}} está pronta para uso.', fontSize: 16, color: '#475569', align: 'center' }),
      b('bv4', 'button', { buttonText: 'Começar agora', buttonUrl: 'https://', buttonColor: '#13DEFC', buttonTextColor: '#FFFFFF', align: 'center', paddingTop: 8 }),
      b('bv5', 'divider', { dividerColor: '#e2e8f0', paddingTop: 24, paddingBottom: 16 }),
      b('bv6', 'text', { content: 'Qualquer dúvida, entre em contato com {{responsavel}}.', fontSize: 14, color: '#94a3b8', align: 'center' }),
    ],
  },
  {
    id: 'sys-followup-1',
    name: 'Follow-up Comercial',
    subject: '{{nome}}, vamos conversar?',
    category: 'follow-up',
    isSystem: true,
    blocks: [
      b('fu1', 'text', { content: 'Olá, {{nome}}!', fontSize: 20, fontWeight: 'bold', color: '#1e293b', paddingTop: 24 }),
      b('fu2', 'text', { content: 'Percebi que você demonstrou interesse em nossos serviços. Gostaria de agendar uma conversa rápida para entender melhor suas necessidades na {{empresa}}.', fontSize: 16, color: '#475569' }),
      b('fu3', 'text', { content: 'Tenho alguns horários disponíveis esta semana. Qual funciona melhor para você?', fontSize: 16, color: '#475569' }),
      b('fu4', 'button', { buttonText: 'Agendar reunião', buttonUrl: 'https://', buttonColor: '#13DEFC', buttonTextColor: '#FFFFFF', align: 'center', paddingTop: 8 }),
      b('fu5', 'spacer', { spacerHeight: 16, paddingTop: 0, paddingBottom: 0 }),
      b('fu6', 'text', { content: 'Abraços,\n{{responsavel}}', fontSize: 14, color: '#64748b' }),
    ],
  },
  {
    id: 'sys-promo-1',
    name: 'Oferta Especial',
    subject: '🔥 Oferta exclusiva para {{empresa}}',
    category: 'promocional',
    isSystem: true,
    blocks: [
      b('pr1', 'image', { src: 'https://placehold.co/600x250/1e293b/FFF?text=OFERTA+ESPECIAL', alt: 'Banner promo', align: 'center', imageWidth: 600, paddingBottom: 0 }),
      b('pr2', 'text', { content: '{{nome}}, preparamos algo especial!', fontSize: 22, fontWeight: 'bold', color: '#1e293b', align: 'center', paddingTop: 20 }),
      b('pr3', 'text', { content: 'Por tempo limitado, estamos oferecendo condições exclusivas para a {{empresa}}. Não perca essa oportunidade!', fontSize: 16, color: '#475569', align: 'center' }),
      b('pr4', 'button', { buttonText: 'Aproveitar oferta', buttonUrl: 'https://', buttonColor: '#dc2626', buttonTextColor: '#FFFFFF', buttonRadius: 24, align: 'center', paddingTop: 8 }),
      b('pr5', 'divider', { dividerColor: '#e2e8f0', paddingTop: 24, paddingBottom: 16 }),
      b('pr6', 'text', { content: 'Válido até o final do mês. Termos e condições se aplicam.', fontSize: 12, color: '#94a3b8', align: 'center' }),
    ],
  },
  {
    id: 'sys-info-1',
    name: 'Newsletter Informativa',
    subject: 'Novidades de {{empresa}}',
    category: 'informativo',
    isSystem: true,
    blocks: [
      b('in1', 'text', { content: '📰 Newsletter', fontSize: 28, fontWeight: 'bold', color: '#1e293b', align: 'center', paddingTop: 24 }),
      b('in2', 'divider', { dividerColor: '#13DEFC', dividerThickness: 3, paddingTop: 8, paddingBottom: 16 }),
      b('in3', 'text', { content: 'Olá, {{nome}}! Confira as novidades desta semana:', fontSize: 16, color: '#475569' }),
      b('in4', 'text', { content: '🎯 Destaque do mês\nAdicione aqui o conteúdo principal da newsletter.', fontSize: 16, color: '#334155', paddingTop: 16 }),
      b('in5', 'text', { content: '📊 Em números\nCompartilhe métricas e resultados relevantes.', fontSize: 16, color: '#334155' }),
      b('in6', 'button', { buttonText: 'Saiba mais', buttonUrl: 'https://', buttonColor: '#13DEFC', buttonTextColor: '#FFFFFF', align: 'center', paddingTop: 8 }),
      b('in7', 'text', { content: 'Até a próxima!\nEquipe {{empresa}}', fontSize: 14, color: '#94a3b8', align: 'center', paddingTop: 16 }),
    ],
  },
  {
    id: 'sys-reeng-1',
    name: 'Reengajamento',
    subject: '{{nome}}, sentimos sua falta!',
    category: 'reengajamento',
    isSystem: true,
    blocks: [
      b('re1', 'text', { content: 'Sentimos sua falta, {{nome}}! 💜', fontSize: 24, fontWeight: 'bold', color: '#1e293b', align: 'center', paddingTop: 24 }),
      b('re2', 'text', { content: 'Faz um tempo que não nos falamos. Gostaríamos de saber como a {{empresa}} está e se podemos ajudar em algo.', fontSize: 16, color: '#475569', align: 'center' }),
      b('re3', 'spacer', { spacerHeight: 8, paddingTop: 0, paddingBottom: 0 }),
      b('re4', 'text', { content: 'Temos novidades que podem interessar:', fontSize: 16, color: '#334155', fontWeight: 'bold' }),
      b('re5', 'text', { content: '✅ Novos recursos disponíveis\n✅ Planos com condições especiais\n✅ Suporte prioritário', fontSize: 16, color: '#475569' }),
      b('re6', 'button', { buttonText: 'Reconectar', buttonUrl: 'https://', buttonColor: '#7c3aed', buttonTextColor: '#FFFFFF', align: 'center', paddingTop: 8 }),
      b('re7', 'text', { content: 'Se preferir não receber mais emails, nos avise. Respeitamos sua decisão.', fontSize: 12, color: '#94a3b8', align: 'center', paddingTop: 16 }),
    ],
  },
]

/* ======================== Component ======================== */

function TemplatesLibraryContent() {
  const router = useRouter()
  const { orgId } = useCrmUser()

  const [orgTemplates, setOrgTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | ''>('')
  const [previewTemplate, setPreviewTemplate] = useState<typeof SYSTEM_TEMPLATES[0] | EmailTemplate | null>(null)

  useEffect(() => {
    if (!orgId) return
    const load = async () => {
      try {
        const q = query(
          collection(db, 'emailTemplates'),
          where('orgId', '==', orgId),
          orderBy('updatedAt', 'desc'),
        )
        const snap = await getDocs(q)
        setOrgTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as EmailTemplate[])
      } catch (error) {
        console.error('Error loading templates:', error)
      }
      setLoading(false)
    }
    load()
  }, [orgId])

  const allTemplates = useMemo(() => {
    const sys = SYSTEM_TEMPLATES.map((t) => ({ ...t, orgId: '', createdAt: '', updatedAt: '', createdBy: '', createdByName: '' }))
    return [...sys, ...orgTemplates]
  }, [orgTemplates])

  const filtered = useMemo(() => {
    return allTemplates.filter((t) => {
      if (selectedCategory && t.category !== selectedCategory) return false
      if (search) {
        const s = search.toLowerCase()
        return t.name.toLowerCase().includes(s) || t.subject.toLowerCase().includes(s)
      }
      return true
    })
  }, [allTemplates, selectedCategory, search])

  const openInEditor = (tmpl: typeof SYSTEM_TEMPLATES[0] | EmailTemplate) => {
    if (tmpl.isSystem) {
      // System templates: open editor with blocks as initialBlocks via sessionStorage
      sessionStorage.setItem('editorBlocks', JSON.stringify(tmpl.blocks))
      sessionStorage.setItem('editorSubject', tmpl.subject)
      router.push('/campanhas/editor')
    } else {
      // Org templates: open editor with templateId
      router.push(`/campanhas/editor?templateId=${tmpl.id}`)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/campanhas')} className="rounded-lg p-2 hover:bg-slate-100 transition-colors">
          <ArrowLeftIcon className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Templates de Email</h1>
          <p className="text-sm text-slate-500">Escolha um template para começar sua campanha</p>
        </div>
        <button
          onClick={() => router.push('/campanhas/editor')}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          <PencilSquareIcon className="h-4 w-4" />
          Criar do zero
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar templates..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-300 focus:border-primary-400 outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedCategory('')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              !selectedCategory ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos
          </button>
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategory === cat.value ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Template grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-sm">Nenhum template encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tmpl) => (
            <div
              key={tmpl.id}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md hover:border-primary-200 transition-all group"
            >
              {/* Thumbnail preview */}
              <div className="h-48 bg-slate-50 overflow-hidden relative">
                <iframe
                  srcDoc={replaceVariables(blocksToHtml(tmpl.blocks || []), SAMPLE_VARS)}
                  title={tmpl.name}
                  sandbox="allow-same-origin"
                  className="w-full border-0 pointer-events-none"
                  style={{ height: 400, transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%' }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                  <button
                    onClick={() => setPreviewTemplate(tmpl)}
                    className="text-xs font-medium text-primary-600 bg-white/90 px-3 py-1.5 rounded-full shadow-sm hover:bg-white"
                  >
                    Preview
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{tmpl.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{tmpl.subject}</p>
                  </div>
                  {tmpl.category && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      {TEMPLATE_CATEGORIES.find((c) => c.value === tmpl.category)?.label || tmpl.category}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-slate-400">
                    {tmpl.isSystem ? 'Template do sistema' : 'Seu template'} &middot; {tmpl.blocks?.length || 0} blocos
                  </span>
                  <button
                    onClick={() => openInEditor(tmpl)}
                    className="text-xs font-medium text-white bg-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Usar template
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewTemplate(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{previewTemplate.name}</h3>
                <p className="text-xs text-slate-400">{previewTemplate.subject}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { openInEditor(previewTemplate); setPreviewTemplate(null) }}
                  className="text-xs font-medium text-white bg-primary-600 px-3 py-1.5 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Usar template
                </button>
                <button onClick={() => setPreviewTemplate(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">
                  Fechar
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4">
              <div className="mx-auto bg-white rounded-lg shadow-sm" style={{ maxWidth: 620 }}>
                <iframe
                  srcDoc={replaceVariables(blocksToHtml(previewTemplate.blocks || []), SAMPLE_VARS)}
                  title="Preview"
                  sandbox="allow-same-origin"
                  className="w-full border-0"
                  style={{ height: 600 }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TemplatesLibraryPage() {
  return (
    <PlanGate feature="email_automation">
      <TemplatesLibraryContent />
    </PlanGate>
  )
}
