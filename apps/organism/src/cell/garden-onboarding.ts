import type { HostedWorkspaceInfo } from './hosted-workspace-creation.js'
import {
  GARDEN_ONBOARDING_EDITION,
  GARDEN_ONBOARDING_PAGES,
  gardenOnboardingDocument,
  type GardenOnboardingPage,
} from './garden-onboarding-content.js'

export { GARDEN_ONBOARDING_EDITION, GARDEN_ONBOARDING_TITLE } from './garden-onboarding-content.js'

export interface GardenOnboardingMcp {
  /** The host supplies raw, authoritative MCP — never a cached source-mirror read. */
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

export interface GardenOnboardingInput {
  readonly mcp: GardenOnboardingMcp
  /** Only the directory-confirmed newly created owned graph, not a local placeholder. */
  readonly workspace: HostedWorkspaceInfo
  readonly expectedOwner: string
  /** Root binds this to the captured subject AND token before calling. */
  readonly isCurrent: () => boolean
}

export interface GardenOnboardingReport {
  readonly status: 'created' | 'preserved'
  readonly edition: string
  readonly graphId: string
  readonly documentIds: readonly string[]
  readonly firstDocumentId: string
  /** Every authored body/title was read back in this run, not merely acknowledged. */
  readonly contentVerified: boolean
  /** True only when every document write reported actual published durability. */
  readonly durabilityConfirmed: boolean
}

export class GardenOnboardingError extends Error {
  constructor(
    readonly graphId: string,
    readonly acknowledgedDocumentIds: readonly string[],
    reason: string,
  ) {
    super(`Garden tour could not be completed in retained graph ${graphId}: ${reason} `
      + 'No automatic retry or deletion was performed. Keep this graph and inspect its pages before deciding what to do next.')
    this.name = 'GardenOnboardingError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not an object`)
  const result = value as Record<string, unknown>
  if (result.isError === true || result.error !== undefined) throw new Error(`${label} reports an error`)
  return result
}

function matchesIdentity(value: Record<string, unknown>, keys: readonly string[], expected: string): boolean {
  const supplied = keys.filter(key => value[key] !== undefined)
  return supplied.length > 0 && supplied.every(key => value[key] === expected)
}

function documentCensus(value: unknown): readonly string[] {
  const result = record(value, 'Document census')
  const page = record(result.page, 'Document census page')
  if (!Array.isArray(result.documents) || !Number.isSafeInteger(result.count) || (result.count as number) < 0
    || page.complete !== true || page.nextCursor !== null || page.returned !== result.documents.length
    || result.count !== result.documents.length) throw new Error('Document census is incomplete or malformed')
  const ids = result.documents.map(value => {
    const row = record(value, 'Document census row')
    if (typeof row.documentId !== 'string' || !row.documentId.trim()) throw new Error('Document census row has no ID')
    return row.documentId
  })
  if (new Set(ids).size !== ids.length) throw new Error('Document census contains duplicate IDs')
  return ids
}

function verifyWrite(value: unknown, graphId: string, documentId: string): { revision: number; published: boolean } {
  const result = record(value, 'Document write')
  if (result.success !== true || !matchesIdentity(result, ['graphId', 'graph_id'], graphId)
    || !matchesIdentity(result, ['documentId', 'document_id'], documentId)
    || !Number.isSafeInteger(result.revision) || (result.revision as number) < 1) {
    throw new Error(`Document ${documentId} has no matching successful write acknowledgement`)
  }
  const checked = result.durabilityChecked ?? result.durability_checked
  const durability = result.durability
  if (typeof checked !== 'boolean' || !['published', 'local', 'pending', 'unchecked'].includes(String(durability))
    || (result.durabilityChecked !== undefined && result.durability_checked !== undefined
      && result.durabilityChecked !== result.durability_checked)
    || checked !== (durability === 'published' || durability === 'local')) {
    throw new Error(`Document ${documentId} has an unconfirmed or invalid durability acknowledgement`)
  }
  return { revision: result.revision as number, published: checked && durability === 'published' }
}

function verifyRead(value: unknown, graphId: string, page: GardenOnboardingPage, revision: number): void {
  const result = record(value, 'Document readback')
  if (!matchesIdentity(result, ['graphId', 'graph_id'], graphId)
    || !matchesIdentity(result, ['documentId', 'document_id'], page.documentId)
    || result.title !== page.title || result.format !== 'json' || result.complete !== true
    || result.fragment !== false || result.offset !== 0 || result.nextOffset !== null
    || !Number.isSafeInteger(result.revision) || (result.revision as number) < revision
    || typeof result.content !== 'string') throw new Error(`Document ${page.documentId} readback is incomplete or mismatched`)
  const projection = record(JSON.parse(result.content), 'Document JSON projection')
  const document = record(projection.tiptapJson, 'Document TipTap projection')
  if (document.type !== 'doc' || !Array.isArray(document.content) || document.content.length !== page.blocks.length) {
    throw new Error(`Document ${page.documentId} content does not match the tour`)
  }
  for (const [index, expected] of page.blocks.entries()) {
    const block = record(document.content[index], 'Document block')
    const attrs = record(block.attrs, 'Document block attributes')
    if (block.type !== expected.type || attrs['data-block-id'] !== `${page.documentId}-b${index + 1}`
      || (expected.type === 'heading' && attrs.level !== 2)
      || !Array.isArray(block.content) || block.content.length !== 1
      || record(block.content[0], 'Document text').type !== 'text'
      || record(block.content[0], 'Document text').text !== expected.text) {
      throw new Error(`Document ${page.documentId} block ${index + 1} does not match the tour`)
    }
  }
}

const activeSeeds = new WeakMap<GardenOnboardingMcp, Set<string>>()

/**
 * Explicit fresh-workspace initialization, never login middleware or an update
 * over an old tutorial. Writes each missing new document once with revision-0
 * preconditions and reads it back. No create_document metadata upsert, retry,
 * deletion, permission change, provider job, or automatic existing-user update.
 */
export async function seedGardenOnboarding(input: GardenOnboardingInput): Promise<GardenOnboardingReport> {
  const { mcp, workspace, expectedOwner, isCurrent } = input
  const graphId = workspace.graphId.trim()
  const acknowledged: string[] = []
  const key = `${expectedOwner}\u001f${graphId}`
  const active = activeSeeds.get(mcp) ?? new Set<string>()
  const ensureCurrent = (): void => {
    if (!isCurrent()) throw new Error('The account or session changed; no further tour operations are allowed')
  }
  if (active.has(key)) throw new GardenOnboardingError(graphId, [], 'A tour request is already in flight')
  active.add(key)
  activeSeeds.set(mcp, active)
  try {
    if (!graphId || graphId !== workspace.graphId || !/^user:[^\s:]+$/.test(expectedOwner)
      || workspace.owner !== expectedOwner || workspace.role !== 'owner' || workspace.localCreation) {
      throw new Error('A newly created, directory-confirmed graph owned by the current account is required')
    }
    ensureCurrent()
    const ids = documentCensus(await mcp.callTool('list_documents', { graphId, limit: 100, maxBytes: 262144 }))
    ensureCurrent()
    const documentIds = GARDEN_ONBOARDING_PAGES.map(page => page.documentId)
    const base = { edition: GARDEN_ONBOARDING_EDITION, graphId, documentIds, firstDocumentId: documentIds[0] }
    if (ids.length > 0) {
      if (documentIds.every(id => ids.includes(id))) {
        return { ...base, status: 'preserved', contentVerified: false, durabilityConfirmed: false }
      }
      throw new Error('This graph already contains documents or a partial tour; its existing work was not changed')
    }
    let durabilityConfirmed = true
    for (const page of GARDEN_ONBOARDING_PAGES) {
      ensureCurrent()
      const written = await mcp.callTool('write_document', {
        graphId,
        documentId: page.documentId,
        title: page.title,
        tiptapJson: gardenOnboardingDocument(page),
        expectedRevision: 0,
        awaitDurable: true,
      })
      ensureCurrent()
      const receipt = verifyWrite(written, graphId, page.documentId)
      acknowledged.push(page.documentId)
      durabilityConfirmed = durabilityConfirmed && receipt.published
      const readback = await mcp.callTool('read_document', {
        graphId, documentId: page.documentId, format: 'json', offset: 0, maxChars: 262144,
      })
      ensureCurrent()
      verifyRead(readback, graphId, page, receipt.revision)
    }
    return { ...base, status: 'created', contentVerified: true, durabilityConfirmed }
  } catch (error) {
    if (error instanceof GardenOnboardingError) throw error
    throw new GardenOnboardingError(graphId, acknowledged.slice(), error instanceof Error ? error.message : String(error))
  } finally {
    active.delete(key)
    if (active.size === 0) activeSeeds.delete(mcp)
  }
}
