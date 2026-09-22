import { contentDigest, isRecord, requireRecord, requireStringArray, requireText, stableJson } from './canonical.js'

export const DOMAIN_TRIGGER_CONSENT_SCHEMA = 'sophia.domain-trigger-consent.v1' as const

export interface DomainTriggerConsent {
  readonly schema: typeof DOMAIN_TRIGGER_CONSENT_SCHEMA
  readonly consentId: string
  readonly subjectAgentId: string
  readonly issuedBy: string
  readonly authorityGraphId: string
  readonly adapter: string
  readonly triggerKinds: readonly string[]
  readonly sourcePrefixes: readonly string[]
  readonly issuedAt: number
  readonly notBefore?: number
  readonly expiresAt?: number
  readonly status: 'active' | 'suspended' | 'revoked' | 'expired'
  readonly maxContextRefs: number
  readonly maxContextBytes: number
  readonly retention: 'ephemeral' | 'graph-referenced'
  readonly sourceRefs: readonly string[]
}

export function buildDomainTriggerConsent(
  input: Omit<DomainTriggerConsent, 'schema' | 'consentId'> & { readonly consentId?: string },
): DomainTriggerConsent {
  const seed = { ...input, consentId: undefined }
  return parseDomainTriggerConsent({
    ...input,
    schema: DOMAIN_TRIGGER_CONSENT_SCHEMA,
    consentId: input.consentId ?? `consent_${contentDigest(seed).slice(0, 24)}`,
  })
}

export function parseDomainTriggerConsent(value: unknown): DomainTriggerConsent {
  const input = requireRecord(value, 'trigger consent')
  if (input.schema !== DOMAIN_TRIGGER_CONSENT_SCHEMA) {
    throw new Error(`expected trigger consent schema '${DOMAIN_TRIGGER_CONSENT_SCHEMA}'`)
  }
  for (const field of ['consentId', 'subjectAgentId', 'issuedBy', 'authorityGraphId', 'adapter'] as const) {
    requireText(input[field], `trigger consent ${field}`)
  }
  const triggerKinds = unique(requireStringArray(input.triggerKinds, 'trigger consent triggerKinds', false), 'trigger kind')
  const sourcePrefixes = unique(
    requireStringArray(input.sourcePrefixes, 'trigger consent sourcePrefixes', false),
    'source prefix',
  )
  for (const field of ['issuedAt', 'notBefore', 'expiresAt'] as const) {
    if (input[field] !== undefined && !Number.isFinite(input[field])) {
      throw new Error(`trigger consent ${field} must be finite epoch milliseconds`)
    }
  }
  if (!['active', 'suspended', 'revoked', 'expired'].includes(String(input.status))) {
    throw new Error('trigger consent status is unsupported')
  }
  boundedInteger(input.maxContextRefs, 'trigger consent maxContextRefs', 0, 10_000)
  boundedInteger(input.maxContextBytes, 'trigger consent maxContextBytes', 0, 16_777_216)
  if (input.retention !== 'ephemeral' && input.retention !== 'graph-referenced') {
    throw new Error('trigger consent retention is unsupported')
  }
  requireStringArray(input.sourceRefs, 'trigger consent sourceRefs')
  if (input.policy !== undefined && !isRecord(input.policy)) throw new Error('trigger consent policy must be an object')
  return { ...input, triggerKinds, sourcePrefixes } as unknown as DomainTriggerConsent
}

export function domainTriggerConsentDigest(consent: DomainTriggerConsent): string {
  return contentDigest(parseDomainTriggerConsent(consent))
}

export function domainTriggerConsentDocument(consent: DomainTriggerConsent): string {
  return `${stableJson(parseDomainTriggerConsent(consent))}\n`
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
}

function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`)
  return values
}
