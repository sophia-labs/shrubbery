/**
 * REAL INTEGRATION TEST — the iter-5a DEEPENED Emporium pack-detail anatomy, end
 * to end, NO MOCKS.
 *
 * Iter-4b proved the pack-detail `dom` face renders a pack's classes + their
 * predicates. THIS test proves the iter-5a DEEPENING: it spawns a REAL
 * current-release gardend cell, reads the LIVE /emporium/vocab/workflow/latest +
 * /emporium/vocab/sophia-memory-core/latest golden contracts through the
 * shell-side EmporiumClient (which now parses the FULL anatomy: wires, class→class
 * relationships, closed enums, cardinality, minting/slug rules + stats), renders
 * the deepened pack-detail through vocab-views.ts into a REAL DOM (happy-dom), and
 * ASSERTS the deepened anatomy is present:
 *
 *   - a class→class RELATIONSHIP (predicate range): AgentNode →wf:partOfWorkflow→
 *     Workflow — both in the parsed read-model AND in the rendered mn-relations;
 *   - a CRDT WIRE rule (flowsInto) parsed + rendered as a wire-kind edge;
 *   - a REQUIRED-predicate badge in a class card;
 *   - the pack STATS (class / predicate / relationship counts);
 *   - the MINTING (slug + uri/doc-id) rules;
 *   - sophia-memory-core's CLOSED ENUMS (mem:sourceKind / mem:contentOrientation)
 *     render their allowed value sets.
 *
 * The cell is killed + its temp profile removed on teardown. There is no stubbed
 * HTTP and no fake /emporium payload anywhere — "the pack IS the catalog", live.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { render as litRender } from 'lit'
import type { VocabPack } from '@shrubbery/render'
// Registering the general primitives (incl. mn-relations) is a side effect of
// importing the views.
import { renderVocabPack } from '../src/cell/vocab-views.js'
import { spawnGardend, resolveGardendBin, type GardendCell } from '../src/cell/spawn-gardend.js'
import { EmporiumClient } from '../src/cell/emporium-client.js'
import { loadEmporiumFromCell, type EmporiumRead } from '../src/cell/emporium-store.js'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

/** Mount a Lit template into a fresh detached real DOM container. */
function mount(tpl: ReturnType<typeof renderVocabPack>): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  litRender(tpl, host)
  return host
}

describe('REAL INTEGRATION — deepened Emporium pack-detail anatomy from a current cell', () => {
  let cell: GardendCell
  let read: EmporiumRead

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real ` +
          `release binary (it serves /emporium; the debug build is stale). Set GARDEN_BIN.`,
      )
    }
    cell = await spawnGardend()
    const client = new EmporiumClient({
      baseUrl: cell.apiUrl,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    read = await loadEmporiumFromCell(client)
  }, 40000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('the read-model parses class→class RELATIONSHIPS live (predicate ranges + wires)', () => {
    const pack: VocabPack = read.packs['workflow']
    expect(pack, 'live workflow pack present').toBeDefined()
    const rels = pack.relationships ?? []
    expect(rels.length).toBeGreaterThan(0)

    // A predicate-range edge: AgentNode →wf:partOfWorkflow→ Workflow (uri pred).
    const partOf = rels.find(
      (r) => r.kind === 'predicate' && r.from === 'AgentNode' && r.predicate === 'wf:partOfWorkflow',
    )
    expect(partOf, 'AgentNode→wf:partOfWorkflow→Workflow predicate edge').toBeDefined()
    expect(partOf!.to).toBe('Workflow')

    // A CRDT wire edge: flowsInto (node doc → node doc).
    const flowsInto = rels.find((r) => r.kind === 'wire' && r.predicate === 'flowsInto')
    expect(flowsInto, 'flowsInto wire edge').toBeDefined()
    expect(flowsInto!.from).toContain('node')
    expect(flowsInto!.to).toContain('node')

    // Stats are derived live.
    expect(pack.relationshipCount).toBe(rels.length)
    expect((pack.predicateCount ?? 0)).toBeGreaterThan(0)
  })

  it('renders the deepened workflow pack-detail to REAL DOM (relationships + wire + required + stats + minting)', () => {
    const pack: VocabPack = read.packs['workflow']
    const host = mount(renderVocabPack(pack))

    // ── RELATIONSHIPS section: the mn-relations component carries real edges. ──
    const relSection = host.querySelector('mn-card[data-section="relationships"]')
    expect(relSection, 'relationships section rendered').not.toBeNull()
    // The predicate-range group has an mn-relations with the partOfWorkflow edge.
    const predGroup = host.querySelector('[data-rel-kind="predicate"] mn-relations')
    expect(predGroup, 'predicate relations component').not.toBeNull()
    const predRels = (predGroup as unknown as { relations: Array<{ from: string; to: string; predicate: string }> })
      .relations
    const partOf = predRels.find(
      (r) => r.from === 'AgentNode' && r.predicate === 'wf:partOfWorkflow' && r.to === 'Workflow',
    )
    expect(partOf, 'AgentNode→wf:partOfWorkflow→Workflow in the rendered mn-relations').toBeDefined()
    // The wire group has an mn-relations carrying the flowsInto wire edge.
    const wireGroup = host.querySelector('[data-rel-kind="wire"] mn-relations')
    expect(wireGroup, 'wire relations component').not.toBeNull()
    const wireRels = (wireGroup as unknown as { relations: Array<{ predicate: string; kind: string }> }).relations
    expect(wireRels.some((r) => r.predicate === 'flowsInto' && r.kind === 'wire')).toBe(true)

    // ── a REQUIRED-predicate badge in a class card (Workflow.wf:name is required). ──
    const wfClass = host.querySelector('mn-card[data-class="Workflow"]')
    expect(wfClass, 'Workflow class card').not.toBeNull()
    const reqGroup = wfClass!.querySelector('[data-pred-group="required"]')
    expect(reqGroup, 'required predicate group on Workflow').not.toBeNull()
    const reqBadge = reqGroup!.querySelector('mn-badge[label="required"]')
    expect(reqBadge, 'a required-predicate badge').not.toBeNull()
    // wf:name (required) lives in the required group, wf:whenToUse (optional) does not.
    expect(reqGroup!.querySelector('tr[data-pred="wf:name"]'), 'wf:name in required group').not.toBeNull()
    const optGroup = wfClass!.querySelector('[data-pred-group="optional"]')
    expect(optGroup!.querySelector('tr[data-pred="wf:whenToUse"]'), 'wf:whenToUse in optional group').not.toBeNull()

    // a multi=true predicate (wf:phase) shows the multi chip in its row.
    const phaseRow = reqGroup!.querySelector('tr[data-pred="wf:phase"]')
    expect(phaseRow, 'wf:phase row (required + multi)').not.toBeNull()
    expect(phaseRow!.querySelector('mn-chip[label="multi"]'), 'multi chip on wf:phase').not.toBeNull()

    // ── pack STATS strip: class / predicate / relationship count chips. ──
    const stats = host.querySelector('.vocab-pack__stats')
    expect(stats, 'stats strip').not.toBeNull()
    const statLabels = Array.from(stats!.querySelectorAll('mn-chip')).map((c) => c.getAttribute('label') ?? '')
    expect(statLabels.some((l) => /\d+ classes?$/.test(l))).toBe(true)
    expect(statLabels.some((l) => /\d+ predicates?$/.test(l))).toBe(true)
    expect(statLabels.some((l) => /\d+ relationships?$/.test(l))).toBe(true)
    // the stats sparkline is present (real magnitudes).
    expect(stats!.querySelector('mn-sparkline'), 'stats sparkline').not.toBeNull()

    // ── MINTING section: slug rule + per-template uri/doc-id rules. ──
    const minting = host.querySelector('mn-card[data-section="minting"]')
    expect(minting, 'minting section rendered').not.toBeNull()
    // workflow declares uri_rules (e.g. the `run` template) — the table renders it.
    const mintRows = minting!.querySelectorAll('.vocab-pack__mint tr')
    expect(mintRows.length).toBeGreaterThan(0)
    // the slug rule chip strip is present (workflow has a slug_rule).
    expect(minting!.querySelector('.vocab-pack__slug'), 'slug rule strip').not.toBeNull()

    host.remove()
  })

  it('renders sophia-memory-core CLOSED ENUMS to REAL DOM (mem:sourceKind / mem:contentOrientation)', () => {
    const pack: VocabPack = read.packs['sophia-memory-core']
    expect(pack, 'live memory-core pack present').toBeDefined()

    // The read-model parsed the closed enums off the golden `source` decls.
    const allPreds = pack.classes.flatMap((c) => c.predicates)
    const sourceKind = allPreds.find((p) => p.name === 'mem:sourceKind')
    expect(sourceKind, 'mem:sourceKind predicate').toBeDefined()
    expect(sourceKind!.enumValues, 'mem:sourceKind closed-enum values parsed').toBeDefined()
    expect(sourceKind!.enumValues).toEqual(
      expect.arrayContaining(['ConversationTurn', 'DocumentBlock', 'ToolCall']),
    )
    expect(sourceKind!.enumValues!.length).toBe(8)

    const orientation = allPreds.find((p) => p.name === 'mem:contentOrientation')
    expect(orientation!.enumValues, 'mem:contentOrientation enum parsed').toBeDefined()
    expect(orientation!.enumValues).toEqual(
      expect.arrayContaining(['knowledge', 'execution', 'affective', 'safety', 'structural', 'policy']),
    )

    // Render and assert the allowed value chips appear in the DOM.
    const host = mount(renderVocabPack(pack))
    const skRow = host.querySelector('tr[data-pred="mem:sourceKind"]')
    expect(skRow, 'mem:sourceKind row rendered').not.toBeNull()
    const skEnum = skRow!.querySelector('.vocab-class__enum[data-enum="mem:sourceKind"]')
    expect(skEnum, 'mem:sourceKind enum chip set').not.toBeNull()
    const skValues = Array.from(skEnum!.querySelectorAll('mn-chip')).map((c) => c.getAttribute('label'))
    expect(skValues).toEqual(
      expect.arrayContaining(['ConversationTurn', 'DocumentBlock', 'ArtifactReference']),
    )

    // contentOrientation enum chips render too.
    const orRow = host.querySelector('tr[data-pred="mem:contentOrientation"]')
    const orValues = Array.from(
      orRow!.querySelectorAll('.vocab-class__enum mn-chip'),
    ).map((c) => c.getAttribute('label'))
    expect(orValues).toEqual(expect.arrayContaining(['knowledge', 'policy']))

    host.remove()
  })
})
