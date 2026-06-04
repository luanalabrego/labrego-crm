'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'
import { useCrmUser } from '@/contexts/CrmUserContext'
import type { ClientSearchResult } from '@/hooks/useGlobalClientSearch'
import Link from 'next/link'

function BuscaContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { orgId } = useCrmUser()

  const initialQ = searchParams.get('q') || ''
  const [search, setSearch] = useState(initialQ)
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const doSearch = useCallback(async (term: string) => {
    if (!orgId || term.length < 2) {
      setResults([])
      setSearched(false)
      return
    }

    setLoading(true)
    setSearched(false)
    try {
      const termLower = term.toLowerCase()
      const snap = await getDocs(
        query(collection(db, 'clients'), where('orgId', '==', orgId), limit(500))
      )

      const all: ClientSearchResult[] = []
      snap.forEach((d) => {
        const data = d.data()
        const name = (data.name || '').toLowerCase()
        const email = (data.email || '').toLowerCase()
        const phone = (data.phone || '').replace(/\D/g, '')
        const artistName = (data.artistName || '').toLowerCase()

        if (
          name.includes(termLower) ||
          email.includes(termLower) ||
          phone.includes(term.replace(/\D/g, '')) ||
          artistName.includes(termLower)
        ) {
          all.push({
            id: d.id,
            name: data.name || '',
            email: data.email,
            phone: data.phone,
            funnelId: data.funnelId,
            funnelStage: data.funnelStage,
            company: data.company,
            photoUrl: data.photoUrl,
          })
        }
      })

      setResults(all)
    } catch (err) {
      console.error('[BuscaPage]', err)
      setResults([])
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [orgId])

  // Run search on mount if q param present
  useEffect(() => {
    if (initialQ) {
      doSearch(initialQ)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (search.length < 2) return
    router.replace(`/busca?q=${encodeURIComponent(search)}`)
    doSearch(search)
  }

  function Highlight({ text, term }: { text: string; term: string }) {
    if (!term) return <>{text}</>
    const idx = text.toLowerCase().indexOf(term.toLowerCase())
    if (idx === -1) return <>{text}</>
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-100 text-yellow-800 rounded-sm px-0.5">{text.slice(idx, idx + term.length)}</mark>
        {text.slice(idx + term.length)}
      </>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Busca Global</h1>
        <p className="text-sm text-slate-500 mt-1">Encontre clientes em todos os funis do CRM</p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome, e-mail ou telefone…"
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={search.length < 2 || loading}
            className="px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Buscando clientes…
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-slate-500 font-medium">Nenhum cliente encontrado</p>
          <p className="text-slate-400 text-sm mt-1">Tente buscar por nome, e-mail ou telefone</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div>
          <p className="text-sm text-slate-500 mb-3">
            {results.length} {results.length === 1 ? 'resultado' : 'resultados'} para &ldquo;{initialQ || search}&rdquo;
          </p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {results.map((client) => (
              <Link
                key={client.id}
                href={client.funnelId ? `/funil/${client.funnelId}?highlight=${client.id}` : '/funil'}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors"
              >
                {client.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={client.photoUrl}
                    alt={client.name}
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary-700">
                      {client.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    <Highlight text={client.name} term={initialQ || search} />
                  </p>
                  {(client.email || client.phone) && (
                    <p className="text-xs text-slate-500 truncate">
                      {client.email ? (
                        <Highlight text={client.email} term={initialQ || search} />
                      ) : (
                        <Highlight text={client.phone || ''} term={initialQ || search} />
                      )}
                    </p>
                  )}
                </div>
                <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BuscaPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500 text-sm">Carregando…</div>}>
      <BuscaContent />
    </Suspense>
  )
}
