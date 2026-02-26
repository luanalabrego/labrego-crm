'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebaseClient'
import { toast } from 'sonner'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
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

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#0a0f1e] p-4 overflow-hidden">
      {/* Animated grid background */}
      <div className="login-grid-bg animate-grid-move absolute inset-0 opacity-60" aria-hidden="true" />

      {/* Radial glow accent */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full animate-glow-pulse pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(19,222,252,0.08) 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      {/* Glassmorphism card */}
      <div className="relative z-10 w-full max-w-md backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-4xl font-bold bg-gradient-to-r from-[#13DEFC] to-[#09B00F] bg-clip-text text-transparent animate-gradient-shift mb-2">
            Voxium
          </h2>
          <h1 className="text-xl font-semibold text-white/90">Entrar</h1>
          <p className="text-sm text-white/50 mt-1">Acesse sua conta para continuar</p>
        </div>

        {!showReset ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-1">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#13DEFC] focus:ring-2 focus:ring-[#13DEFC]/20 focus:shadow-[0_0_15px_rgba(19,222,252,0.15)] transition-all"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-white/70">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setShowReset(true)
                    setResetEmail(email)
                  }}
                  className="text-xs text-[#13DEFC]/70 hover:text-[#13DEFC] font-medium transition-colors"
                >
                  Esqueci minha senha
                </button>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#13DEFC] focus:ring-2 focus:ring-[#13DEFC]/20 focus:shadow-[0_0_15px_rgba(19,222,252,0.15)] transition-all"
                placeholder="Sua senha"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#13DEFC] to-[#09B00F] hover:shadow-[0_0_20px_rgba(19,222,252,0.4)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-sm"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-sm text-white/60">
              Digite seu e-mail e enviaremos um link para redefinir sua senha.
            </p>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-white/70 mb-1">
                E-mail
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#13DEFC] focus:ring-2 focus:ring-[#13DEFC]/20 focus:shadow-[0_0_15px_rgba(19,222,252,0.15)] transition-all"
                placeholder="seu@email.com"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={resetLoading}
              className="w-full bg-gradient-to-r from-[#13DEFC] to-[#09B00F] hover:shadow-[0_0_20px_rgba(19,222,252,0.4)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-sm"
            >
              {resetLoading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>

            <button
              type="button"
              onClick={() => setShowReset(false)}
              className="w-full text-sm text-white/50 hover:text-white/80 font-medium py-2 transition-colors"
            >
              Voltar ao login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
