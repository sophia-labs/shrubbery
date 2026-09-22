import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  compileAgentStudioProfile,
  createSophiaClusterLeadProfile,
} from '../src/agent-studio.js'

const repository = process.env.SOPHIA_CHOREOGRAPH_REPO?.trim()
if (!repository) throw new Error('SOPHIA_CHOREOGRAPH_REPO must point at the Choreograph repository')

const configModule = await import(pathToFileURL(resolve(repository, 'src/workflow/domain-agent-config.ts')).href)
const runtimeDigest = process.env.SOPHIA_AGENT_RUNTIME_DIGEST?.trim() ?? `sha256:${'a'.repeat(64)}`
const profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })
const publication = await compileAgentStudioProfile(profile, {
  promotedBy: 'user:vera',
  promotedAt: 1_800_000_000_000,
  promptDocument: {},
})

class Documents {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  async sparqlUpdate(): Promise<void> {}
  async sparqlQuery(): Promise<unknown> { return {} }
  async searchDocuments(): Promise<[]> { return [] }
  async writeDocument(): Promise<unknown> { throw new Error('verification graph is read-only') }
  async readDocument(graphId: string, documentId: string, options?: { format?: string }) {
    const text = this.values[documentId]
    if (text === undefined) throw new Error(`missing ${graphId}/${documentId}`)
    return {
      graphId,
      documentId,
      documentUri: `urn:mnemosyne:local:document:${documentId}`,
      format: options?.format ?? 'markdown',
      text,
      blocks: [],
      raw: {},
    }
  }
}

const home = new Documents(publication.homeDocuments)
const authority = new Documents(publication.authorityDocuments)
const request = configModule.parseDomainAgentInvocationRequest({
  definition_document_id: publication.definitionDocumentId,
  trigger: { kind: 'sophia-cluster.message', eventId: 'evt-1', resource: 'vehicle:sophia-cluster:room-1' },
  context_refs: [],
})
const resolved = await configModule.resolveDomainAgentConfig({
  graph: home,
  graphId: 'sophia-cluster',
  request,
  homeOwnerPrincipal: 'user:vera',
  trustedGrantAuthorities: [{ ownerPrincipal: 'user:vera', graphId: 'observatory' }],
  graphFor: async (address: { ownerPrincipal: string; graphId: string }) => {
    assert.deepEqual(address, { ownerPrincipal: 'user:vera', graphId: 'observatory' })
    return authority
  },
  now: 1_800_000_000_000,
})

assert.equal(resolved.definition.schema, 'sophia.domain-agent-definition.v2')
assert.equal(resolved.definition.agentId, publication.agentId)
assert.equal(resolved.runtimes.pilot.kind, 'prime')
assert.equal(resolved.runtimes.emanation.kind, 'simple')
assert.deepEqual(resolved.pilotToolInclude, ['recall', 'remember', 'search_documents'])
assert.equal(resolved.prompt.systemPrompt, profile.prompt.trim())
process.stdout.write(`${JSON.stringify({
  schema: 'sophia.agent-studio-choreograph-verification.v1',
  agentId: publication.agentId,
  definitionSchema: resolved.definition.schema,
  profileDigest: publication.profileDigest,
  publicationDigest: publication.digest,
  pilotRuntime: resolved.runtimes.pilot.kind,
  emanationRuntime: resolved.runtimes.emanation.kind,
  tools: resolved.pilotToolInclude,
}, null, 2)}\n`)
