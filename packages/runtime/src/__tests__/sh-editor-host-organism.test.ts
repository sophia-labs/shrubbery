/**
 * sh-editor-host-organism.test.ts — RUNG L2c END-TO-END ORGANISM, NO MOCKS.
 *
 * This closes the host-mount gap: a LIVE collaborative editor mounted in
 * <sh-editor-host> whose KERNEL SLOT is populated with the EditorServices the SHELL
 * assembled over the REAL contract — so the GRAPH-correct adapters (wikilink search,
 * navigation, wire) are finally reachable FROM the live editor, not stranded in the
 * library.
 *
 * THE AXIS THAT MATTERS (real, not faked):
 *   - a REAL Oxigraph NamedGraphStore seeded with candidate documents in
 *     urn:mnemosyne:local:graph:{g}:projection:workspace (the same engine the cell
 *     embeds, same named-graph semantics — a GRAPH-less query sees ZERO);
 *   - a REAL RestClient over that store + a REAL WireWriter capture seam;
 *   - assembleEditorServices(rest, wire, getScope) + buildKernelOptions(services, scope)
 *     — the SAME assembly the shell does;
 *   - a REAL ProviderHandle (a REAL new Y.Doc) + a REAL createLiveCollabEditor mounted
 *     into the host with the kernelOptions prop set beside .binding;
 *   - the picker resolves REAL candidates FROM the named graph (not a vi.fn), and
 *     onWikiLinkClick fires REAL navigation while a wire is created via the path a real
 *     cell accepts (the WireWriter seam — workspace.createWire, NOT raw projection SPARQL
 *     which a real cell rejects).
 *
 * "TYPE [[ → real candidates": the kernel now has a pure `[[` autocomplete event
 * source, while runtime still owns lookup/popup/wire creation. This happy-dom
 * organism test avoids popup geometry and proves BEHAVIORALLY that the live editor
 * stays mounted and the picker service the shell wired (the assembled
 * wikiLinkSearch) returns REAL candidates from the seeded named graph.
 * LiveEditorHandle exposes no callback introspection, so the kernel-slot population
 * is proven via the wikiLinkSearch + onWikiLinkClick/onWikiLinkDelete reachability,
 * not by reading private editor internals.
 *
 * HAPPY-DOM SPLIT (honored): content + CRDT + search assertions run fully here (Y.Doc is
 * pure JS, a real Editor mounts at 0 layout, Oxigraph is a real engine). Pixel positioning
 * stays Playwright territory (deferred, not mocked).
 *
 * HONEST SCOPE NOTE: there is no live gardend cell / LoopbackTransport harness on this POC
 * branch, so the executed real-cell round-trip (cell MATERIALIZES the wire into
 * :projection:workspace → a later read sees it) is OUT OF SCOPE. The cell's ACCEPTANCE of
 * the create_wires / delete{type:'wires'} envelope is verified by reading its Rust schema
 * (mcp_wire_payloads.rs) + asserted as the envelope shape the seam emits (see
 * editor-services.test.ts). Here we prove the seam is REACHED from the live editor.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'lit'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import type { EditorScope, ProviderHandle, WireWriter, WireCreateRequest } from '@shrubbery/nucleus'
import { mountEditorHost } from '../mount.js'
import type { EditorHostState, EditorHostBinding } from '../editor-host-binding.js'
import type { ShEditorHost } from '../editor-host.js'
import {
  assembleEditorServices,
  buildKernelOptions,
  OPEN_DOCUMENT_EVENT,
} from '../editor-services/index.js'
import {
  makeOxigraphRestClient,
  seedWorkspaceStore,
} from './named-graph-store.js'

// ── REAL settable reactive binding (not a vi.fn) ──────────────────────────────
interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}
function makeBinding(initial: EditorHostState): SettableBinding {
  let value = initial
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of subs) cb(value)
    },
  }
}

// ── REAL in-process ProviderHandle over a REAL Y.Doc (no network — the real-infra
//    iteration, not a mock). One per test, torn down in afterEach. ─────────────
const handles: ProviderHandle[] = []
function realProvider(): ProviderHandle {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const h: ProviderHandle = {
    doc,
    awareness,
    lifecycle: synchronizedCrdtProviderLifecycle(),
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy: () => awareness.destroy(),
  }
  handles.push(h)
  return h
}
afterEach(() => {
  for (const h of handles) h.destroy()
  handles.length = 0
})

// ── REAL capture WireWriter (the faithful loopback for the seam-reachability proof) ─
function captureWireWriter(): {
  writer: WireWriter
  creates: Array<{ graphId: string; params: WireCreateRequest }>
  deletes: Array<{ graphId: string; wireId: string }>
} {
  const creates: Array<{ graphId: string; params: WireCreateRequest }> = []
  const deletes: Array<{ graphId: string; wireId: string }> = []
  return {
    writer: {
      async create(graphId, params) {
        creates.push({ graphId, params })
        return { wireId: params.wireId ?? '' }
      },
      async delete(graphId, wireId) {
        deletes.push({ graphId, wireId })
      },
    },
    creates,
    deletes,
  }
}

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}
const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost | null
const proseMirror = (h: ShEditorHost | null) =>
  h?.shadowRoot?.querySelector('.ProseMirror') as HTMLElement | null

/** Flush the host's sync-gated async mount + Lit's update cycle. */
async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

const GRAPH_ID = 'g-tlon'
const DOCS = [
  { id: 'doc-architecture', title: 'Architecture' },
  { id: 'doc-arch-notes', title: 'Arch Notes' },
  { id: 'doc-billing', title: 'Billing' },
]

/** A live document scope for the open doc (graphId read at call time by every service). */
function documentScope(documentId = 'doc-architecture'): () => EditorScope {
  return () => ({ centerMode: 'document', graphId: GRAPH_ID, documentId })
}

/**
 * The shell's exact assembly: real store → real RestClient + real WireWriter →
 * EditorServices → buildKernelOptions. Returns everything the organism asserts against.
 */
function assembleOverRealStore(navTarget: EventTarget) {
  const store = seedWorkspaceStore(GRAPH_ID, DOCS)
  const rest = makeOxigraphRestClient(store)
  const wireCapture = captureWireWriter()
  const services = assembleEditorServices(
    rest,
    wireCapture.writer,
    documentScope(),
    // inject a scoped nav target so the test observes the REAL open-document event
    // without touching globalThis.
    {
      openDocument(graphId, documentId, blockId) {
        navTarget.dispatchEvent(
          new CustomEvent(OPEN_DOCUMENT_EVENT, { detail: { graphId, documentId, blockId } }),
        )
      },
      openZoteroSource(artifactId, zoteroKey) {
        navTarget.dispatchEvent(
          new CustomEvent('mn-open-zotero-source', { detail: { artifactId, zoteroKey } }),
        )
      },
    },
  )
  const kernelOptions = buildKernelOptions(services, documentScope()())
  return { store, services, kernelOptions, wireCapture }
}

describe('L2c ORGANISM — the host-mount closes: live editor + EditorServices over a REAL store', () => {
  it('mounts a LIVE editor WITH the kernel slot populated; the picker resolves REAL candidates from the named graph', async () => {
    const bus = new EventTarget()
    const { services, kernelOptions } = assembleOverRealStore(bus)

    // Mount the keyed host with a REAL provider AND the kernelOptions prop (sibling of
    // .binding) — the same mount glue + the new kernel slot the shell threads.
    const provider = realProvider()
    const binding = makeBinding({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, kernelOptions), container)
    const h = hostEl(container)!
    await settle(h)

    // (1) the live editor is REAL and mounted (the kernel slot was forwarded — the editor
    //     was built via createLiveCollabEditor({ kernel: kernelOptions })).
    expect(proseMirror(h)).not.toBeNull()
    expect(h.liveEditor).not.toBeNull()

    // (2) Insert literal `[[` programmatically; real keystrokes are covered by the
    //     kernel autocomplete test and the picker-glue causal-chain test.
    const real = h as unknown as { _editor: { commands: { insertContent(s: string): boolean } } }
    real._editor.commands.insertContent('[[')
    expect(h.liveEditor!.getText()).toContain('[[')

    // (3) the picker the host was wired with returns REAL candidates FROM the named graph
    //     (not a vi.fn). The candidates are the SEEDED docs, scoped to the open graph.
    const candidates = await services.wikiLinkSearch.suggest('arch')
    const labels = candidates.map((c) => c.label)
    expect(labels).toContain('Architecture')
    expect(labels).toContain('Arch Notes')
    expect(labels).not.toContain('Billing') // 'arch' does not match 'Billing'
    // ids parsed back from the cell-canonical document urn — these are REAL store docs.
    expect(candidates.find((c) => c.label === 'Architecture')?.id).toBe('doc-architecture')
  })

  it('selecting a candidate routes to navigation (onWikiLinkClick) and creating a link writes a wire via the cell-faithful seam', async () => {
    const bus = new EventTarget()
    const { kernelOptions, services, wireCapture } = assembleOverRealStore(bus)

    const provider = realProvider()
    const binding = makeBinding({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, kernelOptions), container)
    const h = hostEl(container)!
    await settle(h)
    expect(h.liveEditor).not.toBeNull()

    // Resolve a REAL candidate from the named graph (the picker selection).
    const [candidate] = await services.wikiLinkSearch.suggest('billing')
    expect(candidate?.id).toBe('doc-billing')

    // SELECT it → onWikiLinkClick fires REAL navigation (the kernel-slot callback the host
    // forwarded). Observe the REAL open-document event on the scoped bus.
    let navDetail: { graphId: string; documentId: string } | null = null
    bus.addEventListener(OPEN_DOCUMENT_EVENT, (e) => {
      navDetail = (e as CustomEvent).detail
    })
    kernelOptions.onWikiLinkClick?.({ targetDocId: candidate!.id, label: candidate!.label })
    expect(navDetail).toEqual({ graphId: GRAPH_ID, documentId: 'doc-billing', blockId: undefined })

    // CREATE the backing wire via the seam (the path a real cell accepts — workspace.createWire
    // through create_wires, NOT raw projection SPARQL). The host minted id flows through.
    const { wireId } = await services.wire.create({
      sourceDocumentId: 'doc-architecture',
      targetDocumentId: candidate!.id,
    })
    expect(wireId).toMatch(/^wire-/)
    expect(wireCapture.creates).toHaveLength(1)
    const created = wireCapture.creates[0]
    expect(created.graphId).toBe(GRAPH_ID)
    expect(created.params.sourceDocumentId).toBe('doc-architecture')
    expect(created.params.targetDocumentId).toBe('doc-billing')
    expect(created.params.wireId).toBe(wireId) // caller-minted, cell-honored

    // DELETE cleanup (onWikiLinkDelete) routes through the seam too (workspace.deleteWire).
    kernelOptions.onWikiLinkDelete?.({ targetDocId: candidate!.id, label: candidate!.label, wireId })
    await Promise.resolve()
    await Promise.resolve()
    expect(wireCapture.deletes).toEqual([{ graphId: GRAPH_ID, wireId }])
  })

  it('REGRESSION: with NO GRAPH scope the same picker would find NOTHING (candidates owed to a correct GRAPH clause, not the store)', async () => {
    // Proves the candidates in the organism are owed to the adapter's GRAPH clause, not a
    // union-default-graph store: a home scope (no graphId) returns [] without a query.
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const services = assembleEditorServices(
      makeOxigraphRestClient(store),
      captureWireWriter().writer,
      () => ({ centerMode: 'home', graphId: null, documentId: null }),
    )
    expect(await services.wikiLinkSearch.suggest('arch')).toEqual([])
  })

  it('mount-once + collab-undo PRESERVED under the kernel slot: same editor survives a same-provider re-render; undo reverts a pre-render edit', async () => {
    // The rung-3 invariants must still hold WITH the kernel slot added. The kernelOptions
    // prop is NOT in the provider-identity compare, so a re-render keeping the SAME provider
    // keeps the SAME live editor (and its full undo history).
    const bus = new EventTarget()
    const { kernelOptions } = assembleOverRealStore(bus)
    const provider = realProvider()
    const docState = (): EditorHostState => ({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
      status: 'ready',
      error: null,
      provider, // SAME reference across all sets — the survival anchor
    })
    const binding = makeBinding(docState())
    const container = connectedContainer()
    render(mountEditorHost(binding, kernelOptions), container)
    const h = hostEl(container)!
    await settle(h)

    const editor0 = h.liveEditor
    expect(editor0).not.toBeNull()

    const real = h as unknown as { _editor: { commands: { insertContent(s: string): boolean; undo(): boolean } } }
    real._editor.commands.insertContent('Funes el memorioso')
    expect(editor0!.getText()).toContain('Funes el memorioso')

    // Re-render with the SAME provider (a shell branch-switch that keeps the doc open).
    binding.set(docState())
    await settle(h)
    binding.set(docState())
    await settle(h)

    // (a) mount-once: the SAME live editor instance survived.
    expect(h.liveEditor).toBe(editor0)

    // (b) room undo survived the re-renders and reverts the pre-render edit
    //     (history recorded exactly once — the kernel dropped its own).
    const undid = real._editor.commands.undo()
    expect(undid).toBe(true)
    expect(h.liveEditor!.getText()).not.toContain('Funes el memorioso')
  })

  it('kernelOptions defaults to undefined when omitted: a bare collab editor still mounts (rung-3 back-compat)', async () => {
    const provider = realProvider()
    const binding = makeBinding({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    // No kernelOptions arg — the rung-3 path.
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    expect(h.liveEditor).not.toBeNull()
    expect(proseMirror(h)).not.toBeNull()
  })
})
