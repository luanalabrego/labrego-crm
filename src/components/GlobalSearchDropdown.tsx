'use client'

import { useRouter } from 'next/navigation'
import type { ClientSearchResult } from '@/hooks/useGlobalClientSearch'

interface GlobalSearchDropdownProps {
  results: ClientSearchResult[]
  total: number
  loading: boolean
  search: string
  onClose: () => void
  highlightText?: string
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

export default function GlobalSearchDropdown({
  results,
  total,
  loading,
  search,
  onClose,
  highlightText,
}: GlobalSearchDropdownProps) {
  const router = useRouter()
  const term = highlightText || search

  if (loading) {
    return (
      <div
        role="listbox"
        aria-label="Resultados da busca"
        className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 py-3 px-4"
      >
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Buscando…
        </div>
      </div>
    )
  }

  if (!loading && search.length >= 2 && results.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="Resultados da busca"
        className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 py-3 px-4"
      >
        <p className="text-sm text-slate-500">Nenhum cliente encontrado para &ldquo;{search}&rdquo;</p>
      </div>
    )
  }

  if (results.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Resultados da busca"
      className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden"
    >
      <ul>
        {results.map((client) => (
          <li key={client.id} role="option" aria-selected="false">
            <button
              type="button"
              onClick={() => {
                if (client.funnelId) {
                  router.push(`/funil/${client.funnelId}?highlight=${client.id}`)
                }
                onClose()
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-100 last:border-b-0"
            >
              {/* Avatar */}
              {client.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={client.photoUrl}
                  alt={client.name}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-primary-700">
                    {client.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">
                  <Highlight text={client.name} term={term} />
                </p>
                {(client.email || client.phone) && (
                  <p className="text-xs text-slate-500 truncate">
                    {client.email ? (
                      <Highlight text={client.email} term={term} />
                    ) : (
                      <Highlight text={client.phone || ''} term={term} />
                    )}
                  </p>
                )}
              </div>

              {/* Arrow */}
              <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {total > 5 && (
        <button
          type="button"
          onClick={() => {
            router.push(`/busca?q=${encodeURIComponent(search)}`)
            onClose()
          }}
          className="w-full px-4 py-2.5 text-sm text-primary-600 hover:bg-primary-50 transition-colors text-center font-medium border-t border-slate-100"
        >
          Ver todos {total} →
        </button>
      )}
    </div>
  )
}
