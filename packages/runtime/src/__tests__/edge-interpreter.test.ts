/**
 * edge-interpreter test — the generic `:ux:config` selection-edge reader.
 *
 * NO MOCKS: every collaborator is a REAL object. The bus is the real
 * `createSelectionBus`; each face is a hand-written in-memory `FacePort` whose
 * `onSelect`/`reflect`/`reveal` are real functions that record their calls (a
 * test double, not a vi.fn) — exactly the harness style of
 * apps/organism/src/harness/in-memory-cell-contract.ts. The config is the REAL
 * GARDEN_DEFAULT with an edge list spread on, so the interpreter reads the same
 * `ConfigEdge` shape the codec round-trips.
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

/** Build a real WorkspaceConfig carrying `edges` (the interpreter reads only that). */
function configWithEdges(edges: readonly ConfigEdge[]): WorkspaceConfig {
  return { ...GARDEN_DEFAULT, edges }
}

/**
 * A real Tier-A source face: a live listener set the test drives via `emit`,
 * plus a `normalize` that maps a raw detail to a `SelectedObject`. `emit` copies
 * the listener set so a disposer running mid-dispatch is well-defined.
 */
function makeSource(normalize: (raw: unknown) => SelectedObject | null): {
  port: FacePort
  emit: (raw: unknown) => void
  listenerCount: () => number
} {
  const listeners = new Set<(raw: unknown) => void>()
  return {
    port: {
      onSelect: (cb) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
      normalize,
    },
    emit: (raw) => {
      for (const cb of [...listeners]) cb(raw)
    },
    listenerCount: () => listeners.size,
  }
}

/** A real reflect sink recording every published selection. */
function makeReflector(): { port: FacePort; calls: Array<SelectedObject | null> } {
  const calls: Array<SelectedObject | null> = []
  return {
    port: {
      reflect: (sel) => {
        calls.push(sel)
      },
    },
    calls,
  }
}

/** A real reveal sink recording every anchor it is focused on. */
function makeRevealer(): { port: FacePort; calls: Array<{ blockId?: string; commentId?: string }> } {
  const calls: Array<{ blockId?: string; commentId?: string }> = []
  return {
    port: {
      reveal: (anchor) => {
        calls.push(anchor)
      },
    },
    calls,
  }
}

/**
 * A real OPEN source face: a live open-listener set the test drives via `emit`,
 * plus a `toResource` that maps a raw open detail to a `NavResource`. Distinct
 * from `makeSource` (select), mirroring the shell's split open/select emitters.
 */
function makeOpener(toResource: (raw: unknown) => NavResource | null): {
  port: FacePort
  emit: (raw: unknown) => void
  listenerCount: () => number
} {
  const listeners = new Set<(raw: unknown) => void>()
  return {
    port: {
      onOpen: (cb) => {
        listeners.add(cb)
        return () => {
          listeners.delete(cb)
        }
      },
      toResource,
    },
    emit: (raw) => {
      for (const cb of [...listeners]) cb(raw)
    },
    listenerCount: () => listeners.size,
  }
}

/** A real navigate sink recording every resource it is asked to open. */
function makeNavigator(): { port: FacePort; calls: NavResource[] } {
  const calls: NavResource[] = []
  return {
    port: {
      navigate: (resource) => {
        calls.push(resource)
      },
    },
    calls,
  }
}

const commentSelection = (commentId: string): SelectedObject => ({ kind: 'comment', commentId })
const blockSelection = (blockId: string): SelectedObject => ({
  kind: 'block',
  graphId: 'g1',
  documentId: 'd1',
  blockId,
})

describe('installEdgeInterpreter', () => {
  it('drivesSelection: a source select publishes the normalized selection into the reflect target', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const inspector = makeReflector()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithEdges([{ from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' }]),
      { 'face:comments': comments.port, 'face:inspector': inspector.port },
      bus,
    )

    comments.emit('c1')

    expect(inspector.calls).toEqual([commentSelection('c1')])
    expect(bus.get()).toEqual(commentSelection('c1'))
  })

  it('keeps divergent drivesSelection routes isolated by source', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const graph = makeSource((raw) => blockSelection(raw as string))
    const commentInspector = makeReflector()
    const graphInspector = makeReflector()
    const globallySeen: Array<SelectedObject | null> = []
    const bus = createSelectionBus()
    bus.subscribe((selection) => globallySeen.push(selection))

    installEdgeInterpreter(
      configWithEdges([
        { from: 'face:comments', to: 'face:comment-inspector', predicate: 'drivesSelection' },
        { from: 'face:graph', to: 'face:graph-inspector', predicate: 'drivesSelection' },
      ]),
      {
        'face:comments': comments.port,
        'face:graph': graph.port,
        'face:comment-inspector': commentInspector.port,
        'face:graph-inspector': graphInspector.port,
      },
      bus,
    )

    comments.emit('c1')
    expect(commentInspector.calls).toEqual([commentSelection('c1')])
    expect(graphInspector.calls).toEqual([])

    graph.emit('b1')
    expect(commentInspector.calls).toEqual([commentSelection('c1')])
    expect(graphInspector.calls).toEqual([blockSelection('b1')])
    expect(globallySeen).toEqual([commentSelection('c1'), blockSelection('b1')])
  })

  it('retargeting or removing an inline Tier-B route changes its behavioral delivery', () => {
    const sidebar: FacePort = {}
    const firstInspector = makeReflector()
    const secondInspector = makeReflector()
    const bus = createSelectionBus()
    const folder = (folderId: string): SelectedObject => ({ kind: 'folder', graphId: 'g1', folderId })

    let dispose = installEdgeInterpreter(
      configWithEdges([{ from: 'face:sidebar', to: 'face:first', predicate: 'drivesSelection' }]),
      { 'face:sidebar': sidebar, 'face:first': firstInspector.port, 'face:second': secondInspector.port },
      bus,
    )
    bus.publishFrom('face:sidebar', folder('f1'))
    expect(firstInspector.calls).toEqual([folder('f1')])
    expect(secondInspector.calls).toEqual([])

    dispose()
    dispose = installEdgeInterpreter(
      configWithEdges([{ from: 'face:sidebar', to: 'face:second', predicate: 'drivesSelection' }]),
      { 'face:sidebar': sidebar, 'face:first': firstInspector.port, 'face:second': secondInspector.port },
      bus,
    )
    bus.publishFrom('face:sidebar', folder('f2'))
    expect(firstInspector.calls).toEqual([folder('f1')])
    expect(secondInspector.calls).toEqual([folder('f2')])

    dispose()
    installEdgeInterpreter(
      configWithEdges([]),
      { 'face:sidebar': sidebar, 'face:first': firstInspector.port, 'face:second': secondInspector.port },
      bus,
    )
    bus.publishFrom('face:sidebar', folder('f3'))
    expect(firstInspector.calls).toEqual([folder('f1')])
    expect(secondInspector.calls).toEqual([folder('f2')])
    // Inline publications remain globally observable even with no behavioral edge.
    expect(bus.get()).toEqual(folder('f3'))
  })

  it('reflect DEDUP: two drivesSelection edges into one inspector subscribe reflect ONCE', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const graph = makeSource((raw) => blockSelection(raw as string))
    const inspector = makeReflector()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithEdges([
        { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
        { from: 'face:graph', to: 'face:inspector', predicate: 'drivesSelection' },
      ]),
      { 'face:comments': comments.port, 'face:graph': graph.port, 'face:inspector': inspector.port },
      bus,
    )

    // One publish must fire exactly one reflect. A per-edge subscription would
    // double-subscribe the shared target and fire it twice.
    comments.emit('c1')

    expect(inspector.calls).toEqual([commentSelection('c1')])
  })

  it('dedupes duplicate routes and publishes once when one source drives multiple targets', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const inspector = makeReflector()
    const secondary = makeReflector()
    const globallySeen: Array<SelectedObject | null> = []
    const bus = createSelectionBus()
    bus.subscribe((selection) => globallySeen.push(selection))

    installEdgeInterpreter(
      configWithEdges([
        { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
        { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
        { from: 'face:comments', to: 'face:secondary', predicate: 'drivesSelection' },
      ]),
      {
        'face:comments': comments.port,
        'face:inspector': inspector.port,
        'face:secondary': secondary.port,
      },
      bus,
    )

    expect(comments.listenerCount()).toBe(1)
    comments.emit('c1')

    expect(inspector.calls).toEqual([commentSelection('c1')])
    expect(secondary.calls).toEqual([commentSelection('c1')])
    expect(globallySeen).toEqual([commentSelection('c1')])
  })

  it('reveals: a graph select imperatively reveals the picked block in the editor (no bus write)', () => {
    const graph = makeSource((raw) => blockSelection(raw as string))
    const editor = makeRevealer()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithEdges([{ from: 'face:graph', to: 'face:editor', predicate: 'reveals' }]),
      { 'face:graph': graph.port, 'face:editor': editor.port },
      bus,
    )

    graph.emit('b1')

    expect(editor.calls).toEqual([{ blockId: 'b1' }])
    // reveals is imperative — it must NOT touch the bus.
    expect(bus.get()).toBeNull()
  })

  it('navigatesTo: a source open imperatively navigates the target to the resource (no bus write)', () => {
    const graph = makeOpener((raw) => raw as NavResource)
    const editor = makeNavigator()
    const bus = createSelectionBus()
    const resource: NavResource = { graphId: 'g1', documentId: 'd1' }

    installEdgeInterpreter(
      configWithEdges([{ from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' }]),
      { 'face:graph': graph.port, 'face:editor': editor.port },
      bus,
    )

    graph.emit(resource)

    expect(editor.calls).toEqual([resource])
    // navigatesTo is a command, not a selection — it must NOT touch the bus.
    expect(bus.get()).toBeNull()
  })

  it('navigatesTo skips a null resource (an unaddressable open is a no-op)', () => {
    // toResource returns null for an open with no documentId (e.g. a graph node
    // that opens no doc) — the interpreter must not call navigate(null).
    const graph = makeOpener(() => null)
    const editor = makeNavigator()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      configWithEdges([{ from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' }]),
      { 'face:graph': graph.port, 'face:editor': editor.port },
      bus,
    )

    graph.emit({ node: {} })

    expect(editor.calls).toEqual([])
  })

  it('navigatesTo and reveals coexist on the SAME source: select reveals, open navigates', () => {
    // One face:graph carries BOTH predicates off its two distinct events —
    // reveals via the select event, navigatesTo via the open event — so the two
    // effects are independent: an open must not reveal, a select must not navigate.
    const selectListeners = new Set<(raw: unknown) => void>()
    const openListeners = new Set<(raw: unknown) => void>()
    const graphPort: FacePort = {
      onSelect: (cb) => {
        selectListeners.add(cb)
        return () => selectListeners.delete(cb)
      },
      normalize: (raw) => blockSelection(raw as string),
      onOpen: (cb) => {
        openListeners.add(cb)
        return () => openListeners.delete(cb)
      },
      toResource: (raw) => raw as NavResource,
    }
    const editor = makeRevealer()
    const navEditor = makeNavigator()
    const bus = createSelectionBus()

    // reveals → the revealer face, navigatesTo → the navigator face. Two distinct
    // targets keep the two effects observably separate.
    installEdgeInterpreter(
      configWithEdges([
        { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
        { from: 'face:graph', to: 'face:surface', predicate: 'navigatesTo' },
      ]),
      { 'face:graph': graphPort, 'face:editor': editor.port, 'face:surface': navEditor.port },
      bus,
    )

    // A SELECT event reveals only.
    for (const cb of [...selectListeners]) cb('b1')
    expect(editor.calls).toEqual([{ blockId: 'b1' }])
    expect(navEditor.calls).toEqual([])

    // An OPEN event navigates only.
    const resource: NavResource = { graphId: 'g1', documentId: 'd1' }
    for (const cb of [...openListeners]) cb(resource)
    expect(navEditor.calls).toEqual([resource])
    expect(editor.calls).toEqual([{ blockId: 'b1' }]) // unchanged — no extra reveal
    expect(bus.get()).toBeNull()
  })

  it('unknown predicate installs nothing', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const inspector = makeReflector()
    const bus = createSelectionBus()

    installEdgeInterpreter(
      // A predicate the interpreter has no case for — it must fall to default and
      // install nothing (not invent a behavior).
      configWithEdges([{ from: 'face:comments', to: 'face:inspector', predicate: 'teleportsTo' }]),
      { 'face:comments': comments.port, 'face:inspector': inspector.port },
      bus,
    )

    comments.emit('c1')

    expect(inspector.calls).toEqual([])
    expect(bus.get()).toBeNull()
    // No reflect subscription and no select subscription were installed.
    expect(comments.listenerCount()).toBe(0)
  })

  it('the disposer stops all further delivery and is idempotent', () => {
    const comments = makeSource((raw) => commentSelection(raw as string))
    const graph = makeSource((raw) => blockSelection(raw as string))
    const inspector = makeReflector()
    const editor = makeRevealer()
    const bus = createSelectionBus()

    const dispose = installEdgeInterpreter(
      configWithEdges([
        { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
        { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
      ]),
      {
        'face:comments': comments.port,
        'face:graph': graph.port,
        'face:inspector': inspector.port,
        'face:editor': editor.port,
      },
      bus,
    )

    dispose()
    dispose() // idempotent — a second dispose must not throw or re-remove.

    comments.emit('c1')
    graph.emit('b1')

    expect(inspector.calls).toEqual([])
    expect(editor.calls).toEqual([])
    expect(bus.get()).toBeNull()
    expect(comments.listenerCount()).toBe(0)
    expect(graph.listenerCount()).toBe(0)
  })
})
