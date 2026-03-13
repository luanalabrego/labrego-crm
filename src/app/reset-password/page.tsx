'use client'

import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebaseClient'
import { toast } from 'sonner'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)

    try {
      await sendPasswordResetEmail(auth, email.trim())
      setSent(true)
      toast.success('E-mail de recuperação enviado! Verifique sua caixa de entrada.')
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
      setLoading(false)
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

      {/* Right side — Reset password form */}
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
                Recuperar senha
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {sent
                  ? 'Verifique sua caixa de entrada e siga as instruções do e-mail'
                  : 'Digite seu e-mail para receber o link de recuperação'}
              </p>
            </div>

            {!sent ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="reset-email" className="block text-sm font-medium text-slate-300 mb-2">
                    E-mail
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#13DEFC]/40 focus:border-[#13DEFC]/40 transition-all"
                    placeholder="seu@email.com"
                    autoFocus
                  />
                </div>

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
                      Enviando...
                    </span>
                  ) : (
                    'Enviar link de recuperação'
                  )}
                </button>

                <Link
                  href="/login"
                  className="block w-full text-center text-sm text-slate-400 hover:text-white font-medium py-2 transition-colors"
                >
                  Voltar ao login
                </Link>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-[#09B00F]/10 border border-[#09B00F]/20 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#09B00F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                </div>

                <p className="text-sm text-slate-300 text-center">
                  Enviamos um link de recuperação para <span className="text-white font-medium">{email}</span>. Caso não encontre, verifique a pasta de spam.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setSent(false)
                    setEmail('')
                  }}
                  className="w-full bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] text-white font-medium py-3.5 rounded-xl transition-all"
                >
                  Enviar novamente
                </button>

                <Link
                  href="/login"
                  className="block w-full text-center text-sm text-slate-400 hover:text-white font-medium py-2 transition-colors"
                >
                  Voltar ao login
                </Link>
              </div>
            )}
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
