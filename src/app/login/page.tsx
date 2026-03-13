'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebaseClient'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await signInWithEmailAndPassword(auth, email, password)
      router.replace('/contatos')
    } catch (err: any) {
      const code = err?.code || ''
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('E-mail ou senha incorretos.')
      } else if (code === 'auth/too-many-requests') {
        setError('Muitas tentativas. Tente novamente em alguns minutos.')
      } else {
        setError('Erro ao fazer login. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setResetLoading(true)

    try {
      await sendPasswordResetEmail(auth, resetEmail.trim())
      toast.success('E-mail de recuperação enviado! Verifique sua caixa de entrada.')
      setShowReset(false)
      setResetEmail('')
    } catch (err: any) {
      const code = err?.code || ''
      if (code === 'auth/user-not-found') {
        toast.error('Nenhuma conta encontrada com esse e-mail.')
      } else if (code === 'auth/too-many-requests') {
        toast.error('Muitas tentativas. Aguarde alguns minutos.')
      } else {
        toast.error('Erro ao enviar e-mail. Tente novamente.')
      }
    } finally {
      setResetLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError(null)
    setGoogleLoading(true)

    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
      router.replace('/contatos')
    } catch (err: any) {
      const code = err?.code || ''
      if (code === 'auth/popup-closed-by-user') {
        // Usuário fechou o popup, não mostra erro
      } else if (code === 'auth/account-exists-with-different-credential') {
        setError('Já existe uma conta com esse e-mail usando outro método de login.')
      } else if (code === 'auth/popup-blocked') {
        setError('O popup foi bloqueado pelo navegador. Permita popups e tente novamente.')
      } else {
        setError('Erro ao fazer login com Google. Tente novamente.')
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-950 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(19,222,252,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(19,222,252,0.3) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Glow orbs */}
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#13DEFC]/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#09B00F]/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#13DEFC]/5 rounded-full blur-[160px]" />
      </div>

      {/* Left side — Hero/Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center relative px-16">
        <div className="max-w-md space-y-8">
          {/* Logo */}
          <div>
            <h1 className="text-6xl font-black bg-gradient-to-r from-[#13DEFC] to-[#09B00F] bg-clip-text text-transparent tracking-tight">
              Voxium
            </h1>
            <div className="h-1 w-20 bg-gradient-to-r from-[#13DEFC] to-[#09B00F] rounded-full mt-4" />
          </div>

          {/* Tagline */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-white/90 leading-relaxed">
              Acelere suas vendas com inteligência artificial
            </h2>
            <p className="text-base text-slate-400 leading-relaxed">
              CRM inteligente com agentes de voz IA, automação de cadências e gestão completa do seu funil de vendas.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="space-y-4 pt-4">
            {[
              { icon: '🎯', text: 'Funis de vendas inteligentes' },
              { icon: '🤖', text: 'Agentes de voz com IA' },
              { icon: '⚡', text: 'Automação de cadências' },
              { icon: '📊', text: 'Analytics em tempo real' },
            ].map((feature) => (
              <div key={feature.text} className="flex items-center gap-3">
                <span className="text-lg">{feature.icon}</span>
                <span className="text-sm text-slate-300">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side — Login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 relative">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-10">
            <h1 className="text-4xl font-black bg-gradient-to-r from-[#13DEFC] to-[#09B00F] bg-clip-text text-transparent tracking-tight">
              Voxium
            </h1>
            <p className="text-sm text-slate-400 mt-2">Acelere suas vendas com IA</p>
          </div>

          {/* Glass card */}
          <div className="backdrop-blur-xl bg-white/[0.04] border border-white/[0.08] rounded-3xl p-8 shadow-[0_0_60px_rgba(19,222,252,0.06)]">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white">
                Bem-vindo de volta
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Entre na sua conta para continuar
              </p>
            </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/40 focus:border-[#13DEFC]/40 transition-all"
                    placeholder="seu@email.com"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                      Senha
                    </label>
                    <Link
                      href="/reset-password"
                      className="text-xs text-[#13DEFC]/80 hover:text-[#13DEFC] font-medium transition-colors"
                    >
                      Esqueci minha senha
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 pr-11 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/40 focus:border-[#13DEFC]/40 transition-all"
                      placeholder="Sua senha"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#13DEFC] to-[#09B00F] hover:from-[#11c8e3] hover:to-[#089e0d] disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-[#13DEFC]/10 hover:shadow-[#13DEFC]/20"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Entrando...
                    </span>
                  ) : (
                    'Entrar'
                  )}
                </button>

                {/* Separador */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-slate-500">ou</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Botão Login com Google */}
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={googleLoading}
                  className="w-full flex items-center justify-center gap-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-xl transition-all"
                >
                  {googleLoading ? (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                    </svg>
                  )}
                  Entrar com Google
                </button>
              </form>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-slate-600 mt-8">
            &copy; {new Date().getFullYear()} Voxium. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}
