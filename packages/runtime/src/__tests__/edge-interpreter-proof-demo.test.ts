/**
 * edge-interpreter PROOF DEMO — "behavior is data", proven with no code change.
 *
 * This is the money shot of the semantic edge overlay: it demonstrates that ONE
 * added `:ux:config` triple installs a brand-new cross-pane coupling, and that
 * editing that triple's predicate literal makes the behavior appear or vanish —
 * all with zero interpreter change, zero rebuild, zero new plumbing.
 *
 * The scenario is exactly the spec's proof: GARDEN_DEFAULT ships graph →reveals→
 * editor but has NO graph → inspector edge. An agent appends one triple —
 * `graph —drivesSelection→ inspector`. Graph node-select is already a Tier-A
 * source (subscribed for its reveals edge), so no new wiring is needed: the added
 * triple alone makes a graph pick drive the inspector to the picked block.
 *
 * NO MOCKS: the bus is the REAL createSelectionBus; each face is a hand-written
 * in-memory FacePort whose onSelect/reflect are real functions recording their
 * calls (a real test double, not vi.fn) — the harness style of
 * apps/organism/src/harness/in-memory-cell-contract.ts. The config is the REAL
 * GARDEN_DEFAULT, extended by spreading one edge onto its edge list, so the
 * interpreter reads the identical ConfigEdge shape the codec round-trips.
 */

import { describe, it, expect } from 'vitest'
import {
  GARDEN_DEFAULT,
  createSelectionBus,
  type ConfigEdge,
  type NavResource,
  type SelectedObject,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import { installEdgeInterpreter, type FacePort } from '../edge-interpreter.js'

/** A real Tier-A graph source: a live listener set the test drives via `emit`. */
function makeGraphSource(): { port: FacePort; emit: (blockId: string) => void } {
  const listeners = new Set<(raw: unknown) => void>()
  return {
    port: {
      onSelect: (cb) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
      // The graph face publishes a block selection for the picked node — the same
      // shape apps/organism's graphNodeToSelected produces.
      normalize: (raw) => ({ kind: 'block', graphId: 'g1', documentId: 'd1', blockId: raw as string }),
    },
    emit: (blockId) => {
      for (const cb of [...listeners]) cb(blockId)
    },
  }
}

/** A real inspector reflect sink recording every published selection. */
function makeInspector(): { port: FacePort; calls: Array<SelectedObject | null> } {
  const calls: Array<SelectedObject | null> = []
  return {
    port: { reflect: (sel) => void calls.push(sel) },
    calls,
  }
}

/** A real OPEN source (distinct from a select source): a live open-listener set
 * the test drives via `emit`, plus a `toResource` that maps the raw open detail to
 * a NavResource — the shape apps/organism's face:sidebar.toResource produces. */
function makeOpenSource(): { port: FacePort; emit: (resource: NavResource) => void } {
  const listeners = new Set<(raw: unknown) => void>()
  return {
    port: {
      onOpen: (cb) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
      toResource: (raw) => raw as NavResource,
    },
    emit: (resource) => {
      for (const cb of [...listeners]) cb(resource)
    },
  }
}

/** A real editor navigate sink recording every resource it is asked to open. */
function makeNavSink(): { port: FacePort; calls: NavResource[] } {
  const calls: NavResource[] = []
  return {
    port: { navigate: (resource) => void calls.push(resource) },
    calls,
  }
}

/** The added triple: a coupling GARDEN_DEFAULT does NOT ship. */
const GRAPH_DRIVES_INSPECTOR: ConfigEdge = {
  from: 'face:graph',
  to: 'face:inspector',
  predicate: 'drivesSelection',
}

/** GARDEN_DEFAULT with exactly one extra edge appended (agent-authored). */
function configWithAddedEdge(edge: ConfigEdge): WorkspaceConfig {
  return { ...GARDEN_DEFAULT, edges: [...(GARDEN_DEFAULT.edges ?? []), edge] }
}

const expectedBlock: SelectedObject = { kind: 'block', graphId: 'g1', documentId: 'd1', blockId: 'b7' }

describe('edge-interpreter proof demo — behavior is data', () => {
  it('a coupling that did NOT exist: ONE added triple drives the inspector from a graph pick', () => {
    // Guard the premise: the shipped default has no graph → inspector edge, so the
    // coupling we are about to see is genuinely new, not pre-wired.
    expect(
      (GARDEN_DEFAULT.edges ?? []).some(
        (e) => e.from === 'face:graph' && e.to === 'face:inspector',
      ),
    ).toBe(false)

    const graph = makeGraphSource()
    const inspector = makeInspector()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithAddedEdge(GRAPH_DRIVES_INSPECTOR),
      { 'face:graph': graph.port, 'face:inspector': inspector.port },
      bus,
    )

    // The graph fires the SAME select event it always has — no new plumbing.
    graph.emit('b7')

    // The inspector reflected the picked block: the added triple installed the
    // coupling, with no interpreter change and no rebuild.
    expect(inspector.calls).toEqual([expectedBlock])
    expect(bus.get()).toEqual(expectedBlock)
  })

  it('flip the predicate to an unknown literal and the behavior disappears', () => {
    // Same faces, same graph pick — only the edge's predicate literal changes from
    // `drivesSelection` to a literal the interpreter has NO case for. It no-ops
    // unknown predicates (default: break), so the coupling vanishes: behavior is
    // data. (`teleportsTo`, not `navigatesTo` — navigatesTo is now a REAL predicate
    // that would install a surface swap given open/navigate ports.)
    const graph = makeGraphSource()
    const inspector = makeInspector()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithAddedEdge({ ...GRAPH_DRIVES_INSPECTOR, predicate: 'teleportsTo' }),
      { 'face:graph': graph.port, 'face:inspector': inspector.port },
      bus,
    )

    graph.emit('b7')

    expect(inspector.calls).toEqual([])
    expect(bus.get()).toBeNull()
  })

  it('the SHIPPED sidebar→editor navigatesTo triple makes a sidebar OPEN call editor.navigate', () => {
    // Slice-2 proof: GARDEN_DEFAULT ships `sidebar —navigatesTo→ editor` as a
    // triple. Read here with ONLY the sidebar (open) + editor (navigate) faces
    // wired, that ONE triple installs the surface swap — a sidebar open flows
    // straight to editor.navigate, zero interpreter change. The default's other
    // edges skip (their endpoints are unwired here), so navigate fires exactly once.
    expect(
      (GARDEN_DEFAULT.edges ?? []).some(
        (e) => e.from === 'face:sidebar' && e.to === 'face:editor' && e.predicate === 'navigatesTo',
      ),
    ).toBe(true)

    const sidebar = makeOpenSource()
    const editor = makeNavSink()
    const bus = createSelectionBus()
    const resource: NavResource = { graphId: 'g1', documentId: 'd7' }

    installEdgeInterpreter(GARDEN_DEFAULT, { 'face:sidebar': sidebar.port, 'face:editor': editor.port }, bus)

    // The sidebar fires its open event — the interpreter routes it to navigate.
    sidebar.emit(resource)

    expect(editor.calls).toEqual([resource])
    // navigatesTo is a COMMAND, not selection currency — the bus stays untouched.
    expect(bus.get()).toBeNull()
  })

  it('flip that navigatesTo predicate to a bus verb and the OPEN stops navigating', () => {
    // Behavior is data, the navigatesTo direction: take the sidebar (open) + editor
    // (navigate) faces, but author the edge as `reflects` instead of `navigatesTo`.
    // reflects is a bus/pull verb with no open→navigate case, and the editor here
    // exposes no reflect sink — so the open no longer reaches navigate. Only the
    // predicate literal changed.
    const sidebar = makeOpenSource()
    const editor = makeNavSink()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      { ...GARDEN_DEFAULT, edges: [{ from: 'face:sidebar', to: 'face:editor', predicate: 'reflects' }] },
      { 'face:sidebar': sidebar.port, 'face:editor': editor.port },
      bus,
    )

    sidebar.emit({ graphId: 'g1', documentId: 'd7' })

    expect(editor.calls).toEqual([])
    expect(bus.get()).toBeNull()
  })
})
