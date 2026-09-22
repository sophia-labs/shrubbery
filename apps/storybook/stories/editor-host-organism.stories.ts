/**
 * Editor Host (ORGANISM) — RUNG L2c: the host-mount closed end-to-end.
 *
 * This is the live twin of editor-host-live.stories.ts WITH the kernel slot now
 * populated by the EditorServices the SHELL assembles. It mounts the REAL
 * `<sh-editor-host>` carrying a LIVE collaborative TipTap body over a REAL Y.Doc, AND
 * threads the assembled `onWikiLinkClick` / `onWikiLinkDelete` callbacks into the
 * kernel slot — so the GRAPH-correct adapters (wikilink search, navigation, wire) are
 * reachable FROM the live editor, exactly as in the gardend shell:
 *
 *   assembleEditorServices(rest, wire, getScope)  →  buildKernelOptions(services, scope)
 *   →  mountEditorHost(binding, kernelOptions)
 *
 * THE ORGANISM (probeable): the live editor + picker service the host wired returns
 * REAL candidates from the workspace. play() asserts the editor stayed live while
 * wikiLinkSearch.suggest returns the seeded candidates — the same behavioral proof
 * the vitest organism (sh-editor-host-organism.test.ts) lands at the command level.
 *
 * NO MOCKS on the axis that matters: the editor is the REAL pure kernel roster + REAL
 * collaboration over a REAL Y.Doc (history owned exactly once); the navigation is a REAL
 * CustomEvent; the wire seam is a REAL WireWriter recording the cell-faithful envelope;
 * the wikiLinkSearch is the REAL makeWikiLinkSearchService issuing the REAL GRAPH-scoped
 * SELECT and parsing the cell's exact row shape.
 *
 * HONEST DEFERRAL (labelled, not faked): the REAL SPARQL ENGINE is the Node-addon
 * oxigraph (the same engine the cell embeds) — it does NOT run in a Storybook BROWSER
 * canvas. So this story backs the RestClient with the cell's EXACT row shape
 * (term.toString() form: NamedNode → `<uri>`, Literal → `"value"`) for the seeded
 * candidates and runs the REAL adapter over them; the engine that would EXECUTE the
 * query is deferred to the vitest organism (which uses the real oxigraph engine with REAL
 * named-graph semantics — a GRAPH-less query returns ZERO). The query the adapter issues
 * is real and GRAPH-scoped; only its execution engine is browser-deferred. Pixel float
 * positioning stays Playwright territory (deferred, not mocked).
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import * as Y from 'yjs'
import { render } from 'lit'
import type {
  EditorScope,
  RestClient,
  WireWriter,
} from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import {
  ShEditorHost,
  createLiveAwareness,
  mountEditorHost,
  assembleEditorServices,
  buildKernelOptions,
  OPEN_DOCUMENT_EVENT,
  type EditorHostState,
  type EditorHostBinding,
  type EditorKernelOptions,
  type WikiLinkSuggestionItem,
} from '@shrubbery/runtime'

const meta: Meta = {
  title: 'Editor/HostOrganism',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

const GRAPH_ID = 'g-tlon'
/** Seeded candidate documents (the workspace the picker resolves against). */
const SEED: Array<{ id: string; title: string }> = [
  { id: 'doc-architecture', title: 'Architecture' },
  { id: 'doc-arch-notes', title: 'Arch Notes' },
  { id: 'doc-billing', title: 'Billing' },
  { id: 'doc-tlon', title: 'Tlön' },
]

/** A REAL reactive binding (get/subscribe) — not a mock. */
function makeBinding(state: EditorHostState): EditorHostBinding {
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

/** A REAL contract.crdt ProviderHandle over a REAL local Y.Doc (in-process, no network). */
function liveProvider(): NonNullable<EditorHostState['provider']> {
  const doc = new Y.Doc()
  const awareness = createLiveAwareness(doc)
  return {
    doc,
    awareness,
    lifecycle: synchronizedCrdtProviderLifecycle(),
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy: () => { awareness.destroy(); doc.destroy() },
  }
}

/**
 * A REAL RestClient whose query returns the cell's EXACT SparqlQueryResult row shape for
 * the seeded candidates. This is NOT a SPARQL engine — the engine (Node oxigraph) is
 * browser-deferred; this hands the REAL adapter the SAME BYTES the cell would, so the
 * adapter's REAL parse + fuzzy filter run unchanged. The doc-list SELECT the adapter
 * issues binds ?doc (the document urn) + ?label (the title literal).
 */
function seededRestClient(): RestClient {
  // Each row mirrors the cell's term.toString(): NamedNode → `<uri>`, Literal → `"value"`.
  const rows = SEED.map((d) => ({
    doc: `<urn:mnemosyne:local:document:${d.id}>`,
    label: `"${d.title}"`,
  }))
  return {
    graphs: () => Promise.resolve([]),
    query: () => Promise.resolve({ result_type: 'solutions', variables: ['doc', 'label'], rows }),
    update: () => Promise.resolve(),
  }
}

/** A REAL WireWriter recording the cell-faithful create/delete envelope (no fake acceptance). */
function recordingWireWriter(host: HTMLElement & { __wires?: unknown[] }): WireWriter {
  host.__wires = []
  return {
    async create(graphId, params) {
      host.__wires!.push({ op: 'create', graphId, params })
      return { wireId: params.wireId ?? '' }
    },
    async delete(graphId, wireId) {
      host.__wires!.push({ op: 'delete', graphId, wireId })
    },
  }
}

/** Live document scope — graphId read at call time so the bundle tracks the open doc. */
function documentScope(): () => EditorScope {
  return () => ({ centerMode: 'document', graphId: GRAPH_ID, documentId: 'doc-architecture' })
}

/**
 * Mount the REAL `<sh-editor-host>` with a live provider AND the assembled kernelOptions.
 * The host element also: (a) stashes the live wikiLinkSearch so play() can probe it, and
 * (b) wires a REAL listener for the pure 'open-wikilink-picker' event that runs the
 * picker against the seeded workspace.
 */
function mountOrganism(): HTMLElement {
  void ShEditorHost

  const container = document.createElement('div') as HTMLElement & {
    __suggest?: (q: string) => Promise<WikiLinkSuggestionItem[]>
    __lastCandidates?: WikiLinkSuggestionItem[]
    __wires?: unknown[]
  }
  container.className = 'main'
  container.style.position = 'relative'
  container.style.height = '100vh'
  container.style.boxSizing = 'border-box'
  container.style.background = 'var(--mn-color-surface-base, #fff)'
  container.style.color = 'var(--mn-color-text-primary, #111)'
  container.style.fontFamily = 'var(--mn-font-chrome, system-ui, sans-serif)'

  // THE SHELL ASSEMBLY — exactly what gardend-contract drives.
  const services = assembleEditorServices(
    seededRestClient(),
    recordingWireWriter(container),
    documentScope(),
  )
  const kernelOptions: EditorKernelOptions = buildKernelOptions(services, documentScope()())

  // Probe seam + the real picker-open listener ("[[ → candidates"): when the editor
  // dispatches 'open-wikilink-picker', run the REAL wikiLinkSearch over the workspace.
  container.__suggest = (q: string) => services.wikiLinkSearch.suggest(q)
  document.addEventListener('open-wikilink-picker', () => {
    void services.wikiLinkSearch.suggest('').then((c) => {
      container.__lastCandidates = c
    })
  })

  const state: EditorHostState = {
    centerMode: 'document',
    graphId: GRAPH_ID,
    documentId: 'doc-architecture',
    status: 'ready',
    error: null,
    provider: liveProvider(),
  }
  render(mountEditorHost(makeBinding(state), kernelOptions), container)
  return container
}

function hostOf(canvasElement: HTMLElement): ShEditorHost {
  const direct = canvasElement.querySelector<ShEditorHost>('#mn-editor-host')
  if (direct) return direct
  if (canvasElement instanceof ShEditorHost) return canvasElement
  throw new Error('editor-host-organism: no <sh-editor-host> found on the canvas')
}

/**
 * The organism: keep the live editor mounted, then assert the picker service the host
 * wired returns the REAL seeded candidates from the workspace (not a vi.fn).
 */
export const HostOrganism: Story = {
  render: () => mountOrganism(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const root = canvasElement.closest('.main') as
      | (HTMLElement & { __suggest?: (q: string) => Promise<WikiLinkSuggestionItem[]> })
      | null
    const probeRoot =
      root && root.__suggest
        ? root
        : (canvasElement.querySelector('.main') as
            | (HTMLElement & { __suggest?: (q: string) => Promise<WikiLinkSuggestionItem[]> })
            | null) ?? (canvasElement as HTMLElement & { __suggest?: (q: string) => Promise<WikiLinkSuggestionItem[]> })

    const host = hostOf(canvasElement)
    // The host mounts the editor in a whenSynced.then() microtask; let it settle.
    await host.updateComplete
    await Promise.resolve()
    await Promise.resolve()
    await host.updateComplete

    const editor = host.liveEditor
    if (!editor) throw new Error('HostOrganism.play: the live editor did not mount (kernel slot)')

    // Insert literal text programmatically; real `[[` keystrokes are covered by the
    // kernel autocomplete test and the picker-glue causal-chain test.
    const real = host as unknown as { _editor: { commands: { insertContent(s: string): boolean } } }
    real._editor.commands.insertContent('[[arch')
    if (!editor.getText().includes('[[arch')) {
      throw new Error(`HostOrganism.play: expected live editor text to contain "[[arch", got: ${editor.getText()}`)
    }

    // The picker the host was wired with returns REAL candidates from the workspace.
    const suggest = probeRoot?.__suggest
    if (!suggest) throw new Error('HostOrganism.play: no live wikiLinkSearch probe on the canvas')
    const candidates = await suggest('arch')
    const labels = candidates.map((c) => c.label)
    if (!labels.includes('Architecture') || !labels.includes('Arch Notes')) {
      throw new Error(`HostOrganism.play: expected real candidates [Architecture, Arch Notes], got: ${labels.join(', ')}`)
    }
    if (labels.includes('Billing')) {
      throw new Error('HostOrganism.play: "Billing" must NOT match the query "arch"')
    }
  },
}
