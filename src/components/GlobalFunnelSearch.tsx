'use client'

import { useRef, useEffect, useState } from 'react'
import { useGlobalClientSearch } from '@/hooks/useGlobalClientSearch'
import GlobalSearchDropdown from '@/components/GlobalSearchDropdown'

interface GlobalFunnelSearchProps {
  orgId: string | null
}

export default function GlobalFunnelSearch({ orgId }: GlobalFunnelSearchProps) {
  const { results, total, loading, search, setSearch, clear } = useGlobalClientSearch(orgId)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Open dropdown when there's input
  useEffect(() => {
    setOpen(search.length >= 2)
  }, [search])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      clear()
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative hidden md:block w-64 lg:w-80">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (search.length >= 2) setOpen(true) }}
          placeholder="Buscar cliente no CRM…"
          aria-label="Busca global de clientes"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 bg-white/80 transition-all"
        />

        {search && (
          <button
            type="button"
            onClick={() => { clear(); setOpen(false) }}
            aria-label="Limpar busca"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <GlobalSearchDropdown
          results={results}
          total={total}
          loading={loading}
          search={search}
          onClose={() => { setOpen(false); clear() }}
        />
      )}
    </div>
  )
}
