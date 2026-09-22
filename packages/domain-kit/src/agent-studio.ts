export const AGENT_STUDIO_PROFILE_SCHEMA = 'sophia.agent-studio-profile.v1' as const
export const DOMAIN_AGENT_DEFINITION_V2_SCHEMA = 'sophia.domain-agent-definition.v2' as const
export const AGENT_RUNTIME_BINDING_V2_SCHEMA = 'choreograph.agent-runtime-binding.v2' as const
export const AGENT_ONTOLOGY_BINDING_V1_SCHEMA = 'sophia.agent-ontology-binding.v1' as const
export const MEANINGFUL_OBJECT_REF_V1_SCHEMA = 'sophia.meaningful-object-ref.v1' as const
export const AGENT_PROMPT_BINDING_V1_SCHEMA = 'sophia.agent-prompt-binding.v1' as const
export const AGENT_PROMPT_SNAPSHOT_V1_SCHEMA = 'sophia.agent-prompt-snapshot.v1' as const
export const AGENT_TOOL_MANIFEST_V0_SCHEMA = 'sophia.agent-tool-manifest.v0' as const
export const AGENT_TOOL_GRANT_V1_SCHEMA = 'sophia.agent-toolbelt-grant.v1' as const
export const AGENT_STUDIO_IDENTITY_ALGORITHM = 'agent-identity-v1-registered-name' as const

export const SOPHIA_CLUSTER_LEAD_HARNESS = Object.freeze({
  schema: 'sophia.agent-harness.v1',
  harnessId: 'sophia-cluster-lead-harness-v1',
  agentId: 'agent-bc89d2e0cffd0e86',
  mappings: {
    inference: 'choreograph.model-gateway',
    sessionEvents: 'choreograph.agent-session',
    graphMemory: 'garden.mcp',
    checkpoint: 'choreograph.agent-checkpoint',
    client: 'vehicle.agent-session',
  },
  forbiddenAuthorities: [
    'provider credentials in sandbox',
    'graph credentials in sandbox',
    'ambient network',
    'direct durable graph mutation outside granted tools',
    'local durable state authority',
  ],
})

export const SOPHIA_CLUSTER_LEAD_HARNESS_DIGEST =
  '13d6961bb2911d7aadfe0b46218a64952a4cc78784de72b91fc88c6045f8a4f8'

const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/
const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const REGISTERED_NAME = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/
const TYPED_OWNER = /^(?:user|agent|service|organization):[^/\s]+$/
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/

export type AgentStudioInferenceProvider = 'openrouter' | 'openai-codex'
export type AgentStudioRuntimeKind = 'prime' | 'simple'
export type AgentStudioApprovalPolicy = 'ordinary' | 'notify' | 'human-always'

export interface AgentStudioGraphAddress {
  readonly ownerPrincipal: string
  readonly graphId: string
}

export interface AgentStudioRuntimeConstraints {
  readonly maxTurns: number
  readonly maxWallTimeMs: number
  readonly maxTokens: number
  readonly maxPromptTokensPerCall: number
  readonly maxCompletionTokensPerCall: number
  readonly maxInlineToolResultBytes: number
  readonly maxCostUsdMicros: number
  readonly maxChildren: number
  readonly maxChildDepth: number
  readonly maxConcurrentChildren: number
  readonly maxArtifactBytes: number
  readonly idlePassivateMs: number
  readonly allowPersistentKernel: boolean
  readonly allowAutonomousContinuation: boolean
  readonly allowSchedules: boolean
  readonly allowWorkflowProposals: boolean
}

export interface AgentStudioRuntimeProfile {
  readonly kind: AgentStudioRuntimeKind
  readonly bundle: { readonly id: 'sophia-agent-runtime'; readonly digest: string }
  readonly constraints: AgentStudioRuntimeConstraints
}

export type AgentStudioMeaningfulObjectKind =
  | 'skill'
  | 'harness'

export interface AgentStudioMeaningfulObjectRef<Kind extends AgentStudioMeaningfulObjectKind = AgentStudioMeaningfulObjectKind> {
  readonly schema: typeof MEANINGFUL_OBJECT_REF_V1_SCHEMA
  readonly kind: Kind
  readonly ownerPrincipal: string
  readonly graphId: string
  readonly objectId: string
  readonly version: string
  readonly digest: string
}

export interface AgentStudioTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly capability: string
  readonly server?: string
  readonly access: 'read' | 'write'
  readonly destructive: boolean
  readonly risk: 'low' | 'medium' | 'high'
  readonly required: boolean
}

export interface AgentStudioGrantCapability {
  readonly capability: string
  readonly operations: readonly string[]
  readonly access: 'read' | 'write'
  readonly approvalPolicy: AgentStudioApprovalPolicy
  readonly operationPolicies?: Readonly<Record<string, AgentStudioApprovalPolicy>>
  readonly fence: {
    readonly graphIds?: readonly string[]
    readonly graphIdPrefixes?: readonly string[]
    readonly originPrefixes?: readonly string[]
    readonly branchPrefixes?: readonly string[]
    readonly resourcePrefixes?: readonly string[]
    readonly pathPrefixes?: readonly string[]
    readonly builderRecipeDigests?: readonly string[]
    readonly maxPayloadBytes?: number
    readonly maxTtlHours?: number
    readonly requiredScopeSchema?: string
    readonly requiredDatasetObjectKind?: string
  }
  readonly quota: {
    readonly maxPerWave?: number
    readonly maxPerDay?: number
    readonly maxConcurrent?: number
    readonly maxCostMicrousd?: number
  }
}

export interface AgentStudioTrigger {
  readonly kind: string
  readonly enabled: boolean
  readonly mode?: string
  readonly ingress?: 'owner' | 'internal-service'
  readonly adapter?: string
  readonly consentRef?: {
    readonly ownerPrincipal: string
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

export interface AgentStudioProfileV1 {
  readonly schema: typeof AGENT_STUDIO_PROFILE_SCHEMA
  readonly registeredName: string
  readonly displayName: string
  readonly home: AgentStudioGraphAddress
  readonly grantAuthority: AgentStudioGraphAddress
  readonly charter: string
  readonly prompt: string
  readonly geist: string
  readonly inference: {
    readonly provider: AgentStudioInferenceProvider
    readonly pilotModel: string
    readonly emanationModel: string
  }
  readonly runtimes: {
    readonly pilot: AgentStudioRuntimeProfile
    readonly emanation: AgentStudioRuntimeProfile
  }
  readonly ontology: {
    readonly skills: readonly AgentStudioMeaningfulObjectRef<'skill'>[]
    readonly harness: AgentStudioMeaningfulObjectRef<'harness'>
  }
  readonly tools: readonly AgentStudioTool[]
  readonly grant: {
    readonly status: 'active' | 'suspended' | 'revoked' | 'expired'
    readonly capabilities: readonly AgentStudioGrantCapability[]
    readonly sourceRefs: readonly string[]
  }
  readonly budgets: {
    readonly pilotMaxTurns: number
    readonly emanationMaxTurns: number
    readonly maxEmanations: number
    readonly maxProposedEffects: number
    readonly maxProgramInvocations: number
  }
  readonly emanations: { readonly enabled: boolean; readonly depth: 1 }
  readonly triggers: readonly AgentStudioTrigger[]
  readonly responseSchema: Readonly<Record<string, unknown>>
}

export interface AgentStudioPublicationContext {
  readonly promotedBy: string
  readonly promotedAt: number
  /** Exact reread witness for the newly written, versioned prompt document. */
  readonly promptDocument: {
    readonly revision?: number
    readonly changeId?: string
  }
}

export interface AgentStudioCompiledPublication {
  readonly schema: 'sophia.agent-studio-publication.v1'
  readonly profileDigest: string
  readonly publicationId: string
  readonly agentId: string
  readonly agentUri: string
  readonly definitionDocumentId: 'domain-agent-definition'
  readonly definition: Readonly<Record<string, unknown>>
  readonly homeDocuments: Readonly<Record<string, string>>
  readonly authorityDocuments: Readonly<Record<string, string>>
  readonly activeDocumentIds: {
    readonly charter: string
    readonly prompt: string
    readonly promptBinding: string
    readonly toolManifest: string
    readonly grant: string
  }
  readonly digest: string
}

export interface AgentStudioVersionedDocumentIds {
  readonly charter: string
  readonly prompt: string
  readonly promptBinding: string
  readonly toolManifest: string
  readonly grant: string
  readonly agent: string
  readonly geist: string
  readonly pilotProfile: string
  readonly emanationProfile: string
}

export const PRIME_RUNTIME_BASELINE: AgentStudioRuntimeConstraints = Object.freeze({
  maxTurns: 24,
  maxWallTimeMs: 900_000,
  maxTokens: 500_000,
  maxPromptTokensPerCall: 240_000,
  maxCompletionTokensPerCall: 32_000,
  maxInlineToolResultBytes: 32_768,
  maxCostUsdMicros: 1_000_000,
  maxChildren: 4,
  maxChildDepth: 2,
  maxConcurrentChildren: 2,
  maxArtifactBytes: 268_435_456,
  idlePassivateMs: 60_000,
  allowPersistentKernel: true,
  allowAutonomousContinuation: false,
  allowSchedules: true,
  allowWorkflowProposals: false,
})

export const SIMPLE_RUNTIME_BASELINE: AgentStudioRuntimeConstraints = Object.freeze({
  maxTurns: 6,
  maxWallTimeMs: 300_000,
  maxTokens: 20_000,
  maxPromptTokensPerCall: 16_000,
  maxCompletionTokensPerCall: 4_000,
  maxInlineToolResultBytes: 16_384,
  maxCostUsdMicros: 500_000,
  maxChildren: 0,
  maxChildDepth: 0,
  maxConcurrentChildren: 0,
  maxArtifactBytes: 268_435_456,
  idlePassivateMs: 0,
  allowPersistentKernel: false,
  allowAutonomousContinuation: false,
  allowSchedules: false,
  allowWorkflowProposals: false,
})

export function createSophiaClusterLeadProfile(input: {
  readonly ownerPrincipal: string
  readonly runtimeBundleDigest: string
}): AgentStudioProfileV1 {
  const ownerPrincipal = typedOwner(input.ownerPrincipal, 'ownerPrincipal')
  const runtimeBundleDigest = digest(input.runtimeBundleDigest, 'runtimeBundleDigest')
  const graphId = 'sophia-cluster'
  return {
    schema: AGENT_STUDIO_PROFILE_SCHEMA,
    registeredName: 'sophia-cluster-lead',
    displayName: 'Sophia Cluster Lead',
    home: { ownerPrincipal, graphId },
    grantAuthority: { ownerPrincipal, graphId: 'observatory' },
    charter: [
      'You are the lead resident of the Sophia cluster.',
      'Work as Vera’s thoughtful technical partner: preserve evidence, surface uncertainty, and make changes only inside explicit authority.',
      'Prefer durable graph testimony and reviewed source over ambient state. Delegate bounded work, integrate it critically, and keep the human in command of consequential effects.',
    ].join('\n\n'),
    prompt: [
      'Begin by understanding the current workspace, its living documents, and the active request.',
      'Maintain continuity across Sessions through the home graph and your durable runtime state.',
      'When a task is complex, propose a small falsifiable plan, use bounded collaborators where useful, and report outcomes in plain language.',
    ].join('\n\n'),
    geist: 'A steady, curious lead engineer and research partner: rigorous about authority, warm in conversation, and delighted by elegant systems.',
    inference: {
      provider: 'openai-codex',
      pilotModel: 'gpt-5.6-sol',
      emanationModel: 'gpt-5.6-luna',
    },
    runtimes: {
      pilot: {
        kind: 'prime',
        bundle: { id: 'sophia-agent-runtime', digest: runtimeBundleDigest },
        constraints: { ...PRIME_RUNTIME_BASELINE },
      },
      emanation: {
        kind: 'simple',
        bundle: { id: 'sophia-agent-runtime', digest: runtimeBundleDigest },
        constraints: { ...SIMPLE_RUNTIME_BASELINE },
      },
    },
    ontology: {
      skills: [],
      harness: {
        schema: MEANINGFUL_OBJECT_REF_V1_SCHEMA,
        kind: 'harness',
        ownerPrincipal,
        graphId,
        objectId: SOPHIA_CLUSTER_LEAD_HARNESS.harnessId,
        version: '1',
        digest: `sha256:${SOPHIA_CLUSTER_LEAD_HARNESS_DIGEST}`,
      },
    },
    tools: [
      {
        name: 'recall',
        title: 'Recall',
        description: 'Read durable context from an authorized graph.',
        capability: 'mnemosyne',
        access: 'read',
        destructive: false,
        risk: 'low',
        required: true,
      },
      {
        name: 'search_documents',
        title: 'Search documents',
        description: 'Find documents in the authorized workspace.',
        capability: 'mnemosyne',
        access: 'read',
        destructive: false,
        risk: 'low',
        required: true,
      },
      {
        name: 'remember',
        title: 'Remember',
        description: 'Queue durable memory for the authorized workspace.',
        capability: 'mnemosyne',
        access: 'write',
        destructive: true,
        risk: 'medium',
        required: false,
      },
    ],
    grant: {
      status: 'active',
      capabilities: [
        {
          capability: 'mnemosyne',
          operations: ['recall', 'search_documents', 'remember'],
          access: 'write',
          approvalPolicy: 'ordinary',
          fence: { graphIds: [graphId], maxPayloadBytes: 65_536 },
          quota: { maxPerWave: 32, maxPerDay: 512, maxConcurrent: 4 },
        },
      ],
      sourceRefs: ['urn:sophia:review:sophia-cluster-lead'],
    },
    budgets: {
      pilotMaxTurns: 24,
      emanationMaxTurns: 6,
      maxEmanations: 4,
      maxProposedEffects: 16,
      maxProgramInvocations: 0,
    },
    emanations: { enabled: true, depth: 1 },
    triggers: [
      {
        kind: 'sophia-cluster.message',
        enabled: true,
        mode: 'direct-owner-session',
        ingress: 'owner',
        sourceFence: {
          resourcePrefixes: [`graph:${graphId}:`, `vehicle:${graphId}:`],
          eventIdRequired: true,
          maxContextRefs: 256,
        },
      },
    ],
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['response'],
      properties: { response: { type: 'string' } },
    },
  }
}

export function parseAgentStudioProfile(value: unknown): AgentStudioProfileV1 {
  const profile = record(value, 'agent studio profile')
  exactKeys(profile, [
    'schema', 'registeredName', 'displayName', 'home', 'grantAuthority', 'charter', 'prompt', 'geist',
    'inference', 'runtimes', 'ontology', 'tools', 'grant', 'budgets', 'emanations', 'triggers', 'responseSchema',
  ], 'agent studio profile')
  if (profile.schema !== AGENT_STUDIO_PROFILE_SCHEMA) throw new Error('agent studio profile schema is unsupported')
  const registeredName = text(profile.registeredName, 'registeredName', 64)
  if (!REGISTERED_NAME.test(registeredName)) throw new Error('registeredName must be a stable lowercase slug')
  text(profile.displayName, 'displayName', 128)
  graphAddress(profile.home, 'home')
  graphAddress(profile.grantAuthority, 'grantAuthority')
  text(profile.charter, 'charter', 32_000)
  text(profile.prompt, 'prompt', 64_000)
  text(profile.geist, 'geist', 16_000)
  const inference = record(profile.inference, 'inference')
  exactKeys(inference, ['provider', 'pilotModel', 'emanationModel'], 'inference')
  if (inference.provider !== 'openrouter' && inference.provider !== 'openai-codex') {
    throw new Error('inference.provider is unsupported')
  }
  text(inference.pilotModel, 'inference.pilotModel', 256)
  text(inference.emanationModel, 'inference.emanationModel', 256)
  const runtimes = record(profile.runtimes, 'runtimes')
  exactKeys(runtimes, ['pilot', 'emanation'], 'runtimes')
  runtime(runtimes.pilot, 'runtimes.pilot', 'prime')
  runtime(runtimes.emanation, 'runtimes.emanation', 'simple')
  const ontology = record(profile.ontology, 'ontology')
  exactKeys(ontology, ['skills', 'harness'], 'ontology')
  if (!Array.isArray(ontology.skills) || ontology.skills.length > 32) throw new Error('ontology.skills is invalid')
  const skillKeys = new Set<string>()
  for (const [index, skill] of ontology.skills.entries()) {
    meaningfulObjectRef(skill, `ontology.skills[${index}]`, 'skill')
    const key = canonicalJson(skill)
    if (skillKeys.has(key)) throw new Error('ontology.skills contains a duplicate')
    skillKeys.add(key)
  }
  meaningfulObjectRef(ontology.harness, 'ontology.harness', 'harness')
  if (!Array.isArray(profile.tools) || profile.tools.length > 128) throw new Error('tools is invalid')
  const toolNames = new Set<string>()
  for (const [index, toolValue] of profile.tools.entries()) {
    const tool = record(toolValue, `tools[${index}]`)
    exactKeys(tool, ['name', 'title', 'description', 'capability', 'server', 'access', 'destructive', 'risk', 'required'], `tools[${index}]`, true)
    const name = text(tool.name, `tools[${index}].name`, 128)
    if (!TOOL_NAME.test(name)) throw new Error(`tools[${index}].name is invalid`)
    if (toolNames.has(name)) throw new Error(`duplicate tool '${name}'`)
    toolNames.add(name)
    text(tool.title, `tools[${index}].title`, 256)
    text(tool.description, `tools[${index}].description`, 2_000)
    text(tool.capability, `tools[${index}].capability`, 128)
    if (tool.server !== undefined) text(tool.server, `tools[${index}].server`, 128)
    if (tool.access !== 'read' && tool.access !== 'write') throw new Error(`tools[${index}].access is invalid`)
    if (typeof tool.destructive !== 'boolean' || typeof tool.required !== 'boolean') throw new Error(`tools[${index}] booleans are invalid`)
    if (tool.risk !== 'low' && tool.risk !== 'medium' && tool.risk !== 'high') throw new Error(`tools[${index}].risk is invalid`)
  }
  grant(profile.grant, toolNames)
  budgets(profile.budgets)
  const emanations = record(profile.emanations, 'emanations')
  exactKeys(emanations, ['enabled', 'depth'], 'emanations')
  if (typeof emanations.enabled !== 'boolean' || emanations.depth !== 1) throw new Error('emanations is invalid')
  if (!Array.isArray(profile.triggers) || profile.triggers.length < 1 || profile.triggers.length > 32) {
    throw new Error('triggers must contain 1..32 entries')
  }
  for (const [index, trigger] of profile.triggers.entries()) validateTrigger(trigger, index)
  record(profile.responseSchema, 'responseSchema')
  return structuredClone(profile) as unknown as AgentStudioProfileV1
}

export async function agentStudioVersionedDocumentIds(
  value: unknown,
  context: Pick<AgentStudioPublicationContext, 'promotedBy' | 'promotedAt'>,
): Promise<AgentStudioVersionedDocumentIds> {
  const profile = parseAgentStudioProfile(value)
  const profileDigest = await sha256Canonical(profile)
  const promotedBy = typedOwner(context.promotedBy, 'promotedBy')
  const promotedAt = nonNegativeInteger(context.promotedAt, 'promotedAt')
  return versionedDocumentIds(
    profile.registeredName,
    (await sha256Canonical({ profileDigest, promotedBy, promotedAt })).slice(0, 24),
  )
}

export async function compileAgentStudioProfile(
  value: unknown,
  context: AgentStudioPublicationContext,
): Promise<AgentStudioCompiledPublication> {
  const profile = parseAgentStudioProfile(value)
  const promotedBy = typedOwner(context.promotedBy, 'promotedBy')
  const promotedAt = nonNegativeInteger(context.promotedAt, 'promotedAt')
  const promptRevision = context.promptDocument.revision === undefined
    ? undefined
    : nonNegativeInteger(context.promptDocument.revision, 'promptDocument.revision')
  const promptChangeId = context.promptDocument.changeId === undefined
    ? undefined
    : text(context.promptDocument.changeId, 'promptDocument.changeId', 512)
  if (promotedBy !== profile.home.ownerPrincipal || promotedBy !== profile.grantAuthority.ownerPrincipal) {
    throw new Error('publisher must own both the home and grant authority graphs')
  }
  const profileDigest = await sha256Canonical(profile)
  const version = (await sha256Canonical({ profileDigest, promotedBy, promotedAt })).slice(0, 24)
  const agentId = await mintAgentId(profile.registeredName)
  const agentUri = `urn:sophia:agent:${agentId}`
  const ids = versionedDocumentIds(profile.registeredName, version)
  for (const documentId of Object.values(ids)) {
    if (!DOCUMENT_ID.test(documentId)) throw new Error(`compiled document id '${documentId}' is invalid`)
  }
  const promptText = profile.prompt.trim()
  const promptDigest = await sha256Text(promptText)
  const promptSnapshot = {
    schema: AGENT_PROMPT_SNAPSHOT_V1_SCHEMA,
    snapshotId: `aps_${(await sha256Canonical({
      graphId: profile.home.graphId,
      documentId: ids.prompt,
      revision: promptRevision,
      changeId: promptChangeId,
      renderedDigest: promptDigest,
    })).slice(0, 24)}`,
    graphId: profile.home.graphId,
    documentId: ids.prompt,
    documentUri: `urn:mnemosyne:local:document:${ids.prompt}`,
    renderedText: promptText,
    renderedDigest: promptDigest,
    ...(promptRevision === undefined ? {} : { revision: promptRevision }),
    ...(promptChangeId === undefined ? {} : { changeId: promptChangeId }),
    blocks: [],
    renderedAt: promotedAt,
  }
  const promptBinding = {
    schema: AGENT_PROMPT_BINDING_V1_SCHEMA,
    bindingId: `apb_${(await sha256Canonical({ agentId, provider: profile.inference.provider, model: profile.inference.pilotModel, snapshotId: promptSnapshot.snapshotId, renderedDigest: promptDigest })).slice(0, 24)}`,
    agentId,
    agentUri,
    registeredName: profile.registeredName,
    identityAlgorithm: AGENT_STUDIO_IDENTITY_ALGORITHM,
    promptRole: 'system',
    promptDocumentId: ids.prompt,
    snapshot: promptSnapshot,
    inference: { provider: profile.inference.provider, model: profile.inference.pilotModel },
    status: 'active',
    promotedAt,
    promotedBy,
  }
  const grantDocument = {
    schema: AGENT_TOOL_GRANT_V1_SCHEMA,
    grantId: ids.grant,
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: profile.grantAuthority.graphId,
    issuedAt: promotedAt,
    status: profile.grant.status,
    capabilities: profile.grant.capabilities,
    sourceRefs: profile.grant.sourceRefs,
  }
  const grantDigest = await sha256Canonical(grantDocument)
  const toolManifest = await buildToolManifest(profile, { agentId, agentUri, promotedBy, promotedAt, manifestId: ids.toolManifest })
  const { manifestId: _manifestId, ...manifestWithoutId } = toolManifest
  const manifestDigest = await sha256Canonical(manifestWithoutId)
  const agentObject = {
    schema: 'sophia.agent-object.v1',
    agentId,
    agentUri,
    registeredName: profile.registeredName,
    displayName: profile.displayName,
    home: profile.home,
    identityAlgorithm: AGENT_STUDIO_IDENTITY_ALGORITHM,
  }
  const geistObject = {
    schema: 'sophia.geist.v1',
    agentId,
    text: profile.geist.trim(),
  }
  const pilotRuntime = await runtimeBinding(profile, ids.pilotProfile, profile.runtimes.pilot)
  const emanationRuntime = await runtimeBinding(profile, ids.emanationProfile, profile.runtimes.emanation)
  const definition = {
    schema: DOMAIN_AGENT_DEFINITION_V2_SCHEMA,
    registeredName: profile.registeredName,
    agentId,
    agentUri,
    homeGraphId: profile.home.graphId,
    runtimes: { pilot: pilotRuntime, emanation: emanationRuntime },
    ontology: {
      objects: {
        agent: await objectRef('agent', profile.home, agentUri, profileDigest, agentObject),
        geist: await objectRef('geist', profile.home, ids.geist, profileDigest, geistObject),
        prompt: await objectRef('prompt', profile.home, promptBinding.bindingId, promptSnapshot.snapshotId, promptText, promptDigest),
        skills: profile.ontology.skills,
        harness: profile.ontology.harness,
        toolManifest: await objectRef('tool-manifest', profile.home, toolManifest.manifestId, String(toolManifest.version), toolManifest, manifestDigest),
        toolGrant: await objectRef('tool-grant', profile.grantAuthority, grantDocument.grantId, String(promotedAt), grantDocument, grantDigest),
      },
    },
    charterDocumentId: ids.charter,
    promptBindingDocumentId: ids.promptBinding,
    toolManifestDocumentId: ids.toolManifest,
    grantRef: {
      ownerPrincipal: profile.grantAuthority.ownerPrincipal,
      graphId: profile.grantAuthority.graphId,
      documentId: ids.grant,
      expectedDigest: grantDigest,
    },
    models: {
      provider: profile.inference.provider,
      pilot: profile.inference.pilotModel,
      emanation: profile.inference.emanationModel,
    },
    budgets: profile.budgets,
    emanations: profile.emanations,
    triggers: profile.triggers,
    programs: [],
    responseSchema: profile.responseSchema,
  }
  const homeDocuments: Record<string, string> = {
    [ids.agent]: prettyJson(agentObject),
    [ids.geist]: prettyJson(geistObject),
    [ids.pilotProfile]: prettyJson(pilotRuntime),
    [ids.emanationProfile]: prettyJson(emanationRuntime),
    [ids.charter]: `${profile.charter.trim()}\n`,
    [ids.prompt]: `${promptText}\n`,
    [ids.promptBinding]: prettyJson(promptBinding),
    [ids.toolManifest]: prettyJson(toolManifest),
    'domain-agent-definition': prettyJson(definition),
  }
  const authorityDocuments = { [ids.grant]: prettyJson(grantDocument) }
  const publicationCore = {
    schema: 'sophia.agent-studio-publication.v1' as const,
    profileDigest,
    publicationId: `asp_${(await sha256Canonical({ profileDigest, promotedBy, promotedAt })).slice(0, 24)}`,
    agentId,
    agentUri,
    definitionDocumentId: 'domain-agent-definition' as const,
    definition,
    homeDocuments,
    authorityDocuments,
    activeDocumentIds: {
      charter: ids.charter,
      prompt: ids.prompt,
      promptBinding: ids.promptBinding,
      toolManifest: ids.toolManifest,
      grant: ids.grant,
    },
  }
  return { ...publicationCore, digest: await sha256Canonical(publicationCore) }
}

async function runtimeBinding(profile: AgentStudioProfileV1, objectId: string, value: AgentStudioRuntimeProfile) {
  const profileValue = { kind: value.kind, constraints: value.constraints }
  return {
    schema: AGENT_RUNTIME_BINDING_V2_SCHEMA,
    kind: value.kind,
    bundle: { id: value.bundle.id, digest: prefixedDigest(value.bundle.digest) },
    profileRef: await objectRef(
      'agent-runtime-profile',
      profile.home,
      objectId,
      (await sha256Canonical(profileValue)).slice(0, 24),
      profileValue,
    ),
    constraints: value.constraints,
  }
}

function versionedDocumentIds(registeredName: string, version: string): AgentStudioVersionedDocumentIds {
  return {
    charter: `${registeredName}-charter-${version}`,
    prompt: `${registeredName}-prompt-${version}`,
    promptBinding: `${registeredName}-prompt-binding-${version}`,
    toolManifest: `${registeredName}-tool-manifest-${version}`,
    grant: `grant-${registeredName}-${version}`,
    agent: `${registeredName}-agent-${version}`,
    geist: `${registeredName}-geist-${version}`,
    pilotProfile: `${registeredName}-pilot-runtime-${version}`,
    emanationProfile: `${registeredName}-emanation-runtime-${version}`,
  }
}

async function buildToolManifest(
  profile: AgentStudioProfileV1,
  input: { agentId: string; agentUri: string; promotedBy: string; promotedAt: number; manifestId: string },
) {
  const sourceRefs = [{ sourceKind: 'AgentStudio', sourceLabel: 'reviewed graph profile', externalId: profile.registeredName }]
  const capabilities = profile.grant.capabilities.map(capability => ({
    capabilityId: `cap_${slug(capability.capability)}`,
    capabilityUri: `${input.agentUri}:cap:${slug(capability.capability)}`,
    name: capability.capability,
    kind: capabilityKind(capability.capability),
    backend: capability.capability,
    scope: { graphId: profile.home.graphId },
    access: capability.access,
    risk: capability.approvalPolicy === 'ordinary' ? 'medium' : 'high',
    approvalPolicy: manifestApprovalPolicy(capability.approvalPolicy),
    sourceRefs,
  }))
  return {
    schema: AGENT_TOOL_MANIFEST_V0_SCHEMA,
    manifestId: input.manifestId,
    manifestUri: `${input.agentUri}:tool-manifest:${input.manifestId}`,
    agentId: input.agentId,
    agentUri: input.agentUri,
    version: 1,
    status: 'active',
    sourceRefs,
    createdAt: input.promotedAt,
    updatedAt: input.promotedAt,
    declaredBy: { actorId: input.promotedBy, actorKind: 'human' },
    policy: {
      toolMode: profile.tools.length === 0 ? 'none' : 'dynamic',
      mcpProfile: 'chat',
      defaultAccess: 'read',
      defaultRisk: 'low',
      includeTools: profile.tools.map(tool => tool.name),
      excludeTools: [],
      requireApprovalFor: ['write', 'dangerous', 'external-side-effect'],
      allowUndeclaredDiscoveredTools: false,
    },
    capabilities,
    tools: profile.tools.map(tool => ({
      toolId: `tool_${slug(tool.name)}`,
      toolUri: `${input.agentUri}:tool:${slug(tool.name)}`,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      capability: tool.capability,
      server: tool.server ?? tool.capability,
      access: tool.access,
      destructive: tool.destructive,
      risk: tool.risk,
      state: 'declared',
      required: tool.required,
      approvalPolicy: { mode: tool.access === 'read' ? 'never' : 'always', driverRequired: tool.access === 'write' },
      sourceRefs,
    })),
    notes: 'Compiled by @shrubbery/domain-kit Agent Studio; effective authority is the manifest/grant intersection.',
  }
}

async function objectRef(
  kind: string,
  address: AgentStudioGraphAddress,
  objectId: string,
  version: string,
  value: unknown,
  knownDigest?: string,
) {
  return {
    schema: MEANINGFUL_OBJECT_REF_V1_SCHEMA,
    kind,
    ownerPrincipal: address.ownerPrincipal,
    graphId: address.graphId,
    objectId,
    version,
    digest: `sha256:${knownDigest ?? await sha256Canonical(value)}`,
  }
}

function runtime(value: unknown, label: string, expectedKind: AgentStudioRuntimeKind): void {
  const candidate = record(value, label)
  exactKeys(candidate, ['kind', 'bundle', 'constraints'], label)
  if (candidate.kind !== expectedKind) throw new Error(`${label}.kind must be '${expectedKind}'`)
  const bundle = record(candidate.bundle, `${label}.bundle`)
  exactKeys(bundle, ['id', 'digest'], `${label}.bundle`)
  if (bundle.id !== 'sophia-agent-runtime') throw new Error(`${label}.bundle.id is unsupported`)
  digest(bundle.digest, `${label}.bundle.digest`)
  constraints(candidate.constraints, `${label}.constraints`, expectedKind)
}

function constraints(value: unknown, label: string, kind: AgentStudioRuntimeKind): void {
  const candidate = record(value, label)
  const numeric = [
    'maxTurns', 'maxWallTimeMs', 'maxTokens', 'maxPromptTokensPerCall', 'maxCompletionTokensPerCall',
    'maxInlineToolResultBytes', 'maxCostUsdMicros', 'maxChildren', 'maxChildDepth', 'maxConcurrentChildren',
    'maxArtifactBytes', 'idlePassivateMs',
  ] as const
  const boolean = ['allowPersistentKernel', 'allowAutonomousContinuation', 'allowSchedules', 'allowWorkflowProposals'] as const
  exactKeys(candidate, [...numeric, ...boolean], label)
  for (const key of numeric) nonNegativeInteger(candidate[key], `${label}.${key}`)
  for (const key of boolean) if (typeof candidate[key] !== 'boolean') throw new Error(`${label}.${key} must be boolean`)
  if (candidate.maxTurns === 0 || candidate.maxWallTimeMs === 0 || candidate.maxTokens === 0 || candidate.maxArtifactBytes === 0) {
    throw new Error(`${label} primary ceilings must be positive`)
  }
  if (kind === 'simple' && (
    candidate.maxChildren !== 0 || candidate.maxChildDepth !== 0 || candidate.maxConcurrentChildren !== 0
    || candidate.allowPersistentKernel !== false || candidate.allowSchedules !== false
  )) throw new Error(`${label} exceeds the simple runtime topology`)
}

function meaningfulObjectRef(value: unknown, label: string, kind: AgentStudioMeaningfulObjectKind): void {
  const candidate = record(value, label)
  exactKeys(candidate, ['schema', 'kind', 'ownerPrincipal', 'graphId', 'objectId', 'version', 'digest'], label)
  if (candidate.schema !== MEANINGFUL_OBJECT_REF_V1_SCHEMA || candidate.kind !== kind) throw new Error(`${label} has invalid identity`)
  typedOwner(candidate.ownerPrincipal, `${label}.ownerPrincipal`)
  text(candidate.graphId, `${label}.graphId`, 128)
  text(candidate.objectId, `${label}.objectId`, 512)
  text(candidate.version, `${label}.version`, 256)
  digest(candidate.digest, `${label}.digest`)
}

function grant(value: unknown, toolNames: ReadonlySet<string>): void {
  const candidate = record(value, 'grant')
  exactKeys(candidate, ['status', 'capabilities', 'sourceRefs'], 'grant')
  if (!['active', 'suspended', 'revoked', 'expired'].includes(String(candidate.status))) throw new Error('grant.status is invalid')
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.length < 1 || candidate.capabilities.length > 64) {
    throw new Error('grant.capabilities must contain 1..64 entries')
  }
  const capabilityNames = new Set<string>()
  for (const [index, value] of candidate.capabilities.entries()) {
    const capability = record(value, `grant.capabilities[${index}]`)
    exactKeys(capability, ['capability', 'operations', 'access', 'approvalPolicy', 'operationPolicies', 'fence', 'quota'], `grant.capabilities[${index}]`, true)
    const name = text(capability.capability, `grant.capabilities[${index}].capability`, 128)
    if (capabilityNames.has(name)) throw new Error(`duplicate grant capability '${name}'`)
    capabilityNames.add(name)
    if (!Array.isArray(capability.operations) || capability.operations.length < 1 || capability.operations.some(operation => typeof operation !== 'string' || !operation)) {
      throw new Error(`grant capability '${name}' operations are invalid`)
    }
    if (capability.access !== 'read' && capability.access !== 'write') throw new Error(`grant capability '${name}' access is invalid`)
    if (!['ordinary', 'notify', 'human-always'].includes(String(capability.approvalPolicy))) throw new Error(`grant capability '${name}' approval is invalid`)
    record(capability.fence, `grant capability '${name}' fence`)
    record(capability.quota, `grant capability '${name}' quota`)
  }
  for (const toolName of toolNames) {
    const matching = candidate.capabilities.some(value => {
      const capability = value as AgentStudioGrantCapability
      return capability.operations.includes(toolName) || capability.operations.includes('*')
    })
    if (!matching) throw new Error(`tool '${toolName}' is absent from the grant operations`)
  }
  if (!Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length < 1 || candidate.sourceRefs.some(ref => typeof ref !== 'string' || !ref)) {
    throw new Error('grant.sourceRefs is invalid')
  }
}

function budgets(value: unknown): void {
  const candidate = record(value, 'budgets')
  exactKeys(candidate, ['pilotMaxTurns', 'emanationMaxTurns', 'maxEmanations', 'maxProposedEffects', 'maxProgramInvocations'], 'budgets')
  for (const key of Object.keys(candidate)) nonNegativeInteger(candidate[key], `budgets.${key}`)
  if (candidate.pilotMaxTurns === 0 || candidate.emanationMaxTurns === 0) throw new Error('turn budgets must be positive')
}

function validateTrigger(value: unknown, index: number): void {
  const trigger = record(value, `triggers[${index}]`)
  exactKeys(trigger, ['kind', 'enabled', 'mode', 'ingress', 'adapter', 'consentRef', 'sourceFence'], `triggers[${index}]`, true)
  text(trigger.kind, `triggers[${index}].kind`, 256)
  if (typeof trigger.enabled !== 'boolean') throw new Error(`triggers[${index}].enabled must be boolean`)
  if (trigger.mode !== undefined) text(trigger.mode, `triggers[${index}].mode`, 128)
  if (trigger.ingress !== undefined && trigger.ingress !== 'owner' && trigger.ingress !== 'internal-service') throw new Error(`triggers[${index}].ingress is invalid`)
  if (trigger.ingress === 'internal-service' && (typeof trigger.adapter !== 'string' || !trigger.consentRef)) {
    throw new Error(`triggers[${index}] internal service needs adapter and consentRef`)
  }
  if (trigger.ingress === 'owner' && (trigger.adapter !== undefined || trigger.consentRef !== undefined)) {
    throw new Error(`triggers[${index}] owner ingress cannot name internal authority`)
  }
}

function graphAddress(value: unknown, label: string): void {
  const address = record(value, label)
  exactKeys(address, ['ownerPrincipal', 'graphId'], label)
  typedOwner(address.ownerPrincipal, `${label}.ownerPrincipal`)
  text(address.graphId, `${label}.graphId`, 128)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string, optional = false): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field '${key}'`)
  if (!optional) for (const key of keys) if (!(key in value)) throw new Error(`${label}.${key} is required`)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label} must be bounded non-empty text`)
  return value
}

function typedOwner(value: unknown, label: string): string {
  const owner = text(value, label, 256)
  if (!TYPED_OWNER.test(owner)) throw new Error(`${label} must be a typed owner principal`)
  return owner
}

function digest(value: unknown, label: string): string {
  const candidate = text(value, label, 71)
  if (!SHA256.test(candidate)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return prefixedDigest(candidate)
}

function prefixedDigest(value: string): string {
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return value as number
}

function manifestApprovalPolicy(policy: AgentStudioApprovalPolicy) {
  if (policy === 'human-always') return { mode: 'always', driverRequired: true }
  if (policy === 'notify') return { mode: 'on-risk', driverRequired: false, reason: 'notify steward after execution' }
  return { mode: 'never' }
}

function capabilityKind(capability: string): string {
  if (capability === 'mnemosyne' || capability === 'garden-mcp') return 'mnemosyne'
  if (capability === 'browser') return 'web'
  if (capability === 'workflow') return 'workflow'
  if (capability === 'discord') return 'discord'
  if (capability === 'site') return 'kg'
  if (capability === 'vehicle') return 'vehicle'
  return 'runtime'
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

async function sha256Canonical(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value))
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function mintAgentId(registeredName: string): Promise<string> {
  return `agent-${(await sha256Text(`agent-name:${registeredName}`)).slice(0, 16)}`
}
