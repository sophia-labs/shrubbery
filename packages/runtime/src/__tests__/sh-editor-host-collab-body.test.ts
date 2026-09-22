/**
 * Rung-3 test — the LIVE collaborative editor body-lift, NO MOCKS.
 *
 * This proves the load-bearing claim of rung-3: when the EditorHostBinding carries
 * an open CRDT room (a contract.crdt ProviderHandle over a REAL Y.Doc), the host
 * graduates from the honest placeholder to a REAL collaborative TipTap Editor —
 * and the HISTORY-OWNERSHIP HANDOFF is correct (the kernel dropped its own undo;
 * one room-level UndoManager owns the recording stack across every attachment).
 *
 * NO MOCKS (Vera's standing rule):
 *   - the CrdtBackend is a REAL in-process one binding a REAL `new Y.Doc()` (the
 *     CRDT plane minus the network — the legitimate real-infra iteration);
 *   - the EditorHostBinding is a REAL reactive object (get/subscribe/set);
 *   - the Editor is a REAL TipTap Editor with the REAL pure kernel roster +
 *     REAL @tiptap/extension-collaboration;
 *   - every assertion is against real getJSON / getText / the real Y.XmlFragment.
 *
 * HAPPY-DOM SPLIT: content + CRDT-sync run fully here (Y.Doc is pure JS; a real
 * Editor mounts + accepts programmatic edits at 0 layout). DEFERRED to a Playwright
 * rung (storybook test-storybook is wired): pixel positioning (getBoundingClientRect
 * → 0) and OS-keymap shortcuts (Mod-z). We prove undo at the COMMAND level here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from 'lit'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { mountEditorHost } from '../mount.js'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostState,
  type EditorHostBinding,
} from '../editor-host-binding.js'
import {
  createLiveCollabEditor,
  COLLAB_FIELD,
  ensureCollaborationRangeFactory,
} from '../collab/live-editor.js'
import type { EditorDocumentAccess, ShEditorHost } from '../editor-host.js'
import { SALIENCE_RATE_REQUEST_EVENT, type SalienceRateRequestDetail } from '../editor-host.js'
import type { BlockScore } from '@shrubbery/nucleus'
import {
  EDITOR_HEADING_IN_VIEW_EVENT,
  OPEN_DOCUMENT_EVENT,
  WIRE_HIGHLIGHT_BLOCK_EVENT,
  WIRE_PIN_WIRE_REQUEST_EVENT,
  WIRE_RADIAL_CONTEXT_REQUEST_EVENT,
  type OpenDocumentDetail,
  type WirePinWireRequestDetail,
  type WireRadialContextRequestDetail,
} from '../index.js'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'
import '../../../components/src/mn-editor-toolbar.js'
import '../../../components/src/mn-wire-radial-overlay.js'

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

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost | null
const proseMirror = (h: ShEditorHost | null) =>
  h?.shadowRoot?.querySelector('.ProseMirror') as HTMLElement | null
const visibleBreadcrumb = (h: ShEditorHost | null) =>
  h?.shadowRoot?.querySelector('.zoom-breadcrumb:not([hidden])') as HTMLElement | null

/** Flush the host's renderable-gated async mount + Lit's update cycle. */
async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  // The host mounts the editor in a whenRenderable.then() microtask; let it run, then
  // re-settle so the mounted body is queryable.
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

async function until(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

let backends: InProcessCrdtBackend[] = []
function backend(): InProcessCrdtBackend {
  const be = new InProcessCrdtBackend()
  backends.push(be)
  return be
}

const OUTLINE_SEED =
  '<p data-block-id="block-a">A</p>' +
  '<p data-block-id="block-b" data-indent="1">B</p>' +
  '<p data-block-id="block-c">C</p>'

const HEADING_SEED =
  '<h1 data-block-id="block-h1">Intro</h1>' +
  '<p data-block-id="block-p1" data-indent="1">child of intro</p>' +
  '<h2 data-block-id="block-h2">Details</h2>'

afterEach(() => {
  for (const be of backends) be.destroyAll()
  backends = []
  document.body.replaceChildren()
})

describe('rung-3 — the live collaborative editor body lifts over a real Y.Doc', () => {
  it('installs the y-tiptap Range factory on one shadow root idempotently', () => {
    const shell = document.createElement('div')
    document.body.append(shell)
    const root = shell.attachShadow({ mode: 'open' })
    const mount = document.createElement('div')
    root.append(mount)

    ensureCollaborationRangeFactory(mount)
    const rangeRoot = root as ShadowRoot & { createRange?: () => Range }
    expect(typeof rangeRoot.createRange).toBe('function')
    const installed = rangeRoot.createRange
    expect(installed?.()).toBeInstanceOf(Range)

    ensureCollaborationRangeFactory(mount)
    expect(rangeRoot.createRange).toBe(installed)
  })

  it('placeholder → live ProseMirror body when the binding carries an open provider', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g-tlon', docId: 'd-uqbar' })
    const binding = makeBinding()
    const container = connectedContainer()

    // Render the keyed host (the same mount glue the workspace uses).
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await h.updateComplete

    // PRE-MOUNT: no provider → honest placeholder, no live body.
    expect(h.shadowRoot?.querySelector('.placeholder')).not.toBeNull()
    expect(proseMirror(h)).toBeNull()
    expect(h.liveEditor).toBeNull()

    // Open a document with a real provider → the body must lift.
    binding.set({
      centerMode: 'document',
      graphId: 'g-tlon',
      documentId: 'd-uqbar',
      status: 'ready',
      error: null,
      provider,
    })
    await settle(h)

    // LIVE: a REAL ProseMirror editor mounted into the shadow mount target.
    expect(h.shadowRoot?.querySelector('.placeholder')).toBeNull()
    expect(h.shadowRoot?.querySelector('[data-mode="live"]')).not.toBeNull()
    expect(proseMirror(h)).not.toBeNull()
    expect(h.liveEditor).not.toBeNull()
  })

  it('a programmatic edit lands in the editor AND propagates into the Y.XmlFragment "content"', async () => {
    const be = backend()
    const room = { kind: 'doc', graphId: 'g', docId: 'd' } as const
    const provider = be.open(room)
    const yDoc = provider.doc as Y.Doc
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'd',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const editor = h.liveEditor!
    expect(editor).not.toBeNull()
    expect(editor.getText()).not.toContain('Funes')

    // Type into the LIVE editor (programmatic command — the same path Playwright
    // keystrokes would drive, but environment-independent). The host's structural
    // handle is read-only by design; reach the real TipTap command surface via the
    // private _editor field (it IS the same real editor — no mock).
    const real = h as unknown as {
      _editor: { commands: { insertContent(s: string): boolean } }
    }
    real._editor.commands.insertContent('Funes el memorioso')

    // 1) the edit is in the editor's own doc...
    expect(editor.getText()).toContain('Funes el memorioso')

    // 2) ...AND it propagated into the shared CRDT document's 'content' fragment.
    // Collaboration writes the ProseMirror doc into the Y.XmlFragment named
    // 'content' — the SAME field garden uses. Read it back from the raw Y.Doc.
    const fragment = yDoc.getXmlFragment(COLLAB_FIELD)
    expect(fragment.toString()).toContain('Funes el memorioso')
  })

  it('two editors sharing ONE Y.Doc CONVERGE (the multi-editor proof, no relay)', async () => {
    const be = backend()
    const room = { kind: 'doc', graphId: 'g', docId: 'shared' } as const
    // Two opens of the SAME room → the SAME Y.Doc (true multi-editor).
    const hA = be.open(room)
    const hB = be.open(room)
    expect(hA.doc).toBe(hB.doc) // same underlying document

    // Build two REAL collab editors directly on the two handles' shared doc.
    const elA = document.createElement('div')
    const elB = document.createElement('div')
    document.body.append(elA, elB)
    const eA = createLiveCollabEditor({ element: elA, doc: hA.doc })
    const eB = createLiveCollabEditor({ element: elB, doc: hB.doc })

    try {
      // Edit A → B converges (one shared Y.Doc, no manual relay needed).
      eA.commands.insertContent('Tlön')
      expect(eA.getText()).toContain('Tlön')
      expect(eB.getText()).toContain('Tlön')

      // And the reverse direction: edit B → A converges.
      eB.commands.focus('end')
      eB.commands.insertContent(' Orbis')
      expect(eB.getText()).toContain('Orbis')
      expect(eA.getText()).toContain('Orbis')
    } finally {
      eA.destroy()
      eB.destroy()
    }
  })

  it('ROOM-OWNED HISTORY: alternating panes share one linear undo/redo stack without losing a branch', async () => {
    const doc = new Y.Doc()
    const elA = document.createElement('div')
    const elB = document.createElement('div')
    document.body.append(elA, elB)
    const eA = createLiveCollabEditor({ element: elA, doc })
    const eB = createLiveCollabEditor({ element: elB, doc })

    try {
      eA.commands.insertContent('alpha')
      expect(eA.getText()).toBe('alpha')
      expect(eB.getText()).toBe('alpha')

      // Yjs deliberately coalesces continuous typing for 500 ms. Cross that
      // normal capture boundary so these are two user-visible history steps.
      await new Promise((resolve) => setTimeout(resolve, 550))
      eB.commands.focus('end')
      eB.commands.insertContent(' beta')
      expect(eA.getText()).toBe('alpha beta')
      expect(eB.getText()).toBe('alpha beta')

      // Alternate the command source on every step. With TipTap's former
      // per-view managers, the third/fourth assertions lost ` beta`.
      expect(eA.commands.undo()).toBe(true)
      expect(eA.getText()).toBe('alpha')
      expect(eB.getText()).toBe('alpha')

      expect(eB.commands.undo()).toBe(true)
      expect(eA.getText()).toBe('')
      expect(eB.getText()).toBe('')

      expect(eA.commands.redo()).toBe(true)
      expect(eA.getText()).toBe('alpha')
      expect(eB.getText()).toBe('alpha')

      expect(eB.commands.redo()).toBe(true)
      expect(eA.getText()).toBe('alpha beta')
      expect(eB.getText()).toBe('alpha beta')

      // One attachment may leave without destroying history for the survivor.
      eA.destroy()
      eB.commands.focus('end')
      eB.commands.insertContent('!')
      expect(eB.getText()).toBe('alpha beta!')
      expect(eB.commands.undo()).toBe(true)
      expect(eB.getText()).toBe('alpha beta')
    } finally {
      eA.destroy()
      eB.destroy()
    }

    // The last attachment is the lifecycle boundary. Reusing the same Y.Doc
    // starts a clean history while preserving the document's current content.
    const elC = document.createElement('div')
    document.body.append(elC)
    const eC = createLiveCollabEditor({ element: elC, doc })
    try {
      expect(eC.getText()).toBe('alpha beta')
      expect(eC.commands.undo()).toBe(false)
    } finally {
      eC.destroy()
      doc.destroy()
    }
  })

  it('ROOM-OWNED HISTORY: different Y.Docs remain independent', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const elA = document.createElement('div')
    const elB = document.createElement('div')
    document.body.append(elA, elB)
    const eA = createLiveCollabEditor({ element: elA, doc: docA })
    const eB = createLiveCollabEditor({ element: elB, doc: docB })

    try {
      eA.commands.insertContent('room A')
      eB.commands.insertContent('room B')
      expect(eA.commands.undo()).toBe(true)
      expect(eA.getText()).toBe('')
      expect(eB.getText()).toBe('room B')
      expect(eB.commands.undo()).toBe(true)
      expect(eB.getText()).toBe('')
    } finally {
      eA.destroy()
      eB.destroy()
      docA.destroy()
      docB.destroy()
    }
  })

  it('renders a remote collaborator cursor from the provider awareness channel', async () => {
    const doc = new Y.Doc()
    const localAwareness = new Awareness(doc)
    const remoteAwareness = new Awareness(new Y.Doc())
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const editor = createLiveCollabEditor({ element: mount, doc, awareness: localAwareness })

    try {
      editor.commands.setContent('<p>Shared Garden document</p>')
      const fragment = doc.getXmlFragment(COLLAB_FIELD)
      const anchor = Y.createRelativePositionFromTypeIndex(fragment, 0)
      remoteAwareness.setLocalState({
        user: {
          userId: 'vera',
          name: 'Remote Vera',
          color: '#2563eb',
          type: 'human',
          clientId: 'vera-tab-b',
          deviceId: 'vera-device',
        },
        cursor: { anchor, head: anchor },
      })
      applyAwarenessUpdate(
        localAwareness,
        encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID]),
        'test-relay',
      )

      await until(() => mount.querySelector('.ProseMirror-yjs-cursor') !== null)
      const cursor = mount.querySelector('.ProseMirror-yjs-cursor') as HTMLElement
      expect(cursor).not.toBeNull()
      expect(cursor.style.borderColor).toBe('#2563eb')
      expect(cursor.getAttribute('contenteditable')).toBe('false')
      expect(cursor.dataset.presenceClientId).toBe('vera-tab-b')
      expect(cursor.dataset.presenceHumanId).toBe('vera')
      expect(cursor.dataset.presenceType).toBe('human')
      expect(cursor.querySelector('div')?.textContent).toBe('Remote Vera')
      expect(cursor.querySelector('div')?.getAttribute('contenteditable')).toBe('false')
    } finally {
      editor.destroy()
      localAwareness.destroy()
      remoteAwareness.destroy()
      doc.destroy()
    }
  })

  it('ignores an invalid opaque awareness adapter without breaking the live editor', () => {
    const doc = new Y.Doc()
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    const editor = createLiveCollabEditor({ element: mount, doc, awareness: {} })

    try {
      editor.commands.insertContent('Operational protocols are validated')
      expect(editor.getText()).toContain('Operational protocols are validated')
    } finally {
      editor.destroy()
      doc.destroy()
    }
  })

  it('HISTORY RECORDED EXACTLY ONCE: undo flows through the room authority, not StarterKit', () => {
    // The handoff proof. The collaborative roster drops kernel history; the
    // room-history extension routes every view to one recording Yjs manager.
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'undo' })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = createLiveCollabEditor({ element: el, doc: provider.doc })

    try {
      editor.commands.insertContent('El Aleph')
      const afterEdit = editor.getText()
      expect(afterEdit).toContain('El Aleph')

      // EXACTLY-ONCE: StarterKit history is absent, and the room authority is
      // present after Collaboration so its commands replace the view-local ones.
      const names = editor.extensionManager.extensions.map((e) => e.name)
      expect(names).not.toContain('undoRedo') // kernel history dropped
      expect(names).toContain('collaboration') // sync + mapping machinery
      expect(names).toContain('shrubberyRoomHistory') // recording authority

      // The room undo command exists and reverts the real edit (one apply).
      expect(typeof editor.commands.undo).toBe('function')
      const undid = editor.commands.undo()
      expect(undid).toBe(true)
      expect(editor.getText()).not.toBe(afterEdit) // state actually moved back, once
    } finally {
      editor.destroy()
    }
  })

  it('SECOND-ORDER MOUNT-ONCE: a live editor SURVIVES a branch switch that keeps the SAME provider (EditorView + undo history both survive)', async () => {
    // The rung's actual load-bearing claim (openFork #3 / the critique's gap):
    // mount-once must hold for a LIVE editor, not just the placeholder DOM node.
    // The branch-switch test proves host-ELEMENT identity over provider:null
    // (placeholder) states; THIS proves the live EditorView (and therefore its
    // UndoManager + full undo history) survives a default→choreograph→default
    // style re-render as long as the SHELL hands back the SAME ProviderHandle and
    // keeps centerMode='document'. The host no-ops _reconcileEditor when
    // this._editorProvider === provider, so the same Editor instance is kept.
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'survive' })
    // A stable document-center state carrying THE SAME provider object every time.
    const docState = (): EditorHostState => ({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'survive',
      status: 'ready',
      error: null,
      provider, // <-- IDENTICAL reference across all sets (the survival anchor)
    })
    const binding = makeBinding(docState())
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const editor0 = h.liveEditor
    expect(editor0).not.toBeNull()

    // Type a real edit into the LIVE editor (the pre-switch edit we want to undo).
    const real = h as unknown as {
      _editor: { commands: { insertContent(s: string): boolean } }
    }
    real._editor.commands.insertContent('pre-switch edit')
    expect(editor0!.getText()).toContain('pre-switch edit')

    // Re-render the host THROUGH a sequence of binding emissions that keep the
    // SAME provider + document center (this is what a shell does when an app/branch
    // switch keeps the editor open: it re-emits an equal-but-fresh state object whose
    // `provider` reference is preserved). Drive several emissions to exercise the
    // reconcile no-op path repeatedly.
    binding.set(docState())
    await settle(h)
    binding.set(docState())
    await settle(h)
    binding.set(docState())
    await settle(h)

    // (a) the live editor is the SAME instance across the whole sequence — the
    //     EditorView (and its room-history lease) was never destroyed/rebuilt.
    const editor1 = h.liveEditor
    expect(editor1).toBe(editor0)

    // (b) undo still reverts the PRE-SWITCH edit — proving room history survived
    //     the re-renders, not just the DOM node. The kernel's own history is absent.
    const undid = (h as unknown as { _editor: { commands: { undo(): boolean } } })._editor.commands.undo()
    expect(undid).toBe(true)
    expect(h.liveEditor!.getText()).not.toContain('pre-switch edit')
  })

  it('SHELL CONTRACT (negative guard): undo survival REQUIRES the shell to hold provider non-null + centerMode=document — flipping either tears the live editor down', async () => {
    // Pins the fragile two-conjunct shell contract as a TESTED boundary rather than
    // an unstated assumption: if the shell drops the provider (provider:null) OR
    // switches to a non-document center while the editor is open, the host tears the
    // live editor down (and its undo history is GONE). This documents — executably —
    // exactly what the shell must preserve for undo to survive a branch switch.
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'contract' })
    const docState: EditorHostState = {
      centerMode: 'document',
      graphId: 'g',
      documentId: 'contract',
      status: 'ready',
      error: null,
      provider,
    }
    const binding = makeBinding(docState)
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    expect(h.liveEditor).not.toBeNull()

    // CONJUNCT 1 — switching to a NON-document center (provider still non-null) tears down.
    binding.set({ ...docState, centerMode: 'artifact' })
    await h.updateComplete
    expect(h.liveEditor).toBeNull()
    expect(h.shadowRoot?.querySelector('.placeholder')).not.toBeNull()

    // Re-open to prove the converse conjunct independently.
    binding.set(docState)
    await settle(h)
    expect(h.liveEditor).not.toBeNull()

    // CONJUNCT 2 — dropping the provider (centerMode still 'document') tears down.
    binding.set({ ...docState, provider: null })
    await h.updateComplete
    expect(h.liveEditor).toBeNull()
    expect(h.shadowRoot?.querySelector('.placeholder')).not.toBeNull()
  })

  it('L1 — the public liveEditor handle inserts a real WikiLink node (insertWikiLink → real kernel command)', async () => {
    // The L1 widening: the SHIPPED public LiveEditorHandle exposes insertWikiLink, a thin
    // pass-through to the real kernel `commands.insertWikiLink`. The picker glue inserts
    // through THIS surface, not a private cast. No mock — a real kernel command over a
    // real collaborative editor on a real Y.Doc.
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'wiki' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'wiki',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const handle = h.liveEditor
    expect(handle).not.toBeNull()
    expect(typeof handle!.insertWikiLink).toBe('function')
    expect(typeof handle!.insertWikiLinkAt).toBe('function')

    // Insert through the PUBLIC handle (not _editor).
    const applied = handle!.insertWikiLink({
      targetDocId: 'doc-architecture',
      label: 'Architecture',
      targetGraphId: 'g',
      wireId: 'wire-xyz',
    })
    expect(applied).toBe(true)

    // The wikilink is an atom inline node (no leaf-text serializer), so getText() is ''
    // for it — assert against getJSON (the real ProseMirror doc) instead. Reach the raw
    // editor through the existing `_editor` cast pattern.
    const real = h as unknown as { _editor: { getJSON(): unknown } }
    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"wikilink"')
    expect(json).toContain('doc-architecture')
    expect(json).toContain('wire-xyz')
    expect(json).toContain('Architecture')
  })

  it('L1 — the public liveEditor handle inserts citation chips and Zotero promotions', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'citation' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'citation',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const handle = h.liveEditor
    expect(handle).not.toBeNull()
    expect(typeof handle!.insertCitation).toBe('function')
    expect(typeof handle!.insertZoteroPromotion).toBe('function')

    expect(handle!.insertCitation({
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })).toBe(true)

    const promotion = handle!.insertZoteroPromotion({
      text: 'Knowledge is situated.',
      comment: 'Core claim',
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })
    expect(promotion.applied).toBe(true)
    expect(typeof promotion.blockId === 'string' || promotion.blockId === null).toBe(true)

    const real = h as unknown as { _editor: { getJSON(): unknown } }
    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"citation"')
    expect(json).toContain('zot-A1')
    expect(json).toContain('Knowledge is situated.')
    expect(json).toContain('Core claim')
  })

  it('L1 — the public liveEditor handle replaces typed [[query text with a real WikiLink node', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'wiki-range' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'wiki-range',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: {
        commands: { setContent(html: string): boolean }
        getJSON(): unknown
      }
    }
    expect(real._editor.commands.setContent('<p>See [[arch</p>')).toBe(true)

    const applied = h.liveEditor!.insertWikiLinkAt(
      { from: 5, to: 11 },
      {
        targetDocId: 'doc-architecture',
        label: 'Architecture',
        targetGraphId: 'g',
        wireId: 'wire-typed',
      },
    )
    expect(applied).toBe(true)

    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"wikilink"')
    expect(json).toContain('doc-architecture')
    expect(json).toContain('wire-typed')
    expect(json).toContain('Architecture')
    expect(json).not.toContain('[[arch')
  })

  it('L1 — the public liveEditor handle replaces tag trigger text with a real TagChip node', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'tag' })
    const scheduled: Array<{ tag: string; absoluteDate: string; sourceBlockId: string; sourceContent: string }> = []
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'tag',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(
      mountEditorHost(binding, {
        onScheduledTag: (detail) => scheduled.push(detail),
      }),
      container,
    )
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: {
        commands: { setContent(html: string): boolean }
        getJSON(): unknown
      }
    }
    expect(real._editor.commands.setContent('<p data-block-id="block-a">Meet #todo</p>')).toBe(true)

    const handle = h.liveEditor
    expect(handle).not.toBeNull()
    expect(typeof handle!.insertTagChipAt).toBe('function')
    expect(typeof handle!.insertTagTextAt).toBe('function')

    const applied = handle!.insertTagChipAt(
      { from: 6, to: 11 },
      { name: 'todo', date: '2026-06-23' },
    )
    expect(applied).toBe(true)

    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"tagChip"')
    expect(json).toContain('"name":"todo"')
    expect(json).toContain('"date":"2026-06-23"')
    expect(json).not.toContain('#todo')
    expect(scheduled).toEqual([
      {
        tag: 'todo',
        absoluteDate: '2026-06-23',
        sourceBlockId: 'block-a',
        sourceContent: 'Meet',
      },
    ])
  })

  it('L1 — the public liveEditor handle can commit tag suggestions as literal text for Tab', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'tag-text' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'tag-text',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: {
        commands: { setContent(html: string): boolean }
        getJSON(): unknown
      }
    }
    expect(real._editor.commands.setContent('<p>#to</p>')).toBe(true)

    const applied = h.liveEditor!.insertTagTextAt({ from: 1, to: 4 }, 'todo')
    expect(applied).toBe(true)

    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('#todo')
    expect(json).not.toContain('"type":"tagChip"')
  })

  it('L1 — dated non-core tag-chip commits do not fire scheduled-tag side effects', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'tag-custom-date' })
    const scheduled: Array<{ tag: string; absoluteDate: string; sourceBlockId: string; sourceContent: string }> = []
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'tag-custom-date',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(
      mountEditorHost(binding, {
        onScheduledTag: (detail) => scheduled.push(detail),
      }),
      container,
    )
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: {
        commands: { setContent(html: string): boolean }
        getJSON(): unknown
      }
    }
    expect(real._editor.commands.setContent('<p data-block-id="block-a">Meet #note</p>')).toBe(true)

    const applied = h.liveEditor!.insertTagChipAt(
      { from: 6, to: 11 },
      { name: 'note', date: '2026-06-23' },
    )
    expect(applied).toBe(true)

    const json = JSON.stringify(real._editor.getJSON())
    expect(json).toContain('"type":"tagChip"')
    expect(json).toContain('"name":"note"')
    expect(json).toContain('"date":"2026-06-23"')
    expect(scheduled).toEqual([])
  })

  it('L2 — the public liveEditor handle drives outliner zoom and the host renders breadcrumb state', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'zoom' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'zoom',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as { _editor: { commands: { setContent(html: string): boolean } } }
    expect(real._editor.commands.setContent(OUTLINE_SEED)).toBe(true)

    const events: Array<{ blockId: string | null }> = []
    h.addEventListener('mn-zoom-change', ((event: CustomEvent<{ blockId: string | null }>) => {
      events.push(event.detail)
    }) as EventListener)

    expect(h.liveEditor?.zoomIntoBlock('block-a')).toBe(true)
    await settle(h)

    const snapshot = h.liveEditor?.getZoomSnapshot()
    expect(snapshot?.blockId).toBe('block-a')
    expect(snapshot?.breadcrumb.map((crumb) => crumb.text)).toEqual(['Home', 'A'])
    expect(events[events.length - 1]?.blockId).toBe('block-a')
    await until(() => visibleBreadcrumb(h) !== null)
    const breadcrumb = visibleBreadcrumb(h)
    expect(breadcrumb?.textContent).toContain('Home')
    expect(breadcrumb?.textContent).toContain('A')

    expect(h.liveEditor?.zoomOut()).toBe(true)
    await settle(h)

    expect(h.liveEditor?.getZoomSnapshot().blockId).toBeNull()
    expect(events[events.length - 1]?.blockId).toBeNull()
    expect(visibleBreadcrumb(h)).toBeNull()
  })

  it('L2 — the public liveEditor handle exposes headings, scroll-position highlighting, and outliner commands', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'headings' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'headings',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: { commands: { setContent(html: string): boolean; focus(): boolean } }
    }
    expect(real._editor.commands.setContent(HEADING_SEED)).toBe(true)
    await settle(h)

    expect(h.liveEditor?.getHeadings()).toEqual([
      { id: 'block-h1', level: 1, text: 'Intro' },
      { id: 'block-h2', level: 2, text: 'Details' },
    ])

    // runOutlinerCommand reaches the same real editor.commands.* the removed
    // toolbar buttons used to drive — focus a block with a child, then collapse it.
    expect(h.liveEditor?.focusBlock('block-h1')).toBe(true)
    h.liveEditor?.runOutlinerCommand('toggleCollapse')
    await settle(h)
    let collapsed = false
    ;(real._editor as unknown as { state: { doc: { descendants(cb: (node: { attrs: Record<string, unknown> }) => void): void } } })
      .state.doc.descendants((node) => {
        if (node.attrs['data-block-id'] === 'block-h1') collapsed = !!node.attrs.collapsed
      })
    expect(collapsed).toBe(true)

    // Scroll-position highlighting: no headings intersecting yet.
    expect(h.liveEditor?.getCurrentHeadingId()).toBeNull()

    const events: Array<{ blockId: string | null }> = []
    h.addEventListener(EDITOR_HEADING_IN_VIEW_EVENT, ((event: CustomEvent<{ blockId: string | null }>) => {
      events.push(event.detail)
    }) as EventListener)

    const h1El = h.liveEditor?.getBlockElement('block-h1')
    const h2El = h.liveEditor?.getBlockElement('block-h2')
    expect(h1El).not.toBeNull()
    expect(h2El).not.toBeNull()

    const hostWithObserver = h as unknown as {
      _onHeadingIntersection(entries: IntersectionObserverEntry[]): void
    }
    hostWithObserver._onHeadingIntersection([
      { target: h1El, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ])
    expect(h.liveEditor?.getCurrentHeadingId()).toBe('block-h1')
    expect(events.at(-1)?.blockId).toBe('block-h1')

    // The LAST intersecting heading in document order wins when more than one
    // is simultaneously in the shrunk top band.
    hostWithObserver._onHeadingIntersection([
      { target: h2El, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ])
    expect(h.liveEditor?.getCurrentHeadingId()).toBe('block-h2')
    expect(events.at(-1)?.blockId).toBe('block-h2')

    hostWithObserver._onHeadingIntersection([
      { target: h2El, isIntersecting: false } as unknown as IntersectionObserverEntry,
    ])
    expect(h.liveEditor?.getCurrentHeadingId()).toBe('block-h1')
    expect(events.at(-1)?.blockId).toBe('block-h1')

    // Scrolling past the LAST heading (nothing intersecting the tracking band
    // anymore) keeps the last-known heading highlighted rather than dropping
    // to null — a bare "nothing currently intersects" reading must not be
    // confused with "no heading has been reached yet."
    hostWithObserver._onHeadingIntersection([
      { target: h1El, isIntersecting: true } as unknown as IntersectionObserverEntry,
    ])
    expect(h.liveEditor?.getCurrentHeadingId()).toBe('block-h1')
    hostWithObserver._onHeadingIntersection([
      { target: h1El, isIntersecting: false } as unknown as IntersectionObserverEntry,
    ])
    expect(h.liveEditor?.getCurrentHeadingId()).toBe('block-h1')
    expect(events.at(-1)?.blockId).toBe('block-h1')
  })

  it('restores an initial outliner zoom block id supplied by the shell', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'zoom-url' })

    const seedElement = document.createElement('div')
    document.body.appendChild(seedElement)
    const seedEditor = createLiveCollabEditor({ element: seedElement, doc: provider.doc })
    try {
      expect(seedEditor.commands.setContent(OUTLINE_SEED)).toBe(true)
    } finally {
      seedEditor.destroy()
    }

    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'zoom-url',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, null, { initialZoomBlockId: 'block-b' }), container)
    const h = hostEl(container)!
    await settle(h)

    const snapshot = h.liveEditor?.getZoomSnapshot()
    expect(snapshot?.blockId).toBe('block-b')
    expect(snapshot?.breadcrumb.map((crumb) => crumb.text)).toEqual(['Home', 'A', 'B'])
    await until(() => visibleBreadcrumb(h) !== null)
    expect(visibleBreadcrumb(h)?.textContent).toContain('B')
  })

  it('centers and transiently highlights a block focus request after navigation', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'focus-target' })

    const seedElement = document.createElement('div')
    document.body.appendChild(seedElement)
    const seedEditor = createLiveCollabEditor({ element: seedElement, doc: provider.doc })
    try {
      expect(seedEditor.commands.setContent(OUTLINE_SEED)).toBe(true)
    } finally {
      seedEditor.destroy()
    }

    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    try {
      const binding = makeBinding({
        centerMode: 'document',
        graphId: 'g',
        documentId: 'focus-target',
        status: 'ready',
        error: null,
        provider,
      })
      const container = connectedContainer()
      render(mountEditorHost(binding, null, { focusRequest: { blockId: 'b', token: 1, durationMs: 200 } }), container)
      const h = hostEl(container)!
      await settle(h)

      const focusedBlock = h.shadowRoot?.querySelector('[data-block-id="block-b"]') as HTMLElement | null
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(focusedBlock?.getAttribute('data-wire-highlighted')).toBe('')

      render(mountEditorHost(binding, null, { focusRequest: { blockId: 'b', token: 2, durationMs: 200 } }), container)
      await settle(h)

      expect(scrollIntoView).toHaveBeenCalledTimes(2)
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        })
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      }
    }
  })

  it('routes direct gutter gestures: fold strip toggles, Shift+gutter zooms, plain gutter wires', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'wire-source' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'wire-source',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as {
      _editor: { commands: { setContent(content: unknown): boolean; setTextSelection(pos: number): boolean } }
    }
    expect(real._editor.commands.setContent(OUTLINE_SEED)).toBe(true)
    await settle(h)

    const focusedBlocks = Array.from(h.shadowRoot?.querySelectorAll('[data-block-focused]') ?? [])
    expect(focusedBlocks).toHaveLength(1)
    expect(focusedBlocks[0]?.getAttribute('data-block-id')).toContain(h.liveEditor?.getActiveBlockId())
    expect(real._editor.commands.setTextSelection(1)).toBe(true)
    await settle(h)
    expect(h.shadowRoot?.querySelector('[data-block-focused]')?.getAttribute('data-block-id')).toBe('block-a')

    const parent = h.shadowRoot?.querySelector('[data-block-id="block-a"]') as HTMLElement | null
    const leaf = h.shadowRoot?.querySelector('[data-block-id="block-c"]') as HTMLElement | null
    expect(parent).not.toBeNull()
    expect(leaf).not.toBeNull()
    Object.defineProperty(parent!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })
    Object.defineProperty(leaf!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 70, right: 500, bottom: 94, width: 400, height: 24 }),
    })

    const events: Array<{ graphId: string | null; documentId: string | null; blockId: string }> = []
    const zoomEvents: Array<{ blockId: string | null }> = []
    h.addEventListener('mn-block-wire-request', ((event: CustomEvent) => {
      events.push(event.detail)
    }) as EventListener)
    h.addEventListener('mn-zoom-change', ((event: CustomEvent<{ blockId: string | null }>) => {
      zoomEvents.push(event.detail)
    }) as EventListener)

    parent!.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        composed: true,
        clientX: 106,
        clientY: 50,
        shiftKey: true,
      }),
    )
    expect(events).toEqual([])
    expect(h.liveEditor?.getZoomSnapshot().blockId).toBeNull()

    ;(h.shadowRoot?.querySelector('[data-block-id="block-a"]') as HTMLElement | null)!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: 106,
        clientY: 50,
      }),
    )
    await settle(h)
    expect(events).toEqual([])
    const collapsedParent = h.shadowRoot?.querySelector('[data-block-id="block-a"]') as HTMLElement | null
    expect(collapsedParent?.classList.contains('outliner-collapsed')).toBe(true)
    Object.defineProperty(collapsedParent!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })

    collapsedParent!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: 106,
        clientY: 50,
      }),
    )
    await settle(h)
    const expandedParent = h.shadowRoot?.querySelector('[data-block-id="block-a"]') as HTMLElement | null
    expect(expandedParent?.classList.contains('outliner-collapsed')).toBe(false)
    Object.defineProperty(expandedParent!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })

    expandedParent!.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        composed: true,
        clientX: 122,
        clientY: 50,
        shiftKey: true,
      }),
    )
    await settle(h)
    expect(events).toEqual([])
    expect(h.liveEditor?.getZoomSnapshot().blockId).toBe('block-a')
    expect(zoomEvents[zoomEvents.length - 1]?.blockId).toBe('block-a')

    parent!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 122,
        clientY: 50,
        shiftKey: true,
      }),
    )
    expect(events).toEqual([])

    expect(h.liveEditor?.zoomOut()).toBe(true)
    await settle(h)

    events.length = 0
    leaf!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 106,
        clientY: 80,
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        graphId: 'g',
        documentId: 'wire-source',
        blockId: 'block-c',
      }),
    ])

    events.length = 0
    leaf!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 160,
        clientY: 80,
      }),
    )
    expect(events).toEqual([])

    expect(real._editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'calendarEvent',
          attrs: {
            id: 'event-a',
            title: 'Calendar checkpoint',
            allDay: true,
            source: 'manual',
          },
        },
      ],
    })).toBe(true)
    await settle(h)

    const calendarEvent = h.shadowRoot?.querySelector(
      'mn-calendar-event[data-block-id="event-a"]',
    ) as HTMLElement | null
    expect(calendarEvent).not.toBeNull()
    Object.defineProperty(calendarEvent!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })

    events.length = 0
    calendarEvent!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 106,
        clientY: 50,
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        graphId: 'g',
        documentId: 'wire-source',
        blockId: 'event-a',
      }),
    ])

    expect(real._editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'ordered', indent: 0, 'data-block-id': 'block-o' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered' }] }],
        },
        {
          type: 'listItem',
          attrs: { listType: 'ordered', indent: 1, 'data-block-id': 'block-o-child' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered child' }] }],
        },
      ],
    })).toBe(true)
    await settle(h)

    const orderedParent = h.shadowRoot?.querySelector('[data-block-id="block-o"]') as HTMLElement | null
    expect(orderedParent).not.toBeNull()
    Object.defineProperty(orderedParent!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })

    events.length = 0
    orderedParent!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: 120,
        clientY: 50,
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        graphId: 'g',
        documentId: 'wire-source',
        blockId: 'block-o',
      }),
    ])
  })

  it('marks wired blocks and opens the existing-wire menu branch from the gutter hotspot', async () => {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'wire-source' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'wire-source',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(
      mountEditorHost(binding, null, {
        wireBundle: {
          outgoingWires: [
            {
              id: 'wire-existing',
              predicate: 'http://mnemosyne.ai/vocab#supports',
              predicateLabel: 'supports',
              otherDocumentId: 'wire-target',
              otherGraphId: 'g',
              otherBlockId: 'target-block',
              localBlockId: 'block-b',
              otherTitle: 'Target',
              bidirectional: false,
            },
          ],
          incomingWires: [],
          wiredBlockIds: ['block-b'],
        },
      }),
      container,
    )
    const h = hostEl(container)!
    await settle(h)

    const real = h as unknown as { _editor: { commands: { setContent(html: string): boolean } } }
    expect(real._editor.commands.setContent(OUTLINE_SEED)).toBe(true)
    await settle(h)

    const wiredBlock = h.shadowRoot?.querySelector('[data-block-id="block-b"]') as HTMLElement | null
    const unwiredBlock = h.shadowRoot?.querySelector('[data-block-id="block-c"]') as HTMLElement | null
    expect(wiredBlock?.getAttribute('data-block-wired')).toBe('')
    expect(wiredBlock?.getAttribute('data-wire-count')).toBe('1')
    expect(unwiredBlock?.hasAttribute('data-block-wired')).toBe(false)

    document.dispatchEvent(
      new CustomEvent(WIRE_HIGHLIGHT_BLOCK_EVENT, {
        detail: { blockId: 'block-b' },
      }),
    )
    expect(wiredBlock?.getAttribute('data-wire-highlighted')).toBe('')
    expect(unwiredBlock?.hasAttribute('data-wire-highlighted')).toBe(false)

    document.dispatchEvent(
      new CustomEvent(WIRE_HIGHLIGHT_BLOCK_EVENT, {
        detail: { blockId: null },
      }),
    )
    expect(wiredBlock?.hasAttribute('data-wire-highlighted')).toBe(false)

    Object.defineProperty(wiredBlock!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
    })
    Object.defineProperty(unwiredBlock!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 70, right: 500, bottom: 94, width: 400, height: 24 }),
    })

    const menuEvents: Array<{ blockId: string; wires: Array<{ id: string }> }> = []
    const createEvents: Array<{ blockId: string }> = []
    h.addEventListener('mn-block-wire-menu-request', ((event: CustomEvent) => {
      menuEvents.push(event.detail)
    }) as EventListener)
    h.addEventListener('mn-block-wire-request', ((event: CustomEvent) => {
      createEvents.push(event.detail)
    }) as EventListener)

    wiredBlock!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 112,
        clientY: 50,
      }),
    )
    expect(menuEvents).toEqual([
      expect.objectContaining({
        blockId: 'block-b',
        wires: [expect.objectContaining({ id: 'wire-existing' })],
      }),
    ])
    expect(createEvents).toEqual([])

    unwiredBlock!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        clientX: 112,
        clientY: 80,
      }),
    )
    expect(createEvents).toEqual([expect.objectContaining({ blockId: 'block-c' })])

    const contextRequests: WireRadialContextRequestDetail[] = []
    const pinEvents: WirePinWireRequestDetail[] = []
    const navEvents: OpenDocumentDetail[] = []
    h.addEventListener(WIRE_RADIAL_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WireRadialContextRequestDetail>) => {
      contextRequests.push(event.detail)
    }) as EventListener)
    h.addEventListener(WIRE_PIN_WIRE_REQUEST_EVENT, ((event: CustomEvent<WirePinWireRequestDetail>) => {
      pinEvents.push(event.detail)
    }) as EventListener)
    h.addEventListener(OPEN_DOCUMENT_EVENT, ((event: CustomEvent<OpenDocumentDetail>) => {
      navEvents.push(event.detail)
    }) as EventListener)

    const hoverEvent = new MouseEvent('mouseover', {
      bubbles: true,
      composed: true,
      clientX: 112,
      clientY: 50,
    })
    wiredBlock!.dispatchEvent(hoverEvent)
    await until(() => h.shadowRoot!.querySelector('mn-wire-radial-overlay') !== null)
    const overlay = h.shadowRoot!.querySelector('mn-wire-radial-overlay') as HTMLElement & {
      updateComplete: Promise<unknown>
      shadowRoot: ShadowRoot
    }
    expect(overlay).not.toBeNull()
    await overlay.updateComplete
    expect(overlay.shadowRoot.querySelector('[data-node-id="wire-wire-existing"]')?.textContent).toContain('Target')

    ;(overlay.shadowRoot.querySelector('[data-node-id="wire-wire-existing"] [data-wire-radial-expand]') as HTMLButtonElement).click()
    await overlay.updateComplete
    expect(contextRequests).toEqual([
      {
        nodeId: 'wire-wire-existing',
        wireId: 'wire-existing',
        graphId: 'g',
        documentId: 'wire-target',
        blockId: 'target-block',
      },
    ])
    h.wireRadialContexts = new Map([
      [
        'wire-wire-existing',
        {
          status: 'ready',
          data: {
            mode: 'text',
            title: 'Target context',
            blocks: [{ id: 'target-block', text: 'Target context text', isTarget: true }],
          },
        },
      ],
    ])
    await settle(h)
    await overlay.updateComplete
    expect(overlay.shadowRoot.querySelector('.expanded-block')?.textContent).toBe('Target context text')

    ;(overlay.shadowRoot.querySelector('[data-node-id="wire-wire-existing"] [data-wire-radial-pin]') as HTMLButtonElement).click()
    expect(pinEvents).toEqual([
      expect.objectContaining({
        wireId: 'wire-existing',
        graphId: 'g',
        sourceDocumentId: 'wire-source',
        sourceBlockId: 'block-b',
        targetDocumentId: 'wire-target',
        targetBlockId: 'target-block',
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    ])

    ;(overlay.shadowRoot.querySelector('[data-node-id="wire-wire-existing"]') as HTMLElement).click()
    expect(navEvents).toEqual([
      {
        graphId: 'g',
        documentId: 'wire-target',
        blockId: 'target-block',
      },
    ])
  })

  async function mountSalienceDoc(
    scores: ReadonlyMap<string, BlockScore>,
    documentAccess: EditorDocumentAccess | null = null,
  ): Promise<{ h: ShEditorHost; blockEl: (blockId: string) => HTMLElement }> {
    const be = backend()
    const provider = be.open({ kind: 'doc', graphId: 'g', docId: 'salience-doc' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'salience-doc',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding, null, { salienceBundle: { scores }, documentAccess }), container)
    const h = hostEl(container)!
    await settle(h)
    const real = h as unknown as { _editor: { commands: { setContent(html: string): boolean } } }
    expect(real._editor.commands.setContent(OUTLINE_SEED)).toBe(true)
    await settle(h)
    const blockEl = (blockId: string): HTMLElement => {
      const el = h.shadowRoot?.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
      expect(el).not.toBeNull()
      // Right edge at x=500 — 10px inside it (490) sits in the 24px hotspot;
      // the LEFT-edge wire gutter lives at clientX ~112 in the sibling test
      // above, confirming these are independent, non-colliding zones.
      Object.defineProperty(el!, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 100, top: 40, right: 500, bottom: 64, width: 400, height: 24 }),
      })
      return el!
    }
    return { h, blockEl }
  }

  it('opens the value gutter for a SCORED block and cycles importance/valence independently', async () => {
    const scoredBlock: BlockScore = {
      blockId: 'block-b',
      documentId: 'salience-doc',
      cumulativeImportance: 1,
      cumulativeValence: 0,
      rawImportanceSum: 3,
      rawValenceSum: 0,
      importanceCount: 1,
      valenceCount: 0,
      compositeScore: 0.6,
      blockWireCount: 0,
      docWireCount: 0,
      lastValuatedAt: null,
      userImportance: 3,
      userValence: null,
    }
    const { h, blockEl } = await mountSalienceDoc(new Map([['block-b', scoredBlock]]))
    const el = blockEl('block-b')

    const rated: SalienceRateRequestDetail[] = []
    h.addEventListener(SALIENCE_RATE_REQUEST_EVENT, ((event: CustomEvent<SalienceRateRequestDetail>) => {
      rated.push(event.detail)
    }) as EventListener)

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, clientX: 490, clientY: 50 }))
    await until(() => h.shadowRoot!.querySelector('.salience-gutter') !== null)
    const gutter = h.shadowRoot!.querySelector('.salience-gutter') as HTMLElement
    const icons = gutter.querySelectorAll('.salience-gutter-icon')
    expect(icons).toHaveLength(3)
    // REGRESSION PROOF: the icon must be a REAL rendered <svg><path> tree, not
    // just a wrapper button with the right class/title — a real bug shipped
    // here once already (a separate `html`-tagged sub-template interpolated
    // into an outer `<svg>` renders BLANK, no console error, and every
    // class/title assertion below still passes; only checking actual content
    // catches it).
    for (const icon of icons) {
      const svg = icon.querySelector('svg.salience-icon')
      expect(svg).not.toBeNull()
      expect(svg!.childElementCount).toBeGreaterThan(0)
    }
    expect(icons[0]?.classList.contains('salience-gutter-icon--scored')).toBe(true)
    expect(icons[1]?.classList.contains('salience-gutter-icon--active')).toBe(true) // userImportance: 3
    expect(icons[1]?.getAttribute('title')).toBe('Important — shared graph rating (online only)')
    expect(icons[2]?.getAttribute('title')).toBe('Neutral — shared graph rating (online only)') // no human valence yet

    // Importance cycles 3 → 5 (still "important", now "very important").
    ;(icons[1] as HTMLButtonElement).click()
    expect(rated).toEqual([{ blockId: 'block-b', importance: 5, valence: null }])

    // Valence cycles null → 4 ("breakthrough"). This host never round-trips
    // its own optimistic write back into `salienceBundle` (that's the
    // shell's job, verified separately in main.ts) — so the still-unbundled
    // click correctly carries the ORIGINAL seeded importance (3, not the 5
    // just clicked) forward alongside the new valence, rather than clobbering
    // the other axis to null.
    ;(icons[2] as HTMLButtonElement).click()
    expect(rated).toEqual([
      { blockId: 'block-b', importance: 5, valence: null },
      { blockId: 'block-b', importance: 3, valence: 4 },
    ])
  })

  it('opens the value gutter for an UNSCORED block too — not gated behind a prior score', async () => {
    // A real OG bug this ports the fix for: gating the gutter behind an
    // existing agent/user score meant an unscored block could never receive
    // its FIRST rating.
    const { h, blockEl } = await mountSalienceDoc(new Map())
    const el = blockEl('block-c')

    const rated: SalienceRateRequestDetail[] = []
    h.addEventListener(SALIENCE_RATE_REQUEST_EVENT, ((event: CustomEvent<SalienceRateRequestDetail>) => {
      rated.push(event.detail)
    }) as EventListener)

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, clientX: 490, clientY: 50 }))
    await until(() => h.shadowRoot!.querySelector('.salience-gutter') !== null)
    const gutter = h.shadowRoot!.querySelector('.salience-gutter') as HTMLElement
    const icons = gutter.querySelectorAll('.salience-gutter-icon')
    for (const icon of icons) {
      const svg = icon.querySelector('svg.salience-icon')
      expect(svg).not.toBeNull()
      expect(svg!.childElementCount).toBeGreaterThan(0)
    }
    expect(icons[0]?.classList.contains('salience-gutter-icon--scored')).toBe(false)
    expect(icons[1]?.classList.contains('salience-gutter-icon--active')).toBe(false)
    expect(icons[1]?.getAttribute('title')).toBe('Unrated — shared graph rating (online only)')
    expect(icons[2]?.getAttribute('title')).toBe('Neutral — shared graph rating (online only)')

    ;(icons[1] as HTMLButtonElement).click()
    expect(rated).toEqual([{ blockId: 'block-c', importance: 3, valence: null }])
  })

  it('keeps scores visible but disables rating when shell authority is read-only', async () => {
    const reason = 'Rating requires Editor access to this graph.'
    const { h, blockEl } = await mountSalienceDoc(new Map(), {
      readOnly: false,
      salienceWritable: false,
      salienceWriteReason: reason,
    })
    const rated: SalienceRateRequestDetail[] = []
    h.addEventListener(SALIENCE_RATE_REQUEST_EVENT, ((event: CustomEvent<SalienceRateRequestDetail>) => {
      rated.push(event.detail)
    }) as EventListener)

    blockEl('block-c').dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      composed: true,
      clientX: 490,
      clientY: 50,
    }))
    await until(() => h.shadowRoot!.querySelector('.salience-gutter') !== null)
    const icons = h.shadowRoot!.querySelectorAll<HTMLButtonElement>('.salience-gutter-icon')
    expect(icons).toHaveLength(3)
    expect(icons[0]?.disabled).toBe(false)
    expect(icons[1]?.disabled).toBe(true)
    expect(icons[2]?.disabled).toBe(true)
    expect(icons[1]?.title).toBe(reason)
    icons[1]?.click()
    icons[2]?.click()
    expect(rated).toEqual([])
  })

  it('clamps the gutter popover inside the viewport near the right/bottom edge', async () => {
    // The hotspot is the block's RIGHT edge (see blockEl's mock rect, right:
    // 500) — the worst-case geometry for an unclamped popover, which would
    // open PAST whatever edge is already close by. A real bug this covers:
    // the popover previously used the raw hover clientX/clientY verbatim with
    // no viewport clamping at all (unlike the sibling wire radial overlay,
    // which already clamps), so a narrow pane or a hover near an edge could
    // render it partially or fully off-screen.
    vi.stubGlobal('innerWidth', 520)
    vi.stubGlobal('innerHeight', 200)
    try {
      const { h, blockEl } = await mountSalienceDoc(new Map())
      const el = blockEl('block-c')
      // clientX=490 is 30px from the 520px-wide viewport's right edge; clientY=10
      // is 10px from the top — both would overflow their edge unclamped.
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, clientX: 490, clientY: 10 }))
      await until(() => h.shadowRoot!.querySelector('.salience-gutter') !== null)
      const gutter = h.shadowRoot!.querySelector('.salience-gutter') as HTMLElement
      const style = gutter.getAttribute('style') ?? ''
      const left = Number(/left:\s*(-?\d+(?:\.\d+)?)px/.exec(style)?.[1])
      const top = Number(/top:\s*(-?\d+(?:\.\d+)?)px/.exec(style)?.[1])
      expect(Number.isNaN(left)).toBe(false)
      expect(Number.isNaN(top)).toBe(false)
      // Clamped well clear of the raw hover point (490, 10) in both directions.
      expect(left).toBeLessThan(490)
      expect(top).toBeGreaterThan(10)
      // And within the stubbed viewport with margin, accounting for the
      // popover's own estimated footprint (it is right-anchored and
      // vertically centered via `transform: translateY(-50%)`).
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left).toBeLessThanOrEqual(520)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(top).toBeLessThanOrEqual(200)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a provider swap rebuilds the live editor on the NEW doc; closing it returns to the placeholder', async () => {
    const be = backend()
    const p1 = be.open({ kind: 'doc', graphId: 'g', docId: 'd1' })
    const p2 = be.open({ kind: 'doc', graphId: 'g', docId: 'd2' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'd1',
      status: 'ready',
      error: null,
      provider: p1,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    const editor1 = h.liveEditor
    expect(editor1).not.toBeNull()

    // Swap to a DIFFERENT provider → a fresh editor on the new doc.
    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'd2',
      status: 'ready',
      error: null,
      provider: p2,
    })
    await settle(h)
    const editor2 = h.liveEditor
    expect(editor2).not.toBeNull()
    expect(editor2).not.toBe(editor1) // rebuilt on the new room

    // Close the document (provider null) → the live body tears down, placeholder back.
    binding.set(NULL_EDITOR_HOST_STATE)
    await h.updateComplete
    expect(h.liveEditor).toBeNull()
    expect(h.shadowRoot?.querySelector('.placeholder')).not.toBeNull()
    expect(proseMirror(h)).toBeNull()
  })

  // ── CONTINUITY PART ONE — the frozen-ghost crossfade ──────────────────────
  //
  // A DIFFERENT-provider switch tears the old editor down synchronously but
  // gates the new one on `provider.whenRenderable` (cache or a real network
  // round-trip on a live shell). These tests prove the mount region is never
  // visually empty
  // across that gap, that the ghost never affects the real editor/undo, and
  // that it cannot leak — no mocks: every provider here is the same real
  // InProcessCrdtBackend handle used above; `whenRenderable`/`whenSynced` are
  // swapped for one externally-resolvable Promise so the test can hold the gap.

  const ghostEl = (h: ShEditorHost) =>
    h.shadowRoot?.querySelector('[data-sh-editor-ghost]') as HTMLElement | null
  const mountEl = (h: ShEditorHost) =>
    h.shadowRoot?.querySelector('.editor-mount') as HTMLElement | null
  // The REAL mounted editor's ProseMirror dom is a DIRECT child of .editor-mount.
  // The ghost's cloneNode(true) ALSO carries a `.ProseMirror` class (deliberately —
  // so `.editor-mount .ProseMirror` styling still applies to the clone), but it is
  // nested one level deeper, inside the [data-sh-editor-ghost] wrapper. This
  // selector distinguishes "a real live editor is mounted" from "only the ghost's
  // frozen pixels are present".
  const liveProseMirror = (h: ShEditorHost) =>
    h.shadowRoot?.querySelector('.editor-mount > .ProseMirror') as HTMLElement | null

  /** A real ProviderHandle whose whenSynced is a real Promise this test controls. */
  function gatedProvider(be: InProcessCrdtBackend, docId: string) {
    const real = be.open({ kind: 'doc', graphId: 'g', docId })
    let resolveSynced!: () => void
    const whenSynced = new Promise<void>((resolve) => {
      resolveSynced = resolve
    })
    return {
      provider: {
        ...real,
        whenRenderable: whenSynced,
        whenEditable: whenSynced,
        whenSynced,
        renderSource: whenSynced.then(() => 'live' as const),
      },
      resolveSynced,
    }
  }

  it('DOCUMENT ACTIVATION — a durable cached document is editable offline and becomes live in the same EditorView', async () => {
    const be = backend()
    const real = be.open({ kind: 'doc', graphId: 'g', docId: 'cache-first' })
    const yDoc = real.doc as Y.Doc

    // Seed the exact Y.XmlFragment/TipTap shape the real cache stores.
    const seedMount = document.createElement('div')
    document.body.append(seedMount)
    const seedEditor = createLiveCollabEditor({
      element: seedMount,
      doc: yDoc,
      awareness: real.awareness,
    })
    expect(seedEditor.commands.setContent('<p>Cached old version</p>')).toBe(true)
    seedEditor.destroy()
    seedMount.remove()

    let resolveSynced!: () => void
    const whenSynced = new Promise<void>(resolve => { resolveSynced = resolve })
    let lifecycleValue: {
      connection: 'connecting' | 'connected' | 'disconnected'
      synchronized: boolean
      shouldConnect: boolean
    } = {
      connection: 'connecting',
      synchronized: false,
      shouldConnect: true,
    }
    const lifecycleListeners = new Set<(value: typeof lifecycleValue) => void>()
    type ActivationValue = {
      phase: 'offline-clean' | 'live'
      durability: 'durable'
      renderSource: 'snapshot'
      conflict: null
    }
    let activationValue: ActivationValue = {
      phase: 'offline-clean',
      durability: 'durable',
      renderSource: 'snapshot',
      conflict: null,
    }
    const activationListeners = new Set<(value: ActivationValue) => void>()
    const provider = {
      ...real,
      lifecycle: {
        get: () => lifecycleValue,
        subscribe(callback: (value: typeof lifecycleValue) => void) {
          lifecycleListeners.add(callback)
          return () => lifecycleListeners.delete(callback)
        },
      },
      whenRenderable: Promise.resolve(),
      whenEditable: Promise.resolve(),
      whenSynced,
      renderSource: Promise.resolve('snapshot' as const),
      activation: {
        get: () => activationValue,
        subscribe(callback: (value: ActivationValue) => void) {
          activationListeners.add(callback)
          return () => activationListeners.delete(callback)
        },
      },
    }
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'cache-first',
      status: 'ready',
      error: null,
      provider,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    const body = liveProseMirror(h)!
    expect(body.textContent).toContain('Cached old version')
    expect(body.getAttribute('contenteditable')).toBe('true')
    expect(h.getAttribute('data-document-activation')).toBe('offline-clean')
    expect(h.getAttribute('data-document-durability')).toBe('durable')
    expect(h.getAttribute('data-document-render-source')).toBe('snapshot')
    const toolbar = h.shadowRoot?.querySelector('mn-editor-toolbar') as HTMLElement | null
    await (toolbar as unknown as { updateComplete: Promise<unknown> }).updateComplete
    expect(toolbar?.shadowRoot?.querySelector('[data-document-sync-badge]')?.textContent).toContain('Offline')
    expect(toolbar?.shadowRoot?.querySelector('[data-make-editable]')).toBeNull()

    // Replay a remote edit into this SAME cached Y.Doc before initial sync.
    const remoteDoc = new Y.Doc()
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(yDoc))
    const remoteMount = document.createElement('div')
    document.body.append(remoteMount)
    const remoteEditor = createLiveCollabEditor({ element: remoteMount, doc: remoteDoc })
    expect(remoteEditor.commands.setContent('<p>Cached old version + remote</p>')).toBe(true)
    Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(remoteDoc))
    await until(() => h.liveEditor?.getText().includes('+ remote') === true)
    expect(body.getAttribute('contenteditable')).toBe('true')

    resolveSynced()
    lifecycleValue = { connection: 'connected', synchronized: true, shouldConnect: true }
    for (const listener of lifecycleListeners) listener(lifecycleValue)
    activationValue = { ...activationValue, phase: 'live' }
    for (const listener of activationListeners) listener(activationValue)
    await settle(h)

    expect(body.getAttribute('contenteditable')).toBe('true')
    expect(h.getAttribute('data-document-activation')).toBe('live')
    expect(h.hasAttribute('data-document-read-only')).toBe(false)
    await (toolbar as unknown as { updateComplete: Promise<unknown> }).updateComplete
    expect(toolbar?.shadowRoot?.querySelector('[data-read-only-badge]')).toBeNull()

    remoteEditor.destroy()
    remoteMount.remove()
    remoteDoc.destroy()
  })

  it('CONTINUITY PART ONE — the mount region is never empty across a different-provider switch, and the ghost is removed once the new editor has mounted', async () => {
    const be = backend()
    const p1 = be.open({ kind: 'doc', graphId: 'g', docId: 'ghost-1' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'ghost-1',
      status: 'ready',
      error: null,
      provider: p1,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)

    // Seed recognizable content so the ghost is provably a snapshot of THIS text.
    const real = h as unknown as {
      _editor: { commands: { setContent(html: string): boolean } }
    }
    expect(real._editor.commands.setContent('<p>Before the switch</p>')).toBe(true)
    await settle(h)
    expect(mountEl(h)?.childElementCount).toBeGreaterThan(0)
    expect(ghostEl(h)).toBeNull() // no ghost while nothing is switching

    // Swap to a DIFFERENT provider whose sync is gated on a real Promise we hold open.
    const { provider: p2, resolveSynced } = gatedProvider(be, 'ghost-2')
    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'ghost-2',
      status: 'ready',
      error: null,
      provider: p2,
    })
    await h.updateComplete // runs the synchronous half of _reconcileEditor: freeze + teardown + claim

    // THE GAP: whenSynced has not resolved, so _mountClaimed has not run yet.
    // The OLD real editor is already torn down — no LIVE (directly-mounted)
    // ProseMirror remains (only the ghost's inert clone, checked below, which
    // deliberately also carries the `.ProseMirror` class for styling)...
    expect(h.liveEditor).toBeNull()
    expect(liveProseMirror(h)).toBeNull()
    // ...but the mount region must NOT be empty: the frozen ghost covers it.
    const ghost = ghostEl(h)
    expect(ghost).not.toBeNull()
    expect(mountEl(h)?.childElementCount).toBeGreaterThan(0)
    expect(ghost!.textContent).toContain('Before the switch')
    // Pure pixels — inert/aria-hidden/non-interactive, no editor/provider/listeners.
    expect(ghost!.getAttribute('aria-hidden')).toBe('true')
    expect(ghost!.hasAttribute('inert')).toBe(true)
    expect(ghost!.style.pointerEvents).toBe('none')
    expect(ghost!.style.userSelect).toBe('none')
    expect(ghost!.style.position).toBe('absolute')
    expect((ghost as unknown as { _editor?: unknown })._editor).toBeUndefined()

    // Release the gate → the new editor mounts on p2's doc.
    resolveSynced()
    await settle(h)
    // Ghost removal is scheduled a paint (rAF) after the mount; flush it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.liveEditor).not.toBeNull()
    expect(proseMirror(h)).not.toBeNull()
    expect(ghostEl(h)).toBeNull() // cleaned up
    expect(mountEl(h)?.childElementCount).toBeGreaterThan(0)
  })

  it('CONTINUITY PART ONE — rapid A→B→C switches never stack ghosts and leave none once C mounts', async () => {
    const be = backend()
    const p1 = be.open({ kind: 'doc', graphId: 'g', docId: 'rapid-a' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'rapid-a',
      status: 'ready',
      error: null,
      provider: p1,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    const real = h as unknown as {
      _editor: { commands: { setContent(html: string): boolean } }
    }
    expect(real._editor.commands.setContent('<p>Content A</p>')).toBe(true)
    await settle(h)

    // A → B: B's sync is gated (never resolved — B will never actually mount).
    const { provider: pB } = gatedProvider(be, 'rapid-b')
    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'rapid-b',
      status: 'ready',
      error: null,
      provider: pB,
    })
    await h.updateComplete
    const ghostAfterA = ghostEl(h)
    expect(ghostAfterA).not.toBeNull()
    expect(ghostAfterA!.textContent).toContain('Content A')

    // B → C BEFORE B ever mounted (B's whenRenderable is still pending). There is
    // nothing live to freeze (the editor for B never mounted), so the existing
    // ghost (still standing in for A) must be left in place — not blanked.
    const { provider: pC, resolveSynced: resolveC } = gatedProvider(be, 'rapid-c')
    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'rapid-c',
      status: 'ready',
      error: null,
      provider: pC,
    })
    await h.updateComplete

    // Exactly ONE ghost node exists — the same one, still covering the region.
    const ghostsNow = h.shadowRoot?.querySelectorAll('[data-sh-editor-ghost]')
    expect(ghostsNow?.length).toBe(1)
    expect(ghostsNow?.[0]).toBe(ghostAfterA)
    expect(mountEl(h)?.childElementCount).toBeGreaterThan(0)
    expect(h.liveEditor).toBeNull() // neither B nor C has mounted yet

    // Release C → it mounts; the ghost (still A's stale content) is dropped.
    resolveC()
    await settle(h)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.liveEditor).not.toBeNull()
    expect(proseMirror(h)).not.toBeNull()
    expect(h.shadowRoot?.querySelectorAll('[data-sh-editor-ghost]').length).toBe(0)

    // B's late whenSynced resolution (if it ever arrived) must be a harmless
    // no-op — its claim was revoked by C. Nothing to release here (never
    // resolved), which is itself the point: a permanently-pending promise from
    // an abandoned switch must not be able to disturb the settled state.
    expect(mountEl(h)?.childElementCount).toBeGreaterThan(0)
  })

  it('CONTINUITY PART ONE — a host disconnect mid-switch leaves no orphan ghost', async () => {
    const be = backend()
    const p1 = be.open({ kind: 'doc', graphId: 'g', docId: 'disc-a' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'disc-a',
      status: 'ready',
      error: null,
      provider: p1,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    const real = h as unknown as {
      _editor: { commands: { setContent(html: string): boolean } }
    }
    expect(real._editor.commands.setContent('<p>Content before disconnect</p>')).toBe(true)
    await settle(h)

    const { provider: p2 } = gatedProvider(be, 'disc-b')
    binding.set({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'disc-b',
      status: 'ready',
      error: null,
      provider: p2,
    })
    await h.updateComplete
    const ghost = ghostEl(h)
    expect(ghost).not.toBeNull()
    expect(ghost!.isConnected).toBe(true)

    // Disconnect the host entirely while the switch is still pending (p2 never synced).
    h.remove()
    expect(h.isConnected).toBe(false)
    // The ghost node itself must no longer be attached anywhere live, and the
    // host's own bookkeeping must have cleared its reference (no retained node).
    expect(ghost!.isConnected).toBe(false)
    expect((h as unknown as { _editorGhost: unknown })._editorGhost).toBeNull()
  })

  it('CONTINUITY PART ONE — the ghost self-expires if the new editor never mounts (a hung sync degrades to the honest empty state, not a stale overlay)', async () => {
    const be = backend()
    const p1 = be.open({ kind: 'doc', graphId: 'g', docId: 'expire-a' })
    const binding = makeBinding({
      centerMode: 'document',
      graphId: 'g',
      documentId: 'expire-a',
      status: 'ready',
      error: null,
      provider: p1,
    })
    const container = connectedContainer()
    render(mountEditorHost(binding), container)
    const h = hostEl(container)!
    await settle(h)
    const real = h as unknown as {
      _editor: { commands: { setContent(html: string): boolean } }
    }
    expect(real._editor.commands.setContent('<p>Content that must not linger forever</p>')).toBe(true)
    await settle(h)

    // Shorten the self-expiry window for the test (a REAL setTimeout — no fake
    // timers); save + restore so it can never leak into another test.
    const ctor = h.constructor as unknown as { GHOST_MAX_LIFETIME_MS: number }
    const originalLifetime = ctor.GHOST_MAX_LIFETIME_MS
    ctor.GHOST_MAX_LIFETIME_MS = 30
    try {
      // Switch to a provider whose whenSynced NEVER resolves — a hung room sync,
      // the exact backend failure mode the p13 decouple fixes. resolveSynced is
      // deliberately never called.
      const { provider: p2 } = gatedProvider(be, 'expire-b')
      binding.set({
        centerMode: 'document',
        graphId: 'g',
        documentId: 'expire-b',
        status: 'ready',
        error: null,
        provider: p2,
      })
      await h.updateComplete

      // The ghost bridges the gap and arms its self-expiry timer.
      expect(ghostEl(h)).not.toBeNull()
      expect((h as unknown as { _ghostTimeout: unknown })._ghostTimeout).not.toBeNull()

      // No mount ever completes. Past the (shortened) max lifetime the ghost
      // self-removes, rather than showing the PREVIOUS doc's frozen content
      // indefinitely over a never-syncing new one.
      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(ghostEl(h)).toBeNull()
      expect((h as unknown as { _ghostTimeout: unknown })._ghostTimeout).toBeNull()
      // Degraded to the honest empty/loading state — NOT a live editor, NOT a stale overlay.
      expect(h.liveEditor).toBeNull()
    } finally {
      ctor.GHOST_MAX_LIFETIME_MS = originalLifetime
    }
  })
})
