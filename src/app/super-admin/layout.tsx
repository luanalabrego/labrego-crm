'use client'

import { ReactNode, useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebaseClient'
import { useSuperAdmin } from '@/hooks/useSuperAdmin'
import Link from 'next/link'
import { Building2, CreditCard, ShieldCheck, ArrowLeft } from 'lucide-react'

const tabs = [
  { label: 'Empresas', href: '/super-admin', icon: <Building2 className="w-4 h-4" /> },
  { label: 'Creditos', href: '/super-admin/creditos', icon: <CreditCard className="w-4 h-4" /> },
]

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace('/login')
        return
      }
      setUserEmail(user.email)
      setCheckingAuth(false)
    })
    return () => unsub()
  }, [router])

  if (checkingAuth || superAdminLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-4 p-8 bg-white rounded-2xl shadow-lg max-w-md mx-4">
          <div className="flex justify-center">
            <ShieldCheck className="w-16 h-16 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Acesso negado</h1>
          <p className="text-gray-600">
            Voce nao tem permissao para acessar o painel de Super Admin.
          </p>
          {userEmail && (
            <p className="text-sm text-gray-400">Logado como: {userEmail}</p>
          )}
          <button
            onClick={() => router.push('/contatos')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-primary-600 shrink-0" />
              <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Super Admin</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {userEmail && (
                <span className="text-xs sm:text-sm text-gray-500 hidden sm:inline">{userEmail}</span>
              )}
              <Link
                href="/contatos"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Voltar ao CRM</span>
                <span className="sm:hidden">Voltar</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <nav className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-gray-200 mb-4 sm:mb-6">
          {tabs.map((tab) => {
            const isActive =
              tab.href === '/super-admin'
                ? pathname === '/super-admin'
                : pathname?.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start gap-2 px-3 sm:px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            )
          })}
        </nav>

        {children}
      </div>
    </div>
  )
}
