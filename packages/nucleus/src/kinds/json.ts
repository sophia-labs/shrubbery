export type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    const record = asRecord(current)
    if (!(key in record)) return undefined
    current = record[key]
  }
  return current
}

export function stringAt(value: unknown, path: readonly string[]): string | null {
  const field = valueAt(value, path)
  if (typeof field === 'string') return field
  if (typeof field === 'number' || typeof field === 'boolean') return String(field)
  return null
}

export function numberAt(value: unknown, path: readonly string[]): number | null {
  const field = valueAt(value, path)
  if (typeof field === 'number' && Number.isFinite(field)) return field
  if (typeof field === 'string') {
    const parsed = Number(field.trim())
    if (Number.isFinite(parsed)) return parsed
    const date = Date.parse(field)
    if (Number.isFinite(date)) return date
  }
  return null
}

export function arrayAt<T = unknown>(value: unknown, path: readonly string[]): T[] {
  const field = valueAt(value, path)
  return Array.isArray(field) ? (field as T[]) : []
}

export function firstNonBlankString(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}
