'use client'

import { useState, useEffect } from 'react'
import { db } from '@/lib/firebaseClient'
import { doc, onSnapshot } from 'firebase/firestore'

interface CreditSummary {
  actionBalance: number
  minuteBalance: number
  loading: boolean
}

/**
 * Hook real-time para saldo de créditos da organização.
 * Usa onSnapshot no Firestore para atualizar automaticamente.
 */
export function useCredits(orgId: string | undefined): CreditSummary {
  const [actionBalance, setActionBalance] = useState(0)
  const [minuteBalance, setMinuteBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }

    const balanceRef = doc(db, 'organizations', orgId, 'credits', 'balance')
    const unsubscribe = onSnapshot(
      balanceRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data()
          setActionBalance(data.actionBalance ?? 0)
          setMinuteBalance(data.balance ?? 0)
        } else {
          setActionBalance(0)
          setMinuteBalance(0)
        }
        setLoading(false)
      },
      (error) => {
        console.error('[useCredits] Error:', error)
        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [orgId])

  return { actionBalance, minuteBalance, loading }
}
