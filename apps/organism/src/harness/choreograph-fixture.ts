import type { ChoreoAgent, ChoreoMode, ChoreoModeDraft, ChoreoModesPort, ChoreoRunOverviewPort, ChoreoToolDescriptor } from '@shrubbery/components'

const tools: readonly ChoreoToolDescriptor[] = [
  { name: 'read_document', description: 'Read a document', scopes: ['document.read'], effect: 'read', family: 'document' },
  { name: 'search_documents', description: 'Search this workspace', scopes: ['document.read'], effect: 'read', family: 'document' },
  { name: 'write_document', description: 'Write a document', scopes: ['document.write'], effect: 'write', family: 'document' },
  { name: 'sparql_query', description: 'Query the graph', scopes: ['rdf.query'], effect: 'read', family: 'rdf' },
  { name: 'sparql_update', description: 'Update the graph', scopes: ['rdf.write'], effect: 'write', family: 'rdf' },
]

export function createChoreographRunFixturePort(): ChoreoRunOverviewPort {
  const now = Date.now()
  return { async runs() { return { kind: 'ok', runs: [
    { runId: 'run-demo-124', workflowName: 'Workspace survey', status: 'running', startedAt: new Date(now - 7 * 60_000).toISOString(), durationMs: null, agentCount: 2 },
    { runId: 'run-demo-123', workflowName: 'Daily synthesis', status: 'finished', startedAt: new Date(now - 4 * 60 * 60_000).toISOString(), endedAt: new Date(now - 4 * 60 * 60_000 + 89_000).toISOString(), durationMs: 89_000, agentCount: 3, totalTokens: 18_420 },
    { runId: 'run-demo-122', workflowName: 'Citation audit', status: 'failed', startedAt: new Date(now - 28 * 60 * 60_000).toISOString(), endedAt: new Date(now - 28 * 60 * 60_000 + 35_000).toISOString(), durationMs: 35_000, agentCount: 1, totalTokens: 3_190 },
  ] } } }
}

export function createChoreographFixturePort(graphId: string): ChoreoModesPort {
  const modes = new Map<string, ChoreoMode>([
    ['research', mode('research', 'Research', 'read', ['read_document', 'search_documents', 'sparql_query'])],
    ['steward', mode('steward', 'Steward', 'write', ['read_document', 'search_documents', 'write_document', 'sparql_query', 'sparql_update'])],
    ['correspondent', mode('correspondent', 'Correspondent', 'read', ['read_document', 'search_documents'])],
  ])
  const agents = new Map<string, ChoreoAgent>([
    ['sophia', agent(graphId, 'sophia', 'Sophia', 'research', ['research', 'steward'])],
    ['gardener', agent(graphId, 'gardener', 'Gardener', 'steward', ['steward'])],
    ['cartographer', agent(graphId, 'cartographer', 'Cartographer', 'research', ['research', 'correspondent'])],
  ])
  return {
    graphId,
    async catalogue() { return tools },
    async load() { return { modes: [...modes.values()], agents: [...agents.values()] } },
    async saveMode(draft: ChoreoModeDraft) {
      const previous = modes.get(draft.slug)
      modes.set(draft.slug, { ...draft, iri: `urn:sophia:mode:${draft.slug}`, imageTransform: previous?.imageTransform ?? null })
    },
    async deleteMode(iri: string) {
      for (const [slug, entry] of modes) if (entry.iri === iri) modes.delete(slug)
      for (const [id, entry] of agents) agents.set(id, {
        ...entry,
        defaultMode: entry.defaultMode === iri ? null : entry.defaultMode,
        mayUseModes: entry.mayUseModes.filter(value => value !== iri),
      })
    },
    async saveAgentModes(iri: string, defaultMode: string | null, mayUseModes: readonly string[]) {
      for (const [id, entry] of agents) if (entry.iri === iri) agents.set(id, { ...entry, defaultMode, mayUseModes })
    },
  }
}

function mode(slug: string, label: string, access: 'read' | 'write', allowsTools: readonly string[]): ChoreoMode {
  return { iri: `urn:sophia:mode:${slug}`, slug, label, access, allowsTools, graphScopes: [], requiresApproval: [], imageTransform: null }
}

function agent(graphId: string, agentId: string, label: string, defaultMode: string, allowedModes: readonly string[]): ChoreoAgent {
  const dossiers = {
    sophia: { role: 'Knowledge steward', summary: 'Orients in the graph, investigates open questions, and preserves durable context.', model: 'Pilot model · fixture', skills: ['Research', 'Synthesis', 'Correspondence'], harness: 'sophia-cluster-lead-harness-v1', geist: 'sophia-1-geist', prompt: 'sophia-1-prompt', toolManifest: 'sophia-1-tools', toolGrant: 'sophia-1-grant', runtimeProfile: 'prime' },
    gardener: { role: 'Workspace caretaker', summary: 'Keeps documents, links, and workspace structure coherent.', model: 'Pilot model · fixture', skills: ['Curation', 'Graph editing'], harness: 'garden-harness-v1', geist: 'gardener-geist', prompt: 'gardener-prompt', toolManifest: 'gardener-tools', toolGrant: 'gardener-grant', runtimeProfile: 'simple' },
    cartographer: { role: 'Graph cartographer', summary: 'Maps concepts and relationships into a readable account of a workspace.', model: 'Pilot model · fixture', skills: ['Graph survey', 'Summary'], harness: 'survey-harness-v1', geist: 'cartographer-geist', prompt: 'cartographer-prompt', toolManifest: 'cartographer-tools', toolGrant: 'cartographer-grant', runtimeProfile: 'simple' },
  }[agentId as 'sophia' | 'gardener' | 'cartographer']
  return {
    iri: `urn:sophia:agent:${agentId}`,
    agentId,
    label,
    defaultMode: `urn:sophia:mode:${defaultMode}`,
    mayUseModes: allowedModes.map(slug => `urn:sophia:mode:${slug}`),
    dossier: {
      sourceLabel: 'Browser demo profile',
      role: dossiers.role,
      summary: dossiers.summary,
      homeGraphId: graphId,
      model: dossiers.model,
      ontology: { geist: dossiers.geist, prompt: dossiers.prompt, skills: dossiers.skills,
        harness: dossiers.harness, toolManifest: dossiers.toolManifest, toolGrant: dossiers.toolGrant,
        runtimeProfile: dossiers.runtimeProfile },
    },
  }
}
