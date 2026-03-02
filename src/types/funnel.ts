export interface Funnel {
  id: string
  orgId: string
  name: string
  description?: string
  color: string // hex color
  isDefault: boolean
  order: number
  visibleTo: string[] // member IDs, empty = all
  createdAt: string
  updatedAt: string
}

export interface FunnelColumn {
  id: string
  funnelId: string
  name: string
  order: number
  color?: string
  probability?: number // 0-100
  maxDays?: number
  countsForMetrics: boolean
  conversionType?: 'positive' | 'negative' | 'neutral' | 'final_conversion'
  macroStageId?: string
  isProspectionStage?: boolean
}
