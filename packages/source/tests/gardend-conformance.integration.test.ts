/**
 * gardend-conformance.integration.test.ts — the 'gardend-local' adapter
 * against the FULL conformance suite on a REAL spawned gardend cell.
 * NO MOCKS: real binary, real temp profile, real MCP over loopback HTTP.
 *
 * Proves (U4 acceptance):
 *   - read of the seeded :ux:config = the canonical seed with sane readAt and the
 *     native nt carrier;
 *   - select COUNT cross-check equals tripleCount (never the envelope
 *     quadCount) — via the conformance suite;
 *   - a sibling named graph (:ux:control-shaped) is readable via the SAME
 *     generic read (atelier's R3 contribution, subsumed);
 *   - EMPTY on a fresh unseeded graph resolves tripleCount 0 without
 *     throwing;
 *   - killed cell → TripleSourceError 'unavailable' carrying the verbatim
 *     connect error; McpError shapes → 'protocol';
 *   - node subpath: spawn-gardend + loopback.json manifest discovery,
 *     seed.ts (createGraphAndSeedUxConfig + seedGraphFromNtFile, loopback
 *     variant), fossil-io round-trip from a live read.
 *
 * The gateway variant of seedGraphFromNtFile is exercised for its URL shape
 * only here — a real gateway write is the env-gated P2.5 tier (§2.7); no
 * fake gateway is stood up (a stubbed contract is a mock).
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  TripleSourceError,
  parseNT,
  uxConfigGraphIri,
  uxControlGraphIri,
} from '@shrubbery/nucleus'
import {
  FossilCodecError,
  McpClient,
  createGardendLocalSource,
  sourceFromBoot,
  staticNtSource,
} from '../src/index.js'
import {
  createGraphAndSeedUxConfig,
  gatewaySeedTarget,
  loopbackSeedTarget,
  readFossil,
  readLoopbackManifest,
  resolveGardendBin,
  seedGraphFromNtFile,
  spawnGardend,
  writeFossil,
  type GardendCell,
} from '../src/node/index.js'
import { runTripleSourceConformance } from '../src/conformance/suite.js'

const require = createRequire(import.meta.url)
const SEED_BODY = readFileSync(
  require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

const GARDEN_BIN = resolveGardendBin()
const SEEDED_GRAPH = 'planter-conformance'
const UNSEEDED_GRAPH = 'planter-conformance-empty'
const SEEDED_IRI = uxConfigGraphIri(SEEDED_GRAPH)
const CONTROL_IRI = uxControlGraphIri(SEEDED_GRAPH)
// An addressable sibling NAMED graph that nothing ever wrote to — the
// same-source EMPTY proof for the seeded binding.
const NEVER_WRITTEN_IRI = SEEDED_IRI.replace(/:ux:config$/, ':ux:never-written')

/** A tiny real :ux:control-shaped sibling body, seeded from a file on disk
 *  (exercises seedGraphFromNtFile's loopback variant). */
const CONTROL_BODY = [
  `<${CONTROL_IRI}:root> <urn:mnemosyne:vocab:sux:kind> "control" .`,
  `<${CONTROL_IRI}:root> <urn:mnemosyne:vocab:sux:label> "planter control sibling" .`,
  `<${CONTROL_IRI}:root> <urn:mnemosyne:vocab:sux:enabled> "true" .`,
  '',
].join('\n')
const CONTROL_TRIPLE_COUNT = 3

let cell: GardendCell
let scratchDir: string

beforeAll(async () => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `gardend binary not found at ${GARDEN_BIN}. This suite requires the real binary; set GARDEN_BIN to override.`,
    )
  }
  cell = await spawnGardend()
  scratchDir = mkdtempSync(join(tmpdir(), 'planter-gardend-it.'))

  const target = loopbackSeedTarget(cell)

  // Graph A: create + seed the REAL canonical GARDEN_DEFAULT body.
  await createGraphAndSeedUxConfig(target, SEEDED_GRAPH, SEED_BODY, 'Planter Conformance')

  // Sibling :ux:control-shaped graph of graph A, seeded FROM A FILE
  // (the seedGraphFromNtFile loopback variant, end to end).
  const controlPath = join(scratchDir, 'control.nt')
  writeFileSync(controlPath, CONTROL_BODY, 'utf8')
  const seeded = await seedGraphFromNtFile(target, {
    graphId: SEEDED_GRAPH,
    filePath: controlPath,
    targetGraphIri: CONTROL_IRI,
  })
  expect(seeded.targetGraphIri).toBe(CONTROL_IRI)
  expect(seeded.tripleCount).toBe(CONTROL_TRIPLE_COUNT)

  // Graph B: created but NEVER seeded — the fresh-unseeded EMPTY proof.
  const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_graph', { graph_id: UNSEEDED_GRAPH, title: 'Planter Empty' })
}, 120_000)

afterAll(async () => {
  if (cell) await cell.kill()
})

function liveSource(graphId: string) {
  return createGardendLocalSource({
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    origin: 'http://127.0.0.1',
    graphId,
    suggestedPollMs: 4000,
  })
}

// ── FULL conformance: the canonical seeded graph ─────────────────────────────

runTripleSourceConformance(`gardend-local (REAL cell, seeded ${SEED_TRIPLE_COUNT}-triple :ux:config)`, () => liveSource(SEEDED_GRAPH), {
  graphIri: SEEDED_IRI,
  expectedTripleCount: SEED_TRIPLE_COUNT,
  emptyGraphIri: NEVER_WRITTEN_IRI,
  // A live-cell failure the binding can induce: a malformed SPARQL query is
  // answered by the cell with an MCP JSON-RPC error → 'protocol'.
  induceFailure: s => s.select!('THIS IS NOT SPARQL'),
})

// ── FULL conformance: a fresh unseeded graph resolves EMPTY, never throws ───

runTripleSourceConformance('gardend-local (REAL cell, fresh unseeded graph)', () => liveSource(UNSEEDED_GRAPH), {
  graphIri: uxConfigGraphIri(UNSEEDED_GRAPH),
  expectedTripleCount: 0,
})

// ── Adapter-specific proofs on the same real cell ────────────────────────────

describe('REAL INTEGRATION — gardend-local specifics', () => {
  it('read carries the native nt body, parse-consistent with tripleCount', async () => {
    const source = liveSource(SEEDED_GRAPH)
    const read = await source.read(SEEDED_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(typeof read.nt).toBe('string')
    expect(parseNT(read.nt!).length).toBe(SEED_TRIPLE_COUNT)
    expect(read.triples!.length).toBe(SEED_TRIPLE_COUNT)
    await source.close()
  })

  it('the sibling :ux:control graph is readable via the SAME generic read', async () => {
    const source = liveSource(SEEDED_GRAPH)
    const read = await source.read(CONTROL_IRI)
    expect(read.graphIri).toBe(CONTROL_IRI)
    expect(read.tripleCount).toBe(CONTROL_TRIPLE_COUNT)
    // Term-faithful: the seeded label round-trips through the store's dump.
    const label = read.triples!.find(t => t.p === 'urn:mnemosyne:vocab:sux:label')
    expect(label?.o).toEqual({ type: 'literal', value: 'planter control sibling' })
    await source.close()
  })

  it('select returns TYPED SourceTerm bindings via parseTerm', async () => {
    const source = liveSource(SEEDED_GRAPH)
    const res = await source.select!(
      `SELECT ?s ?p ?o WHERE { GRAPH <${CONTROL_IRI}> { ?s ?p ?o } } LIMIT 1`,
    )
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].s.type).toBe('iri')
    expect(res.rows[0].p.type).toBe('iri')
    expect(res.rows[0].o.type).toBe('literal')
    expect(Number.isInteger(res.readAt)).toBe(true)
    await source.close()
  })

  it("description testifies honestly: kind/liveness/sparql/endpoint, token-free", async () => {
    const source = liveSource(SEEDED_GRAPH)
    expect(source.description).toMatchObject({
      kind: 'gardend-local',
      liveness: 'poll',
      sparql: true,
      endpoint: cell.mcpUrl,
      suggestedPollMs: 4000,
    })
    expect(JSON.stringify(source.description)).not.toContain(cell.token)
    await source.close()
  })

  it("sourceFromBoot wires 'gardend-local' end-to-end against the live cell", async () => {
    const source = await sourceFromBoot({
      endpoint: cell.apiUrl,
      graph: SEEDED_GRAPH,
      auth: { mode: 'dev', token: cell.token },
      adapter: 'gardend-local',
    })
    expect(source.description.kind).toBe('gardend-local')
    const read = await source.read(SEEDED_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    await source.close()
  })

  it("a cell-answered tool error is 'protocol' with the message verbatim (McpError shape)", async () => {
    const source = liveSource('no-such-graph-anywhere')
    let thrown: unknown
    try {
      await source.read(uxConfigGraphIri('no-such-graph-anywhere'))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('protocol')
    expect(err.detail).toBeTruthy() // upstream MCP message, verbatim
    await source.close()
  })

  it("malformed SPARQL → 'protocol' (never rewritten)", async () => {
    const source = liveSource(SEEDED_GRAPH)
    let thrown: unknown
    try {
      await source.select!('DEFINITELY NOT SPARQL')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    expect((thrown as TripleSourceError).code).toBe('protocol')
    await source.close()
  })

  it("a KILLED cell → 'unavailable' with the verbatim connect error", async () => {
    // A dedicated short-lived cell so the shared one keeps serving the other
    // suites regardless of test order.
    const victim = await spawnGardend()
    const source = createGardendLocalSource({
      mcpUrl: victim.mcpUrl,
      token: victim.token,
      origin: 'http://127.0.0.1',
      graphId: SEEDED_GRAPH,
    })
    await victim.kill()
    let thrown: unknown
    try {
      await source.read(SEEDED_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('unavailable')
    // The connect failure's own message, verbatim in detail.
    expect(err.detail).toMatch(/ECONNREFUSED|ECONNRESET|socket|connect|fetch failed/i)
    await source.close()
  }, 90_000)
})

// ── Node subpath: manifest discovery + fossil-io on the live cell ───────────

describe('REAL INTEGRATION — node subpath (discovery, seeding, fossil-io)', () => {
  it('readLoopbackManifest discovers a running cell from its profile dir AND the file itself', () => {
    const fromDir = readLoopbackManifest(cell.profileDir)
    expect(fromDir.mcpUrl).toBe(cell.mcpUrl)
    expect(fromDir.token).toBe(cell.token)
    const fromFile = readLoopbackManifest(join(cell.profileDir, 'loopback.json'))
    expect(fromFile.apiUrl.replace(/\/$/, '')).toBe(cell.apiUrl)
  })

  it('readLoopbackManifest refuses a missing manifest, naming the path', () => {
    expect(() => readLoopbackManifest(join(scratchDir, 'nowhere'))).toThrow(/loopback\.json/)
  })

  it('gatewaySeedTarget shapes the /g/{id}/mcp URL (the write correctly costs Editor — §2.7)', () => {
    const target = gatewaySeedTarget('https://api.canary.sophia-labs.com/', 'g one', 'tok')
    expect(target.mcpUrl).toBe('https://api.canary.sophia-labs.com/g/g%20one/mcp')
    expect(target.token).toBe('tok')
  })

  it('writeFossil(live read) → readFossil → staticNtSource replays the canonical triples at capture time', async () => {
    const source = liveSource(SEEDED_GRAPH)
    const read = await source.read(SEEDED_IRI)
    const path = join(scratchDir, 'fossils', 'planter-conformance.ux.nt')
    const note = `gardend-local ${cell.apiUrl}`
    const written = await writeFossil(path, read, note)
    expect(written).toEqual({ graphIri: SEEDED_IRI, capturedAt: read.readAt, source: note })

    const fossil = await readFossil(path)
    expect(fossil.header).toEqual(written)

    const replay = staticNtSource(fossil.text)
    const replayRead = await replay.read(SEEDED_IRI)
    expect(replayRead.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(replayRead.readAt).toBe(read.readAt) // capture time, never load time
    await source.close()
    await replay.close()
  })

  it('readFossil REFUSES a header-stripped body with the named codec error', async () => {
    const path = join(scratchDir, 'stripped.nt')
    writeFileSync(path, '<urn:s> <urn:p> "o" .\n', 'utf8')
    await expect(readFossil(path)).rejects.toThrow(FossilCodecError)
    await expect(readFossil(path)).rejects.toThrow(/capture provenance/)
  })
})
