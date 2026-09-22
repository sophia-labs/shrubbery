import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGardendLocalSource, McpClient } from '@shrubbery/source'
import type { TripleSource } from '@shrubbery/nucleus'
import {
  loopbackSeedTarget,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '@shrubbery/source/node'
import { existsSync } from 'node:fs'
import { DEFAULT_SETTINGS, generatePrompt, scoreCopy } from '../src/koch.js'
import { buildDefaultKochLayout, loadKochLayout, persistKochLayout } from '../src/layout.js'
import {
  ensureKochInformationModel,
  loadGraphPerformance,
  loadPreferences,
  loadProgress,
  savePreferences,
  saveSession,
} from '../src/progress.js'
import {
  KOCH_NS,
  kochProjectionGraphIri,
  legacyProgressGraphIri,
  sessionIri,
  userRdfGraphIri,
} from '../src/vocabulary.js'

const hasGardend = existsSync(resolveGardendBin())
const real = hasGardend ? describe : describe.skip

real('Koch information model against a real gardend cell', () => {
  let cell: GardendCell
  let client: McpClient
  const sources: TripleSource[] = []

  async function createGraph(graphId: string): Promise<TripleSource> {
    await client.callTool('create_graph', { graph_id: graphId, title: `Koch integration ${graphId}` })
    const source = createGardendLocalSource({ manifest: cell.manifest, graphId })
    sources.push(source)
    return source
  }

  beforeAll(async () => {
    cell = await spawnGardend({ readyTimeoutMs: 30_000 })
    client = new McpClient(loopbackSeedTarget(cell))
  }, 35_000)

  afterAll(async () => {
    await Promise.all(sources.map((source) => source.close()))
    await cell?.kill()
  })

  it('round-trips the model, layout, preferences, and a copy run through their declared seams', async () => {
    const graphId = 'koch-roundtrip-integration'
    const actor = { id: 'integration-user', displayName: 'Integration Learner' }
    const source = await createGraph(graphId)
    await ensureKochInformationModel(client, source, graphId, actor)
    const layout = buildDefaultKochLayout(graphId, '2026-07-20T18:00:00.000Z', actor.id)
    await persistKochLayout(client, graphId, layout, actor.id)
    await savePreferences(client, graphId, {
      settings: { ...DEFAULT_SETTINGS, characterCount: 10, toneHz: 700 },
      showNotation: true,
    }, actor)

    const prompt = generatePrompt(2, { ...DEFAULT_SETTINGS, characterCount: 10 }, () => 0.25)
    const score = scoreCopy(prompt.plain, prompt.plain)
    await saveSession(client, graphId, {
      prompt,
      score,
      settings: { ...DEFAULT_SETTINGS, characterCount: 10 },
      id: 'real-gardend-session',
      completedAt: '2026-07-20T18:00:00.000Z',
      actor,
    })

    const [progress, storedLayout, preferences, performance] = await Promise.all([
      loadProgress(source, graphId, actor.id),
      loadKochLayout(source, graphId, actor.id),
      loadPreferences(source, graphId, actor.id),
      loadGraphPerformance(source, graphId),
    ])
    expect(progress.sessions).toHaveLength(1)
    expect(progress.sessions[0]).toMatchObject({ lesson: 2, correct: 10, total: 10, accuracy: 1 })
    expect(progress.currentLesson).toBe(3)
    expect(progress.characterStats.reduce((sum, stat) => sum + stat.seen, 0)).toBe(10)
    expect(progress.testimony).toMatchObject({
      graphIri: kochProjectionGraphIri(graphId),
      adapter: 'gardend-local',
    })
    expect(progress.testimony?.tripleCount).toBeGreaterThan(100)
    expect(storedLayout.source).toBe('graph')
    expect(storedLayout.document).toEqual(layout)
    expect(preferences).toMatchObject({ showNotation: true, settings: { characterCount: 10, toneHz: 700 } })
    expect(performance.standings).toEqual([
      expect.objectContaining({ displayName: actor.displayName, activity: 'receive', runs: 1, bestScore: 1 }),
    ])
    expect(performance.participants).toEqual([
      expect.objectContaining({ displayName: actor.displayName, receive: expect.objectContaining({ runs: 1 }) }),
    ])
    const vocabulary = await client.callTool('emporium_vocab', { name: 'koch-morse' }) as {
      registryStatus?: string
      contract?: { classes?: Record<string, unknown> }
    }
    expect(vocabulary.registryStatus).toBe('domain-pack')
    expect(vocabulary.contract?.classes).toHaveProperty('KochCourse')
    expect(vocabulary.contract?.classes).toHaveProperty('Learner')
  }, 25_000)

  it('projects a previously recorded prototype run without deleting its graph', async () => {
    const graphId = 'koch-migration-integration'
    const source = await createGraph(graphId)
    const legacyGraph = legacyProgressGraphIri(graphId)
    const session = 'urn:prototype:koch:session:remember-me'
    const attempt = `${session}:attempt:1`
    await client.callTool('sparql_update', {
      graphId,
      update: `PREFIX old: <https://sophia-labs.com/ns/koch#>
INSERT DATA { GRAPH <${legacyGraph}> {
  <${session}> a old:PracticeSession ;
    old:lesson 2 ; old:accuracy 1.0 ; old:correct 1 ; old:total 1 ;
    old:target "K" ; old:copy "K" ; old:characterWpm 20 ; old:effectiveWpm 12 ;
    old:completedAt "2026-07-20T16:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
    old:hasAttempt <${attempt}> .
  <${attempt}> old:position 1 ; old:expected "K" ; old:entered "K" ; old:isCorrect true .
} }`,
    })
    await client.callTool('sparql_update', {
      graphId,
      update: `PREFIX koch: <${KOCH_NS}>
INSERT DATA { GRAPH <${userRdfGraphIri(graphId)}> {
  <${session}> koch:room <urn:obsolete:nested-room> .
  <urn:obsolete:nested-room> a koch:PracticeRoom ; koch:roomSlug "commons" .
  koch:PracticeRoom a <http://www.w3.org/2000/01/rdf-schema#Class> .
} }`,
    })

    await ensureKochInformationModel(client, source, graphId)
    const progress = await loadProgress(source, graphId)
    const legacyRead = await source.read(legacyGraph)
    expect(progress.sessions).toHaveLength(1)
    expect(progress.sessions[0]?.id).toBe(sessionIri(graphId, `legacy-${session}`))
    expect(progress.characterStats).toEqual([{ character: 'K', seen: 1, correct: 1, accuracy: 1 }])
    expect(legacyRead.tripleCount).toBeGreaterThan(0)
    const canonicalRead = await source.read(kochProjectionGraphIri(graphId))
    expect(canonicalRead.nt).toContain(`<${KOCH_NS}PracticeSession>`)
    expect(canonicalRead.nt).toContain(`"${session}"`)
    expect(canonicalRead.nt).not.toContain(`<${KOCH_NS}room>`)
    const directRead = await source.read(userRdfGraphIri(graphId))
    expect(directRead.nt).toContain(`<${KOCH_NS}PracticeRoom>`)
  }, 25_000)
})
