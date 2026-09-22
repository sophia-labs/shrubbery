import { createHash } from 'node:crypto'

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function contentDigest(value: unknown): string {
  return sha256(stableJson(value))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

export function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

export function requireStringArray(value: unknown, label: string, emptyAllowed = true): string[] {
  if (!Array.isArray(value) || (!emptyAllowed && value.length === 0) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${label} must be ${emptyAllowed ? 'an' : 'a non-empty'} array of strings`)
  }
  return value
}

export function assertAbsoluteIri(value: string, label: string): void {
  try {
    const parsed = new URL(value)
    if (!parsed.protocol) throw new Error('missing scheme')
  } catch {
    throw new Error(`${label} must be an absolute IRI`)
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}
