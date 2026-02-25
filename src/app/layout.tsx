'use client'

import './globals.css'
import '@/polyfills'
import { ReactNode, useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from '@/lib/firebaseClient'
import type { OrgMember } from '@/types/organization'
import type { PlanId } from '@/types/plan'
import { Inter } from 'next/font/google'
import Image from 'next/image'

import CrmSidebar from '@/components/CrmSidebar'
import Loading from '@/components/Loading'
import { logActivity } from '@/lib/activityLogger'
import { getScreenLabel } from '@/lib/screenLabels'
import { formatDateTime } from '@/lib/format'
import { Toaster } from 'sonner'
import { CrmUserProvider } from '@/contexts/CrmUserContext'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

interface CrmLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: CrmLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userUid, setUserUid] = useState<string | null>(null)
  const [userPhoto, setUserPhoto] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgPlan, setOrgPlan] = useState<PlanId | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const lastLoggedRouteRef = useRef<string | null>(null)
  const isLoginPage = pathname === '/login'

  // Fechar menu do usuario ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [userMenuOpen])

  const handleLogout = async () => {
    try {
      await signOut(auth)
      router.replace('/login')
    } catch (err) {
      console.error('[layout] Logout failed:', err)
    }
  }

  // Autenticação
  useEffect(() => {
    if (isLoginPage) {
      setCheckingAuth(false)
      return
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace('/login')
        return
      }
      setUserEmail(user.email)
      setUserUid(user.uid)
      setUserPhoto(user.photoURL)
      setCheckingAuth(false)
      ;(async () => {
        try {
          const snap = await getDoc(doc(db, 'users', user.email!))
          setUserPhoto((snap.data() as Record<string, unknown>)?.photoUrl as string || user.photoURL)
        } catch {
          setUserPhoto(user.photoURL)
        }
        // Buscar organização do usuário
        try {
          const email = user.email?.toLowerCase()
          if (email) {
            const memberQuery = query(collectionGroup(db, 'members'), where('email', '==', email))
            const memberSnap = await getDocs(memberQuery)
            if (!memberSnap.empty) {
              const memberDoc = memberSnap.docs[0]
              const memberData = { id: memberDoc.id, ...memberDoc.data() } as OrgMember
              // O path é organizations/{orgId}/members/{memberId}
              const orgRef = memberDoc.ref.parent.parent
              if (orgRef) {
                const orgDoc = await getDoc(orgRef)
                if (orgDoc.exists()) {
                  const orgData = orgDoc.data()
                  setOrgId(orgRef.id)
                  setOrgName(orgData?.name || null)
                  setOrgPlan((orgData?.plan as PlanId) || 'basic')
                  setMember(memberData)
                }
              }
            }
          }
        } catch (err: any) {
          console.error('[layout] Org lookup failed:', err?.message || err)
          if (err?.message?.includes('indexes')) {
            console.error('[layout] CREATE THIS INDEX:', err.message)
          }
        }
      })()
    })
    return () => {
      setUserUid(null)
      setUserEmail(null)
      setUserPhoto(null)
      setOrgId(null)
      setOrgName(null)
      setOrgPlan(null)
      setMember(null)
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Relógio
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Log de acesso
  useEffect(() => {
    if (checkingAuth) return
    if (!userUid && !userEmail) return

    const screenPath = '/'
    if (lastLoggedRouteRef.current === screenPath) return

    lastLoggedRouteRef.current = screenPath
    const screenLabel = getScreenLabel(screenPath)

    logActivity({
      action: 'Acesso de tela',
      message: `Acessou a tela ${screenLabel}`,
      screenPath,
      screenLabel,
      type: 'screen-access',
      metadata: {
        tela: screenLabel,
        rota: screenPath,
      },
      entityId: userEmail ?? userUid ?? undefined,
    }).catch((error) => {
      console.warn('[activity] Failed to register screen access log', error)
    })
  }, [checkingAuth, userEmail, userUid])

  // Login: renderiza só o conteúdo, sem sidebar/header
  if (isLoginPage) {
    return (
      <html lang="pt-BR" className={`${inter.className}`}>
        <head>
          <link rel="manifest" href="/manifest.json" />
          <title>Voxium CRM</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#ffffff" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="icon" href="/icon-192.png" />
          <link rel="apple-touch-icon" href="/icon-512.png" />
        </head>
        <body className="bg-white">
          {children}
          <Toaster />
        </body>
      </html>
    )
  }

  // Splash enquanto checa auth
  if (checkingAuth) {
    return (
      <html lang="pt-BR" className={`${inter.className}`}>
        <head>
          <link rel="manifest" href="/manifest.json" />
          <title>Voxium CRM</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#ffffff" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="icon" href="/icon-192.png" />
          <link rel="apple-touch-icon" href="/icon-512.png" />
        </head>
        <body className="bg-white">
          <Loading />
        </body>
      </html>
    )
  }

  return (
    <html lang="pt-BR" className={`${inter.className}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <title>Voxium CRM</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/icon-512.png" />
      </head>
      <body className="bg-slate-50">
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar - Desktop */}
          <aside
            className={`
              ${sidebarCollapsed ? 'w-20' : 'w-72'}
              flex-shrink-0 transition-all duration-300 ease-in-out
              hidden md:block
            `}
          >
            <CrmSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </aside>

          {/* Mobile sidebar */}
          <div className={`md:hidden fixed inset-0 z-50 ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            {/* Overlay */}
            <div
              className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => setMobileOpen(false)}
            />

            {/* Sidebar */}
            <div
              className={`
                absolute left-0 top-0 h-full w-72 transform transition-transform duration-300 ease-in-out
                ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
              `}
            >
              <CrmSidebar
                collapsed={false}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <header className="flex-shrink-0 bg-white border-b border-slate-200/60 px-4 py-3">
              <div className="flex items-center justify-between">
                {/* Mobile menu button */}
                <button
                  onClick={() => setMobileOpen(true)}
                  className="md:hidden p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>

                {/* Title - mobile */}
                <span className="md:hidden text-sm font-semibold text-slate-700">Voxium</span>

                {/* Spacer */}
                <div className="hidden md:block" />

                {/* Right side */}
                <div className="flex items-center gap-3">
                  <span className="hidden md:inline text-sm text-slate-500">{formatDateTime(currentTime)}</span>
                  <div className="relative" ref={userMenuRef}>
                    <button
                      onClick={() => setUserMenuOpen(!userMenuOpen)}
                      className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition-colors"
                    >
                      {userPhoto ? (
                        <Image
                          src={userPhoto}
                          alt="Perfil"
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full ring-2 ring-white shadow-sm"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center ring-2 ring-white shadow-sm">
                          <span className="text-xs font-semibold text-primary-700">
                            {userEmail?.charAt(0).toUpperCase() || '?'}
                          </span>
                        </div>
                      )}
                      <svg className={`w-4 h-4 text-slate-400 hidden md:block transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Dropdown */}
                    {userMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-scale-in">
                        <div className="px-4 py-3 border-b border-slate-100">
                          <p className="text-sm font-semibold text-slate-800 truncate">{userEmail}</p>
                          {orgName && (
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{orgName}</p>
                          )}
                        </div>
                        <div className="py-1">
                          <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            Sair
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <CrmUserProvider userEmail={userEmail} userUid={userUid} userPhoto={userPhoto} orgId={orgId} orgName={orgName} orgPlan={orgPlan} member={member}>
                {children}
              </CrmUserProvider>
            </div>
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
