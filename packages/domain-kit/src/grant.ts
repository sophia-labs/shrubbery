import { contentDigest, isRecord, requireRecord, requireStringArray, requireText, stableJson } from './canonical.js'

export const AGENT_TOOLBELT_GRANT_SCHEMA = 'sophia.agent-toolbelt-grant.v1' as const
export type EffectApprovalPolicy = 'ordinary' | 'notify' | 'human-always'

export interface DomainGrantFence {
  readonly graphIds?: readonly string[]
  readonly graphIdPrefixes?: readonly string[]
  readonly originPrefixes?: readonly string[]
  readonly branchPrefixes?: readonly string[]
  readonly resourcePrefixes?: readonly string[]
  readonly pathPrefixes?: readonly string[]
  readonly builderRecipeDigests?: readonly string[]
  readonly maxPayloadBytes?: number
  /** Maximum lifetime the host may materialize for an ephemeral scratch cell. */
  readonly maxTtlHours?: number
}

export interface DomainGrantQuota {
  readonly maxPerWave?: number
  readonly maxPerDay?: number
  readonly maxConcurrent?: number
  readonly maxCostMicrousd?: number
}

export interface DomainGrantedCapability {
  readonly capability: string
  readonly operations: readonly string[]
  readonly access: 'read' | 'write'
  readonly approvalPolicy: EffectApprovalPolicy
  readonly operationPolicies?: Readonly<Record<string, EffectApprovalPolicy>>
  readonly fence: DomainGrantFence
  readonly quota: DomainGrantQuota
}

export interface DomainToolbeltGrant {
  readonly schema: typeof AGENT_TOOLBELT_GRANT_SCHEMA
  readonly grantId: string
  readonly subjectAgentId: string
  readonly issuedBy: string
  readonly authorityGraphId: string
  readonly issuedAt: number
  readonly notBefore?: number
  readonly expiresAt?: number
  readonly status: 'active' | 'suspended' | 'revoked' | 'expired'
  readonly capabilities: readonly DomainGrantedCapability[]
  readonly sourceRefs: readonly string[]
}

export function buildDomainToolbeltGrant(
  input: Omit<DomainToolbeltGrant, 'schema' | 'grantId'> & { readonly grantId?: string },
): DomainToolbeltGrant {
  const seed = { ...input, grantId: undefined }
  return parseDomainToolbeltGrant({
    ...input,
    schema: AGENT_TOOLBELT_GRANT_SCHEMA,
    grantId: input.grantId ?? `grant_${contentDigest(seed).slice(0, 24)}`,
  })
}

export function parseDomainToolbeltGrant(value: unknown): DomainToolbeltGrant {
  const input = requireRecord(value, 'toolbelt grant')
  if (input.schema !== AGENT_TOOLBELT_GRANT_SCHEMA) {
    throw new Error(`expected grant schema '${AGENT_TOOLBELT_GRANT_SCHEMA}'`)
  }
  for (const field of ['grantId', 'subjectAgentId', 'issuedBy', 'authorityGraphId'] as const) {
    requireText(input[field], `grant ${field}`)
  }
  if (!Number.isFinite(input.issuedAt)) throw new Error('grant issuedAt must be finite epoch milliseconds')
  if (input.notBefore !== undefined && !Number.isFinite(input.notBefore)) throw new Error('grant notBefore must be finite')
  if (input.expiresAt !== undefined && !Number.isFinite(input.expiresAt)) throw new Error('grant expiresAt must be finite')
  if (!['active', 'suspended', 'revoked', 'expired'].includes(String(input.status))) {
    throw new Error('grant status is unsupported')
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new Error('grant capabilities must be non-empty')
  }
  const capabilities = input.capabilities.map(parseCapability)
  if (new Set(capabilities.map((capability) => capability.capability)).size !== capabilities.length) {
    throw new Error('grant capability names must be unique')
  }
  requireStringArray(input.sourceRefs, 'grant sourceRefs')
  return { ...input, capabilities } as unknown as DomainToolbeltGrant
}

export function domainToolbeltGrantDocument(grant: DomainToolbeltGrant): string {
  return `${stableJson(parseDomainToolbeltGrant(grant))}\n`
}

export function domainToolbeltGrantDigest(grant: DomainToolbeltGrant): string {
  return contentDigest(parseDomainToolbeltGrant(grant))
}

function parseCapability(value: unknown, index: number): DomainGrantedCapability {
  const input = requireRecord(value, `grant capabilities[${index}]`)
  const capability = requireText(input.capability, `grant capabilities[${index}].capability`)
  const operations = requireStringArray(input.operations, `grant capability '${capability}' operations`, false)
  if (new Set(operations).size !== operations.length) throw new Error(`grant capability '${capability}' has duplicate operations`)
  if (input.access !== 'read' && input.access !== 'write') throw new Error(`grant capability '${capability}' access is unsupported`)
  const approvalPolicy = parsePolicy(input.approvalPolicy, `grant capability '${capability}' approvalPolicy`)
  const operationPolicies = input.operationPolicies
  if (operationPolicies !== undefined) {
    if (!isRecord(operationPolicies)) throw new Error(`grant capability '${capability}' operationPolicies must be an object`)
    for (const [operation, policy] of Object.entries(operationPolicies)) {
      if (!operations.includes(operation) && !operations.includes('*')) {
        throw new Error(`grant capability '${capability}' policy names ungranted operation '${operation}'`)
      }
      parsePolicy(policy, `grant capability '${capability}' operation '${operation}' policy`)
    }
  }
  const fence = requireRecord(input.fence, `grant capability '${capability}' fence`)
  for (const field of ['graphIds', 'graphIdPrefixes', 'originPrefixes', 'branchPrefixes', 'resourcePrefixes', 'pathPrefixes']) {
    if (fence[field] !== undefined) requireStringArray(fence[field], `grant capability '${capability}' fence.${field}`)
  }
  if (fence.builderRecipeDigests !== undefined) {
    const digests = requireStringArray(
      fence.builderRecipeDigests,
      `grant capability '${capability}' fence.builderRecipeDigests`,
      false,
    )
    if (digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest))) {
      throw new Error(`grant capability '${capability}' fence.builderRecipeDigests must be lowercase SHA-256 digests`)
    }
  }
  boundedInteger(fence.maxPayloadBytes, `grant capability '${capability}' fence.maxPayloadBytes`)
  positiveInteger(fence.maxTtlHours, `grant capability '${capability}' fence.maxTtlHours`)
  const quota = requireRecord(input.quota, `grant capability '${capability}' quota`)
  for (const field of ['maxPerWave', 'maxPerDay', 'maxConcurrent', 'maxCostMicrousd']) {
    boundedInteger(quota[field], `grant capability '${capability}' quota.${field}`)
  }
  return {
    capability,
    operations,
    access: input.access,
    approvalPolicy,
    operationPolicies: operationPolicies as Record<string, EffectApprovalPolicy> | undefined,
    fence,
    quota,
  } as DomainGrantedCapability
}

function parsePolicy(value: unknown, label: string): EffectApprovalPolicy {
  if (value !== 'ordinary' && value !== 'notify' && value !== 'human-always') {
    throw new Error(`${label} is unsupported`)
  }
  return value
}

function boundedInteger(value: unknown, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

function positiveInteger(value: unknown, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1)) {
    throw new Error(`${label} must be a positive integer`)
  }
}
