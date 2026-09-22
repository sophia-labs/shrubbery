export interface DomainJourneyStep {
  readonly id: string
  readonly action: string
  readonly expected: string
  readonly evidence: readonly string[]
}

export interface DomainJourney {
  readonly id: string
  readonly order: number
  readonly title: string
  readonly tier: string
  readonly capabilities: readonly string[]
  readonly modes: readonly string[]
  readonly roles: readonly string[]
  readonly fixture?: string
  readonly pairwiseDimensions?: readonly string[]
  readonly steps: readonly DomainJourneyStep[]
  readonly command?: string
  readonly [key: string]: unknown
}

export interface DomainCapability {
  readonly id: string
  readonly domain: string
  readonly title: string
  readonly tier: string
  readonly modes: readonly string[]
  readonly roles: readonly string[]
  readonly journeys: readonly string[]
  readonly stateful?: boolean
  readonly [key: string]: unknown
}

export interface DomainCapabilityManifest {
  readonly schemaVersion: number
  readonly programId: string
  readonly title: string
  readonly tiers: Readonly<Record<string, string>>
  readonly modes: readonly string[]
  readonly roles: readonly string[]
  readonly verdicts: readonly string[]
  readonly capabilities: readonly DomainCapability[]
  readonly journeys: readonly DomainJourney[]
  readonly [key: string]: unknown
}

export type DomainVerdictOutcome = 'PASS' | 'FAIL' | 'BLOCKED'

export interface DomainEvidenceRef {
  readonly uri: string
  readonly sha256: string
  readonly mediaType?: string
  readonly label?: string
}

export interface DomainVerdict {
  readonly schema: 'sophia.domain-verdict.v1'
  readonly verdictId: string
  readonly domain: string
  readonly capabilityId: string
  readonly mode: string
  readonly role: string
  readonly targetSha256: string
  readonly outcome: DomainVerdictOutcome
  readonly evidence: readonly DomainEvidenceRef[]
  readonly asOf: string
  readonly agentSessionUri: string
  readonly reason?: string
}

export interface DomainNamedQueryDefinition {
  readonly name: string
  readonly readerQuestion: string
  readonly description: string
  readonly text: string
  readonly opensGroundingGap?: string
}

export interface DomainQueryCatalogue {
  readonly schema: 'sophia.domain-query-catalogue.v1'
  readonly domain: string
  readonly digest: string
  readonly openGroundingGaps: readonly string[]
  readonly queries: readonly DomainNamedQueryDefinition[]
}

/** One flat record for Garden's vocabulary-gated generic Emporium lane. */
export interface DomainProjectionRecord {
  readonly kind: string
  readonly localId: string
  readonly [field: string]: unknown
}

/**
 * A graph-bound desired projection. The provisioner, not this portable seed,
 * chooses dry-run versus apply; the request therefore cannot smuggle an apply
 * bit across the host authority boundary.
 */
export interface DomainProjectionIngest {
  readonly graphIri: string
  readonly vocab: string
  readonly replaceClass: boolean
  readonly records: readonly DomainProjectionRecord[]
}
