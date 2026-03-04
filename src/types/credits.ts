export interface CreditBalance {
  // Minutes
  balance: number // minutes remaining
  totalPurchased: number
  totalConsumed: number
  lastRechargeAt?: string
  lastConsumedAt?: string
  // Actions (calls + whatsapp messages)
  actionBalance: number
  actionTotalPurchased: number
  actionTotalConsumed: number
  lastActionConsumedAt?: string
}

export interface CreditTransaction {
  id: string
  orgId: string
  type: 'purchase' | 'consumption' | 'adjustment' | 'bonus'
  creditType: 'minutes' | 'actions'
  amount: number // positive for addition, negative for consumption
  balance: number // balance after transaction
  description: string
  callId?: string // for consumption type
  adminEmail?: string // who performed the action
  createdAt: string
}
