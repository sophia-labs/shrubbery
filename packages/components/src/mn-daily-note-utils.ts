const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateKey(dateKey: string): Date | null {
  const match = DATE_KEY_RE.exec(dateKey)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

export function toDateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  if (!date) return dateKey
  return toDateKey(addDays(date, days))
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

export function daysInMonthGrid(displayedMonth: Date, weekStart: 0 | 1 = 1): Date[] {
  const first = startOfMonth(displayedMonth)
  const offset = (first.getUTCDay() - weekStart + 7) % 7
  const gridStart = addDays(first, -offset)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - timestamp)
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 45) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 90) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 36) return `${hours} hr ago`

  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 10) return `${weeks} wk ago`

  const months = Math.floor(days / 30)
  if (months < 18) return `${months} mo ago`

  const years = Math.floor(days / 365)
  return `${Math.max(1, years)} yr ago`
}
