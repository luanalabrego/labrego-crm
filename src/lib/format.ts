type TimestampLike = {
  seconds?: number
  nanoseconds?: number
  toDate?: () => Date
}

type DateInput = string | number | Date | null | undefined | TimestampLike

function parseTimestamp(val: TimestampLike | null | undefined): Date | null {
  if (!val || typeof val !== 'object') return null
  if (typeof val.toDate === 'function') {
    const result = val.toDate()
    if (result instanceof Date) return result
    return new Date(result as unknown as string)
  }
  if (typeof val.seconds === 'number') {
    const seconds = Number(val.seconds) * 1000
    const nanos = typeof val.nanoseconds === 'number' ? Number(val.nanoseconds) / 1e6 : 0
    return new Date(seconds + nanos)
  }
  return null
}

function parseDate(val: DateInput): Date {
  if (val == null) return new Date(NaN)
  if (val instanceof Date) return val
  const timestamp = parseTimestamp(val as TimestampLike)
  if (timestamp) return timestamp
  if (typeof val === 'number' || /^\d+$/.test(String(val))) {
    const num = typeof val === 'number' ? val : parseInt(String(val), 10)
    // Interpret numeric values as Excel serial dates when in a reasonable range
    if (num > 59 && num < 2958465) {
      const base = new Date(Date.UTC(1899, 11, 30))
      base.setUTCDate(base.getUTCDate() + num)
      return base
    }
    return new Date(num)
  }
  if (!val) return new Date(NaN)
  // When the input is in the form YYYY-MM-DD, Date() assumes UTC which may
  // shift the date back depending on the timezone. Explicitly parse as local
  // time to preserve the provided day.
  return String(val).match(/^\d{4}-\d{2}-\d{2}$/)
    ? new Date(`${val}T00:00:00`)
    : new Date(String(val))
}

export function formatDate(date?: DateInput | null): string {
  if (date == null) return ''

  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export function formatDateTime(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function formatMonth(month: string): string {
  if (!month) return ''
  const [year, m] = month.split('-')
  if (!year || !m) return month
  return `${m.padStart(2, '0')}/${year}`
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return ''
  let numericValue: number
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9,.-]/g, '')
    if (!cleaned) return ''
    const commaIndex = cleaned.lastIndexOf(',')
    const dotIndex = cleaned.lastIndexOf('.')
    const normalized =
      commaIndex > dotIndex
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
    numericValue = Number(normalized)
  } else {
    numericValue = value
  }
  if (!isFinite(numericValue)) return ''
  return numericValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatDuration(hours: number): string {
  if (!isFinite(hours)) return ''
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h`
}

/**
 * Formata horas decimais como "Xh Ymin"
 * Exemplos: 55.1 → "55h 6min", 0.3 → "18min", 43 → "43h", 0 → "0h"
 */
export function formatHoursWithMinutes(hours: number): string {
  if (!isFinite(hours)) return ''
  const totalMinutes = Math.round(Math.abs(hours) * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const sign = hours < 0 ? '-' : ''
  if (h === 0 && m === 0) return '0h'
  if (h === 0) return `${sign}${m}min`
  if (m === 0) return `${sign}${h}h`
  return `${sign}${h}h ${m}min`
}

export function formatDurationMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

export function formatDurationClock(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '00:00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function formatContractContent(text: string): string {
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  if (!result.includes('<')) {
    result = result.replace(/(?:\r\n|\r|\n)/g, '<br/>')
  }
  return result
}

/**
 * Aplica máscara de telefone brasileiro: (00) 00000-0000 ou (00) 0000-0000
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits.length ? `(${digits}` : ''
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/**
 * Aplica máscara de CPF: 000.000.000-00
 */
export function maskCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/**
 * Aplica máscara de CNPJ: 00.000.000/0000-00
 */
export function maskCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  if (digits.length <= 2) return digits
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

/**
 * Aplica máscara de CPF ou CNPJ automaticamente baseado no número de dígitos
 */
export function maskDocument(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) return maskCPF(value)
  return maskCNPJ(value)
}

/**
 * Formata um número de telefone para uso em links do WhatsApp (wa.me).
 * Se o número original já contém '+' (indicando código de país), usa o número como está.
 * Caso contrário, assume que é um número brasileiro e adiciona o código 55.
 */
export function formatWhatsAppNumber(phone: string): string {
  if (!phone) return ''

  const hasCountryCode = phone.trim().startsWith('+')
  const digits = phone.replace(/\D/g, '')

  if (!digits) return ''

  // Se o número original já tinha '+', já possui código de país
  if (hasCountryCode) {
    return digits
  }

  // Caso contrário, assume Brasil (55)
  return `55${digits}`
}

const BRAZIL_TIMEZONE = 'America/Sao_Paulo'

/**
 * Formata data no timezone de São Paulo para uso em nomes de arquivo
 * Formato: "yyyy-MM-dd"
 */
export function formatDateISO(date?: DateInput | null): string {
  if (date == null) return ''

  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const year = d.toLocaleString('en-CA', { timeZone: BRAZIL_TIMEZONE, year: 'numeric' })
  const month = d.toLocaleString('en-CA', { timeZone: BRAZIL_TIMEZONE, month: '2-digit' })
  const day = d.toLocaleString('en-CA', { timeZone: BRAZIL_TIMEZONE, day: '2-digit' })

  return `${year}-${month}-${day}`
}

/**
 * Formata dia da semana com data por extenso no timezone de São Paulo
 * Formato: "terça-feira, 31 de janeiro"
 */
export function formatWeekdayLong(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  })
}

/**
 * Formata apenas o dia da semana abreviado no timezone de São Paulo
 * Formato: "seg", "ter", "qua", etc.
 */
export function formatWeekdayShort(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    weekday: 'short'
  })
}

/**
 * Retorna array com nomes abreviados dos dias da semana
 * Formato: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
 */
export function getWeekdayShortNames(): string[] {
  const baseDate = new Date(2024, 0, 7) // Sunday, January 7, 2024
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(baseDate)
    date.setDate(baseDate.getDate() + i)
    return formatWeekdayShort(date)
  })
}

/**
 * Retorna array com nomes capitalizados dos dias da semana
 * Formato: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
 */
export function getWeekdayShortNamesCapitalized(): string[] {
  return getWeekdayShortNames().map(day =>
    day.charAt(0).toUpperCase() + day.slice(1)
  )
}

/**
 * Formata dia e mês abreviado no timezone de São Paulo
 * Formato: "31 de jan"
 */
export function formatDayMonthShort(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: 'short'
  })
}

/**
 * Formata data curta no timezone de São Paulo
 * Formato: "dd/MM/yy"
 */
export function formatDateShort(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  })
}

/**
 * Formata data por extenso no timezone de São Paulo
 * Formato: "dd de MMMM de yyyy"
 */
export function formatDateLong(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

/**
 * Formata data e hora no timezone de São Paulo
 * Formato: "dd/MM/yyyy às HH:mm"
 */
export function formatDateTimeAt(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const formatted = d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Converte de "31/01/2026, 17:00" para "31/01/2026 às 17:00"
  return formatted.replace(', ', ' às ')
}

/**
 * Formata data e hora no timezone de São Paulo
 * Formato: "dd/MM/yyyy HH:mm"
 */
export function formatDateTimeShort(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const formatted = d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Converte de "31/01/2026, 17:00" para "31/01/2026 17:00"
  return formatted.replace(', ', ' ')
}

/**
 * Formata apenas hora no timezone de São Paulo
 * Formato: "HH:mm"
 */
export function formatTime(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  return d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/**
 * Formata dia/mês e hora no timezone de São Paulo
 * Formato: "dd/MM HH:mm"
 */
export function formatDayMonthTime(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const formatted = d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Converte de "31/01, 17:00" para "31/01 17:00"
  return formatted.replace(', ', ' ')
}

/**
 * Formata data e hora curta no timezone de São Paulo
 * Formato: "dd/MM/yy HH:mm"
 */
export function formatDateTimeShortYear(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const formatted = d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Converte de "31/01/26, 17:00" para "31/01/26 17:00"
  return formatted.replace(', ', ' ')
}

/**
 * Formata data por extenso com hora no timezone de São Paulo
 * Formato: "dd de MMMM de yyyy às HH:mm"
 */
export function formatDateTimeLong(date: DateInput): string {
  const d = parseDate(date)
  if (isNaN(d.getTime())) return ''

  const datePart = d.toLocaleDateString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })

  const timePart = d.toLocaleString('pt-BR', {
    timeZone: BRAZIL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  return `${datePart} às ${timePart}`
}
