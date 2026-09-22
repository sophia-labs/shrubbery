/**
 * W14.1 — LOSSLESS CONTENT EXPOSURE ON THE HOSTED PATH (the adversarial
 * review's F10/C6).
 *
 * The claim under test: `<sh-editor-host>`'s public surface can now answer
 * "what does this document actually say?" without flattening it and without
 * anyone casting to `_editor` or re-deriving ProseMirror JSON from the Y.Doc.
 * Two members carry that claim — the pull (`getDocumentJSON()` /
 * `LiveEditorHandle.getJSON()`) and the push (`onDocumentContentChanged`).
 *
 * NO MOCKS, per the house rule. Every editor here is a REAL TipTap editor over
 * a REAL Y.Doc (`InProcessCrdtBackend` = the production contract shape minus
 * the network hop), mounted through the REAL `mountEditorHost` glue. The only
 * private reach is `_editor.commands.insertContent` — the same real command
 * surface a keystroke drives, used because happy-dom has no OS keymap (the
 * existing `sh-editor-host-collab-body.test.ts` establishes this exact idiom
 * and the reason for it).
 *
 * `packages/hoja` is NOT touched by W14.1 and is NOT exercised here: the
 * composer contract is sacred, and this seam is the HOSTED editor path only.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'lit'
import type * as Y from 'yjs'
import { mountEditorHost } from '../mount.js'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostBinding,
  type EditorHostState,
} from '../editor-host-binding.js'
import { createLiveCollabEditor } from '../collab/live-editor.js'
import type { EditorContentChange, LiveDocumentJSON, ShEditorHost } from '../editor-host.js'
import { EDITOR_STRUCTURE_CHANGE_EVENT } from '../editor-host.js'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'

// ── real (non-vi.fn) reactive binding, mirroring the collab-body suite ───────
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

let backends: InProcessCrdtBackend[] = []
function backend(): InProcessCrdtBackend {
  const be = new InProcessCrdtBackend()
  backends.push(be)
  return be
}

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost

/** Flush the host's renderable-gated async mount + Lit's update cycle. */
async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The REAL command surface of the REAL mounted editor (no mock, no stub). */
function commands(h: ShEditorHost): {
  insertContent(value: unknown): boolean
  setTextSelection(pos: number | { from: number; to: number }): boolean
  deleteRange(range: { from: number; to: number }): boolean
  toggleBold(): boolean
  focus(): boolean
} {
  return (h as unknown as { _editor: { commands: ReturnType<typeof commands> } })._editor.commands
}

function rawJSON(h: ShEditorHost): unknown {
  return (h as unknown as { _editor: { getJSON(): unknown } })._editor.getJSON()
}

/** Mount one live host over a real provider and return it, editor already up. */
async function liveHost(
  be: InProcessCrdtBackend,
  room: { kind: 'doc'; graphId: string; docId: string },
): Promise<ShEditorHost> {
  const provider = be.open(room)
  const binding = makeBinding({
    centerMode: 'document',
    graphId: room.graphId,
    documentId: room.docId,
    status: 'ready',
    error: null,
    provider,
  })
  const container = connectedContainer()
  render(mountEditorHost(binding), container)
  const h = hostEl(container)
  await settle(h)
  await waitFor(() => h.liveEditor != null)
  return h
}

/**
 * The projection fixture: the exact hostile shapes W14.1's acceptance names —
 * a fenced block carrying `_`, `*`, `[[` and a blank line. Every one of these
 * is either markdown-significant or wikilink-significant, so a lossy read
 * mangles it; the JSON read must return it byte-for-byte.
 */
const FENCE_TEXT = [
  'circle: 1',
  'note: keep _underscores_ and *stars* and [[not-a-wikilink]]',
  '',
  'trailing: true',
].join('\n')

function codeBlockOf(json: LiveDocumentJSON | null): LiveDocumentJSON | null {
  for (const node of json?.content ?? []) {
    if (node.type === 'codeBlock') return node
  }
  return null
}

afterEach(() => {
  for (const be of backends) be.destroyAll()
  backends = []
  document.body.replaceChildren()
})

describe('W14.1(a) — the document is readable as TipTap JSON', () => {
  it('getDocumentJSON() is null with no live body, and a real doc once the editor mounts', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'd-null' })
    const binding = makeBinding()
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)
    await h.updateComplete

    // Placeholder posture: honest null, not an empty-document lie.
    expect(h.liveEditor).toBeNull()
    expect(h.getDocumentJSON()).toBeNull()

    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'd-null',
      status: 'ready',
      error: null,
      provider,
    })
    await settle(h)
    await waitFor(() => h.liveEditor != null)

    const json = h.getDocumentJSON()
    expect(json).not.toBeNull()
    expect(json!.type).toBe('doc')
  })

  it('the handle accessor and the host accessor both equal the REAL editor.getJSON()', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-identity' })
    commands(h).insertContent('Funes el memorioso')

    expect(h.liveEditor!.getJSON()).toEqual(rawJSON(h))
    expect(h.getDocumentJSON()).toEqual(rawJSON(h))
  })

  it('a fenced block survives byte-exact — the read getText() cannot give you', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-fence' })
    commands(h).insertContent({
      type: 'codeBlock',
      attrs: { language: 'yaml' },
      content: [{ type: 'text', text: FENCE_TEXT }],
    })

    const fence = codeBlockOf(h.getDocumentJSON())
    expect(fence).not.toBeNull()
    expect(fence!.content![0]!.text).toBe(FENCE_TEXT)
    expect(fence!.attrs!.language).toBe('yaml')

    // The pre-existing read is genuinely lossy about the SAME content: the
    // characters come back, but nothing says they were a FENCE rather than
    // prose, and the language attribute is simply unrecoverable — which is
    // precisely what a source projection has to key on.
    const text = h.liveEditor!.getText()
    expect(text).toContain('circle: 1')
    expect(text).not.toContain('yaml')
    expect(text).not.toContain('codeBlock')
  })

  it('marks and wikilink targets survive the JSON read; getText() drops both', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-marks' })
    commands(h).insertContent([
      { type: 'text', marks: [{ type: 'bold' }], text: 'Uqbar' },
      { type: 'text', text: ' — ' },
    ])
    // The public insert path (not a private cast): the picker glue's own route.
    expect(
      h.liveEditor!.insertWikiLink({ targetDocId: 'urn:seele:object/tlon', label: 'Tlön' }),
    ).toBe(true)

    const serialized = JSON.stringify(h.getDocumentJSON())
    expect(serialized).toContain('"bold"')
    expect(serialized).toContain('urn:seele:object/tlon')

    // getText() keeps the label and loses the target — a workbench resolving
    // declared objects off getText() would have to guess the IRI.
    const text = h.liveEditor!.getText()
    expect(text).toContain('Uqbar')
    expect(text).not.toContain('urn:seele:object/tlon')
  })

  it('C6 — a SECOND client on the same room reads the same bytes', async () => {
    const be = backend()
    const room = { kind: 'doc' as const, graphId: 'g', docId: 'd-shared' }
    const a = await liveHost(be, room)
    const b = await liveHost(be, room)
    // Same room ⇒ one Y.Doc, two independent EditorViews.
    expect((a.liveEditor!.getJSON() as unknown) === (b.liveEditor!.getJSON() as unknown)).toBe(false)

    commands(a).insertContent({
      type: 'codeBlock',
      attrs: { language: 'yaml' },
      content: [{ type: 'text', text: FENCE_TEXT }],
    })

    await waitFor(() => codeBlockOf(b.getDocumentJSON()) != null)
    expect(codeBlockOf(b.getDocumentJSON())!.content![0]!.text).toBe(FENCE_TEXT)
    expect(b.getDocumentJSON()).toEqual(a.getDocumentJSON())
  })
})

describe('W14.1(b) — content-change subscription', () => {
  it('subscribing to a quiet editor yields nothing; an edit yields one call carrying the JSON', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-sub' })
    const seen: EditorContentChange[] = []
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 10 })

    // Baseline is the content at subscribe time — silence is correct here.
    await sleep(40)
    expect(seen).toHaveLength(0)

    commands(h).insertContent('Tlön')
    await waitFor(() => seen.length > 0)
    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0]!.json)).toContain('Tlön')
    // The notification carries the document, so a consumer never has to guess
    // whether a later pull is the same document it was told about.
    expect(seen[0]!.json).toEqual(h.getDocumentJSON())

    unsubscribe()
  })

  it('a burst of edits is coalesced into ONE trailing notification with the settled document', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-burst' })
    const seen: EditorContentChange[] = []
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 40 })

    for (const ch of 'orbis tertius') commands(h).insertContent(ch)
    await waitFor(() => seen.length > 0)
    await sleep(80)

    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0]!.json)).toContain('orbis tertius')
    unsubscribe()
  })

  it('a selection-only change fires the structure-change event but NOT a content notification', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-selection' })
    commands(h).insertContent('Herbert Quain')
    await sleep(30)

    const seen: EditorContentChange[] = []
    const structure: string[] = []
    h.addEventListener(EDITOR_STRUCTURE_CHANGE_EVENT, (e) => {
      structure.push((e as CustomEvent<{ reason: string }>).detail.reason)
    })
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 10 })

    commands(h).setTextSelection({ from: 1, to: 4 })
    await sleep(60)

    expect(structure.length).toBeGreaterThan(0) // the trigger really did fire…
    expect(seen).toHaveLength(0) // …and the content channel correctly stayed quiet
    unsubscribe()
  })

  it('an edit that restores the previous bytes produces no notification (content coalescing)', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-idempotent' })
    commands(h).insertContent('Pierre Menard')
    await sleep(30)
    const before = JSON.stringify(h.getDocumentJSON())

    const seen: EditorContentChange[] = []
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 10 })

    // Type a character, then delete exactly it — the document ends byte-identical.
    // Positions: the paragraph opens at 0, so character i occupies [i, i+1).
    commands(h).insertContent('X')
    const length = (h.getDocumentJSON()!.content![0]!.content![0]!.text ?? '').length
    commands(h).deleteRange({ from: length, to: length + 1 })
    await sleep(80)

    expect(JSON.stringify(h.getDocumentJSON())).toBe(before)
    expect(seen).toHaveLength(0)
    unsubscribe()
  })

  it('unsubscribing stops delivery; a second subscriber is unaffected', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-unsub' })
    const first: EditorContentChange[] = []
    const second: EditorContentChange[] = []
    const stopFirst = h.onDocumentContentChanged((c) => first.push(c), { debounceMs: 10 })
    const stopSecond = h.onDocumentContentChanged((c) => second.push(c), { debounceMs: 10 })

    commands(h).insertContent('uno')
    await waitFor(() => first.length > 0 && second.length > 0)

    stopFirst()
    commands(h).insertContent(' dos')
    await waitFor(() => second.length > 1)
    await sleep(40)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    stopSecond()
  })

  it('a REMOTE edit (a second editor on the same Y.Doc) notifies too', async () => {
    const be = backend()
    const room = { kind: 'doc' as const, graphId: 'g', docId: 'd-remote' }
    const h = await liveHost(be, room)
    const peerProvider = be.open(room)
    const peerEl = document.createElement('div')
    document.body.append(peerEl)
    const peer = createLiveCollabEditor({ element: peerEl, doc: peerProvider.doc as Y.Doc })

    const seen: EditorContentChange[] = []
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 10 })
    try {
      peer.commands.insertContent('la biblioteca de Babel')
      await waitFor(() => seen.length > 0)
      expect(JSON.stringify(seen[0]!.json)).toContain('la biblioteca de Babel')
    } finally {
      unsubscribe()
      peer.destroy()
    }
  })

  it('a throwing subscriber does not stop the others, and delivery continues afterwards', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-throwing' })
    const good: EditorContentChange[] = []
    const stopBad = h.onDocumentContentChanged(() => {
      throw new Error('subscriber blew up')
    }, { debounceMs: 10 })
    const stopGood = h.onDocumentContentChanged((c) => good.push(c), { debounceMs: 10 })

    commands(h).insertContent('el jardín')
    await waitFor(() => good.length > 0)
    commands(h).insertContent(' de senderos')
    await waitFor(() => good.length > 1)

    expect(good).toHaveLength(2)
    expect(h.getDocumentJSON()).not.toBeNull() // the editor itself is unharmed
    stopBad()
    stopGood()
  })

  it('nothing fires at a subscriber after the host is detached from the DOM', async () => {
    const h = await liveHost(backend(), { kind: 'doc', graphId: 'g', docId: 'd-detach' })
    const seen: EditorContentChange[] = []
    const unsubscribe = h.onDocumentContentChanged((c) => seen.push(c), { debounceMs: 30 })

    // Edit, then rip the host out before its window elapses — a relocation or
    // a pane close must not deliver into a dead pane.
    commands(h).insertContent('Averroes')
    h.remove()
    await sleep(90)

    expect(seen).toHaveLength(0)
    unsubscribe()
  })
})
