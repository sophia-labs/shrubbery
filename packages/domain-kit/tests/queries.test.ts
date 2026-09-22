import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { namedNode, Store, type Term } from 'oxigraph'
import { describe, expect, it } from 'vitest'
import { buildDomainQueryCatalogue, resolveDomainNamedQuery } from '../src/catalogue.js'
import { standardDomainQueries } from '../src/instances/shared.js'
import { manifestProjectionGraphIri, manifestToNt, parseCapabilityManifest } from '../src/manifest.js'
import { buildDomainVerdict, verdictToNt } from '../src/verdict.js'

const NT = 'application/n-triples'
const GRAPH_ID = 'shrubbery-domain'
const MANIFEST_PATH = fileURLToPath(
  new URL('../../../docs/acceptance/garden-capability-manifest.json', import.meta.url),
)

describe('standard Domain Kit query contract', () => {
  it('executes the sealed catalogue against the real manifest and scoped verdict vocabulary', async () => {
    const manifest = parseCapabilityManifest(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')))
    const store = new Store()
    store.load(manifestToNt(manifest), {
      format: NT,
      to_graph_name: namedNode(manifestProjectionGraphIri(GRAPH_ID)),
    })

    const claim = manifest.capabilities[0]
    const mode = claim.modes[0]
    const role = claim.roles[0]
    const common = {
      domain: 'shrub',
      capabilityId: claim.id,
      mode,
      role,
      targetSha256: 'a'.repeat(64),
      agentSessionUri: 'urn:sophia:agent-session:query-contract',
    } as const
    const pass = buildDomainVerdict({
      ...common,
      outcome: 'PASS',
      asOf: '2026-08-03T01:00:00.000Z',
      evidence: [{ uri: 'urn:sophia:evidence:pass', sha256: 'b'.repeat(64) }],
    })
    const fail = buildDomainVerdict({
      ...common,
      outcome: 'FAIL',
      reason: 'newer testimony contradicts the earlier pass',
      asOf: '2026-08-03T02:00:00.000Z',
      evidence: [{ uri: 'urn:sophia:evidence:fail', sha256: 'c'.repeat(64) }],
    })
    const verdictGraph = namedNode(`urn:mnemosyne:local:graph:${GRAPH_ID}:projection:domain-verdict`)
    store.load(verdictToNt(pass), { format: NT, to_graph_name: verdictGraph })
    store.load(verdictToNt(fail), { format: NT, to_graph_name: verdictGraph })

    store.load(
      [
        '<urn:sophia:session:query-contract> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://mnemosyne.dev/agent#Session> .',
        '<urn:sophia:session:query-contract> <http://mnemosyne.dev/agent#ofAgent> <urn:sophia:agent:shrub-1> .',
        '<urn:sophia:session:query-contract> <http://mnemosyne.dev/agent#turnCount> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .',
        '<urn:sophia:turn:query-contract> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://mnemosyne.dev/agent#Turn> .',
        '<urn:sophia:turn:query-contract> <http://mnemosyne.dev/agent#inSession> <urn:sophia:session:query-contract> .',
        '<urn:sophia:turn:query-contract> <http://mnemosyne.dev/agent#turnTime> "2026-08-03T02:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
        '',
      ].join('\n'),
      {
        format: NT,
        to_graph_name: namedNode(`urn:mnemosyne:local:graph:${GRAPH_ID}:projection:session`),
      },
    )

    const evidencePayload = JSON.stringify({
      run_id: 'run-query-contract',
      scenario_id: 'scenario-query-contract',
      beat_id: 'beat-query-contract',
      engine: 'chromium',
      operation: 'capture',
      evidence_uri: 's3://sophia-evidence/query-contract.json',
      evidence_sha256: 'd'.repeat(64),
    }).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    store.load(
      [
        '<urn:sophia:capture:query-contract> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://mnemosyne.dev/observatory#CaptureEvent> .',
        '<urn:sophia:capture:query-contract> <http://mnemosyne.dev/observatory#kind> "test.beat" .',
        '<urn:sophia:capture:query-contract> <http://mnemosyne.dev/observatory#capturedAt> "2026-08-03T02:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
        '<urn:sophia:capture:query-contract> <http://mnemosyne.dev/observatory#graphId> "obs-hoja-canary" .',
        `<urn:sophia:capture:query-contract> <http://mnemosyne.dev/observatory#payloadJson> "${evidencePayload}" .`,
        '',
      ].join('\n'),
      {
        format: NT,
        to_graph_name: namedNode('urn:mnemosyne:local:graph:obs-hoja-canary:projection:obs:raw'),
      },
    )

    const catalogue = buildDomainQueryCatalogue('shrub', standardDomainQueries('shrub'))
    const query = (suffix: string, graphId = GRAPH_ID): Array<Map<string, Term>> =>
      store.query(resolveDomainNamedQuery(catalogue, `urn:sophia:query:shrub.${suffix}`, graphId)) as Array<Map<string, Term>>
    const value = (row: Map<string, Term>, name: string): string | undefined => row.get(name)?.value

    expect(Number(value(query('claims.summary')[0], 'value'))).toBe(80)

    const scopes = manifest.capabilities.reduce((total, capability) => total + capability.modes.length * capability.roles.length, 0)
    expect(Number(value(query('verdicts.coverage')[0], 'value'))).toBeCloseTo(100 / scopes, 10)
    expect(query('claims.untested')).toHaveLength(scopes - 1)

    const current = query('verdicts.current')
    expect(current).toHaveLength(1)
    expect(value(current[0], 'item')).toBe(fail.verdictId)
    expect(value(current[0], 'capabilityId')).toBe(claim.id)
    expect(value(current[0], 'tier')).toBe(claim.tier)

    expect(query('verdicts.attention')).toHaveLength(1)
    expect(Number(value(query('verdicts.attention-count')[0], 'value'))).toBe(1)
    expect(value(query('freshness')[0], 'value')).toBe('2026-08-03T02:00:00Z')
    expect(query('agent.sessions')).toHaveLength(1)
    expect(query('evidence.recent', 'obs-hoja-canary')).toHaveLength(1)
  })
})
