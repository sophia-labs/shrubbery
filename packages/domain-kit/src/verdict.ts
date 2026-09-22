import { compareTriples, I, L, type Triple, triplesToNT } from '@shrubbery/nucleus'
import { assertAbsoluteIri, contentDigest, requireRecord, requireText, stableJson } from './canonical.js'
import { DOMAIN_KIT_NS, RDF_TYPE } from './manifest.js'
import type {
  DomainEvidenceRef,
  DomainProjectionRecord,
  DomainVerdict,
  DomainVerdictOutcome,
} from './types.js'

const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const dk = (local: string): string => DOMAIN_KIT_NS + local
const SHA256 = /^[0-9a-f]{64}$/
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const OUTCOMES: readonly DomainVerdictOutcome[] = ['PASS', 'FAIL', 'BLOCKED']

export interface BuildDomainVerdictInput {
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

export function buildDomainVerdict(input: BuildDomainVerdictInput): DomainVerdict {
  validateVerdictFields(input)
  const seed = {
    domain: input.domain,
    capabilityId: input.capabilityId,
    mode: input.mode,
    role: input.role,
    targetSha256: input.targetSha256,
    outcome: input.outcome,
    evidence: input.evidence,
    asOf: input.asOf,
    agentSessionUri: input.agentSessionUri,
    reason: input.reason,
  }
  return parseDomainVerdict({
    schema: 'sophia.domain-verdict.v1',
    verdictId: `urn:sophia:domain:${encodeURIComponent(input.domain)}:verdict:${contentDigest(seed)}`,
    ...seed,
  })
}

export function parseDomainVerdict(value: unknown): DomainVerdict {
  const verdict = requireRecord(value, 'domain verdict')
  assertExactKeys(
    verdict,
    ['schema', 'verdictId', 'domain', 'capabilityId', 'mode', 'role', 'targetSha256', 'outcome', 'evidence', 'asOf', 'agentSessionUri', 'reason'],
    'domain verdict',
  )
  if (verdict.schema !== 'sophia.domain-verdict.v1') throw new Error("expected schema 'sophia.domain-verdict.v1'")
  const parsed = verdict as unknown as DomainVerdict
  validateVerdictFields(parsed)
  const expected = buildVerdictId(parsed)
  if (parsed.verdictId !== expected) throw new Error('domain verdict verdictId does not match its content')
  return parsed
}

export function verdictToTriples(value: DomainVerdict | unknown): readonly Triple[] {
  const verdict = parseDomainVerdict(value)
  const out: Triple[] = []
  const add = (p: string, o: ReturnType<typeof I> | ReturnType<typeof L>): void => {
    out.push({ s: verdict.verdictId, p, o })
  }
  add(RDF_TYPE, I(dk('Verdict')))
  add(dk('domain'), L(verdict.domain))
  add(dk('capabilityId'), L(verdict.capabilityId))
  add(dk('modeId'), L(verdict.mode))
  add(dk('roleId'), L(verdict.role))
  add(dk('targetSha256'), L(verdict.targetSha256))
  add(dk('outcome'), I(dk(verdict.outcome)))
  add(dk('asOf'), L(verdict.asOf, XSD_DATE_TIME))
  add(dk('agentSession'), I(verdict.agentSessionUri))
  if (verdict.reason) add(dk('reason'), L(verdict.reason))
  add(dk('contentSha256'), L(contentDigest(verdict)))
  add(dk('sourceJson'), L(stableJson(verdict)))
  for (const evidence of verdict.evidence) {
    const subject = evidenceSubject(evidence)
    out.push({ s: subject, p: RDF_TYPE, o: I(dk('EvidenceRef')) })
    out.push({ s: verdict.verdictId, p: dk('evidence'), o: I(subject) })
    out.push({ s: subject, p: dk('contentUri'), o: I(evidence.uri) })
    out.push({ s: subject, p: dk('contentSha256'), o: L(evidence.sha256) })
    if (evidence.mediaType) out.push({ s: subject, p: dk('mediaType'), o: L(evidence.mediaType) })
    if (evidence.label) out.push({ s: subject, p: dk('label'), o: L(evidence.label) })
  }
  return out.sort(compareTriples)
}

export function verdictToNt(value: DomainVerdict | unknown): string {
  return `${triplesToNT(verdictToTriples(value))}\n`
}

/** Build append-safe generic records accepted by `sophia-domain-verdict`. */
export function verdictToProjectionRecords(value: DomainVerdict | unknown): readonly DomainProjectionRecord[] {
  const verdict = parseDomainVerdict(value)
  const evidenceSubjects = verdict.evidence.map(evidenceSubject)
  return [
    {
      kind: 'Verdict',
      localId: verdict.verdictId,
      domain: verdict.domain,
      capabilityId: verdict.capabilityId,
      modeId: verdict.mode,
      roleId: verdict.role,
      targetSha256: verdict.targetSha256,
      outcome: dk(verdict.outcome),
      asOf: verdict.asOf,
      agentSession: verdict.agentSessionUri,
      ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
      contentSha256: contentDigest(verdict),
      sourceJson: stableJson(verdict),
      evidence: evidenceSubjects,
    },
    ...verdict.evidence.map((evidence, index) => ({
      kind: 'EvidenceRef',
      localId: evidenceSubjects[index],
      hash: contentDigest(evidence),
      contentUri: evidence.uri,
      contentSha256: evidence.sha256,
      ...(evidence.mediaType === undefined ? {} : { mediaType: evidence.mediaType }),
      ...(evidence.label === undefined ? {} : { label: evidence.label }),
    })),
  ]
}

function evidenceSubject(evidence: DomainEvidenceRef): string {
  return `urn:sophia:domain:evidence:${contentDigest(evidence)}`
}

export function verdictFromTriples(triples: readonly Triple[]): DomainVerdict {
  const roots = triples
    .filter((triple) => triple.p === RDF_TYPE && triple.o.type === 'iri' && triple.o.value === dk('Verdict'))
    .map((triple) => triple.s)
  if (roots.length !== 1) throw new Error(`verdict projection must contain exactly one Verdict (found ${roots.length})`)
  const source = triples.find((triple) => triple.s === roots[0] && triple.p === dk('sourceJson'))?.o
  if (source?.type !== 'literal') throw new Error('verdict projection has no sourceJson literal')
  let parsed: unknown
  try {
    parsed = JSON.parse(source.value)
  } catch (cause) {
    throw new Error('verdict projection sourceJson is invalid', { cause })
  }
  const verdict = parseDomainVerdict(parsed)
  const projectedDigest = triples.find((triple) => triple.s === roots[0] && triple.p === dk('contentSha256'))?.o
  if (projectedDigest?.type !== 'literal' || projectedDigest.value !== contentDigest(verdict)) {
    throw new Error('verdict projection contentSha256 is stale')
  }
  return verdict
}

function validateVerdictFields(input: BuildDomainVerdictInput): void {
  for (const [label, value] of [
    ['domain', input.domain],
    ['capabilityId', input.capabilityId],
    ['mode', input.mode],
    ['role', input.role],
  ] as const) {
    const text = requireText(value, label)
    if (!STABLE_ID.test(text)) throw new Error(`${label} must be a stable id`)
  }
  if (!SHA256.test(input.targetSha256)) throw new Error('targetSha256 must be lowercase sha256 hex')
  if (!OUTCOMES.includes(input.outcome)) throw new Error('outcome must be PASS, FAIL, or BLOCKED')
  if (!Array.isArray(input.evidence) || input.evidence.length === 0 || input.evidence.length > 100) {
    throw new Error('a domain verdict requires at least one and at most 100 content-addressed evidence refs')
  }
  const evidenceDigests = new Set<string>()
  for (const [index, evidence] of input.evidence.entries()) {
    const record = requireRecord(evidence, `evidence[${index}]`)
    assertExactKeys(record, ['uri', 'sha256', 'mediaType', 'label'], `evidence[${index}]`)
    const uri = requireText(record.uri, `evidence[${index}].uri`)
    assertAbsoluteIri(uri, `evidence[${index}].uri`)
    if (!SHA256.test(requireText(record.sha256, `evidence[${index}].sha256`))) {
      throw new Error(`evidence[${index}].sha256 must be lowercase sha256 hex`)
    }
    if (record.mediaType !== undefined) requireText(record.mediaType, `evidence[${index}].mediaType`)
    if (record.label !== undefined) requireText(record.label, `evidence[${index}].label`)
    const evidenceDigest = contentDigest(record)
    if (evidenceDigests.has(evidenceDigest)) throw new Error('domain verdict evidence refs must be unique')
    evidenceDigests.add(evidenceDigest)
  }
  const asOf = requireText(input.asOf, 'asOf')
  const asOfMillis = Date.parse(asOf)
  if (Number.isNaN(asOfMillis) || new Date(asOfMillis).toISOString() !== asOf) {
    throw new Error('asOf must be a canonical ISO date-time')
  }
  assertAbsoluteIri(input.agentSessionUri, 'agentSessionUri')
  if (input.reason !== undefined) requireText(input.reason, 'reason')
}

function buildVerdictId(verdict: Omit<DomainVerdict, 'verdictId' | 'schema'>): string {
  const seed = {
    domain: verdict.domain,
    capabilityId: verdict.capabilityId,
    mode: verdict.mode,
    role: verdict.role,
    targetSha256: verdict.targetSha256,
    outcome: verdict.outcome,
    evidence: verdict.evidence,
    asOf: verdict.asOf,
    agentSessionUri: verdict.agentSessionUri,
    reason: verdict.reason,
  }
  return `urn:sophia:domain:${encodeURIComponent(verdict.domain)}:verdict:${contentDigest(seed)}`
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.sort().join(', ')}`)
}
