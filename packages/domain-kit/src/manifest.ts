import { compareTriples, I, L, Lbool, Lint, type Triple, triplesToNT } from '@shrubbery/nucleus'
import { contentDigest, requireRecord, requireStringArray, requireText, stableJson } from './canonical.js'
import type {
  DomainCapability,
  DomainCapabilityManifest,
  DomainJourney,
  DomainJourneyStep,
  DomainProjectionRecord,
} from './types.js'

export const DOMAIN_KIT_NS = 'http://sophia.ai/domain#'
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

const dk = (local: string): string => DOMAIN_KIT_NS + local

export interface ManifestProjectionCheck {
  readonly ok: boolean
  readonly expectedDigest: string
  readonly projectedDigest?: string
  readonly missing: readonly string[]
  readonly stale: readonly string[]
}

export function manifestSubject(programId: string): string {
  return `urn:sophia:domain:${encodeURIComponent(programId)}:manifest`
}

export function manifestProjectionGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:domain-manifest`
}

export function parseCapabilityManifest(value: unknown): DomainCapabilityManifest {
  const input = requireRecord(value, 'capability manifest')
  const schemaVersion = input.schemaVersion
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new Error('capability manifest schemaVersion must be a positive integer')
  }
  const programId = requireText(input.programId, 'capability manifest programId')
  const title = requireText(input.title, 'capability manifest title')
  const tiers = requireRecord(input.tiers, 'capability manifest tiers')
  if (Object.keys(tiers).length === 0 || Object.values(tiers).some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error('capability manifest tiers must map stable ids to descriptions')
  }
  const modes = unique(requireStringArray(input.modes, 'capability manifest modes', false), 'mode')
  const roles = unique(requireStringArray(input.roles, 'capability manifest roles', false), 'role')
  const verdicts = unique(requireStringArray(input.verdicts, 'capability manifest verdicts', false), 'verdict')
  if (!Array.isArray(input.capabilities) || !Array.isArray(input.journeys)) {
    throw new Error('capability manifest capabilities and journeys must be arrays')
  }

  const capabilities = input.capabilities.map((entry, index) => parseCapability(entry, index))
  const journeys = input.journeys.map((entry, index) => parseJourney(entry, index))
  const capabilityIds = unique(capabilities.map((capability) => capability.id), 'capability id')
  const journeyIds = unique(journeys.map((journey) => journey.id), 'journey id')
  const tierIds = new Set(Object.keys(tiers))
  const modeIds = new Set(modes)
  const roleIds = new Set(roles)
  const capabilityIdSet = new Set(capabilityIds)
  const journeyIdSet = new Set(journeyIds)

  for (const capability of capabilities) {
    requireMember(capability.tier, tierIds, `capability '${capability.id}' tier`)
    for (const mode of capability.modes) requireMember(mode, modeIds, `capability '${capability.id}' mode`)
    for (const role of capability.roles) requireMember(role, roleIds, `capability '${capability.id}' role`)
    for (const journey of capability.journeys) requireMember(journey, journeyIdSet, `capability '${capability.id}' journey`)
  }
  for (const journey of journeys) {
    requireMember(journey.tier, tierIds, `journey '${journey.id}' tier`)
    for (const mode of journey.modes) requireMember(mode, modeIds, `journey '${journey.id}' mode`)
    for (const role of journey.roles) requireMember(role, roleIds, `journey '${journey.id}' role`)
    for (const capability of journey.capabilities) {
      requireMember(capability, capabilityIdSet, `journey '${journey.id}' capability`)
    }
  }

  return {
    ...input,
    schemaVersion: schemaVersion as number,
    programId,
    title,
    tiers: tiers as Record<string, string>,
    modes,
    roles,
    verdicts,
    capabilities,
    journeys,
  } as DomainCapabilityManifest
}

export function manifestToTriples(value: DomainCapabilityManifest | unknown): readonly Triple[] {
  const manifest = parseCapabilityManifest(value)
  const root = manifestSubject(manifest.programId)
  const out: Triple[] = []
  const add = (s: string, p: string, o: ReturnType<typeof I> | ReturnType<typeof L>): void => {
    out.push({ s, p, o })
  }
  const typed = (subject: string, className: string): void => add(subject, RDF_TYPE, I(dk(className)))
  typed(root, 'DomainManifest')
  add(root, dk('programId'), L(manifest.programId))
  add(root, dk('title'), L(manifest.title))
  add(root, dk('schemaVersion'), Lint(manifest.schemaVersion))
  add(root, dk('contentSha256'), L(contentDigest(manifest)))
  add(root, dk('sourceJson'), L(stableJson(manifest)))

  for (const [tierId, description] of Object.entries(manifest.tiers)) {
    const subject = child(root, 'tier', tierId)
    typed(subject, 'Tier')
    add(root, dk('hasTier'), I(subject))
    add(subject, dk('stableId'), L(tierId))
    add(subject, dk('description'), L(description))
  }
  for (const modeId of manifest.modes) {
    const subject = child(root, 'mode', modeId)
    typed(subject, 'Mode')
    add(root, dk('hasMode'), I(subject))
    add(subject, dk('stableId'), L(modeId))
  }
  for (const roleId of manifest.roles) {
    const subject = child(root, 'role', roleId)
    typed(subject, 'Role')
    add(root, dk('hasRole'), I(subject))
    add(subject, dk('stableId'), L(roleId))
  }
  for (const journey of manifest.journeys) emitJourney(out, root, journey)
  for (const capability of manifest.capabilities) emitCapability(out, root, capability)
  return out.sort(compareTriples)
}

export function manifestToNt(value: DomainCapabilityManifest | unknown): string {
  return `${triplesToNT(manifestToTriples(value))}\n`
}

/** Build the exact generic records accepted by `sophia-domain-manifest`. */
export function manifestToProjectionRecords(
  value: DomainCapabilityManifest | unknown,
): readonly DomainProjectionRecord[] {
  const manifest = parseCapabilityManifest(value)
  const root = manifestSubject(manifest.programId)
  const records: DomainProjectionRecord[] = [
    {
      kind: 'DomainManifest',
      localId: root,
      programId: manifest.programId,
      title: manifest.title,
      schemaVersion: manifest.schemaVersion,
      contentSha256: contentDigest(manifest),
      sourceJson: stableJson(manifest),
      hasTier: Object.keys(manifest.tiers).map((id) => child(root, 'tier', id)),
      hasMode: manifest.modes.map((id) => child(root, 'mode', id)),
      hasRole: manifest.roles.map((id) => child(root, 'role', id)),
      hasCapability: manifest.capabilities.map((item) => child(root, 'capability', item.id)),
      hasJourney: manifest.journeys.map((item) => child(root, 'journey', item.id)),
    },
  ]

  for (const [id, description] of Object.entries(manifest.tiers)) {
    records.push({ kind: 'Tier', localId: child(root, 'tier', id), stableId: id, description })
  }
  for (const id of manifest.modes) {
    records.push({ kind: 'Mode', localId: child(root, 'mode', id), stableId: id })
  }
  for (const id of manifest.roles) {
    records.push({ kind: 'Role', localId: child(root, 'role', id), stableId: id })
  }
  for (const journey of manifest.journeys) {
    const journeySubject = child(root, 'journey', journey.id)
    records.push({
      kind: 'Journey',
      localId: journeySubject,
      stableId: journey.id,
      title: journey.title,
      order: journey.order,
      tier: child(root, 'tier', journey.tier),
      mode: journey.modes.map((id) => child(root, 'mode', id)),
      role: journey.roles.map((id) => child(root, 'role', id)),
      exercisesCapability: journey.capabilities.map((id) => child(root, 'capability', id)),
      declaresEvidence: [...new Set(journey.steps.flatMap((step) => step.evidence))],
      hasStep: journey.steps.map((step, index) => child(journeySubject, 'step', `${index}-${step.id}`)),
    })
    for (const [index, step] of journey.steps.entries()) {
      records.push({
        kind: 'JourneyStep',
        localId: child(journeySubject, 'step', `${index}-${step.id}`),
        stableId: step.id,
        order: index,
        action: step.action,
        expected: step.expected,
        declaresEvidence: [...step.evidence],
      })
    }
  }
  for (const capability of manifest.capabilities) {
    records.push({
      kind: 'CapabilityClaim',
      localId: child(root, 'capability', capability.id),
      stableId: capability.id,
      domain: capability.domain,
      title: capability.title,
      tier: child(root, 'tier', capability.tier),
      ...(capability.stateful === undefined ? {} : { stateful: capability.stateful }),
      mode: capability.modes.map((id) => child(root, 'mode', id)),
      role: capability.roles.map((id) => child(root, 'role', id)),
      journey: capability.journeys.map((id) => child(root, 'journey', id)),
    })
  }
  return records
}

export function manifestFromTriples(triples: readonly Triple[]): DomainCapabilityManifest {
  const roots = triples
    .filter((triple) => triple.p === RDF_TYPE && triple.o.type === 'iri' && triple.o.value === dk('DomainManifest'))
    .map((triple) => triple.s)
  if (roots.length !== 1) throw new Error(`manifest projection must contain exactly one DomainManifest (found ${roots.length})`)
  const source = triples.find((triple) => triple.s === roots[0] && triple.p === dk('sourceJson'))?.o
  if (source?.type !== 'literal') throw new Error('manifest projection has no sourceJson literal')
  let parsed: unknown
  try {
    parsed = JSON.parse(source.value)
  } catch (cause) {
    throw new Error('manifest projection sourceJson is invalid', { cause })
  }
  const manifest = parseCapabilityManifest(parsed)
  const projectedDigest = literalValue(triples, roots[0], dk('contentSha256'))
  if (projectedDigest !== contentDigest(manifest)) throw new Error('manifest projection contentSha256 is stale')
  return manifest
}

export function checkManifestProjection(
  value: DomainCapabilityManifest | unknown,
  graphTriples: readonly Triple[],
): ManifestProjectionCheck {
  const manifest = parseCapabilityManifest(value)
  const root = manifestSubject(manifest.programId)
  const expected = new Set(manifestToTriples(manifest).map(tripleLine))
  const actual = new Set(
    graphTriples.filter((triple) => triple.s === root || triple.s.startsWith(`${root}:`)).map(tripleLine),
  )
  const missing = [...expected].filter((line) => !actual.has(line)).sort()
  const stale = [...actual].filter((line) => !expected.has(line)).sort()
  return {
    ok: missing.length === 0 && stale.length === 0,
    expectedDigest: contentDigest(manifest),
    projectedDigest: literalValue(graphTriples, root, dk('contentSha256')),
    missing,
    stale,
  }
}

function parseCapability(value: unknown, index: number): DomainCapability {
  const capability = requireRecord(value, `capabilities[${index}]`)
  return {
    ...capability,
    id: stableId(capability.id, `capabilities[${index}].id`),
    domain: stableId(capability.domain, `capabilities[${index}].domain`),
    title: requireText(capability.title, `capabilities[${index}].title`),
    tier: stableId(capability.tier, `capabilities[${index}].tier`),
    modes: unique(requireStringArray(capability.modes, `capabilities[${index}].modes`, false), 'mode'),
    roles: unique(requireStringArray(capability.roles, `capabilities[${index}].roles`, false), 'role'),
    journeys: unique(requireStringArray(capability.journeys, `capabilities[${index}].journeys`, false), 'journey'),
  } as DomainCapability
}

function parseJourney(value: unknown, index: number): DomainJourney {
  const journey = requireRecord(value, `journeys[${index}]`)
  if (!Number.isSafeInteger(journey.order)) throw new Error(`journeys[${index}].order must be an integer`)
  if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
    throw new Error(`journeys[${index}].steps must be non-empty`)
  }
  return {
    ...journey,
    id: stableId(journey.id, `journeys[${index}].id`),
    order: journey.order as number,
    title: requireText(journey.title, `journeys[${index}].title`),
    tier: stableId(journey.tier, `journeys[${index}].tier`),
    capabilities: unique(requireStringArray(journey.capabilities, `journeys[${index}].capabilities`, false), 'capability'),
    modes: unique(requireStringArray(journey.modes, `journeys[${index}].modes`, false), 'mode'),
    roles: unique(requireStringArray(journey.roles, `journeys[${index}].roles`, false), 'role'),
    steps: journey.steps.map((step, stepIndex) => parseStep(step, index, stepIndex)),
  } as DomainJourney
}

function parseStep(value: unknown, journeyIndex: number, stepIndex: number): DomainJourneyStep {
  const step = requireRecord(value, `journeys[${journeyIndex}].steps[${stepIndex}]`)
  return {
    id: stableId(step.id, `journeys[${journeyIndex}].steps[${stepIndex}].id`),
    action: requireText(step.action, `journeys[${journeyIndex}].steps[${stepIndex}].action`),
    expected: requireText(step.expected, `journeys[${journeyIndex}].steps[${stepIndex}].expected`),
    evidence: unique(
      requireStringArray(step.evidence, `journeys[${journeyIndex}].steps[${stepIndex}].evidence`, false),
      'evidence kind',
    ),
  }
}

function emitJourney(out: Triple[], root: string, journey: DomainJourney): void {
  const subject = child(root, 'journey', journey.id)
  add(out, subject, RDF_TYPE, I(dk('Journey')))
  add(out, root, dk('hasJourney'), I(subject))
  add(out, subject, dk('stableId'), L(journey.id))
  add(out, subject, dk('title'), L(journey.title))
  add(out, subject, dk('order'), Lint(journey.order))
  add(out, subject, dk('tier'), I(child(root, 'tier', journey.tier)))
  for (const mode of journey.modes) add(out, subject, dk('mode'), I(child(root, 'mode', mode)))
  for (const role of journey.roles) add(out, subject, dk('role'), I(child(root, 'role', role)))
  for (const capability of journey.capabilities) add(out, subject, dk('exercisesCapability'), I(child(root, 'capability', capability)))
  for (const evidence of new Set(journey.steps.flatMap((step) => step.evidence))) add(out, subject, dk('declaresEvidence'), L(evidence))
  for (const [index, step] of journey.steps.entries()) {
    const stepSubject = child(subject, 'step', `${index}-${step.id}`)
    add(out, stepSubject, RDF_TYPE, I(dk('JourneyStep')))
    add(out, subject, dk('hasStep'), I(stepSubject))
    add(out, stepSubject, dk('stableId'), L(step.id))
    add(out, stepSubject, dk('order'), Lint(index))
    add(out, stepSubject, dk('action'), L(step.action))
    add(out, stepSubject, dk('expected'), L(step.expected))
    for (const evidence of step.evidence) add(out, stepSubject, dk('declaresEvidence'), L(evidence))
  }
}

function emitCapability(out: Triple[], root: string, capability: DomainCapability): void {
  const subject = child(root, 'capability', capability.id)
  add(out, subject, RDF_TYPE, I(dk('CapabilityClaim')))
  add(out, root, dk('hasCapability'), I(subject))
  add(out, subject, dk('stableId'), L(capability.id))
  add(out, subject, dk('domain'), L(capability.domain))
  add(out, subject, dk('title'), L(capability.title))
  add(out, subject, dk('tier'), I(child(root, 'tier', capability.tier)))
  if (capability.stateful !== undefined) add(out, subject, dk('stateful'), Lbool(capability.stateful))
  for (const mode of capability.modes) add(out, subject, dk('mode'), I(child(root, 'mode', mode)))
  for (const role of capability.roles) add(out, subject, dk('role'), I(child(root, 'role', role)))
  for (const journey of capability.journeys) add(out, subject, dk('journey'), I(child(root, 'journey', journey)))
}

function add(out: Triple[], s: string, p: string, o: ReturnType<typeof I> | ReturnType<typeof L>): void {
  out.push({ s, p, o })
}

function child(parent: string, kind: string, id: string): string {
  return `${parent}:${kind}:${encodeURIComponent(id)}`
}

function stableId(value: unknown, label: string): string {
  const id = requireText(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new Error(`${label} is not a stable id`)
  return id
}

function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`)
  return values
}

function requireMember(value: string, values: ReadonlySet<string>, label: string): void {
  if (!values.has(value)) throw new Error(`${label} references unknown id '${value}'`)
}

function literalValue(triples: readonly Triple[], subject: string, predicate: string): string | undefined {
  const term = triples.find((triple) => triple.s === subject && triple.p === predicate)?.o
  return term?.type === 'literal' ? term.value : undefined
}

function tripleLine(triple: Triple): string {
  return triplesToNT([triple])
}
