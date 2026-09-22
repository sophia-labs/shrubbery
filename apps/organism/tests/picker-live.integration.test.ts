/**
 * picker-live.integration.test.ts — the LIVE-OVER-A-REAL-CELL proof, NO MOCKS.
 *
 * The ultimate not-a-toy rung: a real CrdtBackend connects a Y.Doc to a REAL spawned
 * gardend cell's doc-sync WebSocket, proving the provider half of the shell wiring is
 * genuinely live (not the in-process harness). This is the Node path where the cell's
 * Bearer/subprotocol auth works directly with ZERO proxy changes (the precedent
 * gardend-liveread.integration.test.ts already spawns the real binary and holds the
 * token).
 *
 * WHAT IT PROVES (all real):
 *   1. spawnGardend + createGraphAndSeedUxConfig — a real release cell + a real graph,
 *      then create_document for each room identity (a WebSocket may not resurrect an
 *      absent/deleted document by inventing a room name);
 *   2. LoopbackCrdtBackend.open against ws://127.0.0.1:PORT/hocuspocus/docs/{graph}/{doc}
 *      with the bearer.<token> subprotocol → provider.whenSynced RESOLVES (real yjs sync
 *      handshake against the cell's serve_room);
 *   3. a Y.Doc edit ROUND-TRIPS through the real cell room: edit on a first provider's
 *      doc, open a SECOND provider on the same room, and the edit appears on the second
 *      doc — convergence THROUGH the real cell (not an in-process shortcut).
 *
 * It REQUIRES the real gardend binary (no-mock rule). If absent, the suite FAILS LOUDLY
 * pointing at GARDEN_BIN — never fakes a cell.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import * as Y from 'yjs'
import { WebSocket as NodeWebSocket } from 'ws'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackCrdtBackend } from '../src/cell/loopback-crdt-backend.js'
import { render } from 'lit'
import '@shrubbery/components'
import {
  COLLAB_FIELD,
  assembleEditorServices,
  buildKernelOptions,
  installWikiLinkPickerGlue,
  installWireMode,
  mountEditorHost,
  type EditorHostState,
  type EditorHostBinding,
  type ShEditorHost,
  type PickerEditorHandle,
} from '@shrubbery/runtime'
import type { EditorScope } from '@shrubbery/nucleus'
import { createGardendContract } from '../src/cell/gardend-contract.js'

// Node's global WebSocket is shadowed to `undefined` under happy-dom, so the Node path
// supplies the `ws` package as the base WebSocket constructor (the backend wraps it to
// inject the bearer.<token> subprotocol). This is REAL infra — the same `ws` y-websocket
// uses server-side — not a mock.
const WS = NodeWebSocket as unknown as new (
  url: string | URL,
  protocols?: string | string[],
) => unknown

// Anchor on the linked nucleus package for the committed seed (same as the sibling IT).
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const nucleusSrcDir = dirname(nucleusEntry)
const SEED_NT_PATH = resolve(nucleusSrcDir, 'workspace/__generated__/garden-default.ux.nt')
const SEED_NT = readFileSync(SEED_NT_PATH, 'utf8')

const GRAPH_ID = 'shrubbery-picker-live-it'
const DOC_ID = 'doc-live-architecture'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

/** Resolve when the provider syncs, or reject after a deadline (no silent hang). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms),
    ),
  ])
}

async function wikilinkCandidateOptions(mount: HTMLElement): Promise<Element[]> {
  const picker = mount.querySelector('mn-wikilink-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  if (!picker) return []
  await picker.updateComplete
  return Array.from(picker.shadowRoot?.querySelectorAll('[data-wikilink-candidate]') ?? [])
}

describe('REAL INTEGRATION — live editor provider over a spawned gardend cell (doc-sync WS)', () => {
  let cell: GardendCell
  let backend: LoopbackCrdtBackend

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN to override.`,
      )
    }
    cell = await spawnGardend()
    // Establish the graph and authoritative document identities. Gardend intentionally
    // rejects an arbitrary /docs/{graph}/{doc} room name: reconnecting a stale browser
    // must not resurrect a deleted document by manufacturing an empty sidecar.
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT)
    const { LoopbackMcpClient } = await import('../src/cell/loopback-mcp.js')
    const mcp = new LoopbackMcpClient({
      mcpUrl: cell.mcpUrl,
      healthUrl: `${cell.apiUrl}/health`,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    await mcp.toolsCall('create_document', {
      graphId: GRAPH_ID,
      documentId: DOC_ID,
      title: 'Live Architecture',
    })
    await mcp.toolsCall('create_document', {
      graphId: GRAPH_ID,
      documentId: 'doc-roundtrip',
      title: 'Round Trip',
    })
    backend = new LoopbackCrdtBackend({
      mcpUrl: cell.mcpUrl,
      token: cell.token,
      WebSocketPolyfill: WS,
    })
  }, 40000)

  afterAll(async () => {
    backend?.destroyAll()
    if (cell) await cell.kill()
  })

  it('provider.whenSynced resolves against the real cell doc room (yjs sync handshake)', async () => {
    const doc = new Y.Doc()
    const handle = backend.open({ kind: 'doc', graphId: GRAPH_ID, docId: DOC_ID }, doc)
    await withTimeout(handle.whenSynced, 15000, 'whenSynced (doc room)')
    expect(handle.doc).toBe(doc)
    expect(handle.awareness).toBeTruthy()
  }, 20000)

  it('a Y.Doc edit ROUND-TRIPS through the real cell room (two providers converge via the cell)', async () => {
    const room = { kind: 'doc', graphId: GRAPH_ID, docId: 'doc-roundtrip' } as const

    // Provider A — write an edit into the 'content' fragment (the field the live editor
    // binds via Collaboration — COLLAB_FIELD), through a real Y transaction.
    const docA = new Y.Doc()
    const hA = backend.open(room, docA)
    await withTimeout(hA.whenSynced, 15000, 'A.whenSynced')

    const fragA = docA.getXmlFragment(COLLAB_FIELD)
    const el = new Y.XmlElement('paragraph')
    el.insert(0, [new Y.XmlText('Funes el memorioso')])
    fragA.insert(0, [el])

    // Provider B — open the SAME room on a FRESH doc; it must receive A's edit FROM the
    // cell (the cell relays + persisted A's update). Poll the fragment until it converges.
    const docB = new Y.Doc()
    const hB = backend.open(room, docB)
    await withTimeout(hB.whenSynced, 15000, 'B.whenSynced')

    const fragB = docB.getXmlFragment(COLLAB_FIELD)
    const deadline = Date.now() + 10000
    while (!fragB.toString().includes('Funes el memorioso') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(fragB.toString()).toContain('Funes el memorioso')
  }, 40000)

  it('L4 — the SHELL COMPOSITION mounts a LIVE editor over the real cell + the picker chain runs end-to-end', async () => {
    // This is exactly what main.ts assembles in CELL_LIVE mode with a doc open:
    // createGardendContract → assembleEditorServices(contract.rest, contract.wire, getScope)
    // + buildKernelOptions → contract.crdt.open (the REAL LoopbackCrdtBackend over the cell)
    // → mountEditorHost(binding{provider}, kernelOptions) → installWikiLinkPickerGlue. We
    // drive the kernel's REAL open-wikilink-picker CustomEvent and assert the full chain
    // over the REAL cell: real search → candidate → real wire.create (create_wires MCP) +
    // a real wikilink node in the LIVE editor synced to the cell room.

    // Seed two real documents into the graph so the picker has candidates (create_document
    // MCP → the cell materializes TipTapDocuments into :projection:workspace).
    const { LoopbackMcpClient } = await import('../src/cell/loopback-mcp.js')
    const mcp = new LoopbackMcpClient({
      mcpUrl: cell.mcpUrl,
      healthUrl: `${cell.apiUrl}/health`,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: 'doc-arch-live', title: 'Architecture Live' })
    await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: 'doc-self-live', title: 'Self Live' })

    // The real shell contract (Node path: pass the `ws` polyfill — global WS is shadowed).
    const contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
      crdtWebSocketPolyfill: WS,
    })

    // The open-document scope main.ts builds (doc-self-live is the source of the wikilink).
    const getScope = (): EditorScope => ({
      app: undefined,
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-self-live',
    })
    const services = assembleEditorServices(contract.rest, contract.wire, getScope)
    const kernelOptions = buildKernelOptions(services, getScope())

    // Open the REAL provider over the cell + mount the LIVE editor through the shipped host.
    const provider = contract.crdt.open({ kind: 'doc', graphId: GRAPH_ID, docId: 'doc-self-live' }, undefined)
    await withTimeout(provider.whenSynced, 15000, 'shell provider whenSynced')

    const state: EditorHostState = {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-self-live',
      status: 'ready',
      error: null,
      provider,
    }
    let value = state
    const subs = new Set<(v: EditorHostState) => void>()
    const binding: EditorHostBinding = {
      get: () => value,
      subscribe(cb) {
        subs.add(cb)
        return () => subs.delete(cb)
      },
    }

    const container = document.createElement('div')
    container.className = 'main'
    document.body.appendChild(container)
    render(mountEditorHost(binding, kernelOptions), container)
    const host = container.querySelector('#mn-editor-host') as ShEditorHost
    // Settle the host's whenSynced-gated async mount.
    await host.updateComplete
    await Promise.resolve()
    await Promise.resolve()
    await host.updateComplete
    expect(host.liveEditor).not.toBeNull() // LIVE editor over the real cell doc room

    // Install the shipped glue (getEditor reads host.liveEditor at call time), seeded to
    // 'arch' so the candidate is the Architecture doc.
    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: (): PickerEditorHandle | null => host.liveEditor,
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'arch',
    })

    try {
      // TRIGGER the kernel's REAL event → real wikiLinkSearch over the REAL cell store.
      document.dispatchEvent(new CustomEvent('open-wikilink-picker'))
      // suggest() is a real network round-trip to the cell; poll for the dropdown.
      const dl = Date.now() + 10000
      let options = await wikilinkCandidateOptions(mount)
      while (options.length === 0 && Date.now() < dl) {
        await new Promise((r) => setTimeout(r, 100))
        options = await wikilinkCandidateOptions(mount)
      }
      const labels = options.map((o) => o.textContent?.trim())
      expect(labels).toContain('Architecture Live')
      expect(labels).not.toContain('Self Live') // 'arch' does not fuzzy-match 'self live'
      const firstId = options[0].getAttribute('data-doc-id')
      expect(firstId).toBe('doc-arch-live')

      // Select (Enter) → real wire over the cell (create_wires MCP) + inserted node.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

      // The select handler AWAITS a real create_wires round-trip BEFORE inserting the
      // node, so the insert lands asynchronously. POLL until it converges rather than
      // guessing a fixed delay: the fixed-500ms wait went flaky under the concurrent
      // `pnpm -r test:run` where several integration suites each drive a spawned cell and
      // the round-trip can exceed 500ms. (Real round-trip; not a mock — just patient.)
      const real = host as unknown as { _editor: { getJSON(): unknown } }
      const nodeDl = Date.now() + 15000
      let json = JSON.stringify(real._editor.getJSON())
      while (!json.includes('"type":"wikilink"') && Date.now() < nodeDl) {
        await new Promise((r) => setTimeout(r, 100))
        json = JSON.stringify(real._editor.getJSON())
      }

      // The wikilink node is now in the LIVE editor (real getJSON; getText is '' for the atom).
      expect(json).toContain('"type":"wikilink"')
      expect(json).toContain('doc-arch-live')
      expect(json).toContain('Architecture Live')
      // The node carries a minted wire- id (shared with the wire created on the cell).
      expect(json).toMatch(/wire-[0-9a-f-]+/i)

      // The wire was really created on the cell: read it back from :projection:workspace.
      const wireSparql = [
        'PREFIX mnemo: <http://mnemosyne.ai/vocab#>',
        `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <urn:mnemosyne:local:graph:${GRAPH_ID}:projection:workspace> {`,
        '  ?w ?p <urn:mnemosyne:local:document:doc-arch-live> } }',
      ].join('\n')
      const wireRes = (await contract.rest.query(GRAPH_ID, wireSparql)) as {
        rows?: Array<Record<string, string>>
      }
      const n = wireRes.rows?.[0]?.n ?? ''
      // The count term is "N"^^xsd:integer; assert it is > 0 (a wire targeting the doc).
      expect(n).not.toMatch(/^"0"/)
    } finally {
      uninstall()
      mount.remove()
      host.remove()
      container.remove()
      provider.destroy()
    }
  }, 60000)

  it('L5 — visual wire mode commits a REAL wire over the cell (installWireMode + keymap Enter)', async () => {
    // The visual-wire-mode analog of L4: mount the LIVE editor over the real cell,
    // install the wire-mode glue against the REAL shadow-DOM editor host, drive the
    // controller + the document-level keymap, and assert a real wire lands on the
    // cell. This exercises the new editor-host accessors (getBlockElement /
    // getOrderedBlockElements / setEditable) against a real ProseMirror in a shadow
    // root, the :host([wire-mode-active]) attribute, the capture-phase Enter commit,
    // and the contract.wireMode.commit → contract.wire.create → create_wires chain.
    // (Overlay POSITIONS are not asserted — getBoundingClientRect is all-zero under
    // happy-dom; that visual half is the browser-only gate. The LOGIC chain is real.)

    const SRC = 'doc-wiremode-src'
    const { LoopbackMcpClient } = await import('../src/cell/loopback-mcp.js')
    const mcp = new LoopbackMcpClient({
      mcpUrl: cell.mcpUrl,
      healthUrl: `${cell.apiUrl}/health`,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: SRC, title: 'Wire Mode Source' })

    const contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
      crdtWebSocketPolyfill: WS,
    })
    const getScope = (): EditorScope => ({
      app: undefined,
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: SRC,
    })
    const services = assembleEditorServices(contract.rest, contract.wire, getScope)
    const kernelOptions = buildKernelOptions(services, getScope())
    const provider = contract.crdt.open({ kind: 'doc', graphId: GRAPH_ID, docId: SRC }, undefined)
    await withTimeout(provider.whenSynced, 15000, 'wiremode provider whenSynced')

    // Seed TWO paragraphs into the doc fragment so source block ≠ target block (a
    // non-degenerate wire). The live editor is bound to this same Y.Doc via
    // Collaboration, so the blocks appear in the editor and the BlockId extension
    // stamps each with a data-block-id on the resulting transaction.
    const ydoc = provider.doc as Y.Doc
    const frag = ydoc.getXmlFragment(COLLAB_FIELD)
    const mk = (text: string): Y.XmlElement => {
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText(text)])
      return p
    }
    frag.insert(0, [mk('Alpha source'), mk('Beta target')])

    const state: EditorHostState = {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: SRC,
      status: 'ready',
      error: null,
      provider,
    }
    let value = state
    const subs = new Set<(v: EditorHostState) => void>()
    const binding: EditorHostBinding = {
      get: () => value,
      subscribe(cb) {
        subs.add(cb)
        return () => subs.delete(cb)
      },
    }

    const container = document.createElement('div')
    container.className = 'main'
    document.body.appendChild(container)
    render(mountEditorHost(binding, kernelOptions), container)
    const host = container.querySelector('#mn-editor-host') as ShEditorHost
    await host.updateComplete
    await Promise.resolve()
    await Promise.resolve()
    await host.updateComplete
    expect(host.liveEditor).not.toBeNull()

    // Poll until the new editor-host accessor sees BOTH blocks with stamped ids.
    const blockDl = Date.now() + 10000
    let blocks = host.liveEditor!.getOrderedBlockElements()
    while (
      (blocks.length < 2 || blocks.some((b) => !b.getAttribute('data-block-id'))) &&
      Date.now() < blockDl
    ) {
      await new Promise((r) => setTimeout(r, 100))
      blocks = host.liveEditor!.getOrderedBlockElements()
    }
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const sourceBlockId = blocks[0].getAttribute('data-block-id') as string
    expect(sourceBlockId).toMatch(/^block-/)
    // getBlockElement resolves the same element by id (the other new accessor).
    expect(host.liveEditor!.getBlockElement(sourceBlockId)).toBe(blocks[0])

    const proseMirror = host.renderRoot?.querySelector('.editor-mount .ProseMirror') as HTMLElement | null
    expect(proseMirror).not.toBeNull()

    // Count triples in the read-only :projection:workspace graph — a committed wire
    // materializes new triples there. Robust to the wire's exact URN/predicate shape.
    const projectionGraph = `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:workspace`
    const countProjectionTriples = async (): Promise<number> => {
      const res = (await contract.rest.query(
        GRAPH_ID,
        `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${projectionGraph}> { ?s ?p ?o } }`,
      )) as { rows?: Array<Record<string, string>> }
      const raw = res.rows?.[0]?.n ?? '"0"'
      const m = /^"(\d+)"/.exec(raw)
      return m ? Number(m[1]) : 0
    }
    const beforeTriples = await countProjectionTriples()

    const handle = installWireMode({
      wireMode: contract.wireMode,
      hostId: 'it-host',
      getHostElement: () => host,
      getEditor: () => {
        const le = host.liveEditor
        return le ? { setEditable: (editable: boolean) => le.setEditable(editable) } : null
      },
      getBlockElement: (id) => host.liveEditor?.getBlockElement(id) ?? null,
      getOrderedBlockElements: () => host.liveEditor?.getOrderedBlockElements() ?? [],
      getDocumentScope: () => ({ graphId: GRAPH_ID, documentId: SRC }),
    })

    try {
      // Enter wire mode from the first block (what the advanced-menu bridge does on
      // confirm; we drive the controller directly to keep the E2E focused on the
      // installWireMode → commit → cell chain).
      contract.wireMode.enter(
        { graphId: GRAPH_ID, documentId: SRC, blockId: sourceBlockId },
        { predicate: 'relatedTo', direction: 'forward' },
        'it-host',
      )
      expect(contract.wireMode.view().isActive).toBe(true)
      // The real shadow-DOM editor host carries the wire-mode attribute (the crosshair
      // CSS hook) and the editor was frozen (setEditable(false) → contenteditable=false).
      expect(host.hasAttribute('wire-mode-active')).toBe(true)
      expect(proseMirror?.getAttribute('contenteditable')).toBe('false')

      // J navigates the target from blocks[0] (the seed) to blocks[1].
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))

      // Enter commits — capture-phase document handler → contract.wireMode.commit →
      // contract.wire.create → real create_wires on the cell. Poll until the commit
      // resolves and wire mode exits.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      const exitDl = Date.now() + 15000
      while (contract.wireMode.view().isActive && Date.now() < exitDl) {
        await new Promise((r) => setTimeout(r, 100))
      }
      // isActive===false IS the commit-succeeded proof: the controller exits ONLY after
      // wire.create resolves; a cell rejection would leave it active (the install-wire-
      // mode commit helper swallows the rejection, the controller stays put for retry).
      expect(contract.wireMode.view().isActive).toBe(false) // committed + exited
      // Side effects reversed: attribute gone, editor editable again.
      expect(host.hasAttribute('wire-mode-active')).toBe(false)
      expect(proseMirror?.getAttribute('contenteditable')).not.toBe('false')

      // Cell-side corroboration: the wire materialized new triples in the projection
      // graph. Materialization is async (create_wires enqueues a workspace.createWire
      // CRDT op), so poll until the count grows.
      const tripleDl = Date.now() + 10000
      let afterTriples = await countProjectionTriples()
      while (afterTriples <= beforeTriples && Date.now() < tripleDl) {
        await new Promise((r) => setTimeout(r, 150))
        afterTriples = await countProjectionTriples()
      }
      expect(afterTriples).toBeGreaterThan(beforeTriples)
    } finally {
      handle.uninstall()
      host.remove()
      container.remove()
      provider.destroy()
    }
  }, 60000)
})
