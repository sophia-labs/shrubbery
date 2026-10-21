/**
 * The cast (world-UX slice A): the run's events keep who sat, the sittings fold into one face per being, and a being's
 * IRI finds its post in the graph. Over the REAL run recorded in Sophia.app on 2026-10-20 (the fixture's events are
 * what Choreograph sent) and a REAL Oxigraph store holding the run graph's shape (the engine a gardend cell embeds).
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beingFacts, beingFaces, beingHeadline } from '@shrubbery/nucleus/object-faces'
import { namedNode, Store, type Term } from 'oxigraph'
import { describe, expect, it } from 'vitest'
import { readBeingRef } from '../being-reader.js'
import { agentRuns } from '../graph-plan.js'
import appRunEvents from './fixtures/graph-plan-run-events-20261020.json'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/runtime/src/object-view/__tests__/fixtures')

const POSTS = [
  { id: 'cutter', label: 'Passage cutter' },
  { id: 'clerk', label: 'Experiment clerk' },
  { id: 'checker', label: 'Exact-quote checker', checks: 'candidates' },
]

describe('the fold keeps who sat', () => {
  const agents = agentRuns(appRunEvents)
  const byLabel = new Map(agents.map((agent) => [agent.label, agent]))

  it('carries agentId, agentType, the Geist pin, the session and the node key from node_queued', () => {
    const clerk = byLabel.get('Experiment clerk #3')!
    expect(clerk).toMatchObject({ agentId: 'agent-62517a586738e5e9', agentType: 'extractor', nodeKey: '2:experiment-clerk-3' })
    expect(clerk.sessionId).toMatch(/^ags_/)
    expect(clerk.geistObjectRef).toMatchObject({ kind: 'geist', graphId: 'freud-dreams' })
  })

  it('keeps a sitting asked again as one sitting with its first session and node key', () => {
    const checker = byLabel.get('Exact-quote checker #5')!
    expect(checker.attempts).toBe(2)
    expect(checker.nodeKey).toBe('3:exact-quote-checker-5')
  })
})

describe('the cast: one face per being, keyed by agentId, named by its post', () => {
  const faces = beingFaces({ posts: POSTS, sittings: agentRuns(appRunEvents) })

  it('folds the sittings of a post into one being, in the order of the posts', () => {
    expect(faces.map((f) => [f.name, f.agentId, f.sittings])).toEqual([
      ['Passage cutter', 'agent-eb966074fbcc322a', 1],
      ['Experiment clerk', 'agent-62517a586738e5e9', 2],
      ['Exact-quote checker', 'agent-8e5db2cdd0f70794', 2],
    ])
    expect(faces.map((f) => f.stepId)).toEqual(['cutter', 'clerk', 'checker'])
    expect(faces.map((f) => f.checks)).toEqual([false, false, true])
  })

  it('states only what the events observed: kind, model, tally; no mode, no run count', () => {
    const clerk = faces[1]!
    expect(clerk).toMatchObject({ kind: 'extractor', models: ['google/gemini-2.5-flash'], done: 2, failed: 0, askedAgain: 0 })
    expect(beingFacts(clerk)).toEqual(['extractor', 'google/gemini-2.5-flash', '2 sittings'])
    expect(faces[2]!.askedAgain).toBe(1)
    expect(beingHeadline(clerk)).toBe('Experiment clerk, 2 sittings')
    expect(Object.keys(clerk)).not.toContain('mode')
    expect(Object.keys(clerk)).not.toContain('runs')
  })

  it('gives a being of the graph a face even when no sitting was recorded', () => {
    const named = beingFaces({ posts: POSTS, sittings: [], cast: { clerk: 'urn:sophia:agent:agent-62517a586738e5e9' } })
    expect(named).toHaveLength(1)
    expect(named[0]).toMatchObject({ name: 'Experiment clerk', sittings: 0, kind: null, agentId: 'agent-62517a586738e5e9' })
  })

  it('counts failures as failures (a sitting that lost its model call)', () => {
    const failed = beingFaces({ posts: POSTS, sittings: agentRuns(appRunEvents.filter((e) => !String(e.label).endsWith('#5 again'))) })
    expect(failed[2]).toMatchObject({ sittings: 2, failed: 1 })
    expect(beingFacts(failed[2]!)).toContain('1 failed')
  })
})

describe('a being finds its post in the graph', () => {
  const store = new Store()
  const run = readFileSync(join(FIXTURES, 'run-record.ttl'), 'utf8')
  store.load(run, { format: 'text/turtle', to_graph_name: namedNode(/^# graph: (\S+)/.exec(run)![1]!) })
  // The workflow's draft graph labels its posts (the plan's `wf:label`).
  store.load('@prefix wf: <http://mnemosyne.dev/workflow#> . <urn:sophia:wf:doc-sleepers#clerk> a wf:AgentNode ; wf:label "Experiment clerk" .', {
    format: 'text/turtle', to_graph_name: namedNode('urn:sophia:wf:doc-sleepers:draft'),
  })
  const query = async (_graphId: string, sparql: string) => ({
    rows: (store.query(sparql) as Map<string, Term>[]).map((solution) => Object.fromEntries([...solution].map(([k, v]) => [k, v.toString()]))),
  })

  it('names the being by its post and opens the post in its workflow', async () => {
    expect(await readBeingRef(query, 'freud-dreams', 'urn:sophia:agent:agent-62517a586738e5e9')).toEqual({
      iri: 'urn:sophia:agent:agent-62517a586738e5e9', name: 'Experiment clerk', documentId: 'doc-sleepers', stepId: 'clerk',
    })
  })

  it('is null for a being no run of the graph cast', async () => {
    expect(await readBeingRef(query, 'freud-dreams', 'urn:sophia:agent:agent-0000000000000000')).toBeNull()
  })

  it('refuses what is not an IRI before it reaches a query', async () => {
    await expect(readBeingRef(query, 'freud-dreams', 'x> } DROP')).rejects.toThrow()
  })
})
