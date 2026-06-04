'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from '@/lib/firebaseClient'

export interface ClientSearchResult {
  id: string
  name: string
  email?: string
  phone?: string
  funnelId?: string
  funnelStage?: string
  company?: string
  photoUrl?: string
}

interface UseGlobalClientSearchReturn {
  results: ClientSearchResult[]
  total: number
  loading: boolean
  search: string
  setSearch: (value: string) => void
  clear: () => void
}

const cache = new Map<string, { results: ClientSearchResult[]; total: number; ts: number }>()
const CACHE_TTL = 30_000 // 30s

export function useGlobalClientSearch(orgId: string | null): UseGlobalClientSearchReturn {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ClientSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (term: string) => {
    if (!orgId || term.length < 2) {
      setResults([])
      setTotal(0)
      setLoading(false)
      return
    }

    const cacheKey = `${orgId}:${term}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setResults(cached.results)
      setTotal(cached.total)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const termLower = term.toLowerCase()

      // Fetch up to 200 clients for local filtering (Firestore doesn't support full-text search)
      const snap = await getDocs(
        query(
          collection(db, 'clients'),
          where('orgId', '==', orgId),
          limit(200)
        )
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

      const top5 = all.slice(0, 5)
      cache.set(cacheKey, { results: top5, total: all.length, ts: Date.now() })
      setResults(top5)
      setTotal(all.length)
    } catch (err) {
      console.error('[useGlobalClientSearch]', err)
      setResults([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!search || search.length < 2) {
      setResults([])
      setTotal(0)
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(() => {
      doSearch(search)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, doSearch])

  const clear = useCallback(() => {
    setSearch('')
    setResults([])
    setTotal(0)
    setLoading(false)
  }, [])

  return { results, total, loading, search, setSearch, clear }
}
