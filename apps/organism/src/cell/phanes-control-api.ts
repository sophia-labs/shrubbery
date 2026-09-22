/**
 * Structural graph authority supplied by the Organism shell. Both the local
 * gardend contract and the hosted gateway contract implement this exact
 * graph-id-bearing call shape, so Phanes controls never learn a cell address,
 * browser token, or service credential.
 */
export interface PhanesControlMcp {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

export const PHANES_CONTROL_GRAPH_ID = 'phanes-control'
export const PHANES_CONTROL_DOCUMENT_ID = 'phanes-control'
export const PHANES_CHANNEL_CATALOG_DOCUMENT_ID = 'phanes-discord-channel-catalog'
export const PHANES_INGESTION_POLICY_DOCUMENT_ID = 'phanes-discord-ingestion-policy'
export const PHANES_OPERATIONS_CONTROL_DOCUMENT_ID = 'phanes-operations-control'
export const PHANES_OPERATIONS_STATUS_DOCUMENT_ID = 'phanes-operations-status'

const CONTROL_SCHEMA = 'sophia.agent-interaction-control-bundle.v1'
const PRESENTATION_SCHEMA = 'sophia.agent-presentation-catalog.v1'
const MESSAGE_SCHEMA = 'sophia.message-template.v1'
const FLOW_SCHEMA = 'sophia.interaction-flow.v1'
const CHANNEL_CATALOG_SCHEMA = 'sophia.discord-channel-catalog.v1'
const CHANNEL_SCHEMA = 'sophia.discord-channel.v1'
const INGESTION_POLICY_SCHEMA = 'sophia.discord-ingestion-policy.v1'
const CHANNEL_EXCLUSION_SCHEMA = 'sophia.discord-channel-exclusion.v1'
const OPERATIONS_CONTROL_SCHEMA = 'sophia.agent-operations-control.v1'
const INGESTION_REQUEST_SCHEMA = 'sophia.agent-ingestion-request.v1'
const OPERATIONS_STATUS_SCHEMA = 'sophia.agent-operations-status.v1'
const AGENT_OBJECT_ID = 'urn:sophia:agent:agent-ded0c28b107012ad'
const CONTROL_OBJECT_ID = `${AGENT_OBJECT_ID}:interaction-control`
const PRESENTATION_OBJECT_ID = `${AGENT_OBJECT_ID}:presentation`
const CHANNEL_CATALOG_OBJECT_ID = `${AGENT_OBJECT_ID}:discord-channel-catalog`
const INGESTION_POLICY_OBJECT_ID = `${AGENT_OBJECT_ID}:discord-ingestion-policy`
const OPERATIONS_CONTROL_OBJECT_ID = `${AGENT_OBJECT_ID}:operations-control`
const OPERATIONS_STATUS_OBJECT_ID = `${AGENT_OBJECT_ID}:operations-status`
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const SNOWFLAKE_PATTERN = /^[0-9]{1,20}$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const NODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const VARIABLE_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/
const ALLOWED_SURFACES = new Set([
  'command-description',
  'message',
  'ephemeral',
  'button',
  'select-placeholder',
  'modal-title',
  'modal-label',
  'embed-title',
  'embed-body',
  'embed-field',
  'embed-footer',
  'attachment-suffix',
])
const ALLOWED_NODE_KINDS = new Set(['menu', 'privacy', 'recording', 'roles', 'about', 'confirmation'])
const ALLOWED_ACTION_KINDS = new Set([
  'navigate',
  'privacy.identified',
  'privacy.superphan',
  'privacy.pseudonymous',
  'privacy.redacted',
  'privacy.refresh',
  'recording.start',
  'recording.status',
  'recording.stop',
  'recording.abort',
  'recording.retry',
  'roles.manage',
  'roles.post-picker',
  'close',
])
const ALLOWED_STYLES = new Set(['primary', 'secondary', 'success', 'danger'])
const INGESTION_SEMANTICS = {
  configuredFence: 'runtime-configured-narrow-only',
  discordMutation: 'forbidden',
  excludedChannel: {
    initialBackfill: 'never-read',
    gatewayCreate: 'ignore',
    gatewayEdit: 'ignore',
    gatewayDelete: 'ignore',
    directMention: 'ignore',
    capabilityContext: 'deny',
  },
  policyChange: 'rdf-source-surgery-and-rematerialization',
}

export interface PhanesMessageTemplate {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  key: string
  text: string
  surface: string
  description: string
  allowedVariables: string[]
  maxLength: number
}

export interface PhanesFlowAction {
  actionId: string
  kind: string
  labelTemplate: string
  style: string
  target: string | null
  requiredCog: string | null
}

export interface PhanesFlowNode {
  nodeId: string
  kind: string
  titleTemplate: string
  bodyTemplate: string
  actions: PhanesFlowAction[]
}

export interface PhanesInteractionFlow {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  flowId: string
  entryNode: string
  nodes: PhanesFlowNode[]
}

export interface PhanesControlBundle {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  agent: {
    kind: string
    objectId: string
  }
  publishedAt: string
  presentation: {
    schema: string
    object: {
      kind: string
      objectId: string
    }
    messages: PhanesMessageTemplate[]
  }
  flows: PhanesInteractionFlow[]
}

export interface PhanesControlDocument {
  bundle: PhanesControlBundle
  revision: number
  canonicalContent: string
  updatedAt: string | null
}

export interface PhanesDiscordChannel {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  channelId: string
  name: string
  kind: string
  categoryName: string | null
}

export interface PhanesDiscordChannelCatalog {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  guildId: string
  channels: PhanesDiscordChannel[]
  observedAt: string
  source: string
}

export interface PhanesDiscordChannelExclusion {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  channelId: string
}

export interface PhanesDiscordIngestionPolicy {
  schema: string
  object: {
    kind: string
    objectId: string
    version: string
  }
  guildId: string
  enabled: boolean
  excludedChannels: PhanesDiscordChannelExclusion[]
  semantics: typeof INGESTION_SEMANTICS
  updatedAt: string
}

export interface PhanesJsonDocument<T> {
  value: T
  revision: number
  canonicalContent: string
  updatedAt: string | null
}

export interface PhanesDiscordIngestionControl {
  catalog: PhanesJsonDocument<PhanesDiscordChannelCatalog>
  policy: PhanesJsonDocument<PhanesDiscordIngestionPolicy>
}

export interface PhanesIngestionRunRequest {
  schema: string
  object: { kind: string; objectId: string; version: string }
  requestId: string
  requestedAt: string
  intent: 'reconcile-current-policy'
  discordMutation: 'forbidden'
}

export interface PhanesOperationsControl {
  schema: string
  object: { kind: string; objectId: string; version: string }
  agent: { kind: 'agent'; objectId: string }
  responsesEnabled: boolean
  ingestionRequest: PhanesIngestionRunRequest | null
  updatedAt: string
}

export interface PhanesOperationsStatus {
  schema: string
  object: { kind: string; objectId: string; version: string }
  agent: { kind: 'agent'; objectId: string }
  source: 'phanes-runtime-privacy-authority'
  responsesEnabled: boolean
  controlVersion: string
  ingestion: {
    phase: string
    controlRequestId: string | null
    privacyRequestId: string | null
    authorityRevision: number | null
    messageCount: number
    documentCount: number
    errorCode: string | null
  }
  updatedAt: string
}

export interface PhanesOperations {
  control: PhanesJsonDocument<PhanesOperationsControl>
  status: PhanesJsonDocument<PhanesOperationsStatus>
}

export class PhanesControlApi {
  constructor(private readonly mcp: PhanesControlMcp) {}

  async load(): Promise<PhanesControlDocument> {
    const value = await this.callTool('read_document', {
      graphId: PHANES_CONTROL_GRAPH_ID,
      documentId: PHANES_CONTROL_DOCUMENT_ID,
      format: 'markdown',
    })
    const record = asRecord(value, 'Phanes control read result')
    const revision = nonNegativeInteger(record.revision, 'Phanes control document revision')
    const content = text(record.content, 'Phanes control document content')
    const bundle = await parseAndValidateControlBundle(content)
    return {
      bundle,
      revision,
      canonicalContent: canonicalJson(bundle),
      updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
    }
  }

  async save(bundle: unknown, expectedRevision: number): Promise<PhanesControlDocument> {
    nonNegativeInteger(expectedRevision, 'expected Phanes control revision')
    const current = await this.load()
    if (current.revision !== expectedRevision) {
      throw new Error(
        `Phanes controls changed in Garden (expected revision ${expectedRevision}, current ${current.revision})`,
      )
    }
    assertPresentationContracts(bundle, current.bundle)
    const sealed = await sealControlBundle(bundle)
    const canonicalContent = canonicalJson(sealed)
    await this.callTool('write_document', {
      graphId: PHANES_CONTROL_GRAPH_ID,
      documentId: PHANES_CONTROL_DOCUMENT_ID,
      title: 'Phanes interaction control',
      tiptapJson: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'json' },
            content: [{ type: 'text', text: canonicalContent }],
          },
        ],
      },
      expectedRevision,
      awaitDurable: true,
    })
    const reread = await this.load()
    if (reread.canonicalContent !== canonicalContent) {
      throw new Error('Garden reread differs from the saved Phanes control object')
    }
    return reread
  }

  async loadIngestionControl(): Promise<PhanesDiscordIngestionControl> {
    const [catalog, policy] = await Promise.all([
      this.readJsonDocument(
        PHANES_CHANNEL_CATALOG_DOCUMENT_ID,
        'Discord channel catalog',
        parseAndValidateChannelCatalog,
      ),
      this.readJsonDocument(
        PHANES_INGESTION_POLICY_DOCUMENT_ID,
        'Discord ingestion policy',
        parseAndValidateIngestionPolicy,
      ),
    ])
    assertPolicyWithinCatalog(policy.value, catalog.value)
    return { catalog, policy }
  }

  async saveIngestionPolicy(
    value: unknown,
    expectedRevision: number,
  ): Promise<PhanesDiscordIngestionControl> {
    nonNegativeInteger(expectedRevision, 'expected Discord ingestion policy revision')
    const current = await this.loadIngestionControl()
    if (current.policy.revision !== expectedRevision) {
      throw new Error(
        `Discord ingestion policy changed in Garden (expected revision ${expectedRevision}, current ${current.policy.revision})`,
      )
    }
    const sealed = await sealDiscordIngestionPolicy(value, current.catalog.value)
    const canonicalContent = canonicalJson(sealed)
    await this.writeJsonDocument(
      PHANES_INGESTION_POLICY_DOCUMENT_ID,
      'Phanes Discord ingestion policy',
      canonicalContent,
      expectedRevision,
    )
    const reread = await this.loadIngestionControl()
    if (reread.policy.canonicalContent !== canonicalContent) {
      throw new Error('Garden reread differs from the saved Discord ingestion policy')
    }
    return reread
  }

  async loadOperations(): Promise<PhanesOperations> {
    const [control, status] = await Promise.all([
      this.readJsonDocument(
        PHANES_OPERATIONS_CONTROL_DOCUMENT_ID,
        'Phanes operations control',
        parseAndValidateOperationsControl,
      ),
      this.readJsonDocument(
        PHANES_OPERATIONS_STATUS_DOCUMENT_ID,
        'Phanes operations status',
        parseAndValidateOperationsStatus,
      ),
    ])
    return { control, status }
  }

  async saveOperationsControl(
    value: unknown,
    expectedRevision: number,
  ): Promise<PhanesOperations> {
    nonNegativeInteger(expectedRevision, 'expected Phanes operations revision')
    const current = await this.loadOperations()
    if (current.control.revision !== expectedRevision) {
      throw new Error(
        `Phanes operations changed in Garden (expected revision ${expectedRevision}, current ${current.control.revision})`,
      )
    }
    const sealed = await sealOperationsControl(value)
    const canonicalContent = canonicalJson(sealed)
    await this.writeJsonDocument(
      PHANES_OPERATIONS_CONTROL_DOCUMENT_ID,
      'Phanes operations control',
      canonicalContent,
      expectedRevision,
    )
    const rereadControl = await this.readJsonDocument(
      PHANES_OPERATIONS_CONTROL_DOCUMENT_ID,
      'Phanes operations control',
      parseAndValidateOperationsControl,
    )
    if (rereadControl.canonicalContent !== canonicalContent) {
      throw new Error('Garden reread differs from the saved Phanes operations control')
    }
    return { control: rereadControl, status: current.status }
  }

  private async readJsonDocument<T>(
    documentId: string,
    label: string,
    parse: (content: string) => Promise<T>,
  ): Promise<PhanesJsonDocument<T>> {
    const value = await this.callTool('read_document', {
      graphId: PHANES_CONTROL_GRAPH_ID,
      documentId,
      format: 'markdown',
    })
    const record = asRecord(value, `${label} read result`)
    const revision = nonNegativeInteger(record.revision, `${label} document revision`)
    const content = text(record.content, `${label} document content`)
    const parsed = await parse(content)
    return {
      value: parsed,
      revision,
      canonicalContent: canonicalJson(parsed),
      updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
    }
  }

  private async writeJsonDocument(
    documentId: string,
    title: string,
    canonicalContent: string,
    expectedRevision: number,
  ): Promise<void> {
    await this.callTool('write_document', {
      graphId: PHANES_CONTROL_GRAPH_ID,
      documentId,
      title,
      tiptapJson: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'json' },
            content: [{ type: 'text', text: canonicalContent }],
          },
        ],
      },
      expectedRevision,
      awaitDurable: true,
    })
  }

  private callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    return this.mcp.callTool(name, arguments_)
  }
}

export async function parseAndValidateControlBundle(content: string): Promise<PhanesControlBundle> {
  const raw = unwrapJsonFence(content)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Phanes control document is not valid JSON')
  }
  const bundle = validateControlStructure(value)
  await verifyControlDigests(bundle)
  return bundle
}

export async function sealControlBundle(value: unknown): Promise<PhanesControlBundle> {
  const bundle = structuredClone(validateControlStructure(value))
  bundle.publishedAt = new Date().toISOString()
  for (const message of bundle.presentation.messages) {
    message.object.version = `sha256:${await sha256Text(message.text)}`
  }
  for (const flow of bundle.flows) {
    flow.object.version = `sha256:${await sha256Text(canonicalJson(flowCore(flow)))}`
  }
  bundle.object.version = `sha256:${await sha256Text(canonicalJson(controlCore(bundle)))}`
  validateControlStructure(bundle)
  await verifyControlDigests(bundle)
  return bundle
}

export async function parseAndValidateChannelCatalog(
  content: string,
): Promise<PhanesDiscordChannelCatalog> {
  const catalog = validateChannelCatalogStructure(parseJsonDocument(content, 'Discord channel catalog'))
  await verifyChannelCatalogDigests(catalog)
  return catalog
}

export async function parseAndValidateIngestionPolicy(
  content: string,
): Promise<PhanesDiscordIngestionPolicy> {
  const policy = validateIngestionPolicyStructure(parseJsonDocument(content, 'Discord ingestion policy'))
  await verifyIngestionPolicyDigests(policy)
  return policy
}

export async function sealDiscordIngestionPolicy(
  value: unknown,
  catalog: PhanesDiscordChannelCatalog,
): Promise<PhanesDiscordIngestionPolicy> {
  const policy = structuredClone(asRecord(value, 'Discord ingestion policy')) as unknown as PhanesDiscordIngestionPolicy
  if (!Array.isArray(policy.excludedChannels)) {
    throw new Error('Discord ingestion exclusions must be an array')
  }
  policy.excludedChannels.sort((left, right) => compareSnowflakes(left.channelId, right.channelId))
  policy.updatedAt = new Date().toISOString()
  for (const exclusion of policy.excludedChannels) {
    exclusion.object.version = `sha256:${await sha256Text(canonicalJson(exclusionCore(exclusion)))}`
  }
  policy.object.version = `sha256:${await sha256Text(canonicalJson(ingestionPolicyCore(policy)))}`
  const sealed = validateIngestionPolicyStructure(policy)
  assertPolicyWithinCatalog(sealed, catalog)
  await verifyIngestionPolicyDigests(sealed)
  return sealed
}

export function draftDiscordIngestionPolicy(
  policy: PhanesDiscordIngestionPolicy,
  options: { enabled: boolean; excludedChannelIds: Iterable<string> },
): PhanesDiscordIngestionPolicy {
  const excluded = [...new Set(options.excludedChannelIds)]
    .map(channelId => snowflake(channelId, 'excluded Discord channel id'))
    .sort(compareSnowflakes)
  return {
    ...structuredClone(policy),
    enabled: options.enabled,
    excludedChannels: excluded.map(channelId => ({
      schema: CHANNEL_EXCLUSION_SCHEMA,
      object: {
        kind: 'discord-channel-exclusion',
        objectId: `${INGESTION_POLICY_OBJECT_ID}:channel:${channelId}`,
        version: `sha256:${'0'.repeat(64)}`,
      },
      channelId,
    })),
  }
}

export function draftOperationsControl(
  control: PhanesOperationsControl,
  options: { responsesEnabled?: boolean; ingestionRequest?: PhanesIngestionRunRequest | null },
): PhanesOperationsControl {
  return {
    ...structuredClone(control),
    responsesEnabled: options.responsesEnabled ?? control.responsesEnabled,
    ingestionRequest: options.ingestionRequest === undefined
      ? control.ingestionRequest
      : options.ingestionRequest,
  }
}

export function createIngestionRunRequest(
  requestId = crypto.randomUUID(),
  requestedAt = new Date().toISOString(),
): PhanesIngestionRunRequest {
  return {
    schema: INGESTION_REQUEST_SCHEMA,
    object: {
      kind: 'agent-ingestion-request',
      objectId: `${OPERATIONS_CONTROL_OBJECT_ID}:ingestion:${requestId}`,
      version: `sha256:${'0'.repeat(64)}`,
    },
    requestId,
    requestedAt,
    intent: 'reconcile-current-policy',
    discordMutation: 'forbidden',
  }
}

export async function parseAndValidateOperationsControl(content: string): Promise<PhanesOperationsControl> {
  const control = validateOperationsControlStructure(parseJsonDocument(content, 'Phanes operations control'))
  await verifyOperationsControlDigests(control)
  return control
}

export async function parseAndValidateOperationsStatus(content: string): Promise<PhanesOperationsStatus> {
  const status = validateOperationsStatusStructure(parseJsonDocument(content, 'Phanes operations status'))
  const expected = `sha256:${await sha256Text(canonicalJson(operationsStatusCore(status)))}`
  if (status.object.version !== expected) throw new Error('Phanes operations status has a stale content digest')
  return status
}

export async function sealOperationsControl(value: unknown): Promise<PhanesOperationsControl> {
  const control = structuredClone(asRecord(value, 'Phanes operations control')) as unknown as PhanesOperationsControl
  control.updatedAt = new Date().toISOString()
  if (control.ingestionRequest) {
    control.ingestionRequest.object.version = `sha256:${await sha256Text(canonicalJson(ingestionRequestCore(control.ingestionRequest)))}`
  }
  control.object.version = `sha256:${await sha256Text(canonicalJson(operationsControlCore(control)))}`
  const sealed = validateOperationsControlStructure(control)
  await verifyOperationsControlDigests(sealed)
  return sealed
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function validateChannelCatalogStructure(value: unknown): PhanesDiscordChannelCatalog {
  const catalog = asRecord(value, 'Discord channel catalog') as unknown as PhanesDiscordChannelCatalog
  if (catalog.schema !== CHANNEL_CATALOG_SCHEMA || catalog.source !== 'discord-gateway-cache-no-message-polling') {
    throw new Error('Discord channel catalog has invalid source testimony')
  }
  const object = asRecord(catalog.object, 'Discord channel catalog Meaningful Object')
  if (
    object.kind !== 'discord-channel-catalog'
    || object.objectId !== CHANNEL_CATALOG_OBJECT_ID
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) {
    throw new Error('Discord channel catalog has an invalid Meaningful Object identity')
  }
  snowflake(catalog.guildId, 'Discord channel catalog guild')
  utcTimestamp(catalog.observedAt, 'Discord channel catalog observation time')
  if (!Array.isArray(catalog.channels)) throw new Error('Discord channel catalog channels must be an array')
  const seen = new Set<string>()
  let previous: string | null = null
  for (const candidate of catalog.channels) {
    const channel = asRecord(candidate, 'Discord channel') as unknown as PhanesDiscordChannel
    if (channel.schema !== CHANNEL_SCHEMA) throw new Error('Discord channel schema is invalid')
    const channelId = snowflake(channel.channelId, 'Discord channel id')
    if (seen.has(channelId) || (previous !== null && compareSnowflakes(previous, channelId) >= 0)) {
      throw new Error('Discord channel catalog must use unique, stable channel-id order')
    }
    seen.add(channelId)
    previous = channelId
    if (typeof channel.name !== 'string' || channel.name.length < 1 || channel.name.length > 100) {
      throw new Error('Discord channel name is invalid')
    }
    if (typeof channel.kind !== 'string' || channel.kind.length < 1 || channel.kind.length > 64) {
      throw new Error('Discord channel kind is invalid')
    }
    if (
      channel.categoryName !== null
      && (typeof channel.categoryName !== 'string' || channel.categoryName.length < 1 || channel.categoryName.length > 100)
    ) {
      throw new Error('Discord channel category name is invalid')
    }
    const channelObject = asRecord(channel.object, 'Discord channel Meaningful Object')
    if (
      channelObject.kind !== 'discord-channel'
      || channelObject.objectId !== `${CHANNEL_CATALOG_OBJECT_ID}:channel:${channelId}`
      || typeof channelObject.version !== 'string'
      || !SHA256_PATTERN.test(channelObject.version)
    ) {
      throw new Error('Discord channel has an invalid Meaningful Object identity')
    }
  }
  return catalog
}

function validateIngestionPolicyStructure(value: unknown): PhanesDiscordIngestionPolicy {
  const policy = asRecord(value, 'Discord ingestion policy') as unknown as PhanesDiscordIngestionPolicy
  if (policy.schema !== INGESTION_POLICY_SCHEMA) {
    throw new Error('Discord ingestion policy schema is invalid')
  }
  const object = asRecord(policy.object, 'Discord ingestion policy Meaningful Object')
  if (
    object.kind !== 'discord-ingestion-policy'
    || object.objectId !== INGESTION_POLICY_OBJECT_ID
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) {
    throw new Error('Discord ingestion policy has an invalid Meaningful Object identity')
  }
  snowflake(policy.guildId, 'Discord ingestion policy guild')
  if (typeof policy.enabled !== 'boolean') throw new Error('Discord ingestion policy enabled flag is invalid')
  if (canonicalJson(policy.semantics) !== canonicalJson(INGESTION_SEMANTICS)) {
    throw new Error('Discord ingestion policy semantics differ from the Phanes host contract')
  }
  utcTimestamp(policy.updatedAt, 'Discord ingestion policy update time')
  if (!Array.isArray(policy.excludedChannels)) {
    throw new Error('Discord ingestion exclusions must be an array')
  }
  const seen = new Set<string>()
  let previous: string | null = null
  for (const candidate of policy.excludedChannels) {
    const exclusion = asRecord(candidate, 'Discord channel exclusion') as unknown as PhanesDiscordChannelExclusion
    if (exclusion.schema !== CHANNEL_EXCLUSION_SCHEMA) {
      throw new Error('Discord channel exclusion schema is invalid')
    }
    const channelId = snowflake(exclusion.channelId, 'excluded Discord channel id')
    if (seen.has(channelId) || (previous !== null && compareSnowflakes(previous, channelId) >= 0)) {
      throw new Error('Discord ingestion exclusions must use unique, stable channel-id order')
    }
    seen.add(channelId)
    previous = channelId
    const exclusionObject = asRecord(exclusion.object, 'Discord channel exclusion Meaningful Object')
    if (
      exclusionObject.kind !== 'discord-channel-exclusion'
      || exclusionObject.objectId !== `${INGESTION_POLICY_OBJECT_ID}:channel:${channelId}`
      || typeof exclusionObject.version !== 'string'
      || !SHA256_PATTERN.test(exclusionObject.version)
    ) {
      throw new Error('Discord channel exclusion has an invalid Meaningful Object identity')
    }
  }
  return policy
}

function validateOperationsControlStructure(value: unknown): PhanesOperationsControl {
  const control = asRecord(value, 'Phanes operations control') as unknown as PhanesOperationsControl
  if (control.schema !== OPERATIONS_CONTROL_SCHEMA) throw new Error('Phanes operations control schema is invalid')
  const object = asRecord(control.object, 'Phanes operations control Meaningful Object')
  if (
    object.kind !== 'agent-operations-control'
    || object.objectId !== OPERATIONS_CONTROL_OBJECT_ID
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) throw new Error('Phanes operations control has an invalid Meaningful Object identity')
  const agent = asRecord(control.agent, 'Phanes operations control agent')
  if (agent.kind !== 'agent' || agent.objectId !== AGENT_OBJECT_ID) throw new Error('Phanes operations control names the wrong agent')
  if (typeof control.responsesEnabled !== 'boolean') throw new Error('Phanes response switch is invalid')
  utcTimestamp(control.updatedAt, 'Phanes operations control update time')
  if (control.ingestionRequest !== null) validateIngestionRequestStructure(control.ingestionRequest)
  return control
}

function validateIngestionRequestStructure(value: unknown): PhanesIngestionRunRequest {
  const request = asRecord(value, 'Phanes ingestion request') as unknown as PhanesIngestionRunRequest
  if (request.schema !== INGESTION_REQUEST_SCHEMA) throw new Error('Phanes ingestion request schema is invalid')
  if (!UUID_V4_PATTERN.test(text(request.requestId, 'Phanes ingestion request id'))) throw new Error('Phanes ingestion request id is invalid')
  utcTimestamp(request.requestedAt, 'Phanes ingestion request time')
  if (request.intent !== 'reconcile-current-policy' || request.discordMutation !== 'forbidden') {
    throw new Error('Phanes ingestion request semantics are invalid')
  }
  const object = asRecord(request.object, 'Phanes ingestion request Meaningful Object')
  if (
    object.kind !== 'agent-ingestion-request'
    || object.objectId !== `${OPERATIONS_CONTROL_OBJECT_ID}:ingestion:${request.requestId}`
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) throw new Error('Phanes ingestion request has an invalid Meaningful Object identity')
  return request
}

function validateOperationsStatusStructure(value: unknown): PhanesOperationsStatus {
  const status = asRecord(value, 'Phanes operations status') as unknown as PhanesOperationsStatus
  if (status.schema !== OPERATIONS_STATUS_SCHEMA || status.source !== 'phanes-runtime-privacy-authority') {
    throw new Error('Phanes operations status source testimony is invalid')
  }
  const object = asRecord(status.object, 'Phanes operations status Meaningful Object')
  if (
    object.kind !== 'agent-operations-status'
    || object.objectId !== OPERATIONS_STATUS_OBJECT_ID
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) throw new Error('Phanes operations status has an invalid Meaningful Object identity')
  const agent = asRecord(status.agent, 'Phanes operations status agent')
  if (agent.kind !== 'agent' || agent.objectId !== AGENT_OBJECT_ID) throw new Error('Phanes operations status names the wrong agent')
  if (typeof status.responsesEnabled !== 'boolean' || !SHA256_PATTERN.test(status.controlVersion)) {
    throw new Error('Phanes operations status control testimony is invalid')
  }
  utcTimestamp(status.updatedAt, 'Phanes operations status update time')
  const ingestion = asRecord(status.ingestion, 'Phanes ingestion status') as unknown as PhanesOperationsStatus['ingestion']
  text(ingestion.phase, 'Phanes ingestion phase')
  if (ingestion.controlRequestId !== null && !UUID_V4_PATTERN.test(ingestion.controlRequestId)) throw new Error('Phanes ingestion status control request is invalid')
  if (ingestion.privacyRequestId !== null && !/^privacy-rebuild:[0-9a-f]{32}$/.test(ingestion.privacyRequestId)) throw new Error('Phanes ingestion status privacy request is invalid')
  if (ingestion.authorityRevision !== null) nonNegativeInteger(ingestion.authorityRevision, 'Phanes authority revision')
  nonNegativeInteger(ingestion.messageCount, 'Phanes ingestion message count')
  nonNegativeInteger(ingestion.documentCount, 'Phanes ingestion document count')
  if (ingestion.errorCode !== null && (typeof ingestion.errorCode !== 'string' || ingestion.errorCode.length < 1)) throw new Error('Phanes ingestion status error is invalid')
  return status
}

function assertPolicyWithinCatalog(
  policy: PhanesDiscordIngestionPolicy,
  catalog: PhanesDiscordChannelCatalog,
): void {
  if (policy.guildId !== catalog.guildId) {
    throw new Error('Discord ingestion policy and channel catalog name different guilds')
  }
  const configured = new Set(catalog.channels.map(channel => channel.channelId))
  if (policy.excludedChannels.some(exclusion => !configured.has(exclusion.channelId))) {
    throw new Error('Discord ingestion policy may only narrow the configured channel fence')
  }
}

async function verifyChannelCatalogDigests(catalog: PhanesDiscordChannelCatalog): Promise<void> {
  for (const channel of catalog.channels) {
    const expected = `sha256:${await sha256Text(canonicalJson(channelCore(channel)))}`
    if (channel.object.version !== expected) {
      throw new Error(`Discord channel ${channel.channelId} has a stale content digest`)
    }
  }
  const expected = `sha256:${await sha256Text(canonicalJson(channelCatalogCore(catalog)))}`
  if (catalog.object.version !== expected) {
    throw new Error('Discord channel catalog has a stale content digest')
  }
}

async function verifyIngestionPolicyDigests(policy: PhanesDiscordIngestionPolicy): Promise<void> {
  for (const exclusion of policy.excludedChannels) {
    const expected = `sha256:${await sha256Text(canonicalJson(exclusionCore(exclusion)))}`
    if (exclusion.object.version !== expected) {
      throw new Error(`Discord channel exclusion ${exclusion.channelId} has a stale content digest`)
    }
  }
  const expected = `sha256:${await sha256Text(canonicalJson(ingestionPolicyCore(policy)))}`
  if (policy.object.version !== expected) {
    throw new Error('Discord ingestion policy has a stale content digest')
  }
}

function channelCore(channel: PhanesDiscordChannel): Record<string, unknown> {
  return {
    channelId: channel.channelId,
    name: channel.name,
    kind: channel.kind,
    categoryName: channel.categoryName,
  }
}

function channelCatalogCore(catalog: PhanesDiscordChannelCatalog): Record<string, unknown> {
  return {
    guildId: catalog.guildId,
    channels: catalog.channels,
    observedAt: catalog.observedAt,
    source: catalog.source,
  }
}

function exclusionCore(exclusion: PhanesDiscordChannelExclusion): Record<string, unknown> {
  return { channelId: exclusion.channelId }
}

function ingestionPolicyCore(policy: PhanesDiscordIngestionPolicy): Record<string, unknown> {
  return {
    guildId: policy.guildId,
    enabled: policy.enabled,
    excludedChannels: policy.excludedChannels,
    semantics: policy.semantics,
    updatedAt: policy.updatedAt,
  }
}

function ingestionRequestCore(request: PhanesIngestionRunRequest): Record<string, unknown> {
  return {
    requestId: request.requestId,
    requestedAt: request.requestedAt,
    intent: request.intent,
    discordMutation: request.discordMutation,
  }
}

function operationsControlCore(control: PhanesOperationsControl): Record<string, unknown> {
  return {
    agent: control.agent,
    responsesEnabled: control.responsesEnabled,
    ingestionRequest: control.ingestionRequest,
    updatedAt: control.updatedAt,
  }
}

function operationsStatusCore(status: PhanesOperationsStatus): Record<string, unknown> {
  return {
    agent: status.agent,
    source: status.source,
    responsesEnabled: status.responsesEnabled,
    controlVersion: status.controlVersion,
    ingestion: status.ingestion,
    updatedAt: status.updatedAt,
  }
}

async function verifyOperationsControlDigests(control: PhanesOperationsControl): Promise<void> {
  if (control.ingestionRequest) {
    const requestVersion = `sha256:${await sha256Text(canonicalJson(ingestionRequestCore(control.ingestionRequest)))}`
    if (control.ingestionRequest.object.version !== requestVersion) throw new Error('Phanes ingestion request has a stale content digest')
  }
  const expected = `sha256:${await sha256Text(canonicalJson(operationsControlCore(control)))}`
  if (control.object.version !== expected) throw new Error('Phanes operations control has a stale content digest')
}

function validateControlStructure(value: unknown): PhanesControlBundle {
  const bundle = asRecord(value, 'Phanes control bundle') as unknown as PhanesControlBundle
  if (bundle.schema !== CONTROL_SCHEMA) {
    throw new Error('Phanes control bundle has an unsupported schema')
  }
  const object = asRecord(bundle.object, 'Phanes control Meaningful Object')
  if (
    object.kind !== 'agent-interaction-control-bundle'
    || object.objectId !== CONTROL_OBJECT_ID
    || typeof object.version !== 'string'
    || !SHA256_PATTERN.test(object.version)
  ) {
    throw new Error('Phanes control bundle has an invalid Meaningful Object identity')
  }
  if (!Number.isFinite(Date.parse(text(bundle.publishedAt, 'Phanes control publication time')))) {
    throw new Error('Phanes control publication time is invalid')
  }
  if (!bundle.publishedAt.endsWith('Z')) {
    throw new Error('Phanes control publication time must be UTC')
  }
  const agent = asRecord(bundle.agent, 'Phanes agent Meaningful Object')
  if (agent.kind !== 'agent' || agent.objectId !== AGENT_OBJECT_ID) {
    throw new Error('Phanes control bundle names the wrong agent')
  }
  const presentation = asRecord(bundle.presentation, 'Phanes presentation catalog')
  if (presentation.schema !== PRESENTATION_SCHEMA || !Array.isArray(presentation.messages)) {
    throw new Error('Phanes presentation catalog is invalid')
  }
  const presentationObject = asRecord(presentation.object, 'Phanes presentation Meaningful Object')
  if (
    presentationObject.kind !== 'agent-presentation-catalog'
    || presentationObject.objectId !== PRESENTATION_OBJECT_ID
  ) {
    throw new Error('Phanes presentation catalog has an invalid Meaningful Object identity')
  }
  if (!Array.isArray(presentation.messages) || presentation.messages.length < 1 || presentation.messages.length > 512) {
    throw new Error('Phanes presentation catalog exceeds its host size contract')
  }
  const messageKeys = new Set<string>()
  const messageByKey = new Map<string, PhanesMessageTemplate>()
  for (const candidate of presentation.messages) {
    const message = asRecord(candidate, 'Phanes message template') as unknown as PhanesMessageTemplate
    if (message.schema !== MESSAGE_SCHEMA || !KEY_PATTERN.test(text(message.key, 'message key'))) {
      throw new Error('Phanes message template identity is invalid')
    }
    if (messageKeys.has(message.key)) throw new Error(`Duplicate Phanes message key: ${message.key}`)
    messageKeys.add(message.key)
    messageByKey.set(message.key, message)
    const maxLength = positiveInteger(message.maxLength, `maximum length for ${message.key}`)
    if (maxLength > 6000) throw new Error(`Maximum length for ${message.key} exceeds Discord's host contract`)
    if (typeof message.text !== 'string' || message.text.length < 1 || message.text.length > maxLength) {
      throw new Error(`Phanes message ${message.key} exceeds its length contract`)
    }
    if (!ALLOWED_SURFACES.has(text(message.surface, `surface for ${message.key}`))) {
      throw new Error(`Phanes message ${message.key} names a surface the host does not admit`)
    }
    if (typeof message.description !== 'string') {
      throw new Error(`Phanes message ${message.key} has an invalid description`)
    }
    const variables = templateVariables(message.text)
    if (
      !Array.isArray(message.allowedVariables)
      || message.allowedVariables.some(variable => typeof variable !== 'string')
      || canonicalJson(message.allowedVariables) !== canonicalJson(variables)
    ) {
      throw new Error(`Phanes message ${message.key} has stale allowedVariables testimony`)
    }
    const messageObject = asRecord(message.object, `Meaningful Object for ${message.key}`)
    if (
      messageObject.kind !== 'message-template'
      || messageObject.objectId !== `${AGENT_OBJECT_ID}:message-template:${message.key}`
      || typeof messageObject.version !== 'string'
      || !SHA256_PATTERN.test(messageObject.version)
    ) {
      throw new Error(`Phanes message ${message.key} has an invalid Meaningful Object identity`)
    }
  }
  if (!Array.isArray(bundle.flows) || bundle.flows.length < 1 || bundle.flows.length > 8) {
    throw new Error('Phanes control bundle has no InteractionFlow')
  }
  const flowIds = new Set<string>()
  for (const candidate of bundle.flows) {
    const flow = asRecord(candidate, 'Phanes InteractionFlow') as unknown as PhanesInteractionFlow
    if (flow.schema !== FLOW_SCHEMA || !NODE_PATTERN.test(text(flow.flowId, 'flow id'))) {
      throw new Error('Phanes InteractionFlow identity is invalid')
    }
    if (flowIds.has(flow.flowId)) throw new Error(`Duplicate Phanes flow id: ${flow.flowId}`)
    flowIds.add(flow.flowId)
    if (
      !Array.isArray(flow.nodes)
      || flow.nodes.length > 64
      || !NODE_PATTERN.test(text(flow.entryNode, 'flow entry node'))
    ) {
      throw new Error(`Phanes InteractionFlow ${flow.flowId} has invalid nodes`)
    }
    const nodeIds = new Set(flow.nodes.map(node => {
      const nodeId = text(node.nodeId, 'flow node id')
      if (!NODE_PATTERN.test(nodeId)) throw new Error(`Phanes InteractionFlow ${flow.flowId} has an invalid node id`)
      return nodeId
    }))
    if (nodeIds.size !== flow.nodes.length || !nodeIds.has(flow.entryNode)) {
      throw new Error(`Phanes InteractionFlow ${flow.flowId} has an invalid entry node`)
    }
    for (const node of flow.nodes) {
      if (!ALLOWED_NODE_KINDS.has(text(node.kind, `kind for ${node.nodeId}`))) {
        throw new Error(`Phanes flow node ${node.nodeId} names a kind the host does not admit`)
      }
      if (!messageKeys.has(node.titleTemplate) || !messageKeys.has(node.bodyTemplate)) {
        throw new Error(`Phanes flow node ${node.nodeId} references missing copy`)
      }
      const titleTemplate = messageByKey.get(node.titleTemplate)!
      const bodyTemplate = messageByKey.get(node.bodyTemplate)!
      if (
        titleTemplate.allowedVariables.length !== 0
        || titleTemplate.surface !== 'embed-title'
        || titleTemplate.maxLength > 256
      ) {
        throw new Error(`Phanes flow title ${node.titleTemplate} differs from its host contract`)
      }
      const expectedBodyVariables = node.kind === 'privacy' ? ['status', 'transition'] : []
      if (
        canonicalJson(bodyTemplate.allowedVariables) !== canonicalJson(expectedBodyVariables)
        || bodyTemplate.surface !== 'embed-body'
        || bodyTemplate.maxLength > 4096
      ) {
        throw new Error(`Phanes flow body ${node.bodyTemplate} differs from its host contract`)
      }
      if (!Array.isArray(node.actions) || node.actions.length > 20) {
        throw new Error(`Phanes flow node ${node.nodeId} has invalid actions`)
      }
      const actionIds = new Set<string>()
      for (const action of node.actions) {
        if (!NODE_PATTERN.test(text(action.actionId, `action id in ${node.nodeId}`))) {
          throw new Error(`Phanes flow node ${node.nodeId} has an invalid action id`)
        }
        if (actionIds.has(action.actionId)) throw new Error(`Duplicate action in ${node.nodeId}`)
        actionIds.add(action.actionId)
        if (!ALLOWED_ACTION_KINDS.has(text(action.kind, `kind for ${action.actionId}`))) {
          throw new Error(`Phanes flow action ${action.actionId} names a capability the host does not admit`)
        }
        if (!ALLOWED_STYLES.has(text(action.style, `style for ${action.actionId}`))) {
          throw new Error(`Phanes flow action ${action.actionId} names an invalid style`)
        }
        if (!messageKeys.has(action.labelTemplate)) {
          throw new Error(`Phanes flow action ${action.actionId} references missing copy`)
        }
        const labelTemplate = messageByKey.get(action.labelTemplate)!
        if (
          labelTemplate.allowedVariables.length !== 0
          || labelTemplate.surface !== 'button'
          || labelTemplate.maxLength > 80
        ) {
          throw new Error(`Phanes flow action ${action.actionId} has an invalid label contract`)
        }
        if (action.kind === 'navigate' && (!action.target || !nodeIds.has(action.target))) {
          throw new Error(`Phanes flow action ${action.actionId} has an invalid target`)
        }
        if (action.kind !== 'navigate' && action.target !== null) {
          throw new Error(`Only navigation actions may name a target (${action.actionId})`)
        }
        if (
          action.requiredCog !== null
          && (
            typeof action.requiredCog !== 'string'
            || !NODE_PATTERN.test(action.requiredCog.toLocaleLowerCase())
          )
        ) {
          throw new Error(`Phanes flow action ${action.actionId} has an invalid required cog`)
        }
      }
    }
    const flowObject = asRecord(flow.object, `Meaningful Object for ${flow.flowId}`)
    if (
      flowObject.kind !== 'interaction-flow'
      || flowObject.objectId !== `${AGENT_OBJECT_ID}:interaction-flow:${flow.flowId}`
      || typeof flowObject.version !== 'string'
      || !SHA256_PATTERN.test(flowObject.version)
    ) {
      throw new Error(`Phanes InteractionFlow ${flow.flowId} has an invalid Meaningful Object identity`)
    }
  }
  if (!flowIds.has('phanes-hub')) {
    throw new Error('Phanes control bundle omits the host Phanes interaction flow')
  }
  if (!flowIds.has('roles-hub')) {
    throw new Error('Phanes control bundle omits the host Roles interaction flow')
  }
  const phanesFlow = bundle.flows.find(flow => flow.flowId === 'phanes-hub')!
  if (phanesFlow.nodes.some(node => (
    node.kind === 'roles' || node.actions.some(action => action.kind.startsWith('roles.'))
  ))) {
    throw new Error('Roles must remain outside the Phanes interaction flow')
  }
  const rolesFlow = bundle.flows.find(flow => flow.flowId === 'roles-hub')!
  const rolesEntry = rolesFlow.nodes.find(node => node.nodeId === rolesFlow.entryNode)
  if (
    rolesEntry?.kind !== 'roles'
    || !rolesFlow.nodes.some(node => node.actions.some(action => action.kind.startsWith('roles.')))
  ) {
    throw new Error('Roles interaction flow must remain a top-level roles command')
  }
  return bundle
}

function assertPresentationContracts(value: unknown, baseline: PhanesControlBundle): void {
  const candidate = validateControlStructure(value)
  const candidateMessages = new Map(candidate.presentation.messages.map(message => [message.key, message]))
  for (const expected of baseline.presentation.messages) {
    const actual = candidateMessages.get(expected.key)
    if (!actual) throw new Error(`Phanes controls may not remove host template ${expected.key}`)
    if (
      actual.surface !== expected.surface
      || actual.maxLength !== expected.maxLength
      || canonicalJson(actual.allowedVariables) !== canonicalJson(expected.allowedVariables)
    ) {
      throw new Error(`Phanes message ${expected.key} changes its fixed host contract`)
    }
  }
}

async function verifyControlDigests(bundle: PhanesControlBundle): Promise<void> {
  for (const message of bundle.presentation.messages) {
    if (message.object.version !== `sha256:${await sha256Text(message.text)}`) {
      throw new Error(`Phanes message ${message.key} has a stale content digest`)
    }
  }
  for (const flow of bundle.flows) {
    if (flow.object.version !== `sha256:${await sha256Text(canonicalJson(flowCore(flow)))}`) {
      throw new Error(`Phanes InteractionFlow ${flow.flowId} has a stale content digest`)
    }
  }
  const expected = `sha256:${await sha256Text(canonicalJson(controlCore(bundle)))}`
  if (bundle.object.version !== expected) {
    throw new Error('Phanes control bundle has a stale content digest')
  }
}

function controlCore(bundle: PhanesControlBundle): Record<string, unknown> {
  return {
    agent: bundle.agent,
    publishedAt: bundle.publishedAt,
    presentation: bundle.presentation,
    flows: bundle.flows,
  }
}

function flowCore(flow: PhanesInteractionFlow): Record<string, unknown> {
  return {
    flowId: flow.flowId,
    entryNode: flow.entryNode,
    nodes: flow.nodes,
  }
}

function templateVariables(value: string): string[] {
  const variables = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '}') {
      if (value[index + 1] === '}') {
        index += 1
        continue
      }
      throw new Error('Phanes message template has an unmatched closing brace')
    }
    if (value[index] !== '{') continue
    if (value[index + 1] === '{') {
      index += 1
      continue
    }
    const end = value.indexOf('}', index + 1)
    if (end < 0) throw new Error('Phanes message template has an unmatched opening brace')
    const variable = value.slice(index + 1, end)
    if (!VARIABLE_PATTERN.test(variable)) {
      throw new Error(`Phanes message template variable is unsafe: ${variable}`)
    }
    variables.add(variable)
    index = end
  }
  return [...variables].sort()
}

function unwrapJsonFence(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('```json') && trimmed.endsWith('```')) {
    return trimmed.slice('```json'.length, -3).trim()
  }
  return trimmed
}

function parseJsonDocument(content: string, label: string): unknown {
  const raw = unwrapJsonFence(content)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (canonicalJson(value) !== raw) throw new Error(`${label} is not canonical JSON`)
  return value
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Python's canonical_json uses Unicode code-point ordering. Avoid the
        // host locale here so Garden and Phanes seal the exact same bytes.
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1) throw new Error(`${label} must be text`)
  return value
}

function snowflake(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SNOWFLAKE_PATTERN.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(snowflake(left, 'Discord channel id'))
  const rightValue = BigInt(snowflake(right, 'Discord channel id'))
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function utcTimestamp(value: unknown, label: string): string {
  const timestamp = text(value, label)
  if (!timestamp.endsWith('Z') || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be a valid UTC timestamp`)
  }
  return timestamp
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`)
  return value as number
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label)
  if (parsed < 1) throw new Error(`${label} must be positive`)
  return parsed
}
