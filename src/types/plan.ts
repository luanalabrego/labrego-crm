export type PlanCategory = 'agency' | 'direct'

export type PlanId =
  | 'agency_start' | 'agency_pro' | 'agency_scale'
  | 'direct_starter' | 'direct_growth' | 'direct_scale'

export type FeatureKey =
  | 'funnel'
  | 'contacts'
  | 'proposals'
  | 'cadence'
  | 'productivity'
  | 'whatsapp_plugin'
  | 'email_automation'
  | 'crm_automation'
  | 'voice_agent'
  | 'whatsapp_agent'
  | 'ai_reports'

export interface Plan {
  id: PlanId
  displayName: string
  price: number // BRL per month
  category: PlanCategory
  features: FeatureKey[]
  limits: PlanLimits
  overage: OveragePricing
  order: number // display order
}

export interface PlanLimits {
  maxUsers: number
  maxFunnels: number
  maxContacts: number
  monthlyActions: number      // ligações + whatsapp messages
  monthlyMinutes: number      // minutos falados
  maxConcurrentAgents: number // agentes simultâneos
  maxNumbers: number          // números dedicados
  maxCadences: number         // -1 = ilimitado
  monthlyCredits: number      // deprecated: use monthlyMinutes
}

export interface OveragePricing {
  perAction: number  // BRL por ação adicional
  perMinute: number  // BRL por minuto adicional
}

const ALL_FEATURES: FeatureKey[] = [
  'funnel', 'contacts', 'proposals', 'cadence', 'productivity',
  'whatsapp_plugin', 'email_automation', 'crm_automation',
  'voice_agent', 'whatsapp_agent', 'ai_reports',
]

export const PLAN_FEATURES: Record<PlanId, FeatureKey[]> = {
  agency_start: ALL_FEATURES,
  agency_pro: ALL_FEATURES,
  agency_scale: ALL_FEATURES,
  direct_starter: ALL_FEATURES,
  direct_growth: ALL_FEATURES,
  direct_scale: ALL_FEATURES,
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  agency_start:   { maxUsers: 5,  maxFunnels: 1,  maxContacts: 2000,  monthlyActions: 2000,  monthlyMinutes: 450,  maxConcurrentAgents: 3,  maxNumbers: 1, maxCadences: 1,  monthlyCredits: 450 },
  agency_pro:     { maxUsers: 10, maxFunnels: 2,  maxContacts: 5000,  monthlyActions: 4000,  monthlyMinutes: 900,  maxConcurrentAgents: 6,  maxNumbers: 2, maxCadences: -1, monthlyCredits: 900 },
  agency_scale:   { maxUsers: 15, maxFunnels: 3,  maxContacts: 10000, monthlyActions: 6000,  monthlyMinutes: 1350, maxConcurrentAgents: 9,  maxNumbers: 3, maxCadences: -1, monthlyCredits: 1350 },
  direct_starter: { maxUsers: 5,  maxFunnels: 2,  maxContacts: 3000,  monthlyActions: 2000,  monthlyMinutes: 450,  maxConcurrentAgents: 3,  maxNumbers: 1, maxCadences: 1,  monthlyCredits: 450 },
  direct_growth:  { maxUsers: 15, maxFunnels: 5,  maxContacts: 10000, monthlyActions: 4000,  monthlyMinutes: 900,  maxConcurrentAgents: 6,  maxNumbers: 2, maxCadences: -1, monthlyCredits: 900 },
  direct_scale:   { maxUsers: 50, maxFunnels: 10, maxContacts: 30000, monthlyActions: 7000,  monthlyMinutes: 1600, maxConcurrentAgents: 10, maxNumbers: 3, maxCadences: -1, monthlyCredits: 1600 },
}

export const PLAN_OVERAGE: Record<PlanId, OveragePricing> = {
  agency_start:   { perAction: 0.89, perMinute: 1.69 },
  agency_pro:     { perAction: 0.89, perMinute: 1.69 },
  agency_scale:   { perAction: 0.89, perMinute: 1.69 },
  direct_starter: { perAction: 0.99, perMinute: 1.89 },
  direct_growth:  { perAction: 0.99, perMinute: 1.89 },
  direct_scale:   { perAction: 0.99, perMinute: 1.89 },
}

export const PLAN_DISPLAY: Record<PlanId, { displayName: string; price: number; category: PlanCategory }> = {
  agency_start:   { displayName: 'Agency Start',   price: 1499.90, category: 'agency' },
  agency_pro:     { displayName: 'Agency Pro',      price: 2849.80, category: 'agency' },
  agency_scale:   { displayName: 'Agency Scale',    price: 4149.70, category: 'agency' },
  direct_starter: { displayName: 'Starter',         price: 2997,    category: 'direct' },
  direct_growth:  { displayName: 'Growth',           price: 4497,    category: 'direct' },
  direct_scale:   { displayName: 'Scale',            price: 6997,    category: 'direct' },
}

export const PLAN_CATEGORY: Record<PlanId, PlanCategory> = {
  agency_start: 'agency',
  agency_pro: 'agency',
  agency_scale: 'agency',
  direct_starter: 'direct',
  direct_growth: 'direct',
  direct_scale: 'direct',
}

// Map features to human-readable labels
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  funnel: 'Funil de vendas',
  contacts: 'Dados detalhados dos clientes',
  proposals: 'Geracao de propostas comerciais',
  cadence: 'Estrategia comercial',
  productivity: 'Gestao de produtividade',
  whatsapp_plugin: 'Plugin e Conexao com WhatsApp',
  email_automation: 'Envio automatico de e-mails',
  crm_automation: 'Automacao de CRM e nutricao de leads',
  voice_agent: 'Agente de prospeccao ativa por voz',
  whatsapp_agent: 'Agente de prospeccao ativa por WhatsApp',
  ai_reports: 'Relatorios da IA',
}
