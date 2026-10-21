import { describe, expect, it } from 'vitest'
import { agentIdOfIri, agentIriOfId, beingFaces, documentOfRunGraph, postOfStepIri, sittingsWords } from '../object-faces/being.js'

describe('a being and its post, by their IRIs', () => {
  it('goes between the agent id and its IRI', () => {
    expect(agentIdOfIri('urn:sophia:agent:agent-62517a586738e5e9')).toBe('agent-62517a586738e5e9')
    expect(agentIriOfId('agent-62517a586738e5e9')).toBe('urn:sophia:agent:agent-62517a586738e5e9')
    expect(agentIriOfId(agentIriOfId('agent-1'))).toBe('urn:sophia:agent:agent-1')
  })

  it('reads the workflow document and the post from a step IRI, and the document from a run graph', () => {
    expect(postOfStepIri('urn:sophia:wf:doc-1a79ba323d4c43a38cee5f7c785ef8bf#clerk')).toEqual({ documentId: 'doc-1a79ba323d4c43a38cee5f7c785ef8bf', stepId: 'clerk' })
    expect(postOfStepIri('http://example.org/x#y')).toBeNull()
    expect(documentOfRunGraph('urn:sophia:wf:doc-a:run:wfr-1')).toBe('doc-a')
    expect(documentOfRunGraph('urn:sophia:wf:doc-a:draft')).toBeNull()
  })

  it('says sittings as a person does', () => {
    expect([1, 26].map(sittingsWords)).toEqual(['1 sitting', '26 sittings'])
  })

  it('keys sittings by agentId, never by label: two posts with one label are two beings', () => {
    const faces = beingFaces({
      posts: [{ id: 'a', label: 'Clerk' }, { id: 'b', label: 'Clerk' }],
      sittings: [
        { agentId: 'agent-1', step: 'Clerk', state: 'done' },
        { agentId: 'agent-2', step: 'Clerk', state: 'done' },
        { agentId: 'agent-2', step: 'Clerk', state: 'failed' },
      ],
    })
    expect(faces.map((f) => [f.agentId, f.sittings])).toEqual([['agent-1', 1], ['agent-2', 2]])
  })

  it('leaves out sittings that name no being', () => {
    expect(beingFaces({ posts: [], sittings: [{ step: 'Old run', state: 'done' }] })).toEqual([])
  })
})
