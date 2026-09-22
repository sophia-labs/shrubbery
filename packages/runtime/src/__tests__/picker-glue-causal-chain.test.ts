/**
 * picker-glue-causal-chain.test.ts — THE end-to-end proof that the wikilink picker glue
 * closes the causal chain in SHIPPED code, no mock on the axis that matters.
 *
 * This drives the FULL chain through shipped surfaces in ONE causal flow (not two
 * disjoint asserts):
 *
 *   trigger (the kernel's REAL open-wikilink-picker CustomEvent)
 *     → the SHIPPED installWikiLinkPickerGlue listener
 *       → the SHIPPED wikiLinkSearch.suggest over a REAL oxigraph store
 *         → a candidate selection (Enter on the rendered dropdown)
 *           → the real WireService.create (recorded) — WIRE-FIRST, shared minted id
 *             → insertWikiLink through the SHIPPED public host handle (host.liveEditor)
 *               → a real wikilink node in the LIVE editor over a real Y.Doc.
 *
 * REAL INGREDIENTS (per Vera's no-mock rule):
 *   - a REAL oxigraph Store (the SAME engine the cell embeds) seeded into the named
 *     :projection:workspace graph — GRAPH-less query returns ZERO (intrinsic regression);
 *   - a REAL in-process ProviderHandle (real new Y.Doc + Awareness, whenSynced resolved);
 *   - a REAL recording WireWriter that CAPTURES the create envelope (real capture, not a
 *     vi.fn acceptance) and mints+returns the id like the real cell;
 *   - the SHIPPED assembleEditorServices / buildKernelOptions / mountEditorHost /
 *     installWikiLinkPickerGlue.
 *
 * WHY THE CUSTOMEVENT, NOT suggest() DIRECTLY: the kernel's actual output on Mod-Shift-k
 * is `document.dispatchEvent(new CustomEvent('open-wikilink-picker'))`. Dispatching that
 * real event is the FAITHFUL trigger (Mod-Shift-k keymap dispatch through ProseMirror in
 * happy-dom is fragile, and the CustomEvent IS the kernel's real output). Calling
 * suggest() directly would make this a unit probe, not a causal-chain test.
 *
 * HAPPY-DOM CAVEAT: pixel positioning of the dropdown is Playwright-territory (no layout
 * engine here); this test asserts BEHAVIOR (candidates, wire envelope, inserted node),
 * not float math.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'lit'
import '../../../components/src/mn-advanced-wire-menu.js'
import '../../../components/src/mn-wire-menu-dropdown.js'
import '../../../components/src/mn-wikilink-picker.js'
import '../../../components/src/mn-tag-autocomplete-popover.js'
import '../../../components/src/mn-citation-picker.js'
import {
  DEFAULT_WIRE_PREDICATE_URI,
  MNEMO_NS,
  type WireWriter,
  type WireCreateRequest,
  type EditorScope,
} from '@shrubbery/nucleus'
import {
  CLOSE_TAG_PICKER_EVENT,
  CLOSE_WIKILINK_PICKER_EVENT,
  EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
  OPEN_CITATION_PICKER_EVENT,
  OPEN_SLASH_COMMAND_EVENT,
  OPEN_WIKILINK_PICKER_EVENT,
  OPEN_TAG_PICKER_EVENT,
  todayKey,
  type EditorKeyboardWireRequestDetail,
  type OpenTagPickerDetail,
  type OpenSlashCommandDetail,
  type OpenWikiLinkPickerDetail,
  type SlashCommandId,
} from '@shrubbery/editor-kernel'
import {
  assembleEditorServices,
  buildKernelOptions,
  eventNavigationService,
  mountEditorHost,
  installWikiLinkPickerGlue,
  mintWireId,
  NULL_EDITOR_HOST_STATE,
  OPEN_DOCUMENT_EVENT,
  WIRE_DOCUMENT_REQUEST_EVENT,
  type EditorHostState,
  type EditorHostBinding,
  type CitationGroundingRequest,
  type CitationPickerItem,
  type LiveTagChipAttrs,
  type LiveCitationAttrs,
  type OpenDocumentDetail,
  type WireSummary,
} from '../index.js'
import type { ShEditorHost } from '../editor-host.js'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'
import { seedWorkspaceStore, makeOxigraphRestClient } from './named-graph-store.js'

// ── a REAL settable reactive binding (not a vi.fn) ────────────────────────────
interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}
function makeBinding(initial: EditorHostState = NULL_EDITOR_HOST_STATE): SettableBinding {
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

/**
 * A REAL recording WireWriter: it CAPTURES every create envelope and mints+returns the
 * wireId exactly like the cell-faithful LoopbackWireWriter (which honors a caller-minted
 * id but, here, the WireService mints internally and the writer echoes it back). This is
 * real capture — we assert the captured envelope — NOT a vi.fn acceptance.
 */
interface RecordedCreate {
  graphId: string
  params: WireCreateRequest
}
function recordingWireWriter(): WireWriter & { creates: RecordedCreate[]; deletes: Array<{ graphId: string; wireId: string }> } {
  const creates: RecordedCreate[] = []
  const deletes: Array<{ graphId: string; wireId: string }> = []
  return {
    creates,
    deletes,
    create(graphId: string, params: WireCreateRequest): Promise<{ wireId: string }> {
      creates.push({ graphId, params })
      // The cell honors the caller-minted wire_id; echo it back like LoopbackWireWriter.
      return Promise.resolve({ wireId: params.wireId ?? mintWireId() })
    },
    delete(graphId: string, wireId: string): Promise<void> {
      deletes.push({ graphId, wireId })
      return Promise.resolve()
    },
  }
}

async function advancedWireMenuRoot(mount: HTMLElement): Promise<ShadowRoot> {
  const menu = mount.querySelector('mn-advanced-wire-menu') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(menu).not.toBeNull()
  await menu!.updateComplete
  expect(menu!.shadowRoot).not.toBeNull()
  return menu!.shadowRoot!
}

async function existingWireMenuRoot(mount: HTMLElement): Promise<ShadowRoot> {
  const menu = mount.querySelector('mn-wire-menu-dropdown') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(menu).not.toBeNull()
  await menu!.updateComplete
  expect(menu!.shadowRoot).not.toBeNull()
  return menu!.shadowRoot!
}

async function wikilinkCandidateOptions(mount: HTMLElement): Promise<Element[]> {
  const picker = mount.querySelector('mn-wikilink-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  if (!picker) return []
  await picker.updateComplete
  return Array.from(picker.shadowRoot?.querySelectorAll('[data-wikilink-candidate]') ?? [])
}

async function wikilinkSearchInput(mount: HTMLElement): Promise<HTMLInputElement> {
  const picker = mount.querySelector('mn-wikilink-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(picker).not.toBeNull()
  await picker!.updateComplete
  const input = picker!.shadowRoot?.querySelector('[data-wikilink-search]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  return input!
}

async function wikilinkPredicateOptions(mount: HTMLElement): Promise<Element[]> {
  const picker = mount.querySelector('mn-wikilink-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  if (!picker) return []
  await picker.updateComplete
  return Array.from(picker.shadowRoot?.querySelectorAll('[data-wikilink-predicate]') ?? [])
}

async function wikilinkBlockOptions(mount: HTMLElement): Promise<Element[]> {
  const picker = mount.querySelector('mn-wikilink-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  if (!picker) return []
  await picker.updateComplete
  return Array.from(picker.shadowRoot?.querySelectorAll('[data-wikilink-block]') ?? [])
}

async function tagCandidateOptions(mount: HTMLElement): Promise<Element[]> {
  const popover = mount.querySelector('mn-tag-autocomplete-popover') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  if (!popover) return []
  await popover.updateComplete
  return Array.from(popover.shadowRoot?.querySelectorAll('[data-tag-candidate]') ?? [])
}

function slashCommandOptions(mount: HTMLElement): Element[] {
  return Array.from(mount.querySelectorAll('[data-slash-command]') ?? [])
}

async function citationPickerRoot(): Promise<ShadowRoot> {
  const picker = document.querySelector('mn-citation-picker') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(picker).not.toBeNull()
  await picker!.updateComplete
  expect(picker!.shadowRoot).not.toBeNull()
  return picker!.shadowRoot!
}

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  c.className = 'main'
  document.body.appendChild(c)
  return c
}

const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost | null

/** Flush the host's sync-gated async mount + Lit's update cycle. */
async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

/** Flush the glue's async openPicker (suggest is async). */
async function flushMicrotasks(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

let backends: InProcessCrdtBackend[] = []
function backend(): InProcessCrdtBackend {
  const be = new InProcessCrdtBackend()
  backends.push(be)
  return be
}
const teardowns: Array<() => void> = []
afterEach(() => {
  for (const t of teardowns.splice(0)) t()
  for (const be of backends) be.destroyAll()
  backends = []
  // Clear any dropdown mounts left on the body.
  for (const el of Array.from(document.querySelectorAll('.sh-wikilink-picker-mount'))) el.remove()
  document.body.innerHTML = ''
})

const GRAPH_ID = 'g-tlon'
const DOC_ID = 'd-self' // the open document (the wire's source)

function documentScope(): () => EditorScope {
  return () => ({
    app: undefined,
    centerMode: 'document',
    graphId: GRAPH_ID,
    documentId: DOC_ID,
  })
}

describe('picker glue — the full causal chain through SHIPPED code (no mock on the matter axis)', () => {
  it('owns, hides before first paint, and removes its default overlay mount', () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const getScope = documentScope()
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services: assembleEditorServices(rest, recordingWireWriter(), getScope),
      getScope,
      document,
    })

    const mount = document.querySelector<HTMLElement>('.sh-wikilink-picker-mount')
    expect(mount?.style.left).toBe('-10000px')
    expect(mount?.style.top).toBe('-10000px')

    uninstall()
    expect(document.querySelector('.sh-wikilink-picker-mount')).toBeNull()
  })

  it('kernel CustomEvent → real wikiLinkSearch → candidate → real wire (minted id) + inserted wikilink node', async () => {
    // ── REAL store: seed 4 docs into the named projection graph (GRAPH-less = ZERO). ──
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-arch-notes', title: 'Arch Notes' },
      { id: 'doc-billing', title: 'Billing' },
      { id: 'doc-tlon', title: 'Tlön' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()

    // ── (1) SHIPPED assembleEditorServices + buildKernelOptions. ──
    const services = assembleEditorServices(rest, wire, getScope)
    const kernelOptions = buildKernelOptions(services, getScope())

    // ── (2) SHIPPED mountEditorHost over a REAL in-process ProviderHandle. ──
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: GRAPH_ID, docId: DOC_ID })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: DOC_ID,
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, kernelOptions), container)
    const host = hostEl(container)!
    await settle(host)
    expect(host.liveEditor).not.toBeNull() // the live collab editor over the real Y.Doc

    // ── (3) install the SHIPPED glue on `document`, getEditor=()=>host.liveEditor. ──
    // Seed the search with 'arch' so the candidate set is [Architecture, Arch Notes].
    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => host.liveEditor,
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'arch',
    })
    teardowns.push(uninstall)

    // ── (4) TRIGGER THE REAL CHAIN — the kernel's actual output on Mod-Shift-k. ──
    document.dispatchEvent(new CustomEvent('open-wikilink-picker'))
    await flushMicrotasks()

    // ── (5) the SHIPPED listener ran the REAL wikiLinkSearch over the REAL store. ──
    // The dropdown shows [Architecture, Arch Notes] (fuzzy 'arch'), NOT Billing/Tlön.
    const options = await wikilinkCandidateOptions(mount)
    const labels = options.map((o) => o.textContent?.trim())
    expect(labels).toContain('Architecture')
    expect(labels).toContain('Arch Notes')
    expect(labels).not.toContain('Billing')
    expect(labels).not.toContain('Tlön')
    // The top candidate's doc id parsed back to the bare document id.
    const docIds = options.map((o) => o.getAttribute('data-doc-id'))
    expect(docIds).toContain('doc-architecture')

    // ── (6) drive a real selection — Enter on the rendered dropdown (first candidate). ──
    // (Architecture is the top hit: startsWith('arch') scores higher than 'arch notes'
    //  also startsWith but Architecture is shorter — both start with; order is by score
    //  then stable. We select index 0 explicitly via Enter on the default selection.)
    // Ensure the first candidate is the one we assert on.
    const firstId = docIds[0]
    const firstLabel = labels[0]
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    // The dropdown closed after select.
    expect(await wikilinkCandidateOptions(mount)).toHaveLength(0)

    // (a) the recording WireWriter captured a create — WIRE-FIRST, minted id, correct
    //     source(scope.documentId) / target(the picked doc) / graphId.
    expect(wire.creates.length).toBe(1)
    const rec = wire.creates[0]
    expect(rec.graphId).toBe(GRAPH_ID)
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.targetDocumentId).toBe(firstId)
    const mintedWireId = rec.params.wireId
    expect(typeof mintedWireId).toBe('string')
    expect(mintedWireId).toMatch(/^wire-/)

    // (b) a wikilink node now exists in the LIVE editor carrying targetDocId = the picked
    //     doc + the SAME minted wireId (the wire-first shared-id contract). The wikilink
    //     is an atom inline node (getText is '' for it) — assert against the real getJSON.
    const real = host as unknown as { _editor: { getJSON(): unknown } }
    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"wikilink"')
    expect(json).toContain(firstId!)
    expect(json).toContain(mintedWireId!)
    expect(json).toContain(firstLabel!)
  })

  it('citation picker event → Zotero search → materialize + citesEvidence grounding → inserted citation node', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: GRAPH_ID, docId: DOC_ID })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: DOC_ID,
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, buildKernelOptions(services, getScope())), container)
    const host = hostEl(container)!
    await settle(host)
    const real = host as unknown as {
      _editor: {
        commands: {
          setContent(html: string): boolean
          setTextSelection(range: { from: number; to: number }): boolean
        }
        getJSON(): unknown
      }
    }
    expect(real._editor.commands.setContent('<p data-block-id="block-cite">Claim needing support</p>')).toBe(true)
    expect(real._editor.commands.setTextSelection({ from: 8, to: 8 })).toBe(true)

    const item: CitationPickerItem = {
      key: 'A1',
      title: 'Situated Cognition',
      citation: 'Brown et al. (1989). Situated cognition.',
      itemType: 'journalArticle',
      year: '1989',
      creatorSummary: 'Brown et al.',
    }
    const searched: string[] = []
    const materialized: CitationPickerItem[] = []
    const grounded: CitationGroundingRequest[] = []
    const inserted: LiveCitationAttrs[] = []
    const service = {
      async search(query: string): Promise<readonly CitationPickerItem[]> {
        searched.push(query)
        return query === 'situated' ? [item] : []
      },
      async materialize(pick: CitationPickerItem): Promise<{ artifactId: string }> {
        materialized.push(pick)
        return { artifactId: `zot-${pick.key}` }
      },
      async ground(request: CitationGroundingRequest): Promise<void> {
        grounded.push(request)
      },
    }

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const editorHandle = host.liveEditor!
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        ...editorHandle,
        insertCitation(attrs: LiveCitationAttrs): boolean {
          inserted.push(attrs)
          return editorHandle.insertCitation(attrs)
        },
      }),
      services,
      citation: service,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent(OPEN_CITATION_PICKER_EVENT))
    await flushMicrotasks()
    let root = await citationPickerRoot()
    const input = root.querySelector<HTMLInputElement>('[data-citation-search]')!
    input.value = 'situated'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await flushMicrotasks()
    root = await citationPickerRoot()
    const row = root.querySelector<HTMLButtonElement>('[data-citation-row]')!
    expect(row?.getAttribute('data-citation-key')).toBe('A1')
    row.click()
    await flushMicrotasks()

    expect(searched).toEqual(['situated'])
    expect(materialized).toEqual([item])
    expect(grounded).toEqual([{
      graphId: GRAPH_ID,
      sourceDocumentId: DOC_ID,
      sourceBlockId: 'block-cite',
      targetArtifactId: 'zot-A1',
    }])
    expect(inserted).toEqual([{
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    }])

    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"citation"')
    expect(json).toContain('zot-A1')
    expect(json).toContain('Brown et al. (1989). Situated cognition.')
  })

  it('typed [[ picker event → real wikiLinkSearch → wire-first range replacement', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const insertedAt: Array<{
      range: { from: number; to: number }
      attrs: { targetDocId: string; label: string; targetGraphId?: string | null; wireId?: string | null }
    }> = []
    const insertedAtCursor: unknown[] = []
    const overlayOpenStates: boolean[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: (attrs) => {
          insertedAtCursor.push(attrs)
          return true
        },
        insertWikiLinkAt: (range, attrs) => {
          insertedAt.push({ range, attrs })
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    const detail: OpenWikiLinkPickerDetail = {
      query: 'arch',
      matchedText: '[[arch',
      range: { from: 5, to: 11 },
    }
    document.dispatchEvent(new CustomEvent<OpenWikiLinkPickerDetail>(OPEN_WIKILINK_PICKER_EVENT, { detail }))
    await flushMicrotasks()

    const options = await wikilinkCandidateOptions(mount)
    expect(options.map((o) => o.getAttribute('data-doc-id'))).toEqual(['doc-architecture'])
    expect(overlayOpenStates).toEqual([true])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.targetDocumentId).toBe('doc-architecture')
    expect(insertedAtCursor).toEqual([])
    expect(insertedAt).toEqual([
      {
        range: { from: 5, to: 11 },
        attrs: {
          targetDocId: 'doc-architecture',
          label: 'Architecture',
          targetGraphId: GRAPH_ID,
          wireId: rec.params.wireId,
        },
      },
    ])
    expect(overlayOpenStates).toEqual([true, false])
  })

  it('typed / picker event → runtime slash menu → public live-editor command handle', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const runs: Array<{ range: { from: number; to: number }; commandId: SlashCommandId }> = []
    const overlayOpenStates: boolean[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        runSlashCommandAt: (range, commandId) => {
          runs.push({ range, commandId })
          return Promise.resolve(true)
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    const detail: OpenSlashCommandDetail = {
      query: 'head',
      matchedText: '/head',
      range: { from: 1, to: 6 },
    }
    document.dispatchEvent(new CustomEvent<OpenSlashCommandDetail>(OPEN_SLASH_COMMAND_EVENT, { detail }))
    await flushMicrotasks()

    const options = slashCommandOptions(mount)
    expect(options.map((o) => o.getAttribute('data-command-id'))).toEqual([
      'heading1',
      'heading2',
      'heading3',
    ])
    expect(overlayOpenStates).toEqual([true])

    // Slash, tag, and wikilink observers all inspect the same character. Their
    // honest inactive-close events must not erase the sibling that owns the
    // shared mount.
    document.dispatchEvent(new CustomEvent(CLOSE_TAG_PICKER_EVENT))
    document.dispatchEvent(new CustomEvent(CLOSE_WIKILINK_PICKER_EVENT))
    expect(slashCommandOptions(mount)).toHaveLength(3)
    expect(overlayOpenStates).toEqual([true])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(runs).toEqual([{ range: { from: 1, to: 6 }, commandId: 'heading1' }])
    expect(slashCommandOptions(mount)).toHaveLength(0)
    expect(overlayOpenStates).toEqual([true, false])
  })

  it('slash menu runs the math command (now available via the pure-renderer seam)', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const runs: SlashCommandId[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        runSlashCommandAt: (_range, commandId) => {
          runs.push(commandId)
          return Promise.resolve(true)
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent<OpenSlashCommandDetail>(OPEN_SLASH_COMMAND_EVENT, {
      detail: { query: 'math', matchedText: '/math', range: { from: 1, to: 6 } },
    }))
    await flushMicrotasks()

    const options = slashCommandOptions(mount)
    expect(options).toHaveLength(1)
    expect(options[0].getAttribute('data-command-id')).toBe('math')
    expect((options[0] as HTMLButtonElement).disabled).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(runs).toEqual(['math'])
    expect(slashCommandOptions(mount)).toHaveLength(0)
  })

  it('slash menu dispatches the available queryBlock command', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const runs: SlashCommandId[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        runSlashCommandAt: (_range, commandId) => {
          runs.push(commandId)
          return Promise.resolve(true)
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent<OpenSlashCommandDetail>(OPEN_SLASH_COMMAND_EVENT, {
      detail: { query: 'query', matchedText: '/query', range: { from: 1, to: 7 } },
    }))
    await flushMicrotasks()

    const options = slashCommandOptions(mount)
    expect(options).toHaveLength(1)
    expect(options[0].getAttribute('data-command-id')).toBe('queryBlock')
    expect((options[0] as HTMLButtonElement).disabled).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(runs).toEqual(['queryBlock'])
    expect(slashCommandOptions(mount)).toHaveLength(0)
  })

  it('wikilink picker input → real wikiLinkSearch refresh → refreshed document selection', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const insertedAtCursor: Array<{
      targetDocId: string
      label: string
      targetGraphId?: string | null
      wireId?: string | null
    }> = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: (attrs) => {
          insertedAtCursor.push(attrs)
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'arch',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent(OPEN_WIKILINK_PICKER_EVENT))
    await flushMicrotasks()

    expect((await wikilinkCandidateOptions(mount)).map((o) => o.getAttribute('data-doc-id'))).toEqual([
      'doc-architecture',
    ])

    const input = await wikilinkSearchInput(mount)
    input.value = 'bill'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await flushMicrotasks()

    expect((await wikilinkCandidateOptions(mount)).map((o) => o.getAttribute('data-doc-id'))).toEqual([
      'doc-billing',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(insertedAtCursor).toEqual([
      {
        targetDocId: 'doc-billing',
        label: 'Billing',
        targetGraphId: GRAPH_ID,
        wireId: rec.params.wireId,
      },
    ])
  })

  it('wikilink picker predicate phase → predicate-filtered wire-first wikilink insert', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const insertedAtCursor: Array<{
      targetDocId: string
      label: string
      targetGraphId?: string | null
      wireId?: string | null
    }> = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: (attrs) => {
          insertedAtCursor.push(attrs)
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent(OPEN_WIKILINK_PICKER_EVENT))
    await flushMicrotasks()
    expect((await wikilinkCandidateOptions(mount)).map((o) => o.getAttribute('data-doc-id'))).toEqual([
      'doc-billing',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await flushMicrotasks()
    expect((await wikilinkPredicateOptions(mount)).map((o) => o.getAttribute('data-predicate-uri'))).toContain(
      `${MNEMO_NS}supports`,
    )

    const input = await wikilinkSearchInput(mount)
    input.value = 'sup'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await flushMicrotasks()
    expect((await wikilinkPredicateOptions(mount)).map((o) => o.getAttribute('data-predicate-uri'))).toEqual([
      `${MNEMO_NS}supports`,
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(rec.params.predicate).toBe(`${MNEMO_NS}supports`)
    expect(insertedAtCursor).toEqual([
      {
        targetDocId: 'doc-billing',
        label: 'Billing',
        targetGraphId: GRAPH_ID,
        wireId: rec.params.wireId,
      },
    ])
  })

  it('wikilink picker block phase → block-filtered wire-first wikilink insert', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      {
        id: 'doc-billing',
        title: 'Billing',
        blocks: [
          { id: 'block-title', type: 'heading', level: 2, text: 'Billing model', order: 0 },
          { id: 'block-price', type: 'paragraph', text: 'Pricing plans and invoices', order: 1 },
        ],
      },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const insertedAtCursor: Array<{
      targetDocId: string
      targetBlockId?: string | null
      label: string
      blockPreview?: string | null
      targetGraphId?: string | null
      wireId?: string | null
    }> = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: (attrs) => {
          insertedAtCursor.push(attrs)
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent(OPEN_WIKILINK_PICKER_EVENT))
    await flushMicrotasks()
    expect((await wikilinkCandidateOptions(mount)).map((o) => o.getAttribute('data-doc-id'))).toEqual([
      'doc-billing',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flushMicrotasks()
    expect((await wikilinkBlockOptions(mount)).map((o) => o.getAttribute('data-block-id'))).toEqual([
      'block-title',
      'block-price',
    ])

    const input = await wikilinkSearchInput(mount)
    input.value = 'invoice'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await flushMicrotasks()
    expect((await wikilinkBlockOptions(mount)).map((o) => o.getAttribute('data-block-id'))).toEqual([
      'block-price',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(rec.params.targetBlockId).toBe('block-price')
    expect(insertedAtCursor).toEqual([
      {
        targetDocId: 'doc-billing',
        targetBlockId: 'block-price',
        label: 'Billing',
        blockPreview: 'Pricing plans and invoices',
        targetGraphId: GRAPH_ID,
        wireId: rec.params.wireId,
      },
    ])
  })

  it('honest no-op: with nothing open (home scope) the listener does not search or wire', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: 'doc-architecture', title: 'Architecture' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    // Home scope: no graphId, no documentId.
    const getScope = (): EditorScope => ({
      app: undefined,
      centerMode: 'home',
      graphId: null,
      documentId: null,
    })
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent('open-wikilink-picker'))
    await flushMicrotasks()

    // No dropdown, no search, no wire — honest no-op (nothing to source a wire from).
    expect(await wikilinkCandidateOptions(mount)).toHaveLength(0)
    expect(wire.creates.length).toBe(0)
  })

  it('tag picker event → real tagSearch → candidate → public tag-chip handle insert', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: DOC_ID, title: 'Self', tags: ['Shrubbery'] },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const inserted: Array<{ range: { from: number; to: number }; attrs: LiveTagChipAttrs }> = []
    const overlayOpenStates: boolean[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        insertTagChipAt: (range, attrs) => {
          inserted.push({ range, attrs })
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    const detail: OpenTagPickerDetail = {
      query: 'shr',
      matchedText: '#shr',
      range: { from: 5, to: 9 },
    }
    document.dispatchEvent(new CustomEvent<OpenTagPickerDetail>(OPEN_TAG_PICKER_EVENT, { detail }))
    await flushMicrotasks()

    const options = await tagCandidateOptions(mount)
    expect(options.map((o) => o.getAttribute('data-tag-name'))).toEqual(['shrubbery'])
    expect(overlayOpenStates).toEqual([true])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(await tagCandidateOptions(mount)).toHaveLength(0)
    expect(overlayOpenStates).toEqual([true, false])
    expect(inserted).toEqual([
      {
        range: { from: 5, to: 9 },
        attrs: { name: 'shrubbery', date: null },
      },
    ])
    expect(wire.creates).toEqual([])
  })

  it('tag picker assigns today to scheduled core tags and closes on close-tag-picker', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const inserted: Array<{ range: { from: number; to: number }; attrs: LiveTagChipAttrs }> = []
    const overlayOpenStates: boolean[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        insertTagChipAt: (range, attrs) => {
          inserted.push({ range, attrs })
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent<OpenTagPickerDetail>(OPEN_TAG_PICKER_EVENT, {
        detail: {
          query: 'to',
          matchedText: '#to',
          range: { from: 1, to: 4 },
        },
      }),
    )
    await flushMicrotasks()
    expect(
      (await tagCandidateOptions(mount)).map((o) => o.getAttribute('data-tag-name')),
    ).toEqual(['todo'])
    expect(overlayOpenStates).toEqual([true])

    document.dispatchEvent(new CustomEvent(CLOSE_TAG_PICKER_EVENT))
    expect(await tagCandidateOptions(mount)).toHaveLength(0)
    expect(overlayOpenStates).toEqual([true, false])

    document.dispatchEvent(
      new CustomEvent<OpenTagPickerDetail>(OPEN_TAG_PICKER_EVENT, {
        detail: {
          query: 'to',
          matchedText: '#to',
          range: { from: 1, to: 4 },
        },
      }),
    )
    await flushMicrotasks()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(overlayOpenStates).toEqual([true, false, true, false])
    expect(inserted).toEqual([
      {
        range: { from: 1, to: 4 },
        attrs: { name: 'todo', date: todayKey() },
      },
    ])
    expect(wire.creates).toEqual([])
  })

  it('tag picker Tab inserts literal #name text instead of a chip', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: DOC_ID, title: 'Self', tags: ['Shrubbery'] },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    const insertedChips: Array<{ range: { from: number; to: number }; attrs: LiveTagChipAttrs }> = []
    const insertedText: Array<{ range: { from: number; to: number }; name: string }> = []
    const overlayOpenStates: boolean[] = []

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
        insertTagChipAt: (range, attrs) => {
          insertedChips.push({ range, attrs })
          return true
        },
        insertTagTextAt: (range, name) => {
          insertedText.push({ range, name })
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent<OpenTagPickerDetail>(OPEN_TAG_PICKER_EVENT, {
        detail: {
          query: 'shr',
          matchedText: '#shr',
          range: { from: 5, to: 9 },
        },
      }),
    )
    await flushMicrotasks()

    expect((await tagCandidateOptions(mount)).map((o) => o.getAttribute('data-tag-name'))).toEqual([
      'shrubbery',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await flushMicrotasks()

    expect(await tagCandidateOptions(mount)).toHaveLength(0)
    expect(overlayOpenStates).toEqual([true, false])
    expect(insertedChips).toEqual([])
    expect(insertedText).toEqual([{ range: { from: 5, to: 9 }, name: 'shrubbery' }])
    expect(wire.creates).toEqual([])
  })

  it('candidate Escape closes the picker without leaking to the editor keymap', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: 'doc-architecture', title: 'Architecture' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const overlayOpenStates: boolean[] = []
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => true,
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'arch',
      onOverlayOpenChange: (open) => overlayOpenStates.push(open),
    })
    teardowns.push(uninstall)

    document.dispatchEvent(new CustomEvent('open-wikilink-picker'))
    await flushMicrotasks()
    expect(await wikilinkCandidateOptions(mount)).toHaveLength(1)
    expect(overlayOpenStates).toEqual([true])

    const editorLikeTarget = document.createElement('div')
    document.body.appendChild(editorLikeTarget)
    let leakedKeydowns = 0
    editorLikeTarget.addEventListener('keydown', () => {
      leakedKeydowns += 1
    })

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    expect(editorLikeTarget.dispatchEvent(event)).toBe(false)

    expect(leakedKeydowns).toBe(0)
    expect(await wikilinkCandidateOptions(mount)).toHaveLength(0)
    expect(wire.creates.length).toBe(0)
    expect(overlayOpenStates).toEqual([true, false])
  })

  it('block gutter request → real candidate picker → block-scoped wire create without inserting a wikilink node', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    let inserts = 0

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const created: Array<{
      wireId: string
      sourceDocumentId: string
      sourceBlockId: string
      targetDocumentId: string
    }> = []
    const onCreated: EventListener = (event) => {
      created.push((event as CustomEvent).detail)
    }
    document.addEventListener('mn-wire-created', onCreated)
    teardowns.push(() => document.removeEventListener('mn-wire-created', onCreated))

    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => {
          inserts += 1
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent('mn-block-wire-request', {
        detail: {
          graphId: GRAPH_ID,
          documentId: DOC_ID,
          blockId: 'block-a',
          clientX: 12,
          clientY: 24,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ctrlKey: false,
        },
      }),
    )
    await flushMicrotasks()

    const options = await wikilinkCandidateOptions(mount)
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Billing'])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(inserts).toBe(0)
    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.graphId).toBe(GRAPH_ID)
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.sourceBlockId).toBe('block-a')
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(created).toEqual([
      {
        wireId: rec.params.wireId,
        sourceDocumentId: DOC_ID,
        sourceBlockId: 'block-a',
        targetDocumentId: 'doc-billing',
        predicate: DEFAULT_WIRE_PREDICATE_URI,
        direction: 'forward',
        bidirectional: false,
      },
    ])
  })

  it('document wire request → real candidate picker → document-level wire create without inserting a wikilink node', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)
    let inserts = 0

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const created: Array<Record<string, unknown>> = []
    const onCreated: EventListener = (event) => {
      created.push((event as CustomEvent).detail)
    }
    document.addEventListener('mn-wire-created', onCreated)
    teardowns.push(() => document.removeEventListener('mn-wire-created', onCreated))

    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => ({
        insertWikiLink: () => {
          inserts += 1
          return true
        },
      }),
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent(WIRE_DOCUMENT_REQUEST_EVENT, {
        detail: {
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ctrlKey: false,
        },
      }),
    )
    await flushMicrotasks()

    const options = await wikilinkCandidateOptions(mount)
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Billing'])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(inserts).toBe(0)
    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.graphId).toBe(GRAPH_ID)
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.sourceBlockId).toBeUndefined()
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(rec.params.targetBlockId).toBeUndefined()
    expect(created).toEqual([
      {
        wireId: rec.params.wireId,
        sourceDocumentId: DOC_ID,
        targetDocumentId: 'doc-billing',
        predicate: DEFAULT_WIRE_PREDICATE_URI,
        direction: 'forward',
        bidirectional: false,
      },
    ])
  })

  it('shift block gutter request opens the advanced predicate menu before creating a bidirectional wire', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const created: Array<Record<string, unknown>> = []
    const onCreated: EventListener = (event) => {
      created.push((event as CustomEvent).detail)
    }
    document.addEventListener('mn-wire-created', onCreated)
    teardowns.push(() => document.removeEventListener('mn-wire-created', onCreated))

    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent('mn-block-wire-request', {
        detail: {
          graphId: GRAPH_ID,
          documentId: DOC_ID,
          blockId: 'block-a',
          clientX: 12,
          clientY: 24,
          shiftKey: true,
          altKey: false,
          metaKey: false,
          ctrlKey: false,
        },
      }),
    )
    await flushMicrotasks()

    const menuRoot = await advancedWireMenuRoot(mount)
    expect(menuRoot.querySelector('[data-wire-advanced-menu]')).not.toBeNull()
    expect(await wikilinkCandidateOptions(mount)).toHaveLength(0)

    const supports = `${MNEMO_NS}supports`
    const predicateButton = Array.from(menuRoot.querySelectorAll<HTMLButtonElement>('[data-wire-advanced-predicate]'))
      .find((button) => button.getAttribute('data-predicate-uri') === supports)
    expect(predicateButton).toBeTruthy()
    predicateButton?.click()
    await flushMicrotasks()
    ;(menuRoot.querySelector('[data-wire-advanced-direction="bidirectional"]') as HTMLButtonElement).click()
    await flushMicrotasks()
    ;(menuRoot.querySelector('[data-wire-advanced-confirm]') as HTMLButtonElement).click()
    await flushMicrotasks()

    const options = await wikilinkCandidateOptions(mount)
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Billing'])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe(DOC_ID)
    expect(rec.params.sourceBlockId).toBe('block-a')
    expect(rec.params.targetDocumentId).toBe('doc-billing')
    expect(rec.params.predicate).toBe(supports)
    expect(rec.params.bidirectional).toBe(true)
    expect(created).toEqual([
      {
        wireId: rec.params.wireId,
        sourceDocumentId: DOC_ID,
        sourceBlockId: 'block-a',
        targetDocumentId: 'doc-billing',
        predicate: supports,
        direction: 'bidirectional',
        bidirectional: true,
      },
    ])
  })

  it('advanced reverse direction swaps the write envelope while preserving the local event context', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const created: Array<Record<string, unknown>> = []
    const onCreated: EventListener = (event) => {
      created.push((event as CustomEvent).detail)
    }
    document.addEventListener('mn-wire-created', onCreated)
    teardowns.push(() => document.removeEventListener('mn-wire-created', onCreated))

    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
      initialQuery: 'billing',
    })
    teardowns.push(uninstall)

    document.dispatchEvent(
      new CustomEvent('mn-block-wire-request', {
        detail: {
          graphId: GRAPH_ID,
          documentId: DOC_ID,
          blockId: 'block-a',
          clientX: 12,
          clientY: 24,
          shiftKey: true,
          altKey: false,
          metaKey: false,
          ctrlKey: false,
        },
      }),
    )
    await flushMicrotasks()

    const menuRoot = await advancedWireMenuRoot(mount)
    const qualifies = `${MNEMO_NS}qualifies`
    const predicateButton = Array.from(menuRoot.querySelectorAll<HTMLButtonElement>('[data-wire-advanced-predicate]'))
      .find((button) => button.getAttribute('data-predicate-uri') === qualifies)
    expect(predicateButton).toBeTruthy()
    predicateButton?.click()
    await flushMicrotasks()
    ;(menuRoot.querySelector('[data-wire-advanced-direction="reverse"]') as HTMLButtonElement).click()
    await flushMicrotasks()
    ;(menuRoot.querySelector('[data-wire-advanced-confirm]') as HTMLButtonElement).click()
    await flushMicrotasks()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushMicrotasks()

    expect(wire.creates).toHaveLength(1)
    const rec = wire.creates[0]
    expect(rec.params.sourceDocumentId).toBe('doc-billing')
    expect(rec.params.sourceBlockId).toBeUndefined()
    expect(rec.params.targetDocumentId).toBe(DOC_ID)
    expect(rec.params.targetBlockId).toBe('block-a')
    expect(rec.params.predicate).toBe(qualifies)
    expect(rec.params.bidirectional).toBe(false)
    expect(created).toEqual([
      {
        wireId: rec.params.wireId,
        sourceDocumentId: DOC_ID,
        sourceBlockId: 'block-a',
        targetDocumentId: 'doc-billing',
        predicate: qualifies,
        direction: 'reverse',
        bidirectional: false,
      },
    ])
  })

  it('existing block-wire menu navigates and deletes through real services', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: DOC_ID, title: 'Self' },
      { id: 'doc-billing', title: 'Billing' },
    ])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope, eventNavigationService(document))

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const navs: OpenDocumentDetail[] = []
    const deleted: Array<{ wireId: string }> = []
    const onNavigate: EventListener = (event) => {
      navs.push((event as CustomEvent<OpenDocumentDetail>).detail)
    }
    const onDeleted: EventListener = (event) => {
      deleted.push((event as CustomEvent).detail)
    }
    document.addEventListener(OPEN_DOCUMENT_EVENT, onNavigate)
    document.addEventListener('mn-wire-deleted', onDeleted)
    teardowns.push(() => document.removeEventListener(OPEN_DOCUMENT_EVENT, onNavigate))
    teardowns.push(() => document.removeEventListener('mn-wire-deleted', onDeleted))

    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    const summary: WireSummary = {
      id: 'wire-existing',
      predicate: 'http://mnemosyne.ai/vocab#supports',
      predicateLabel: 'supports',
      otherDocumentId: 'doc-billing',
      otherGraphId: GRAPH_ID,
      otherBlockId: 'block-b',
      localBlockId: 'block-a',
      otherTitle: 'Billing',
      bidirectional: false,
    }
    const detail = {
      graphId: GRAPH_ID,
      documentId: DOC_ID,
      blockId: 'block-a',
      clientX: 12,
      clientY: 24,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      wires: [summary],
    }

    document.dispatchEvent(new CustomEvent('mn-block-wire-menu-request', { detail }))
    await flushMicrotasks()
    let menuRoot = await existingWireMenuRoot(mount)
    expect(menuRoot.querySelector('[data-wire-menu-item]')?.getAttribute('data-wire-id')).toBe('wire-existing')
    ;(menuRoot.querySelector('[data-wire-navigate]') as HTMLButtonElement).click()
    await flushMicrotasks()
    expect(navs).toEqual([{ graphId: GRAPH_ID, documentId: 'doc-billing', blockId: 'block-b' }])

    document.dispatchEvent(new CustomEvent('mn-block-wire-menu-request', { detail }))
    await flushMicrotasks()
    menuRoot = await existingWireMenuRoot(mount)
    ;(menuRoot.querySelector('[data-wire-delete]') as HTMLButtonElement).click()
    await flushMicrotasks()
    expect(wire.deletes).toEqual([{ graphId: GRAPH_ID, wireId: 'wire-existing' }])
    expect(deleted).toEqual([{ wireId: 'wire-existing' }])
  })

  // ── Mod-; keyboard bridge: kernel-event → glue translation → mn-block-wire-request ──
  //
  // The kernel fires `mn-editor-keyboard-wire-request` with only `{ blockId,
  // shiftKey }` (no host state). install-glue fills graphId/documentId from
  // scope and re-dispatches `mn-block-wire-request` so the existing
  // bubble-click handler does all picker / advanced-menu routing. These tests
  // assert ONLY the translation step. The full causal chain (kernel → glue →
  // picker → candidate → wire) is covered by the existing 'block gutter
  // request → real candidate picker' tests above; the bridge here just feeds
  // the same `mn-block-wire-request` shape into those flows.

  it('keyboard Mod-; bridge: kernel event → mn-block-wire-request with scope-filled detail', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    const captured: CustomEvent[] = []
    const listener: EventListener = (event) => {
      captured.push(event as CustomEvent)
    }
    document.addEventListener('mn-block-wire-request', listener)
    teardowns.push(() => document.removeEventListener('mn-block-wire-request', listener))

    document.dispatchEvent(
      new CustomEvent<EditorKeyboardWireRequestDetail>(
        EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
        { detail: { blockId: 'block-source', shiftKey: false } },
      ),
    )
    await flushMicrotasks()

    expect(captured).toHaveLength(1)
    expect(captured[0]!.detail).toEqual({
      graphId: GRAPH_ID,
      documentId: DOC_ID,
      blockId: 'block-source',
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
    })
  })

  it('keyboard Mod-; bridge: honest no-op when scope has no graphId / documentId', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: 'doc-a', title: 'Doc A' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = (): EditorScope => ({
      app: undefined,
      centerMode: 'home',
      graphId: null,
      documentId: null,
    })
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    const captured: CustomEvent[] = []
    const listener: EventListener = (event) => {
      captured.push(event as CustomEvent)
    }
    document.addEventListener('mn-block-wire-request', listener)
    teardowns.push(() => document.removeEventListener('mn-block-wire-request', listener))

    document.dispatchEvent(
      new CustomEvent<EditorKeyboardWireRequestDetail>(
        EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
        { detail: { blockId: 'block-source', shiftKey: false } },
      ),
    )
    await flushMicrotasks()

    // Nothing to source a wire from with no open document — silent no-op.
    expect(captured).toHaveLength(0)
    expect(wire.creates).toHaveLength(0)
  })

  it('keyboard Mod-; bridge: honest no-op when the event detail carries no blockId', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [{ id: DOC_ID, title: 'Self' }])
    const rest = makeOxigraphRestClient(store)
    const wire = recordingWireWriter()
    const getScope = documentScope()
    const services = assembleEditorServices(rest, wire, getScope)

    const mount = document.createElement('div')
    mount.className = 'sh-wikilink-picker-mount'
    document.body.appendChild(mount)
    const uninstall = installWikiLinkPickerGlue({
      getEditor: () => null,
      services,
      getScope,
      document,
      mountInto: mount,
    })
    teardowns.push(uninstall)

    const captured: CustomEvent[] = []
    const listener: EventListener = (event) => {
      captured.push(event as CustomEvent)
    }
    document.addEventListener('mn-block-wire-request', listener)
    teardowns.push(() => document.removeEventListener('mn-block-wire-request', listener))

    document.dispatchEvent(
      new CustomEvent<EditorKeyboardWireRequestDetail>(
        EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
        { detail: { blockId: '', shiftKey: false } },
      ),
    )
    await flushMicrotasks()

    expect(captured).toHaveLength(0)
  })
})
