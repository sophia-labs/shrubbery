/**
 * resolution-flow.test.ts — the user-facing resolution journey (master §3
 * Slice 6, WS2 §6.6-6.7). Real DOM (happy-dom, matching this package's own
 * `vitest.config.ts`), real custom elements (`mn-confirmation-dialog`,
 * `hoja-editor`) — no mocks, no fakes standing in for either.
 */
import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { MnConfirmationDialog } from '@shrubbery/components'
import type { SourceMirrorState } from '@shrubbery/source'
import {
  resolutionMenuModel,
  pickResolution,
  pickComposedRecord,
  showLostRaceDialog,
  resolutionPresentationFor,
  resolutionPresentationCopy,
  composedRecord,
  type ResolutionMenuProposal,
  type ComposedFieldValue,
} from '../resolution-flow.js'
import { isMenuHeader, isMenuItem, type MenuItemEntry } from '@shrubbery/nucleus'

function baseState(overrides: Partial<SourceMirrorState> = {}): SourceMirrorState {
  return {
    phase: 'complete',
    complete: true,
    epoch: 'epoch-1',
    graphIncarnation: 'incarnation-a',
    pending: 0,
    parked: 0,
    nonDocumentParked: 0,
    rejectedPermanent: 0,
    supersededResolutions: 0,
    resolving: [],
    awaitingEpoch: [],
    contestedObjects: 0,
    repairNeeded: false,
    fenced: false,
    fenceTestimony: null,
    error: null,
    errorCode: null,
    ...overrides,
  }
}

function proposal(overrides: Partial<ResolutionMenuProposal> = {}): ResolutionMenuProposal {
  return {
    operationId: 'op-a',
    sourceVersion: 'abcdef0123456789',
    observer: null,
    isProjectedHead: false,
    record: { kind: 'Bookmark', localId: 'obj-1', title: 'A' },
    ...overrides,
  }
}

let mounted: HTMLElement[] = []

function mountDialog(): MnConfirmationDialog {
  const dialog = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
  document.body.appendChild(dialog)
  mounted.push(dialog)
  return dialog
}

afterEach(() => {
  for (const element of mounted) element.remove()
  mounted = []
})

// ── the menu model (pure) ────────────────────────────────────────────────

describe('resolutionMenuModel', () => {
  it('renders a header, a "keep" submenu with one entry per proposal, a divider, compose, and copy-key', () => {
    const entries = resolutionMenuModel({
      objectKey: 'k',
      conflictId: 'c1',
      proposals: [
        proposal({ operationId: 'op-a', observer: 'device-a', sourceVersion: 'aaaaaaaaaaaaaaaa' }),
        proposal({ operationId: 'op-b', observer: null, sourceVersion: 'bbbbbbbbbbbbbbbb' }),
      ],
      composeAvailable: true,
      pendingResolution: false,
    })
    expect(isMenuHeader(entries[0]!) && entries[0]!.content).toBe('Resolve this object')
    expect(isMenuHeader(entries[1]!) && entries[1]!.content).toBe('Keep a proposal')
    // Flattened, real top-level items (master §3 Slice 6 REPAIR) — the real
    // `<mn-context-menu>` never opens a nested `submenu`, so each proposal
    // must be directly, mechanically clickable.
    const keepA = entries[2] as MenuItemEntry
    const keepB = entries[3] as MenuItemEntry
    expect(keepA.id).toBe('keep:op-a')
    expect(keepA.label).toBe('device-a · aaaaaaaaaa…')
    expect(keepA.disabled).toBe(false)
    expect(keepB.id).toBe('keep:op-b')
    expect(keepB.label).toBe('Proposal 2 · bbbbbbbbbb…')
    const ids = entries.filter(isMenuItem).map(entry => entry.id)
    expect(ids).toEqual(['keep:op-a', 'keep:op-b', 'compose', 'copy-key'])
  })

  it('disables every entry and swaps the header while a resolution is pending; omits compose when unavailable', () => {
    const entries = resolutionMenuModel({
      objectKey: 'k',
      conflictId: 'c1',
      proposals: [proposal()],
      composeAvailable: false,
      pendingResolution: true,
    })
    expect(isMenuHeader(entries[0]!) && entries[0]!.content).toBe('Waiting for the cell to confirm your choice')
    const items = entries.filter(isMenuItem)
    expect(items.every(item => item.disabled === true || item.id === 'copy-key')).toBe(true)
    expect(items.map(item => item.id)).toEqual(['keep:op-a', 'copy-key'])
  })

  it('no "Keep a proposal" header or entries with zero proposals (a degraded contest read) — compose and copy-key still reachable', () => {
    const entries = resolutionMenuModel({
      objectKey: 'k',
      conflictId: 'c1',
      proposals: [],
      composeAvailable: true,
      pendingResolution: false,
    })
    expect(entries.some(entry => isMenuHeader(entry) && entry.content === 'Keep a proposal')).toBe(false)
    expect(entries.filter(isMenuItem).map(item => item.id)).toEqual(['compose', 'copy-key'])
  })
})

// ── pending-resolution presentation (pure) ──────────────────────────────

describe('resolutionPresentationFor / resolutionPresentationCopy', () => {
  it("'pending' while the resolveCurrent is locally durable and unacknowledged", () => {
    const state = baseState({ resolving: ['c1'] })
    expect(resolutionPresentationFor('c1', state)).toBe('pending')
    expect(resolutionPresentationCopy('pending')).toBe('Your choice is saved here. Waiting for the cell.')
  })

  it("'accepted' once the receipt lands but the epoch has not confirmed it cleared", () => {
    const state = baseState({ awaitingEpoch: [{ conflictId: 'c1', remainingConflictId: null }] })
    expect(resolutionPresentationFor('c1', state)).toBe('accepted')
    expect(resolutionPresentationCopy('accepted')).toBe('The cell accepted your choice.')
  })

  it("'settled-with-successor' when the receipt names a remaining conflict", () => {
    const state = baseState({ awaitingEpoch: [{ conflictId: 'c1', remainingConflictId: 'c2' }] })
    expect(resolutionPresentationFor('c1', state)).toBe('settled-with-successor')
    expect(resolutionPresentationCopy('settled-with-successor')).toBe('Settled — and a newer disagreement has appeared.')
  })

  it("'idle' once the next epoch no longer names the conflict in either register — and 'resolving' wins over a stale awaitingEpoch entry", () => {
    expect(resolutionPresentationFor('c1', baseState())).toBe('idle')
    expect(resolutionPresentationCopy('idle')).toBeNull()
    const state = baseState({
      resolving: ['c1'],
      awaitingEpoch: [{ conflictId: 'c1', remainingConflictId: 'c2' }],
    })
    expect(resolutionPresentationFor('c1', state)).toBe('pending')
  })
})

// ── the three-way "choose" dialog (real mn-confirmation-dialog) ─────────

describe('pickResolution', () => {
  it('presents the choose copy, and mn-confirm resolves "keep" only AFTER onKeep settles — loading is true while it runs', async () => {
    const dialog = mountDialog()
    let loadingDuringKeep: boolean | null = null
    const pending = pickResolution({
      dialog,
      objectLabel: 'Bookmark obj-1',
      proposalLabel: 'device-a',
      onKeep: async () => {
        loadingDuringKeep = dialog.loading
      },
      onCompose: async () => true,
    })
    expect(dialog.title).toBe('Resolve Bookmark obj-1')
    expect(dialog.confirmText).toBe('Keep this one')
    expect(dialog.secondaryConfirmText).toBe('Compose a merged value…')
    expect(dialog.cancelText).toBe('Not now')
    expect(dialog.open).toBe(true)

    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    const choice = await pending
    expect(choice).toBe('keep')
    expect(loadingDuringKeep).toBe(true)
    expect(dialog.loading).toBe(false)
    expect(dialog.open).toBe(false)
  })

  it('a rejected onKeep surfaces the error verbatim in the message area and leaves the dialog open', async () => {
    const dialog = mountDialog()
    const pending = pickResolution({
      dialog,
      objectLabel: 'Bookmark obj-1',
      proposalLabel: 'device-a',
      onKeep: async () => {
        throw new Error('SourceMirror: a complete, unfenced local copy is required before you can resolve')
      },
      onCompose: async () => true,
    })
    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    // Give the microtask queue a turn — the handler is async but this
    // promise only settles on cancel/keep/compose, so poll the dialog state.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dialog.loading).toBe(false)
    expect(dialog.open).toBe(true)
    expect(dialog.message).toBe('SourceMirror: a complete, unfenced local copy is required before you can resolve')
    dialog.dispatchEvent(new CustomEvent('mn-cancel'))
    expect(await pending).toBeNull()
  })

  it('mn-cancel resolves null without running either callback', async () => {
    const dialog = mountDialog()
    let ran = false
    const pending = pickResolution({
      dialog,
      objectLabel: 'Bookmark obj-1',
      proposalLabel: 'device-a',
      onKeep: async () => { ran = true },
      onCompose: async () => { ran = true; return true },
    })
    // The real component's `private cancel()` sets `open = false` itself
    // BEFORE dispatching `mn-cancel` (mn-confirmation-dialog.ts:424-428) —
    // mirrored here since dispatching the bare event skips that method.
    dialog.open = false
    dialog.dispatchEvent(new CustomEvent('mn-cancel'))
    expect(await pending).toBeNull()
    expect(ran).toBe(false)
    expect(dialog.open).toBe(false)
  })

  it('onCompose returning false ("Back") re-presents the SAME choose dialog rather than resolving', async () => {
    const dialog = mountDialog()
    let composeCalls = 0
    const pending = pickResolution({
      dialog,
      objectLabel: 'Bookmark obj-1',
      proposalLabel: 'device-a',
      onKeep: async () => {},
      onCompose: async () => {
        composeCalls += 1
        return false
      },
    })
    dialog.dispatchEvent(new CustomEvent('mn-secondary-confirm'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(composeCalls).toBe(1)
    expect(dialog.open).toBe(true) // still open, not resolved
    expect(dialog.title).toBe('Resolve Bookmark obj-1') // choose dialog restored
    expect(dialog.confirmText).toBe('Keep this one')
    // Now let it actually commit.
    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    expect(await pending).toBe('keep')
  })

  it('onCompose returning true resolves "compose" and hides', async () => {
    const dialog = mountDialog()
    const pending = pickResolution({
      dialog,
      objectLabel: 'Bookmark obj-1',
      proposalLabel: 'device-a',
      onKeep: async () => {},
      onCompose: async () => true,
    })
    dialog.dispatchEvent(new CustomEvent('mn-secondary-confirm'))
    expect(await pending).toBe('compose')
    expect(dialog.open).toBe(false)
  })
})

// ── composing a merged record ────────────────────────────────────────────

describe('composedRecord (pure)', () => {
  it('overlays composed fields onto the base, leaving untouched keys alone', () => {
    const base = { kind: 'Bookmark', localId: 'obj-1', title: 'A', url: 'https://a' }
    const fields: readonly ComposedFieldValue[] = [
      { key: 'title', json: 'Merged Title', source: 'composed' },
    ]
    expect(composedRecord(base, fields)).toEqual({
      kind: 'Bookmark',
      localId: 'obj-1',
      title: 'Merged Title',
      url: 'https://a',
    })
  })
})

describe('pickComposedRecord (real mn-confirmation-dialog + real hoja-editor)', () => {
  it('confirming with no edits carries the projected head\'s values through for every differing field, and locked/identical fields verbatim from the head', async () => {
    const dialog = mountDialog()
    const proposals: readonly ResolutionMenuProposal[] = [
      proposal({
        operationId: 'op-head',
        isProjectedHead: true,
        record: { kind: 'Bookmark', localId: 'obj-1', title: 'Head Title', shared: 'same', flag: true, n: 3 },
      }),
      proposal({
        operationId: 'op-other',
        isProjectedHead: false,
        record: { kind: 'Bookmark', localId: 'obj-1', title: 'Other Title', shared: 'same', flag: false, n: 9 },
      }),
    ]
    const pending = pickComposedRecord({
      dialog,
      objectLabel: 'Bookmark obj-1',
      className: 'Bookmark',
      proposals,
    })
    expect(dialog.title).toBe('Compose a merged value')
    expect(dialog.confirmText).toBe('Use this merged value')
    expect(dialog.cancelText).toBe('Back')
    // A real <hoja-editor> mounted for the 'title' field, seeded from the head.
    const editor = dialog.querySelector('hoja-editor')
    expect(editor).not.toBeNull()

    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    const record = await pending
    expect(record).toEqual({
      kind: 'Bookmark',
      localId: 'obj-1',
      title: 'Head Title', // unedited hoja seed — the head's own value
      shared: 'same', // identical across candidates — carried through
      flag: true, // boolean, defaulted to the head's own value
      n: 3, // number, defaulted to the head's own value
    })
  })

  it('choosing a non-head candidate for a structural/boolean field via its choice button changes the composed value', async () => {
    const dialog = mountDialog()
    const proposals: readonly ResolutionMenuProposal[] = [
      proposal({ operationId: 'op-head', isProjectedHead: true, record: { kind: 'K', localId: 'x', flag: true } }),
      proposal({ operationId: 'op-other', isProjectedHead: false, record: { kind: 'K', localId: 'x', flag: false } }),
    ]
    const pending = pickComposedRecord({ dialog, objectLabel: 'K x', className: 'K', proposals })
    const buttons = Array.from(dialog.querySelectorAll('.sh-resolution-composer-field-choices button'))
    expect(buttons).toHaveLength(2)
    const otherButton = buttons.find(button => button.getAttribute('aria-pressed') === 'false')
    expect(otherButton).toBeDefined()
    otherButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    const record = await pending
    expect(record).toEqual({ kind: 'K', localId: 'x', flag: false })
  })

  it('"Back" (mn-cancel) resolves null and leaves no composer DOM behind', async () => {
    const dialog = mountDialog()
    const proposals: readonly ResolutionMenuProposal[] = [
      proposal({ operationId: 'op-head', isProjectedHead: true, record: { kind: 'K', localId: 'x', title: 'A' } }),
      proposal({ operationId: 'op-other', record: { kind: 'K', localId: 'x', title: 'B' } }),
    ]
    const pending = pickComposedRecord({ dialog, objectLabel: 'K x', className: 'K', proposals })
    expect(dialog.querySelector('.sh-resolution-composer')).not.toBeNull()
    dialog.dispatchEvent(new CustomEvent('mn-cancel'))
    expect(await pending).toBeNull()
    expect(dialog.querySelector('.sh-resolution-composer')).toBeNull()
  })
})

// ── the lost race (real mn-confirmation-dialog) ──────────────────────────

describe('showLostRaceDialog', () => {
  it('renders the authority testimony verbatim in a monospace block, and mn-confirm runs onLookAgain', async () => {
    const dialog = mountDialog()
    let lookedAgain = false
    const pending = showLostRaceDialog({
      dialog,
      objectLabel: 'Bookmark obj-1',
      testimony: "sync conflict 'conflict-abc' is not current for object 'vocabBookmarkobj-1'",
      onLookAgain: () => { lookedAgain = true },
    })
    expect(dialog.title).toBe('Someone else decided first')
    expect(dialog.confirmText).toBe('Look at it again')
    expect(dialog.cancelText).toBe('Dismiss')
    const testimonyEl = dialog.querySelector('.sh-resolution-testimony')
    expect(testimonyEl?.textContent).toBe("sync conflict 'conflict-abc' is not current for object 'vocabBookmarkobj-1'")
    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    await pending
    expect(lookedAgain).toBe(true)
    expect(dialog.querySelector('.sh-resolution-testimony')).toBeNull()
  })

  it('mn-cancel ("Dismiss") settles without running onLookAgain', async () => {
    const dialog = mountDialog()
    let lookedAgain = false
    const pending = showLostRaceDialog({
      dialog,
      objectLabel: 'Bookmark obj-1',
      testimony: 'verbatim',
      onLookAgain: () => { lookedAgain = true },
    })
    dialog.dispatchEvent(new CustomEvent('mn-cancel'))
    await pending
    expect(lookedAgain).toBe(false)
  })
})
