export interface Organization {
  id: string
  name: string
  slug: string // unique, URL-friendly
  plan: 'basic' | 'standard' | 'pro'
  adminEmail?: string
  logoUrl?: string
  settings: OrgSettings
  limits: OrgLimits
  status: 'active' | 'suspended' | 'trial'
  createdAt: string
  updatedAt: string
}

export interface OrgSettings {
  defaultFunnelId?: string
  timezone: string // e.g., 'America/Sao_Paulo'
  currency: string // e.g., 'BRL'
}

export interface OrgLimits {
  maxUsers: number
  maxFunnels: number
  maxContacts: number
}

export interface OrgMember {
  id: string
  userId: string
  email: string
  role: 'admin' | 'manager' | 'seller' | 'viewer'
  displayName: string
  photoUrl?: string
  permissions: MemberPermissions
  status: 'active' | 'invited' | 'suspended'
  joinedAt: string
  invitedBy?: string
  funnelAccess?: FunnelAccessConfig[]
}

export interface MemberPermissions {
  pages: string[] // allowed routes e.g. ['/contatos', '/funil', '/admin/usuarios']
  actions: MemberActions
  viewScope: 'own' | 'team' | 'all'
}

export interface MemberActions {
  canCreateContacts: boolean
  canEditContacts: boolean
  canDeleteContacts: boolean
  canCreateProposals: boolean
  canExportData: boolean
  canManageFunnels: boolean
  canManageUsers: boolean
  canTriggerCalls: boolean
  canViewReports: boolean
  canManageSettings: boolean
  canTransferLeads: boolean
}

export interface FunnelAccessConfig {
  funnelId: string
  allStages: boolean
  stageIds?: string[]
}
