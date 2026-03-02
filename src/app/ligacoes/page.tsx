'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LigacoesRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/ligacoes/configuracao')
  }, [router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  )
}
