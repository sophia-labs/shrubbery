import { createHash } from 'node:crypto'
import { contentDigest, requireText, stableJson } from './canonical.js'
import { type DomainToolbeltGrant, domainToolbeltGrantDigest, parseDomainToolbeltGrant } from './grant.js'
import {
  type DomainTriggerConsent,
  domainTriggerConsentDigest,
  parseDomainTriggerConsent,
} from './trigger-consent.js'

export const DEFAULT_DOMAIN_PILOT_MODEL = 'thinkingmachines/inkling'
export const DEFAULT_DOMAIN_EMANATION_MODEL = 'thinkingmachines/inkling-small'
export const STANDALONE_AGENT_IDENTITY_ALGORITHM = 'agent-identity-v1-registered-name'
/** Replaced with an exact typed owner by the trusted installation edge. */
export const DOMAIN_AUTHORITY_OWNER_BINDING = 'binding:authority-owner' as const

export interface DomainDirectTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly capability: string
  readonly server?: string
  readonly access: 'read' | 'write'
  readonly risk: 'low' | 'medium' | 'high'
  readonly required: boolean
}

/**
 * A graph-authored reference to a deterministic Meaningful Object already
 * registered by Choreograph. The definition carries coordinates and a contract,
 * never executable source or ambient authority. A pilot selects `programId` and
 * supplies input; the host re-resolves and verifies the pinned target.
 */
export interface DomainProgramBinding {
  readonly programId: string
  readonly title: string
  readonly description: string
  readonly workflowName: string
  readonly workflowUri: string
  readonly definitionDigest: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly authority: {
    readonly capability: string
    readonly operation: string
    readonly access: 'read' | 'write'
    readonly resourceRef: string
  }
  readonly graph: { readonly mode: 'home' } | { readonly mode: 'input-field'; readonly inputField: string }
}

export interface DomainAgentBundleInput {
  readonly registeredName: string
  readonly homeGraphId: string
  readonly agentRef: string
  readonly ontologyRefs: readonly string[]
  readonly charter: string
  readonly prompt: string
  readonly promotedBy: string
  readonly promotedAt: number
  /** Concrete when known; portable seeds retain the provisioner binding token. */
  readonly grantAuthorityOwnerPrincipal?: string
  readonly grant: DomainToolbeltGrant
  readonly directTools: readonly DomainDirectTool[]
  readonly triggers: readonly DomainAgentTriggerBinding[]
  readonly programs?: readonly DomainProgramBinding[]
  /** Consent documents live beside the grant in the trusted authority graph. */
  readonly triggerConsents?: Readonly<Record<string, DomainTriggerConsent>>
  readonly responseSchema: Readonly<Record<string, unknown>>
  readonly models?: { readonly pilot?: string; readonly emanation?: string }
  readonly budgets?: {
    readonly pilotMaxTurns?: number
    readonly emanationMaxTurns?: number
    readonly maxEmanations?: number
    readonly maxProposedEffects?: number
    readonly maxProgramInvocations?: number
  }
  readonly definitionDocumentId?: string
}

export interface DomainAgentTriggerBinding {
  readonly kind: string
  readonly enabled: boolean
  readonly mode?: string
  readonly ingress?: 'owner' | 'internal-service'
  readonly adapter?: string
  readonly consentRef?: {
    readonly ownerPrincipal?: string
    readonly graphId: string
    readonly documentId: string
    readonly expectedDigest: string
  }
  readonly sourceFence?: {
    readonly resourcePrefixes: readonly string[]
    readonly eventIdRequired?: boolean
    readonly maxContextRefs?: number
  }
}

export interface DomainAgentSeedBundle {
  readonly schema: 'sophia.domain-agent-seed-bundle.v1'
  readonly registeredName: string
  readonly agentId: string
  readonly agentUri: string
  readonly homeGraphId: string
  readonly grantAuthorityGraphId: string
  readonly grantAuthorityOwnerPrincipal: string
  readonly grantDocumentId: string
  readonly definitionDocumentId: string
  readonly definition: Readonly<Record<string, unknown>>
  readonly promptBinding: Readonly<Record<string, unknown>>
  readonly toolManifest: Readonly<Record<string, unknown>>
  readonly homeDocuments: Readonly<Record<string, string>>
  readonly authorityDocuments: Readonly<Record<string, string>>
  readonly digest: string
}

export function mintStandaloneAgentId(registeredName: string): string {
  const name = requireText(registeredName, 'registeredName').trim()
  return `agent-${createHash('sha256').update(`agent-name:${name}`).digest('hex').slice(0, 16)}`
}

export function buildDomainAgentSeedBundle(input: DomainAgentBundleInput): DomainAgentSeedBundle {
  const registeredName = requireText(input.registeredName, 'registeredName').trim()
  const homeGraphId = requireText(input.homeGraphId, 'homeGraphId')
  const charter = requireText(input.charter, 'charter').trim()
  const prompt = requireText(input.prompt, 'prompt').trim()
  if (input.ontologyRefs.length === 0 || new Set(input.ontologyRefs).size !== input.ontologyRefs.length) {
    throw new Error('ontologyRefs must be non-empty and unique')
  }
  if (input.triggers.length === 0 || input.triggers.some((trigger) => !trigger.kind.trim())) {
    throw new Error('at least one named trigger is required')
  }
  const grant = parseDomainToolbeltGrant(input.grant)
  const grantAuthorityOwnerPrincipal = validateAuthorityOwner(
    input.grantAuthorityOwnerPrincipal ?? DOMAIN_AUTHORITY_OWNER_BINDING,
  )
  const agentId = mintStandaloneAgentId(registeredName)
  if (grant.subjectAgentId !== agentId) throw new Error('grant subjectAgentId does not match registeredName')
  const agentUri = `urn:sophia:agent:${agentId}`
  const documentIds = {
    charter: `${registeredName}-charter`,
    prompt: `${registeredName}-prompt`,
    promptBinding: `${registeredName}-prompt-binding`,
    toolManifest: `${registeredName}-tool-manifest`,
    definition: input.definitionDocumentId ?? 'domain-agent-definition',
    grant: `grant-${registeredName}`,
  }
  const triggerConsents = Object.fromEntries(
    Object.entries(input.triggerConsents ?? {}).map(([documentId, consent]) => {
      const parsed = parseDomainTriggerConsent(consent)
      if (parsed.subjectAgentId !== agentId) throw new Error(`trigger consent '${documentId}' belongs to another agent`)
      if (parsed.authorityGraphId !== grant.authorityGraphId) {
        throw new Error(`trigger consent '${documentId}' must live in the grant authority graph`)
      }
      return [documentId, parsed]
    }),
  )
  const triggers = input.triggers.map((trigger) =>
    validateTriggerBinding(trigger, triggerConsents, grantAuthorityOwnerPrincipal),
  )
  const programs = validateProgramBindings(input.programs ?? [], grant, homeGraphId)
  const maxProgramInvocations = input.budgets?.maxProgramInvocations ?? (programs.length > 0 ? 1 : 0)
  if (!Number.isSafeInteger(maxProgramInvocations) || maxProgramInvocations < 0 || maxProgramInvocations > 4) {
    throw new Error('maxProgramInvocations must be an integer between 0 and 4')
  }
  if (programs.length > 0 && maxProgramInvocations === 0) {
    throw new Error('programs require maxProgramInvocations > 0')
  }
  const promptSnapshot = buildPromptSnapshot(homeGraphId, documentIds.prompt, prompt, input.promotedAt)
  const pilotModel = input.models?.pilot ?? DEFAULT_DOMAIN_PILOT_MODEL
  const promptBinding = buildPromptBinding({
    registeredName,
    agentId,
    agentUri,
    promptDocumentId: documentIds.prompt,
    snapshot: promptSnapshot,
    provider: 'openrouter',
    model: pilotModel,
    promotedBy: input.promotedBy,
    promotedAt: input.promotedAt,
  })
  const toolManifest = buildToolManifest({
    registeredName,
    agentId,
    agentUri,
    graphId: homeGraphId,
    declaredBy: input.promotedBy,
    now: input.promotedAt,
    grant,
    directTools: input.directTools,
  })
  const definition = {
    schema: 'sophia.domain-agent-definition.v1',
    registeredName,
    agentId,
    agentUri,
    homeGraphId,
    agentRef: requireText(input.agentRef, 'agentRef'),
    ontologyRefs: input.ontologyRefs,
    charterDocumentId: documentIds.charter,
    promptBindingDocumentId: documentIds.promptBinding,
    toolManifestDocumentId: documentIds.toolManifest,
    grantRef: {
      ownerPrincipal: grantAuthorityOwnerPrincipal,
      graphId: grant.authorityGraphId,
      documentId: documentIds.grant,
      expectedDigest: domainToolbeltGrantDigest(grant),
    },
    models: {
      provider: 'openrouter',
      pilot: pilotModel,
      emanation: input.models?.emanation ?? DEFAULT_DOMAIN_EMANATION_MODEL,
    },
    budgets: {
      pilotMaxTurns: input.budgets?.pilotMaxTurns ?? 12,
      emanationMaxTurns: input.budgets?.emanationMaxTurns ?? 5,
      maxEmanations: input.budgets?.maxEmanations ?? 3,
      maxProposedEffects: input.budgets?.maxProposedEffects ?? 8,
      maxProgramInvocations,
    },
    emanations: { enabled: (input.budgets?.maxEmanations ?? 3) > 0, depth: 1 },
    triggers,
    programs,
    responseSchema: input.responseSchema,
  }
  const homeDocuments = {
    [documentIds.charter]: `${charter}\n`,
    [documentIds.prompt]: `${prompt}\n`,
    [documentIds.promptBinding]: `${JSON.stringify(promptBinding, null, 2)}\n`,
    [documentIds.toolManifest]: `${JSON.stringify(toolManifest, null, 2)}\n`,
    [documentIds.definition]: `${JSON.stringify(definition, null, 2)}\n`,
  }
  const authorityDocuments = {
    [documentIds.grant]: `${JSON.stringify(grant, null, 2)}\n`,
    ...Object.fromEntries(
      Object.entries(triggerConsents).map(([documentId, consent]) => [documentId, `${JSON.stringify(consent, null, 2)}\n`]),
    ),
  }
  const seed = {
    schema: 'sophia.domain-agent-seed-bundle.v1' as const,
    registeredName,
    agentId,
    agentUri,
    homeGraphId,
    grantAuthorityGraphId: grant.authorityGraphId,
    grantAuthorityOwnerPrincipal,
    grantDocumentId: documentIds.grant,
    definitionDocumentId: documentIds.definition,
    definition,
    promptBinding,
    toolManifest,
    homeDocuments,
    authorityDocuments,
  }
  return { ...seed, digest: contentDigest(seed) }
}

function validateProgramBindings(
  programs: readonly DomainProgramBinding[],
  grant: DomainToolbeltGrant,
  homeGraphId: string,
): readonly DomainProgramBinding[] {
  if (programs.length > 16) throw new Error('at most 16 deterministic programs may be bound')
  const programIds = new Set<string>()
  const targets = new Set<string>()
  return programs.map((program) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(program.programId)) {
      throw new Error('programId must be a stable 1..128 character identifier')
    }
    for (const field of ['title', 'description', 'workflowName', 'workflowUri'] as const) {
      requireText(program[field], `program '${program.programId}' ${field}`)
    }
    if (!/^[0-9a-f]{64}$/.test(program.definitionDigest)) {
      throw new Error(`program '${program.programId}' definitionDigest must be sha256 hex`)
    }
    if (!program.inputSchema || typeof program.inputSchema !== 'object' || Array.isArray(program.inputSchema)) {
      throw new Error(`program '${program.programId}' inputSchema must be an object`)
    }
    if (
      !program.authority ||
      !requireText(program.authority.capability, `program '${program.programId}' authority capability`) ||
      !requireText(program.authority.operation, `program '${program.programId}' authority operation`) ||
      (program.authority.access !== 'read' && program.authority.access !== 'write') ||
      !requireText(program.authority.resourceRef, `program '${program.programId}' authority resourceRef`)
    ) {
      throw new Error(`program '${program.programId}' authority binding is invalid`)
    }
    if (
      !program.graph ||
      (program.graph.mode !== 'home' && program.graph.mode !== 'input-field') ||
      (program.graph.mode === 'input-field' && !requireText(program.graph.inputField, `program '${program.programId}' graph inputField`))
    ) {
      throw new Error(`program '${program.programId}' graph binding is invalid`)
    }
    if (programIds.has(program.programId)) throw new Error(`duplicate programId '${program.programId}'`)
    const target = `${program.workflowName}\u0000${program.workflowUri}`
    if (targets.has(target)) throw new Error(`duplicate program target '${program.workflowName}'`)
    const capability = grant.capabilities.find(
      (candidate) =>
        candidate.capability === program.authority.capability &&
        (candidate.operations.includes(program.authority.operation) || candidate.operations.includes('*')),
    )
    if (!capability || (program.authority.access === 'write' && capability.access !== 'write')) {
      throw new Error(`program '${program.programId}' is outside the steward-issued grant`)
    }
    const policy = capability.operationPolicies?.[program.authority.operation] ?? capability.approvalPolicy
    if (policy === 'human-always') {
      throw new Error(`program '${program.programId}' needs a proposed-effect approval path, not immediate invocation`)
    }
    if (
      capability.fence.resourcePrefixes?.length &&
      !capability.fence.resourcePrefixes.some((prefix) => program.authority.resourceRef.startsWith(prefix))
    ) {
      throw new Error(`program '${program.programId}' resource is outside the steward-issued grant fence`)
    }
    const graphConstrained = Boolean(capability.fence.graphIds?.length || capability.fence.graphIdPrefixes?.length)
    if (program.graph.mode === 'input-field' && !graphConstrained) {
      throw new Error(`cross-graph program '${program.programId}' requires a steward-issued graph fence`)
    }
    if (
      program.graph.mode === 'home' &&
      graphConstrained &&
      !capability.fence.graphIds?.includes(homeGraphId) &&
      !capability.fence.graphIdPrefixes?.some((prefix) => homeGraphId.startsWith(prefix))
    ) {
      throw new Error(`program '${program.programId}' home graph is outside the steward-issued grant fence`)
    }
    if (capability.quota.maxPerWave === 0 || capability.quota.maxPerDay === 0 || capability.quota.maxConcurrent === 0) {
      throw new Error(`program '${program.programId}' is disabled by its steward-issued quota`)
    }
    programIds.add(program.programId)
    targets.add(target)
    return {
      ...program,
      inputSchema: structuredClone(program.inputSchema),
    }
  })
}

function validateTriggerBinding(
  trigger: DomainAgentTriggerBinding,
  consents: Readonly<Record<string, DomainTriggerConsent>>,
  grantAuthorityOwnerPrincipal: string,
): DomainAgentTriggerBinding {
  if (trigger.ingress === 'internal-service') {
    if (!trigger.adapter?.trim()) throw new Error(`internal trigger '${trigger.kind}' requires an adapter`)
    if (!trigger.consentRef) throw new Error(`internal trigger '${trigger.kind}' requires a consentRef`)
  }
  if (trigger.ingress === 'owner' && (trigger.adapter || trigger.consentRef)) {
    throw new Error(`owner trigger '${trigger.kind}' cannot claim an internal adapter or consentRef`)
  }
  if (trigger.sourceFence) {
    if (trigger.sourceFence.resourcePrefixes.length === 0 || trigger.sourceFence.resourcePrefixes.some((value) => !value.trim())) {
      throw new Error(`trigger '${trigger.kind}' source fence needs non-empty resource prefixes`)
    }
    const max = trigger.sourceFence.maxContextRefs
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0 || max > 10_000)) {
      throw new Error(`trigger '${trigger.kind}' maxContextRefs is invalid`)
    }
  }
  if (!trigger.consentRef) return { ...trigger, ingress: trigger.ingress ?? 'owner' }
  const consent = consents[trigger.consentRef.documentId]
  if (!consent) throw new Error(`trigger '${trigger.kind}' references missing consent document`)
  if (
    trigger.consentRef.ownerPrincipal !== undefined &&
    trigger.consentRef.ownerPrincipal !== grantAuthorityOwnerPrincipal
  ) {
    throw new Error(`trigger '${trigger.kind}' consent owner is inconsistent`)
  }
  if (trigger.consentRef.graphId !== consent.authorityGraphId) throw new Error('trigger consent graph is inconsistent')
  if (trigger.consentRef.expectedDigest !== domainTriggerConsentDigest(consent)) {
    throw new Error(`trigger '${trigger.kind}' consent digest is inconsistent`)
  }
  if (consent.adapter !== trigger.adapter || !consent.triggerKinds.includes(trigger.kind)) {
    throw new Error(`trigger '${trigger.kind}' is outside its consent scope`)
  }
  for (const prefix of trigger.sourceFence?.resourcePrefixes ?? []) {
    if (!consent.sourcePrefixes.some((allowed) => prefix.startsWith(allowed))) {
      throw new Error(`trigger '${trigger.kind}' source fence exceeds consent`)
    }
  }
  if ((trigger.sourceFence?.maxContextRefs ?? 0) > consent.maxContextRefs) {
    throw new Error(`trigger '${trigger.kind}' context fence exceeds consent`)
  }
  return {
    ...trigger,
    ingress: trigger.ingress ?? 'owner',
    consentRef: { ...trigger.consentRef, ownerPrincipal: grantAuthorityOwnerPrincipal },
  }
}

function validateAuthorityOwner(value: string): string {
  const owner = requireText(value, 'grantAuthorityOwnerPrincipal')
  if (owner === DOMAIN_AUTHORITY_OWNER_BINDING) return owner
  if (!/^(user|agent|service|organization):[^/\s]+$/.test(owner)) {
    throw new Error('grantAuthorityOwnerPrincipal must be a typed owner or the provisioner binding')
  }
  return owner
}

function buildPromptSnapshot(graphId: string, documentId: string, renderedText: string, renderedAt: number) {
  const renderedDigest = createHash('sha256').update(renderedText).digest('hex')
  const snapshotSeed = { graphId, documentId, renderedDigest }
  return {
    schema: 'sophia.agent-prompt-snapshot.v1',
    snapshotId: `aps_${contentDigest(snapshotSeed).slice(0, 24)}`,
    graphId,
    documentId,
    documentUri: `urn:mnemosyne:local:document:${documentId}`,
    renderedText,
    renderedDigest,
    blocks: [],
    renderedAt,
  }
}

function buildPromptBinding(input: {
  registeredName: string
  agentId: string
  agentUri: string
  promptDocumentId: string
  snapshot: ReturnType<typeof buildPromptSnapshot>
  provider: string
  model: string
  promotedBy: string
  promotedAt: number
}) {
  const bindingSeed = {
    agentId: input.agentId,
    provider: input.provider,
    model: input.model,
    snapshotId: input.snapshot.snapshotId,
    renderedDigest: input.snapshot.renderedDigest,
  }
  return {
    schema: 'sophia.agent-prompt-binding.v1',
    bindingId: `apb_${contentDigest(bindingSeed).slice(0, 24)}`,
    agentId: input.agentId,
    agentUri: input.agentUri,
    registeredName: input.registeredName,
    identityAlgorithm: STANDALONE_AGENT_IDENTITY_ALGORITHM,
    promptRole: 'system',
    promptDocumentId: input.promptDocumentId,
    snapshot: input.snapshot,
    inference: { provider: input.provider, model: input.model },
    status: 'active',
    promotedAt: input.promotedAt,
    promotedBy: input.promotedBy,
  }
}

function buildToolManifest(input: {
  registeredName: string
  agentId: string
  agentUri: string
  graphId: string
  declaredBy: string
  now: number
  grant: DomainToolbeltGrant
  directTools: readonly DomainDirectTool[]
}) {
  const sourceRefs = [
    { sourceKind: 'DomainKit', sourceLabel: 'graph-defined agent seed', externalId: input.registeredName },
  ]
  const capabilities = input.grant.capabilities.map((capability) => ({
    capabilityId: `cap_${slug(capability.capability)}`,
    capabilityUri: `${input.agentUri}:cap:${slug(capability.capability)}`,
    name: capability.capability,
    kind: capabilityKind(capability.capability),
    backend: capability.capability,
    scope: { graphId: input.graphId },
    access: capability.access,
    risk: capability.approvalPolicy === 'ordinary' ? 'medium' : 'high',
    approvalPolicy: manifestApprovalPolicy(capability.approvalPolicy),
    sourceRefs,
  }))
  const manifestId = `atm_${createHash('sha256').update(`${input.agentId}:1`).digest('hex').slice(0, 16)}`
  return {
    schema: 'sophia.agent-tool-manifest.v0',
    manifestId,
    manifestUri: `${input.agentUri}:tool-manifest:1`,
    agentId: input.agentId,
    agentUri: input.agentUri,
    version: 1,
    status: 'active',
    sourceRefs,
    createdAt: input.now,
    updatedAt: input.now,
    declaredBy: { actorId: input.declaredBy, actorKind: 'human' },
    policy: {
      toolMode: 'dynamic',
      mcpProfile: 'chat',
      defaultAccess: 'read',
      defaultRisk: 'low',
      includeTools: input.directTools.map((tool) => tool.name),
      excludeTools: [],
      requireApprovalFor: ['write', 'dangerous', 'external-side-effect'],
      allowUndeclaredDiscoveredTools: false,
    },
    capabilities,
    tools: input.directTools.map((tool) => ({
      toolId: `tool_${slug(tool.name)}`,
      toolUri: `${input.agentUri}:tool:${slug(tool.name)}`,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      capability: tool.capability,
      server: tool.server ?? tool.capability,
      access: tool.access,
      risk: tool.risk,
      state: 'declared',
      required: tool.required,
      approvalPolicy: { mode: tool.access === 'read' ? 'never' : 'always', driverRequired: tool.access === 'write' },
      sourceRefs,
    })),
    notes: 'Generated by @shrubbery/domain-kit; effective authority is the intersection with the Layer 0 grant.',
  }
}

function manifestApprovalPolicy(policy: 'ordinary' | 'notify' | 'human-always') {
  if (policy === 'human-always') return { mode: 'always', driverRequired: true }
  if (policy === 'notify') return { mode: 'on-risk', driverRequired: false, reason: 'notify steward after execution' }
  return { mode: 'never' }
}

function capabilityKind(capability: string): string {
  if (capability === 'mnemosyne' || capability === 'garden-mcp') return 'mnemosyne'
  if (capability === 'browser') return 'web'
  if (capability === 'workflow') return 'workflow'
  if (capability === 'site') return 'kg'
  return 'runtime'
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

export function domainAgentBundleDocument(bundle: DomainAgentSeedBundle): string {
  return `${stableJson(bundle)}\n`
}
