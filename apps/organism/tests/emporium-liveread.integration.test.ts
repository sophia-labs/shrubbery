/**
 * REAL integration test — the Emporium vocab-CATALOGUE live-read, end to end, NO
 * MOCKS.
 *
 * Stands up a REAL headless gardend cell (the CURRENT release build, which serves
 * the /emporium routes — the debug build is stale), reads its LIVE /emporium vocab
 * catalogue through the shell-side EmporiumClient, then renders that REAL vocab
 * data through @shrubbery/render to the markdown / Turtle / JSON-LD faces and
 * asserts the real catalogue (workflow + sophia-memory-core, each with name /
 * version / namespace / sha / classes). "The pack IS the catalog."
 *
 * It REQUIRES the real release binary (no-mock rule). The cell is killed + its
 * temp profile removed on teardown. There is no stubbed HTTP and no fake /emporium
 * payload anywhere on this path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import {
  renderHypertext,
  renderTurtle,
  renderJson,
  type VocabResource,
  type VocabPackResource,
  type VocabSummary,
} from '@shrubbery/render'
import { spawnGardend, resolveGardendBin, type GardendCell } from '../src/cell/spawn-gardend.js'
import { EmporiumClient } from '../src/cell/emporium-client.js'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

describe('REAL INTEGRATION — Emporium vocab catalogue live-read from a current cell', () => {
  let cell: GardendCell
  let client: EmporiumClient
  let vocabs: VocabSummary[]

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real ` +
          `release binary (it serves /emporium; the debug build is stale). Set GARDEN_BIN.`,
      )
    }
    cell = await spawnGardend()
    client = new EmporiumClient({
      baseUrl: cell.apiUrl,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    vocabs = await client.listVocabs()
  }, 40000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('reads the LIVE /emporium/vocabs catalogue (≥ workflow + sophia-memory-core)', () => {
    const names = vocabs.map((v) => v.name)
    expect(names).toContain('workflow')
    expect(names).toContain('sophia-memory-core')
    // every row carries the catalogue fields the registry promises.
    for (const v of vocabs) {
      expect(v.name).toBeTruthy()
      expect(v.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(v.namespace).toMatch(/^https?:\/\//)
      expect(v.sha).toMatch(/^[0-9a-f]{64}$/) // a real content hash
      expect(v.title).toBeTruthy()
    }
  })

  it('reads a LIVE golden contract pack (workflow/latest) with classes + predicates', async () => {
    const summary = vocabs.find((v) => v.name === 'workflow')!
    const pack = await client.getVocab('workflow', 'latest', summary)
    expect(pack.name).toBe('workflow')
    expect(pack.namespace).toBe('http://mnemosyne.dev/workflow#')
    // real classes from the live contract (AgentNode/Workflow/Run/… were verified).
    const classNames = pack.classes.map((c) => c.name)
    expect(classNames.length).toBeGreaterThan(0)
    expect(classNames).toContain('AgentNode')
    // at least one class has predicates with a datatype (the contract shape).
    const withPreds = pack.classes.find((c) => c.predicates.length > 0)
    expect(withPreds, 'a class should carry predicates').toBeDefined()
    expect(withPreds!.predicates[0].name).toBeTruthy()
  })

  it('renders the LIVE catalogue through @shrubbery/render to all three text faces', async () => {
    const resource: VocabResource = {
      kind: 'vocab-catalog',
      id: 'emporium',
      title: 'Emporium — vocabulary catalogue (live)',
      summary: 'Read live from the cell /emporium registry.',
      vocabs,
    }
    const ctx = { baseUrl: 'http://localhost:8787', selfPath: '/emporium', upPath: null }

    // markdown
    const md = renderHypertext(resource, ctx)
    expect(md.body).toContain('`workflow`')
    expect(md.body).toContain('`sophia-memory-core`')
    expect(md.body).toContain('## Navigate')

    // turtle
    const ttl = renderTurtle(resource, ctx)
    expect(ttl.body).toContain('emp:Vocabulary')
    expect(ttl.body).toContain('"workflow"')

    // json-ld (async)
    const json = await renderJson(resource, ctx)
    const parsed = JSON.parse(json.body)
    expect(JSON.stringify(parsed['@context'])).toContain('emp')
  })

  it('renders a LIVE vocab pack through @shrubbery/render (the golden-contract face)', async () => {
    const summary = vocabs.find((v) => v.name === 'sophia-memory-core')!
    const pack = await client.getVocab('sophia-memory-core', summary.version, summary)
    const resource: VocabPackResource = { kind: 'vocab-pack', pack }
    const ctx = {
      baseUrl: 'http://localhost:8787',
      selfPath: '/emporium/sophia-memory-core',
      upPath: '/emporium',
    }
    const md = renderHypertext(resource, ctx)
    expect(md.body).toContain('# `sophia-memory-core`')
    expect(md.body).toContain('http://mnemosyne.dev/memory#')
    // memory-core's real classes (Claim/MemoryRecord/… were verified live).
    expect(md.body).toContain('### `')
  })
})
