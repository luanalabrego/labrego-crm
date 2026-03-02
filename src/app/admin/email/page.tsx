'use client'

import PermissionGate from '@/components/PermissionGate'
import EmailProviderSection from '@/components/EmailProviderSection'

export default function EmailConfigPage() {
  return (
    <PermissionGate action="canManageSettings">
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Configuracao de Email</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure o provedor de envio de emails da sua organizacao.
          </p>
        </div>
        <EmailProviderSection defaultExpanded />
      </div>
    </PermissionGate>
  )
}
