'use client'

import './globals.css'
import '@/polyfills'
import { ReactNode, useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, updateDoc, collectionGroup, query, where, getDocs, collection } from 'firebase/firestore'
import { auth, db } from '@/lib/firebaseClient'
import type { OrgMember } from '@/types/organization'
import type { PlanId } from '@/types/plan'
import { PLAN_DISPLAY } from '@/types/plan'
import { Inter } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'

import CrmSidebar from '@/components/CrmSidebar'
import Loading from '@/components/Loading'
import { logActivity } from '@/lib/activityLogger'
import { getScreenLabel } from '@/lib/screenLabels'
import { formatDateTime } from '@/lib/format'
import { Toaster } from 'sonner'
import { CrmUserProvider } from '@/contexts/CrmUserContext'
import { ImpersonationProvider, useImpersonation } from '@/contexts/ImpersonationContext'
import { PartnerViewProvider, usePartnerView, type MembershipInfo } from '@/contexts/PartnerViewContext'
import { useCredits } from '@/hooks/useCredits'
import FreePlanExpiredGate from '@/components/FreePlanExpiredGate'
import CookieConsent from '@/components/CookieConsent'
import PageAccessGuard from '@/components/PageAccessGuard'
import NotificationBell from '@/components/NotificationBell'
import GlobalFunnelSearch from '@/components/GlobalFunnelSearch'
// useSuperAdmin removido — usado apenas no CrmSidebar

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
  const [darkMode, setDarkMode] = useState(false)

  // Dark mode: read preference on mount, sync to <html> class
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    const prefersDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)
    setDarkMode(prefersDark)
    document.documentElement.classList.toggle('dark', prefersDark)
  }, [])

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userUid, setUserUid] = useState<string | null>(null)
  const [userPhoto, setUserPhoto] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgPlan, setOrgPlan] = useState<PlanId | null>(null)
  const [orgCreatedAt, setOrgCreatedAt] = useState<string | null>(null)
  const [orgPlanSubscribedAt, setOrgPlanSubscribedAt] = useState<string | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [impersonateMenuOpen, setImpersonateMenuOpen] = useState(false)
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [allMemberships, setAllMemberships] = useState<MembershipInfo[]>([])
  const impersonateMenuRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const lastLoggedRouteRef = useRef<string | null>(null)
  const isPublicPage = pathname === '/login' || pathname === '/auth/forgot-password' || pathname === '/auth/reset-password' || pathname === '/reset-password'
  const { actionBalance, minuteBalance, loading: creditsLoading } = useCredits(orgId ?? undefined, orgPlan)
  // Apenas admin da organização pode usar "Ver como"
  // systemRole 'admin' (definido via super-admin) também concede acesso
  const isAdmin = member?.systemRole === 'admin' || member?.role === 'admin'

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

  // Fechar menu de impersonação ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (impersonateMenuRef.current && !impersonateMenuRef.current.contains(e.target as Node)) {
        setImpersonateMenuOpen(false)
      }
    }
    if (impersonateMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [impersonateMenuOpen])

  // Carregar membros da organização quando admin (skip para plano free)
  // Busca Firestore members + Firebase Auth users e faz merge (igual /admin/usuarios)
  useEffect(() => {
    if (!orgId || !member || !isAdmin || orgPlan === 'free') return

    const loadMembers = async () => {
      try {
        // Buscar membros do Firestore
        const membersRef = collection(db, 'organizations', orgId, 'members')
        const snap = await getDocs(query(membersRef))
        const firestoreMembers = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as OrgMember))

        // Buscar usuários do Firebase Auth via API
        let authUsers: { uid: string; email: string; displayName?: string; photoURL?: string; disabled: boolean; createdAt?: string }[] = []
        try {
          const res = await fetch(`/api/admin/members/verify-auth?orgId=${encodeURIComponent(orgId)}`, {
            headers: { 'x-user-email': userEmail || '' },
          })
          if (res.ok) {
            const data = await res.json()
            authUsers = data.users || []
          }
        } catch {
          // silently fail - Firestore members will still show
        }

        // Merge: Firestore members + Auth-only users (sem vínculo no Firestore)
        const memberEmailSet = new Set(firestoreMembers.map(m => m.email?.toLowerCase()))
        const memberUidSet = new Set(firestoreMembers.map(m => m.userId).filter(Boolean))
        const authUidSet = new Set(authUsers.map(u => u.uid))

        // Firestore members válidos (cujo userId existe no Auth, se temos dados de Auth)
        const validMembers = authUsers.length > 0
          ? firestoreMembers.filter(m => !m.userId || authUidSet.has(m.userId))
          : firestoreMembers

        // Auth-only users (não existem no Firestore)
        const authOnlyMembers: OrgMember[] = authUsers
          .filter(u => !memberEmailSet.has(u.email?.toLowerCase()) && !memberUidSet.has(u.uid))
          .filter(u => !u.disabled)
          .map(u => ({
            id: `auth-${u.uid}`,
            userId: u.uid,
            email: u.email,
            displayName: u.displayName || u.email?.split('@')[0] || '',
            photoUrl: u.photoURL,
            role: '' as OrgMember['role'],
            permissions: { pages: [], actions: {} as OrgMember['permissions']['actions'], viewScope: 'own' as const },
            status: 'active' as OrgMember['status'],
            joinedAt: u.createdAt || '',
          }))

        const allMembers = [...validMembers, ...authOnlyMembers]
          .filter(m => m.status !== 'suspended' && m.role !== 'admin')
          .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))

        setOrgMembers(allMembers)
      } catch (err) {
        console.warn('[layout] Failed to load org members:', err)
        setOrgMembers([])
      }
    }

    loadMembers()
  }, [orgId, member, isAdmin, orgPlan, userEmail])

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
    if (isPublicPage) {
      setCheckingAuth(false)
      return
    }
    setCheckingAuth(true)
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace('/login')
        return
      }
      setUserEmail(user.email)
      setUserUid(user.uid)
      setUserPhoto(user.photoURL)
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
              // If user has memberships in multiple orgs, prioritize:
              // 1. Active own-org memberships (no invitedBy) first
              // 2. Active partner memberships second
              // 3. Skip suspended partner memberships (they lost access to the partner org)
              const sorted = [...memberSnap.docs].sort((a, b) => {
                const aData = a.data()
                const bData = b.data()
                const aSuspendedPartner = aData.status === 'suspended' && !!aData.invitedBy
                const bSuspendedPartner = bData.status === 'suspended' && !!bData.invitedBy
                if (aSuspendedPartner && !bSuspendedPartner) return 1
                if (bSuspendedPartner && !aSuspendedPartner) return -1
                if (aData.status === 'active' && bData.status !== 'active') return -1
                if (bData.status === 'active' && aData.status !== 'active') return 1
                if (!aData.invitedBy && bData.invitedBy) return -1
                if (aData.invitedBy && !bData.invitedBy) return 1
                return (bData.joinedAt || '').localeCompare(aData.joinedAt || '')
              })
              const bestDoc = sorted[0]

              const memberData = { id: bestDoc.id, ...bestDoc.data() } as OrgMember
              // Block suspended non-partner members from accessing the app
              if (memberData.status === 'suspended') {
                if (memberData.invitedBy) {
                  console.info('[layout] Partner suspended, auto-provisioning own org:', memberData.email)
                } else {
                  console.warn('[layout] Member is suspended, signing out:', memberData.email)
                  await signOut(auth)
                  router.replace('/login?blocked=1')
                  return
                }
              }

              // If bestDoc is a usable membership (not a suspended partner), use it
              const isSuspendedPartner = memberData.status === 'suspended' && !!memberData.invitedBy
              if (!isSuspendedPartner) {
                // Auto-activate invited members on login
                if (memberData.status === 'invited') {
                  try {
                    await updateDoc(bestDoc.ref, { status: 'active' })
                    memberData.status = 'active'
                  } catch (e) {
                    console.error('[layout] Failed to activate member:', e)
                  }
                }
                const orgRef = bestDoc.ref.parent.parent
                if (orgRef) {
                  const orgDoc = await getDoc(orgRef)
                  if (orgDoc.exists()) {
                    const orgData = orgDoc.data()
                    if (orgData?.status === 'suspended') {
                      console.warn('[layout] Organization is suspended:', orgRef.id)
                    }
                    setOrgId(orgRef.id)
                    setOrgName(orgData?.name || null)
                    setOrgPlan((orgData?.plan as PlanId) || 'free')
                    setOrgCreatedAt(orgData?.createdAt || null)
                    setOrgPlanSubscribedAt(orgData?.planSubscribedAt || null)
                    setMember(memberData)
                  }
                }
              }

              // Load ALL active memberships for partner view switching
              const loadedMemberships: MembershipInfo[] = []
              for (const memberDoc of sorted) {
                const mData = { id: memberDoc.id, ...memberDoc.data() } as OrgMember
                // Skip suspended memberships
                if (mData.status === 'suspended') continue
                // Auto-activate invited members
                if (mData.status === 'invited') {
                  try {
                    await updateDoc(memberDoc.ref, { status: 'active' })
                    mData.status = 'active'
                  } catch { /* already handled for bestDoc */ }
                }
                const mOrgRef = memberDoc.ref.parent.parent
                if (!mOrgRef) continue
                // For the bestDoc, reuse already fetched org data
                if (memberDoc.id === bestDoc.id && !isSuspendedPartner) {
                  const orgRef = bestDoc.ref.parent.parent
                  if (orgRef) {
                    const orgDoc = await getDoc(orgRef)
                    if (orgDoc.exists()) {
                      const orgData = orgDoc.data()
                      loadedMemberships.push({
                        member: mData,
                        orgId: orgRef.id,
                        orgName: orgData?.name || '',
                        orgPlan: (orgData?.plan as PlanId) || 'free',
                        orgCreatedAt: orgData?.createdAt || null,
                        orgPlanSubscribedAt: orgData?.planSubscribedAt || null,
                        isPartner: !!mData.invitedBy,
                      })
                    }
                  }
                } else {
                  try {
                    const mOrgDoc = await getDoc(mOrgRef)
                    if (mOrgDoc.exists()) {
                      const mOrgData = mOrgDoc.data()
                      if (mOrgData?.status !== 'suspended') {
                        loadedMemberships.push({
                          member: mData,
                          orgId: mOrgRef.id,
                          orgName: mOrgData?.name || '',
                          orgPlan: (mOrgData?.plan as PlanId) || 'free',
                          orgCreatedAt: mOrgData?.createdAt || null,
                          orgPlanSubscribedAt: mOrgData?.planSubscribedAt || null,
                          isPartner: !!mData.invitedBy,
                        })
                      }
                    }
                  } catch (e) {
                    console.warn('[layout] Failed to load partner org data:', e)
                  }
                }
              }
              setAllMemberships(loadedMemberships)
            }

            // Auto-provision free org if user has no usable membership
            // (either no memberships at all, or only suspended partner memberships)
            const hasUsableMembership = !memberSnap.empty && (() => {
              const bestData = memberSnap.docs.length > 1
                ? [...memberSnap.docs].sort((a, b) => {
                    const aData = a.data()
                    const bData = b.data()
                    const aSP = aData.status === 'suspended' && !!aData.invitedBy
                    const bSP = bData.status === 'suspended' && !!bData.invitedBy
                    if (aSP && !bSP) return 1
                    if (bSP && !aSP) return -1
                    if (aData.status === 'active' && bData.status !== 'active') return -1
                    if (bData.status === 'active' && aData.status !== 'active') return 1
                    return 0
                  })[0].data()
                : memberSnap.docs[0].data()
              return !(bestData.status === 'suspended' && !!bestData.invitedBy)
            })()

            if (!hasUsableMembership) {
              // User has no org — auto-provision with free plan
              try {
                const res = await fetch('/api/auto-provision', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email,
                    uid: user.uid,
                    displayName: user.displayName || email.split('@')[0],
                  }),
                })
                if (res.ok) {
                  const data = await res.json()
                  if (data.orgId) {
                    // Re-fetch org and member data after provisioning
                    const orgDoc = await getDoc(doc(db, 'organizations', data.orgId))
                    if (orgDoc.exists()) {
                      const orgData = orgDoc.data()
                      setOrgId(data.orgId)
                      setOrgName(orgData?.name || null)
                      setOrgPlan('free')
                      setOrgCreatedAt(orgData?.createdAt || null)
                      setOrgPlanSubscribedAt(orgData?.planSubscribedAt || null)

                      // Fetch the newly created member
                      const newMemberQuery = query(collectionGroup(db, 'members'), where('email', '==', email))
                      const newMemberSnap = await getDocs(newMemberQuery)
                      if (!newMemberSnap.empty) {
                        setMember({ id: newMemberSnap.docs[0].id, ...newMemberSnap.docs[0].data() } as OrgMember)
                      }
                    }
                  }
                } else {
                  console.error('[layout] Auto-provision failed:', await res.text())
                }
              } catch (provisionErr) {
                console.error('[layout] Auto-provision error:', provisionErr)
              }
            }
          }
        } catch (err: any) {
          console.error('[layout] Org lookup failed:', err?.message || err)
          if (err?.message?.includes('indexes')) {
            console.error('[layout] CREATE THIS INDEX:', err.message)
          }
        } finally {
          setCheckingAuth(false)
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
      setOrgCreatedAt(null)
      setOrgPlanSubscribedAt(null)
      setMember(null)
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, isPublicPage])

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

  // Cálculo do countdown da assinatura (free=7d, pago=30d)
  const subscriptionCountdown = (() => {
    if (!orgPlan || !orgCreatedAt) return null
    const isFreePlan = orgPlan === 'free'
    const trialDays = isFreePlan ? 7 : 30
    const startDate = isFreePlan ? orgCreatedAt : (orgPlanSubscribedAt || orgCreatedAt)
    const expiresAt = new Date(startDate)
    expiresAt.setDate(expiresAt.getDate() + trialDays)
    const diffMs = expiresAt.getTime() - currentTime.getTime()
    const planLabel = isFreePlan ? 'Teste gratuito' : 'Assinatura'
    if (diffMs <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true, planLabel }
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000)
    return { days, hours, minutes, seconds, expired: false, planLabel }
  })()

  // Timer visível para todos os usuários com org ativa
  const showSubscriptionTimer = !!subscriptionCountdown

  // Login: renderiza só o conteúdo, sem sidebar/header
  if (isPublicPage) {
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
        <body className="bg-white dark:bg-surface-dark">
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
        <body className="bg-white dark:bg-surface-dark">
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
      <body className="bg-slate-50 dark:bg-[#0F0A2E] dark:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
        >
          Pular para o conteúdo principal
        </a>
        <ImpersonationProvider>
        <PartnerViewProvider memberships={allMemberships}>
        <CrmUserProvider userEmail={userEmail} userUid={userUid} userPhoto={userPhoto} orgId={orgId} orgName={orgName} orgPlan={orgPlan} orgCreatedAt={orgCreatedAt} orgPlanSubscribedAt={orgPlanSubscribedAt} member={member}>
        <div className="flex flex-col h-screen overflow-hidden">
        <ImpersonationBanner orgPlan={orgPlan} />
        <PartnerViewBanner />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Desktop */}
          <aside
            role="navigation"
            aria-label="Menu principal"
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
          <div className={`md:hidden fixed inset-0 z-50 ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} role="dialog" aria-modal={mobileOpen} aria-label="Menu de navegação">
            {/* Overlay */}
            <div
              className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
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
          <main id="main-content" className="flex-1 flex flex-col overflow-hidden" role="main">
            {/* Header */}
            <header className="flex-shrink-0 bg-white dark:bg-navy border-b border-slate-200 dark:border-white/10/60 dark:border-navy-mid px-4 py-3">
              <div className="flex items-center justify-between">
                {/* Mobile menu button */}
                <button
                  onClick={() => setMobileOpen(true)}
                  className="md:hidden p-2 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors"
                  aria-label="Abrir menu"
                >
                  <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>

                {/* Greeting - mobile */}
                <span className="md:hidden text-sm font-semibold text-slate-700 dark:text-white truncate max-w-[180px]">
                  {(() => {
                    const h = currentTime.getHours()
                    const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
                    const firstName = (member?.displayName || userEmail?.split('@')[0] || '').split(' ')[0]
                    return firstName ? `${greeting}, ${firstName}` : greeting
                  })()}
                </span>

                {/* Partner View Switcher - mobile */}
                <PartnerViewSwitcherMobile />

                {/* Greeting - desktop */}
                <div className="hidden md:flex items-center gap-2">
                  <span className="text-sm text-slate-700 dark:text-slate-200">
                    {(() => {
                      const h = currentTime.getHours()
                      const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
                      const firstName = (member?.displayName || userEmail?.split('@')[0] || '').split(' ')[0]
                      return firstName ? `${greeting}, ${firstName}` : greeting
                    })()}
                  </span>
                  {orgName && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className="text-sm font-medium text-primary-600">{orgName}</span>
                    </>
                  )}
                  {!creditsLoading && orgId && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        actionBalance <= 0 || minuteBalance <= 0
                          ? 'bg-red-100 text-red-700'
                          : actionBalance < 200 || minuteBalance < 50
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        {actionBalance} ações · {minuteBalance} min
                      </span>
                    </>
                  )}
                  {showSubscriptionTimer && (
                    <>
                      <span className="text-slate-300">|</span>
                      <Link
                        href="/plano"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        {member?.role === 'admin' ? 'Admin' : (orgPlan ? PLAN_DISPLAY[orgPlan]?.displayName || orgPlan : 'Sem plano')}
                      </Link>
                      {member?.role !== 'admin' && (
                      <Link
                        href="/plano"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium transition-colors ${
                          (() => {
                            const c = subscriptionCountdown!
                            if (c.expired) return 'bg-red-100 text-red-700 hover:bg-red-200'
                            if (c.days <= 1) return 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            return 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          })()
                        }`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {subscriptionCountdown!.expired
                          ? 'Expirado'
                          : `${String(subscriptionCountdown!.days).padStart(2, '0')}:${String(subscriptionCountdown!.hours).padStart(2, '0')}:${String(subscriptionCountdown!.minutes).padStart(2, '0')}`
                        }
                      </Link>
                      )}
                    </>
                  )}
                </div>

                {/* Global CRM Search — visible only on /funil routes */}
                {pathname.startsWith('/funil') && (
                  <GlobalFunnelSearch orgId={orgId} />
                )}

                {/* Right side */}
                <div className="flex items-center gap-3">
                  {showSubscriptionTimer && (
                    <div className="md:hidden flex items-center gap-1">
                      <Link
                        href="/plano"
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        {member?.role === 'admin' ? 'Admin' : (orgPlan ? PLAN_DISPLAY[orgPlan]?.displayName || orgPlan : '—')}
                      </Link>
                      {member?.role !== 'admin' && (
                      <Link
                        href="/plano"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
                          (() => {
                            const c = subscriptionCountdown!
                            if (c.expired) return 'bg-red-100 text-red-700'
                            if (c.days <= 1) return 'bg-amber-100 text-amber-700'
                            return 'bg-blue-50 text-blue-700'
                          })()
                        }`}
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {subscriptionCountdown!.expired
                          ? 'Expirado'
                          : `${String(subscriptionCountdown!.days).padStart(2, '0')}:${String(subscriptionCountdown!.hours).padStart(2, '0')}:${String(subscriptionCountdown!.minutes).padStart(2, '0')}`
                        }
                      </Link>
                      )}
                    </div>
                  )}
                  {!creditsLoading && orgId && (
                    <span className={`md:hidden inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      actionBalance <= 0 || minuteBalance <= 0
                        ? 'bg-red-100 text-red-700'
                        : actionBalance < 200 || minuteBalance < 50
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {actionBalance} · {minuteBalance}m
                    </span>
                  )}

                  {/* Dark Mode Toggle */}
                  <button
                    onClick={toggleDarkMode}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                    title={darkMode ? 'Modo claro' : 'Modo escuro'}
                  >
                    {darkMode ? (
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </button>

                  {/* Notification Bell */}
                  <NotificationBell />

                  {/* Partner View Switcher */}
                  <PartnerViewSwitcher />

                  {/* "Ver como" — visível somente para administradores */}
                  {isAdmin && orgMembers.length > 0 && (
                    <div className="relative" ref={impersonateMenuRef}>
                      <ImpersonateButton
                        onClick={() => setImpersonateMenuOpen(!impersonateMenuOpen)}
                        isOpen={impersonateMenuOpen}
                      />
                      {impersonateMenuOpen && (
                        <ImpersonateDropdown
                          members={orgMembers}
                          currentUserEmail={userEmail}
                          orgPlan={orgPlan}
                          onClose={() => setImpersonateMenuOpen(false)}
                        />
                      )}
                    </div>
                  )}

                  <span className="hidden md:inline text-sm text-slate-500 dark:text-slate-400">{formatDateTime(currentTime)}</span>
                  <div className="relative" ref={userMenuRef}>
                    <button
                      onClick={() => setUserMenuOpen(!userMenuOpen)}
                      className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 dark:bg-white/10 transition-colors"
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
                      <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-navy-mid rounded-xl shadow-lg border border-slate-200 dark:border-primary-900 py-2 z-50 animate-scale-in">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-primary-900">
                          <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{userEmail}</p>
                          {orgName && (
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{orgName}</p>
                          )}
                        </div>
                        <div className="py-1">
                          <Link
                            href="/perfil"
                            onClick={() => setUserMenuOpen(false)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-white/5 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Meu Perfil
                          </Link>
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
            <div className="flex-1 overflow-y-auto dark:bg-[#0F0A2E]">
                <FreePlanExpiredGate>
                  <PageAccessGuard>
                    {children}
                  </PageAccessGuard>
                </FreePlanExpiredGate>
            </div>
          </main>
        </div>
        </div>
        </CrmUserProvider>
        </PartnerViewProvider>
        </ImpersonationProvider>
        <Toaster />
        <CookieConsent />
      </body>
    </html>
  )
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Gerente',
  seller: 'Vendedor',
  viewer: 'Visualizador',
}

function ImpersonateButton({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) {
  const { isImpersonating } = useImpersonation()
  return (
    <button
      onClick={onClick}
      className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        isImpersonating
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
      }`}
      title="Ver como outro usuário"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      {isImpersonating ? 'Visualizando como...' : 'Ver como'}
      <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

function ImpersonateDropdown({
  members,
  currentUserEmail,
  orgPlan,
  onClose,
}: {
  members: OrgMember[]
  currentUserEmail: string | null
  orgPlan: PlanId | null
  onClose: () => void
}) {
  const { startImpersonation, stopImpersonation, isImpersonating, impersonatedMember } = useImpersonation()
  const [search, setSearch] = useState('')

  const planLabel = orgPlan ? PLAN_DISPLAY[orgPlan]?.displayName || orgPlan : 'Sem plano'

  const filteredMembers = members.filter(m => {
    if (!search) return true
    const term = search.toLowerCase()
    return m.displayName.toLowerCase().includes(term) || m.email.toLowerCase().includes(term)
  })

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-surface-dark rounded-xl shadow-lg border border-slate-200 dark:border-white/10 py-2 z-50 animate-scale-in">
      <div className="px-4 py-2 border-b border-slate-100">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ver como usuário</p>
        <p className="text-[11px] text-slate-400 mt-0.5">Plano: {planLabel}</p>
      </div>

      {isImpersonating && (
        <button
          onClick={() => {
            stopImpersonation()
            onClose()
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors border-b border-slate-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Voltar para minha conta
        </button>
      )}

      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Buscar usuário..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {filteredMembers.map((m) => {
          const isCurrentUser = m.email === currentUserEmail
          const isImpersonated = impersonatedMember?.id === m.id
          return (
            <button
              key={m.id}
              onClick={() => {
                if (isCurrentUser) {
                  stopImpersonation()
                } else {
                  startImpersonation(m)
                }
                onClose()
              }}
              disabled={isImpersonated}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isImpersonated
                  ? 'bg-primary-50 text-primary-700'
                  : 'hover:bg-slate-50 dark:bg-white/5 text-slate-700'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {m.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.displayName}
                  {isCurrentUser && <span className="text-xs text-slate-400 ml-1">(você)</span>}
                </p>
                <p className="text-xs text-slate-400 truncate">{m.email}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                m.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                m.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                m.role === 'seller' ? 'bg-green-100 text-green-700' :
                'bg-slate-100 dark:bg-white/10 text-slate-600'
              }`}>
                {ROLE_LABELS[m.role] || m.role}
              </span>
            </button>
          )
        })}
        {filteredMembers.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">Nenhum usuário encontrado</p>
        )}
      </div>
    </div>
  )
}

function ImpersonationBanner({ orgPlan }: { orgPlan: PlanId | null }) {
  const { isImpersonating, impersonatedMember, stopImpersonation } = useImpersonation()
  if (!isImpersonating || !impersonatedMember) return null

  const planLabel = orgPlan ? PLAN_DISPLAY[orgPlan]?.displayName || orgPlan : ''

  return (
    <div className="bg-amber-500 text-white px-4 py-1.5 text-center text-sm font-medium shadow-md z-[60]">
      <div className="flex items-center justify-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>
          Visualizando como <strong>{impersonatedMember.displayName}</strong>
          {' '}({ROLE_LABELS[impersonatedMember.role] || impersonatedMember.role})
          {planLabel && <> &middot; Plano: {planLabel}</>}
        </span>
        <button
          onClick={stopImpersonation}
          className="ml-3 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold transition-colors"
        >
          Sair
        </button>
      </div>
    </div>
  )
}

function PartnerViewSwitcherMobile() {
  const { activeView, hasMultipleViews, switchView } = usePartnerView()

  if (!hasMultipleViews) return null

  const isPartnerView = activeView === 'partner'

  return (
    <button
      onClick={() => switchView(isPartnerView ? 'personal' : 'partner')}
      className={`md:hidden flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
        isPartnerView
          ? 'bg-indigo-100 text-indigo-700'
          : 'bg-slate-100 dark:bg-white/10 text-slate-600'
      }`}
    >
      {isPartnerView ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )}
      {isPartnerView ? 'Parceiro' : 'Pessoal'}
    </button>
  )
}

function PartnerViewSwitcher() {
  const { activeView, hasMultipleViews, personalMembership, partnerMembership, switchView } = usePartnerView()

  if (!hasMultipleViews) return null

  const isPartnerView = activeView === 'partner'

  return (
    <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-white/10 rounded-lg p-0.5">
      <button
        onClick={() => switchView('personal')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          !isPartnerView
            ? 'bg-white dark:bg-surface-dark text-primary-700 shadow-sm'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-300'
        }`}
        title={`Conta pessoal${personalMembership ? ` — ${personalMembership.orgName}` : ''}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        Pessoal
      </button>
      <button
        onClick={() => switchView('partner')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          isPartnerView
            ? 'bg-white dark:bg-surface-dark text-indigo-700 shadow-sm'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-300'
        }`}
        title={`Conta parceiro${partnerMembership ? ` — ${partnerMembership.orgName}` : ''}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Parceiro
      </button>
    </div>
  )
}

function PartnerViewBanner() {
  const { activeView, hasMultipleViews, partnerMembership, switchView } = usePartnerView()

  if (!hasMultipleViews || activeView !== 'partner' || !partnerMembership) return null

  return (
    <div className="bg-indigo-500 text-white px-4 py-1.5 text-center text-sm font-medium shadow-md z-[60]">
      <div className="flex items-center justify-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span>
          Visualizando como <strong>Parceiro</strong> em <strong>{partnerMembership.orgName}</strong>
        </span>
        <button
          onClick={() => switchView('personal')}
          className="ml-3 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold transition-colors"
        >
          Voltar para conta pessoal
        </button>
      </div>
    </div>
  )
}
