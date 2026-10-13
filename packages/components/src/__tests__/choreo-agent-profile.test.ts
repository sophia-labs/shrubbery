import { describe, expect, it } from 'vitest'
import '../choreo-agent-profile.js'
import type { ChoreoAgentProfile } from '../choreo-agent-profile.js'
import type { ChoreoAgent, ChoreoMode, ChoreoToolDescriptor } from '../choreo-modes-model.js'

const mode: ChoreoMode = {
  iri: 'urn:sophia:mode:research', slug: 'research', label: 'Research', access: 'read',
  allowsTools: ['read_document', 'write_document'], graphScopes: [], requiresApproval: [], imageTransform: null,
}
const agent: ChoreoAgent = {
  iri: 'urn:sophia:agent:scout', agentId: 'scout', label: 'Scout',
  defaultMode: mode.iri, mayUseModes: [mode.iri],
}
const catalogue: readonly ChoreoToolDescriptor[] = [
  { name: 'read_document', description: 'Read a document', scopes: ['documents.read'], effect: 'read', family: 'documents' },
  { name: 'write_document', description: 'Write a document', scopes: ['documents.write'], effect: 'write', family: 'documents' },
]

async function render(agentValue: ChoreoAgent): Promise<ChoreoAgentProfile> {
  const view = document.createElement('choreo-agent-profile')
  view.agent = agentValue
  view.modes = [mode]
  view.catalogue = catalogue
  view.graphId = 'graph-a'
  document.body.append(view)
  await view.updateComplete
  return view
}

describe('choreo-agent-profile', () => {
  it('shows source-backed mode exposure and labels missing ontology evidence', async () => {
    const view = await render(agent)
    const text = view.shadowRoot?.textContent ?? ''
    expect(text).toContain('Mode graph only')
    expect(text).toContain('Read a document')
    expect(text).not.toContain('Write a document')
    expect(text).toContain('This workspace only served the Agent identity and mode assignments')
    view.remove()
  })

  it('renders supplied ontology references without treating them as grants', async () => {
    const view = await render({ ...agent, dossier: {
      sourceLabel: 'Demo binding', role: 'Surveyor', homeGraphId: 'graph-a',
      ontology: { geist: 'scout-geist', skills: ['Map reading'], harness: 'survey-harness' },
    } })
    const text = view.shadowRoot?.textContent ?? ''
    expect(text).toContain('Surveyor')
    expect(text).toContain('scout-geist')
    expect(text).toContain('Map reading')
    expect(text).toContain('The runtime grant may narrow access further')
    view.remove()
  })
})
