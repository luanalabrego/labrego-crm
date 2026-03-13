import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/** Rotas que devem continuar funcionando sem auth */
const BYPASS_PATHS = [
  '/api/vapi/webhook',
  '/api/meta/webhooks',
  '/api/n8n/',
  '/api/health',
  '/login',
  '/reset-password',
]

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const accept = request.headers.get('accept') || ''

  // bypass por rotas críticas (webhooks/health/login)
  if (BYPASS_PATHS.some(p => path.startsWith(p))) {
    return NextResponse.next()
  }

  // Admin route permissions are now handled at the page level
  // via usePermissions() hook and PermissionGate component
  // from the SaaS multi-tenant system (organizations/members)

  const res = NextResponse.next()

  // Security headers
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-DNS-Prefetch-Control', 'off')

  // evita cache para HTML e APIs
  if (path.startsWith('/api') || accept.includes('text/html')) {
    res.headers.set('Cache-Control', 'no-store')
  }

  return res
}

export const config = {
  matcher: [
    '/((?!_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|js|css|map|json|txt|woff2?|ttf)).*)',
  ],
}
