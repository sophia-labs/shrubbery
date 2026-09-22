/**
 * REAL INTEGRATION TEST — the iter-6b anatomy GRAPH view, end to end, NO MOCKS.
 *
 * This is the iteration-6b acceptance: the dedicated Emporium product shell, fed by
 * a REAL current-release gardend cell, renders the workflow pack's class→class
 * RELATIONSHIPS as a LAYERED CLASS GRAPH (the general mn-graph component) when the
 * relationships LIST/GRAPH toggle is flipped to "graph". It:
 *   1. spawns a REAL current-release gardend (serves /emporium) via the SHARED
 *      spawn helper,
 *   2. boots the shell (shell.ts) with a Node-transport store + a hash-router,
 *   3. navigates to the workflow pack (the live pack-detail view),
 *   4. flips the relationships section's GRAPH toggle (a real button click),
 *   5. asserts the LIVE class graph renders to REAL DOM: the mn-graph mounts, its
 *      class nodes (one per class the live workflow pack DECLARES — derived from
 *      the same live pack read the shell already consumes, never a fossilized
 *      count) are present, AND at least one PREDICATE edge
 *      (AgentNode →wf:partOfWorkflow→ Workflow) and at least one CRDT WIRE edge
 *      (flowsInto) are drawn — discriminated structurally (predicate=solid,
 *      wire=dashed), exactly the SAME relationship read-model the list face
 *      consumes.
 *   6. flips back to LIST and asserts the mn-relations list returns (the toggle is
 *      a real, reversible UI state the shell owns).
 *   7. activating a graph node deep-links the class route (the graph is interactive).
 *
 * COUNT DERIVATION (U10/R9): the expected class-node count and total-edge count
 * are read from the SAME live workflow pack this test's own store already loaded
 * (`pack.classes.length` / `pack.relationships.length`) — never a hardcoded
 * cardinality. This asserts INTERNAL CONSISTENCY (rendered == read) at whatever
 * cardinality the binary currently serves, so the test survives the golden
 * contract evolving. The cell is killed + its temp profile removed on teardown.
 * No stubbed HTTP and no fake /emporium payload anywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'

import { spawnGardend, resolveGardendBin, type GardendCell } from '@shrubbery/source/node'
import { createEmporiumStore } from '@shrubbery/source/emporium'
import { bootShell, type EmporiumShell, type ShellElements } from '../src/shell.js'
import { createRouter } from '../src/router.js'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

function buildMounts(): ShellElements {
  const make = (id: string): HTMLElement => {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
    return el
  }
  return {
    appBarMount: make('app-bar'),
    railMount: make('rail'),
    contentMount: make('content'),
    statusMount: make('status'),
  }
}

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('REAL INTEGRATION — Emporium anatomy GRAPH view from a current cell', () => {
  let cell: GardendCell
  let shell: EmporiumShell
  let mounts: ShellElements
  // The live workflow pack, captured from the SAME store read the shell renders
  // from — expected node/edge counts below derive from THIS, never a hardcoded
  // cardinality (U10/R9 count-derivation fix).
  let workflowClassCount: number
  let workflowRelationshipCount: number

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real ` +
          `release binary (it serves /emporium; the debug build is stale). Set GARDEN_BIN.`,
      )
    }
    cell = await spawnGardend()

    window.location.hash = ''
    mounts = buildMounts()

    const store = createEmporiumStore({
      transport: { baseUrl: cell.apiUrl, token: cell.token, origin: 'http://127.0.0.1' },
    })
    const router = createRouter(window)
    shell = bootShell(mounts, { store, router, skin: 'emporium', theme: 'light' })

    await store.refresh()
    await tick()

    const workflowPack = store.getState().read?.packs['workflow']
    if (!workflowPack) {
      throw new Error('live /emporium read did not include the "workflow" pack — no faked fallback.')
    }
    workflowClassCount = workflowPack.classes.length
    workflowRelationshipCount = workflowPack.relationships?.length ?? 0

    // Drill into the workflow pack (the pack-detail view with the relationships section).
    shell.router.navigate({ kind: 'pack', pack: 'workflow' })
    await tick()
  }, 40000)

  afterAll(async () => {
    shell?.destroy()
    if (cell) await cell.kill()
  })

  it('the workflow pack-detail shows the relationships section with a LIST/GRAPH toggle (list default)', () => {
    const section = mounts.contentMount.querySelector('mn-card[data-section="relationships"]')
    expect(section, 'relationships section rendered').not.toBeNull()
    // Defaults to the LIST face.
    expect(section!.getAttribute('data-rel-view')).toBe('list')
    expect(mounts.contentMount.querySelector('[data-rel-kind="predicate"] mn-relations')).not.toBeNull()
    // Both toggle buttons exist.
    expect(section!.querySelector('[data-rel-view-btn="list"]')).not.toBeNull()
    expect(section!.querySelector('[data-rel-view-btn="graph"]')).not.toBeNull()
  })

  it('flips to GRAPH: renders the LIVE workflow class graph (one node per pack class) to REAL DOM', async () => {
    const graphBtn = mounts.contentMount.querySelector(
      '[data-rel-view-btn="graph"]',
    ) as HTMLButtonElement
    graphBtn.click()
    await tick()

    const section = mounts.contentMount.querySelector('mn-card[data-section="relationships"]')!
    expect(section.getAttribute('data-rel-view')).toBe('graph')

    const graph = mounts.contentMount.querySelector('mn-graph') as HTMLElement
    expect(graph, 'mn-graph mounted in the graph view').not.toBeNull()
    const sr = (graph as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    expect(sr, 'mn-graph shadow root').not.toBeNull()

    // The live workflow pack declares workflowClassCount classes ⇒ that many EXPLICIT
    // class node boxes (derived from the SAME live pack read the shell renders from
    // — U10/R9, never a fossilized cardinality). The graph node set is the pack's
    // classes (the CRDT-wire endpoints are a different node space — doc kinds — and
    // render as `derived` nodes so no wire dangles).
    const classNodes = sr.querySelectorAll('g.node[data-node-origin="explicit"]')
    expect(classNodes.length).toBe(workflowClassCount)
    // Real class names from the live contract are present as class nodes (not faked).
    expect(
      sr.querySelector('g.node[data-node="AgentNode"][data-node-origin="explicit"]'),
      'AgentNode class node',
    ).not.toBeNull()
    expect(
      sr.querySelector('g.node[data-node="Workflow"][data-node-origin="explicit"]'),
      'Workflow class node',
    ).not.toBeNull()
    // The wire doc-kind endpoints render as `derived` nodes (a distinct node space),
    // so the wire edges are real, not dangling — honest, never faked.
    expect(
      sr.querySelectorAll('g.node[data-node-origin="derived"]').length,
      'CRDT-wire doc-kind endpoints render as derived nodes',
    ).toBeGreaterThan(0)
  })

  it('the graph draws at least one PREDICATE edge AND one CRDT WIRE edge (structurally discriminated)', () => {
    const graph = mounts.contentMount.querySelector('mn-graph') as HTMLElement & {
      shadowRoot: ShadowRoot
    }
    const sr = graph.shadowRoot

    // At least one predicate edge (solid) and at least one wire edge (dashed).
    const predEdges = sr.querySelectorAll('g.edge[data-edge-kind="predicate"]')
    const wireEdges = sr.querySelectorAll('g.edge[data-edge-kind="wire"]')
    expect(predEdges.length, 'at least one predicate edge drawn').toBeGreaterThanOrEqual(1)
    expect(wireEdges.length, 'at least one wire edge drawn').toBeGreaterThanOrEqual(1)

    // The wire edges carry the dashed-connector structural class (not a color).
    const firstWire = wireEdges[0]
    expect(firstWire.classList.contains('wire')).toBe(true)

    // A SPECIFIC predicate edge from the live contract: AgentNode →wf:partOfWorkflow→
    // Workflow. Find it by its connector label + title (real data, never faked).
    const titles = Array.from(sr.querySelectorAll('g.edge title')).map((t) => t.textContent ?? '')
    expect(
      titles.some((t) => t.includes('AgentNode') && t.includes('wf:partOfWorkflow') && t.includes('Workflow')),
      'AgentNode →wf:partOfWorkflow→ Workflow predicate edge present',
    ).toBe(true)
    // A SPECIFIC wire edge from the live contract: flowsInto.
    expect(
      titles.some((t) => t.includes('flowsInto')),
      'flowsInto wire edge present',
    ).toBe(true)

    // Total edges drawn matches the live relationship count (predicate + wire),
    // derived from the SAME live pack read the shell renders from — U10/R9.
    const allEdges = sr.querySelectorAll('g.edge[data-edge-kind]')
    expect(allEdges.length).toBe(workflowRelationshipCount)
  })

  it('the graph is LAYERED: a forward edge target sits in a later column than its source', () => {
    const graph = mounts.contentMount.querySelector('mn-graph') as HTMLElement & {
      shadowRoot: ShadowRoot
    }
    const sr = graph.shadowRoot
    const agentX = sr
      .querySelector('g.node[data-node="AgentNode"] rect.node-box')!
      .getAttribute('x')
    const wfX = sr.querySelector('g.node[data-node="Workflow"] rect.node-box')!.getAttribute('x')
    // AgentNode →wf:partOfWorkflow→ Workflow ⇒ Workflow lays out in a later column.
    expect(Number(wfX)).toBeGreaterThan(Number(agentX))
  })

  it('activating a graph node deep-links the class route (the graph is interactive)', async () => {
    const graph = mounts.contentMount.querySelector('mn-graph') as HTMLElement & {
      shadowRoot: ShadowRoot
    }
    const node = graph.shadowRoot.querySelector('g.node[data-node="AgentNode"]') as SVGGElement
    expect(node.getAttribute('role')).toBe('button')
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await tick()
    expect(shell.router.current()).toEqual({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })
    expect(window.location.hash).toBe('#/emporium/workflow/AgentNode')
  })

  it('flips back to LIST: the mn-relations edge list returns (the toggle is reversible)', async () => {
    // Back to the workflow pack root (the deep-link left us on the class route).
    shell.router.navigate({ kind: 'pack', pack: 'workflow' })
    await tick()
    const listBtn = mounts.contentMount.querySelector(
      '[data-rel-view-btn="list"]',
    ) as HTMLButtonElement
    listBtn.click()
    await tick()
    const section = mounts.contentMount.querySelector('mn-card[data-section="relationships"]')!
    expect(section.getAttribute('data-rel-view')).toBe('list')
    expect(mounts.contentMount.querySelector('mn-graph')).toBeNull()
    expect(mounts.contentMount.querySelector('[data-rel-kind="predicate"] mn-relations')).not.toBeNull()
  })
})
