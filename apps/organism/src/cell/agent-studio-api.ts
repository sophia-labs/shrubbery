import {
  type AgentStudioCompiledPublication,
  type AgentStudioProfileV1,
  agentStudioVersionedDocumentIds,
  canonicalJson,
  compileAgentStudioProfile,
  parseAgentStudioProfile,
} from '@shrubbery/domain-kit/agent-studio'

export const AGENT_STUDIO_GRAPH_ID = 'sophia-cluster'
export const AGENT_STUDIO_PROFILE_DOCUMENT_ID = 'agent-studio-profile'
export const AGENT_STUDIO_DEFINITION_DOCUMENT_ID = 'domain-agent-definition'

const OPERATION_TIMEOUT_MS = 30_000

export interface AgentStudioMcp {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

export interface AgentStudioDocumentVersion {
  readonly revision: number | null
  readonly updatedAt: string | null
}

export interface AgentStudioProfileDocument extends AgentStudioDocumentVersion {
  readonly profile: AgentStudioProfileV1
  readonly canonicalContent: string
}

export interface AgentStudioActiveDefinition extends AgentStudioDocumentVersion {
  readonly value: Readonly<Record<string, unknown>>
  readonly canonicalContent: string
}

export interface AgentStudioSnapshot {
  readonly profile: AgentStudioProfileDocument
  readonly activeDefinition: AgentStudioActiveDefinition | null
}

export interface AgentStudioPublishResult {
  readonly snapshot: AgentStudioSnapshot
  readonly publication: AgentStudioCompiledPublication
}

export class AgentStudioConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStudioConflictError'
  }
}

export class AgentStudioApi {
  constructor(
    private readonly mcp: AgentStudioMcp,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<AgentStudioSnapshot> {
    const [profile, activeDefinition] = await Promise.all([
      this.readProfile(),
      this.readOptionalJson(AGENT_STUDIO_GRAPH_ID, AGENT_STUDIO_DEFINITION_DOCUMENT_ID, 'active Agent definition'),
    ])
    return { profile, activeDefinition }
  }

  async saveDraft(value: unknown, expected: AgentStudioDocumentVersion): Promise<AgentStudioSnapshot> {
    const profile = parseAgentStudioProfile(value)
    const current = await this.readProfile()
    assertExpectedVersion(current, expected, 'Agent Studio draft')
    const canonicalContent = canonicalJson(profile)
    await this.writeDocument({
      graphId: AGENT_STUDIO_GRAPH_ID,
      documentId: AGENT_STUDIO_PROFILE_DOCUMENT_ID,
      title: 'Sophia Cluster lead Agent profile',
      content: canonicalContent,
      expectedRevision: current.revision,
    })
    const reread = await this.readProfile()
    if (reread.canonicalContent !== canonicalContent) {
      throw new Error('Garden reread differs from the saved Agent Studio profile')
    }
    return {
      profile: reread,
      activeDefinition: await this.readOptionalJson(
        AGENT_STUDIO_GRAPH_ID,
        AGENT_STUDIO_DEFINITION_DOCUMENT_ID,
        'active Agent definition',
      ),
    }
  }

  async publish(expected: AgentStudioDocumentVersion): Promise<AgentStudioPublishResult> {
    const snapshotBefore = await this.load()
    assertExpectedVersion(snapshotBefore.profile, expected, 'Agent Studio draft')
    const profile = snapshotBefore.profile.profile
    if (profile.home.graphId !== AGENT_STUDIO_GRAPH_ID) {
      throw new Error(`Agent Studio may publish only into '${AGENT_STUDIO_GRAPH_ID}'`)
    }
    const promotedBy = profile.home.ownerPrincipal
    const promotedAt = this.now()
    const ids = await agentStudioVersionedDocumentIds(profile, { promotedBy, promotedAt })

    // The prompt is written and reread first because Choreograph's executable
    // prompt binding seals the exact Garden read witness. Every dependency is
    // versioned; none of these writes changes the currently active definition.
    await this.writeDocument({
      graphId: profile.home.graphId,
      documentId: ids.prompt,
      title: `${profile.displayName} prompt`,
      content: `${profile.prompt.trim()}\n`,
      expectedRevision: 0,
    })
    const prompt = await this.readDocument(profile.home.graphId, ids.prompt, 'published prompt')
    if (prompt.content.trim() !== profile.prompt.trim()) {
      throw new Error('Garden reread differs from the published Agent prompt')
    }
    const publication = await compileAgentStudioProfile(profile, {
      promotedBy,
      promotedAt,
      promptDocument: {
        ...(prompt.revision === null ? {} : { revision: prompt.revision }),
        ...(prompt.changeId === null ? {} : { changeId: prompt.changeId }),
      },
    })
    if (publication.activeDocumentIds.prompt !== ids.prompt) {
      throw new Error('Agent Studio compiler changed the prepared prompt coordinate')
    }

    // Cross-graph Layer-0 authority lands before anything can point at it.
    for (const [documentId, content] of Object.entries(publication.authorityDocuments)) {
      await this.writeAndVerify(profile.grantAuthority.graphId, documentId, `${profile.displayName} grant`, content, 0)
    }
    for (const [documentId, content] of Object.entries(publication.homeDocuments)) {
      if (documentId === ids.prompt || documentId === publication.definitionDocumentId) continue
      await this.writeAndVerify(profile.home.graphId, documentId, `${profile.displayName} ${documentId}`, content, 0)
    }

    // Re-read the source immediately before the activation pointer. On cells
    // that expose a durable revision this is also enforced by write_document;
    // older cells retain the explicit optimistic updatedAt fence plus reread.
    const sourceAtCommit = await this.readProfile()
    assertExpectedVersion(sourceAtCommit, expected, 'Agent Studio draft')
    const activeAtCommit = await this.readOptionalJson(
      AGENT_STUDIO_GRAPH_ID,
      AGENT_STUDIO_DEFINITION_DOCUMENT_ID,
      'active Agent definition',
    )
    assertSameVersion(snapshotBefore.activeDefinition, activeAtCommit, 'active Agent definition')
    const definitionContent = publication.homeDocuments[publication.definitionDocumentId]
    await this.writeAndVerify(
      profile.home.graphId,
      publication.definitionDocumentId,
      `${profile.displayName} active definition`,
      definitionContent,
      activeAtCommit ? activeAtCommit.revision : 0,
    )
    const snapshot = await this.load()
    if (snapshot.activeDefinition?.canonicalContent !== canonicalJson(publication.definition)) {
      throw new Error('Active Agent definition does not match the compiled publication')
    }
    return { snapshot, publication }
  }

  private async readProfile(): Promise<AgentStudioProfileDocument> {
    const document = await this.readDocument(
      AGENT_STUDIO_GRAPH_ID,
      AGENT_STUDIO_PROFILE_DOCUMENT_ID,
      'Agent Studio profile',
    )
    const value = parseJsonDocument(document.content, 'Agent Studio profile')
    const profile = parseAgentStudioProfile(value)
    return {
      profile,
      revision: document.revision,
      updatedAt: document.updatedAt,
      canonicalContent: canonicalJson(profile),
    }
  }

  private async readOptionalJson(
    graphId: string,
    documentId: string,
    label: string,
  ): Promise<AgentStudioActiveDefinition | null> {
    let document: Awaited<ReturnType<AgentStudioApi['readDocument']>>
    try {
      document = await this.readDocument(graphId, documentId, label)
    } catch (error) {
      if (isMissingDocument(error)) return null
      throw error
    }
    const value = parseJsonDocument(document.content, label)
    return {
      value,
      revision: document.revision,
      updatedAt: document.updatedAt,
      canonicalContent: canonicalJson(value),
    }
  }

  private async writeAndVerify(
    graphId: string,
    documentId: string,
    title: string,
    content: string,
    expectedRevision: number | null,
  ): Promise<void> {
    await this.writeDocument({ graphId, documentId, title, content, expectedRevision })
    const reread = await this.readDocument(graphId, documentId, documentId)
    if (normalizeDocumentText(reread.content) !== normalizeDocumentText(content)) {
      throw new Error(`Garden reread differs from published document '${documentId}'`)
    }
  }

  private async writeDocument(input: {
    graphId: string
    documentId: string
    title: string
    content: string
    expectedRevision: number | null
  }): Promise<void> {
    const jsonContent = canonicalJsonContent(input.content)
    await withinDeadline(`write ${input.graphId}/${input.documentId}`, this.mcp.callTool('write_document', {
      graphId: input.graphId,
      documentId: input.documentId,
      title: input.title,
      ...(jsonContent === null
        ? { content: input.content }
        : {
            tiptapJson: {
              type: 'doc',
              content: [{
                type: 'codeBlock',
                attrs: { language: 'json' },
                content: [{ type: 'text', text: jsonContent }],
              }],
            },
          }),
      ...(input.expectedRevision === null ? {} : { expectedRevision: input.expectedRevision }),
      awaitDurable: true,
    }))
  }

  private async readDocument(graphId: string, documentId: string, label: string): Promise<{
    content: string
    revision: number | null
    changeId: string | null
    updatedAt: string | null
  }> {
    const value = await withinDeadline(`read ${graphId}/${documentId}`, this.mcp.callTool('read_document', {
      graphId,
      documentId,
      format: 'markdown',
    }))
    const result = asRecord(value, `${label} read result`)
    return {
      content: requiredText(result.content, `${label} content`),
      revision: optionalRevision(result.revision ?? result.rev, `${label} revision`),
      changeId: optionalText(result.change_id ?? result.changeId),
      updatedAt: optionalText(result.updated_at ?? result.updatedAt),
    }
  }
}

function assertExpectedVersion(
  actual: AgentStudioDocumentVersion,
  expected: AgentStudioDocumentVersion,
  label: string,
): void {
  if (actual.revision !== null || expected.revision !== null) {
    if (actual.revision !== expected.revision) {
      throw new AgentStudioConflictError(`${label} changed in Garden; reload before saving`)
    }
    return
  }
  if (actual.updatedAt !== expected.updatedAt) {
    throw new AgentStudioConflictError(`${label} changed in Garden; reload before saving`)
  }
}

function assertSameVersion(
  expected: AgentStudioDocumentVersion | null,
  actual: AgentStudioDocumentVersion | null,
  label: string,
): void {
  if (!expected || !actual) {
    if (expected !== actual) throw new AgentStudioConflictError(`${label} changed in Garden; reload before publishing`)
    return
  }
  assertExpectedVersion(actual, expected, label)
}

function parseJsonDocument(content: string, label: string): Readonly<Record<string, unknown>> {
  const raw = unwrapJsonFence(content)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  const record = asRecord(value, label)
  return record
}

function unwrapJsonFence(content: string): string {
  const trimmed = content.trim()
  const fenced = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/i.exec(trimmed)
  return fenced?.[1] ?? trimmed
}

function normalizeDocumentText(value: string): string {
  const unwrapped = unwrapJsonFence(value).trim()
  return canonicalJsonContent(unwrapped) ?? unwrapped
}

function canonicalJsonContent(value: string): string | null {
  try {
    return canonicalJson(JSON.parse(value))
  } catch {
    return null
  }
}

function optionalRevision(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`)
  return value as number
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is empty`)
  return value
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function isMissingDocument(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:not found|missing document|does not exist|404)/i.test(message)
}

async function withinDeadline<T>(label: string, operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${OPERATION_TIMEOUT_MS}ms`)), OPERATION_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}
