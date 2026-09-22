/**
 * Tests for installDocumentSwitcherWireBridge.
 *
 * Verifies the contract bridge between contract.wireMode and the
 * mn-document-switcher component:
 *   - On enter (false → true): switcher.wireMode = true AND
 *     switcher.scope = 'documents' (matches prod's open-switcher behavior).
 *   - On exit (true → false): switcher.wireMode = false.
 *   - Scope is reset ONLY on false → true transitions; subsequent
 *     transferActiveHost / re-enter / etc. do NOT clobber a user-picked
 *     scope.
 *   - wire-target event → wireMode.commit(target) with the right shape.
 *   - target.graphId falls back to wire mode source's graphId when the
 *     switcher emits null.
 *   - uninstall removes both the subscription and the event listener.
 */

import { describe, expect, it } from 'vitest'
import { createWireModeController } from '@shrubbery/nucleus'
import type { WireWriter } from '@shrubbery/nucleus'
import {
  DOCUMENT_SWITCHER_WIRE_TARGET_EVENT,
  installDocumentSwitcherWireBridge,
  type DocumentSwitcherHandle,
} from '../install-document-switcher-wire-bridge.js'

function makeWireWriter(): { writer: WireWriter; calls: Array<{ graphId: string; params: Parameters<WireWriter['create']>[1] }> } {
  const calls: Array<{ graphId: string; params: Parameters<WireWriter['create']>[1] }> = []
  const writer: WireWriter = {
    async create(graphId, params) {
      calls.push({ graphId, params })
      return { wireId: 'wire-1' }
    },
    async delete() {},
  }
  return { writer, calls }
}

function makeSwitcher(): DocumentSwitcherHandle & EventTarget {
  // Use a real EventTarget so add/removeEventListener + dispatchEvent are real.
  const target = new EventTarget() as EventTarget & {
    wireMode: boolean
    scope: 'all' | 'documents' | 'blocks' | 'actions'
    open: boolean
  }
  target.wireMode = false
  target.scope = 'all'
  target.open = true
  return target as DocumentSwitcherHandle & EventTarget
}

describe('installDocumentSwitcherWireBridge — reflect wireMode into switcher', () => {
  it('sets switcher.wireMode = true and scope = "documents" on enter (false → true)', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    switcher.scope = 'all'

    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    expect(switcher.wireMode).toBe(false)
    expect(switcher.scope).toBe('all')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(switcher.wireMode).toBe(true)
    expect(switcher.scope).toBe('documents')
    uninstall()
  })

  it('sets switcher.wireMode = false on exit (true → false)', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    wireMode.exit()
    expect(switcher.wireMode).toBe(false)
    uninstall()
  })

  it('does NOT re-set scope on subsequent transferActiveHost (only on enter)', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(switcher.scope).toBe('documents')
    // User changes scope mid-search.
    switcher.scope = 'blocks'
    wireMode.transferActiveHost('host-2')
    // Bridge must NOT re-set scope to 'documents'.
    expect(switcher.scope).toBe('blocks')
    uninstall()
  })

  it('does NOT re-set scope when enter() is called with new source/config while already active', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    switcher.scope = 'blocks'
    // Mod-Shift-; re-opens menu, picks new predicate, re-fires enter.
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b2' },
      { predicate: 'contradicts', direction: 'reverse' },
      'host-1',
    )
    expect(switcher.scope).toBe('blocks')
    uninstall()
  })

  it('reflects current state when installed mid-mode (late mount)', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    expect(switcher.wireMode).toBe(true)
    expect(switcher.scope).toBe('documents')
    uninstall()
  })
})

describe('installDocumentSwitcherWireBridge — commit on wire-target', () => {
  it('commits the wire with explicit detail.graphId + blockId', async () => {
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    wireMode.enter(
      { graphId: 'g-source', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: 'g-target', documentId: 'd-target', blockId: 'b-target' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toMatchObject({
      sourceDocumentId: 'd-source',
      targetDocumentId: 'd-target',
      targetGraphId: 'g-target',
      sourceBlockId: 'b-source',
      targetBlockId: 'b-target',
      predicate: 'supports',
      bidirectional: false,
    })
    uninstall()
  })

  it('falls back to source graphId when detail.graphId is null', async () => {
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    wireMode.enter(
      { graphId: 'g-source', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: null, documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0].params.targetGraphId).toBe('g-source')
    expect(calls[0].params.targetBlockId).toBeUndefined()
    uninstall()
  })

  it('uses custom resolveTargetGraphId when provided', async () => {
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({
      wireMode,
      switcher,
      resolveTargetGraphId: () => 'g-resolved',
    })
    wireMode.enter(
      { graphId: 'g-source', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: null, documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    expect(calls[0].params.targetGraphId).toBe('g-resolved')
    uninstall()
  })

  it('is a no-op when wire mode is inactive', async () => {
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: 'g', documentId: 'd' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    uninstall()
  })

  it('falls back to source graphId when detail.graphId AND resolver both yield null', async () => {
    // Precedence is detail.graphId → resolver → source.graphId. With the first
    // two null, the source's graphId is used — the commit DOES fire.
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({
      wireMode,
      switcher,
      resolveTargetGraphId: () => null,
    })
    wireMode.enter(
      { graphId: 'g-source', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: null, documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0].params.targetGraphId).toBe('g-source')
    uninstall()
  })

  it('refuses the commit (no wire.create) when EVERY graphId source is empty/null', async () => {
    // The `if (!graphId) return` guard: detail null, resolver null, and an
    // empty-string source graphId (type-legal but semantically invalid). The
    // bridge must NOT send graphId='' to wire.create.
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({
      wireMode,
      switcher,
      resolveTargetGraphId: () => null,
    })
    wireMode.enter(
      { graphId: '', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: null, documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    uninstall()
  })
})

describe('installDocumentSwitcherWireBridge — close-on-success', () => {
  it('closes the switcher (open = false) after a successful commit', async () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    switcher.open = true
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    wireMode.enter(
      { graphId: 'g', documentId: 'd-source', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: 'g', documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(switcher.open).toBe(false)
    uninstall()
  })

  it('leaves the switcher OPEN when the commit rejects (retry path)', async () => {
    const calls: number[] = []
    const writer: WireWriter = {
      async create() {
        calls.push(1)
        throw new Error('backend boom')
      },
      async delete() {},
    }
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    switcher.open = true
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })
    wireMode.enter(
      { graphId: 'g', documentId: 'd-source', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: 'g', documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(switcher.open).toBe(true)
    uninstall()
  })
})

describe('installDocumentSwitcherWireBridge — uninstall', () => {
  it('uninstall removes the subscription (subsequent state changes do not reflect)', () => {
    const { writer } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })

    uninstall()
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'b' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(switcher.wireMode).toBe(false)
  })

  it('uninstall removes the event listener (subsequent wire-target events do not commit)', async () => {
    const { writer, calls } = makeWireWriter()
    const wireMode = createWireModeController({ wire: writer })
    const switcher = makeSwitcher()
    const uninstall = installDocumentSwitcherWireBridge({ wireMode, switcher })

    wireMode.enter(
      { graphId: 'g-source', documentId: 'd-source', blockId: 'b-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    uninstall()
    ;(switcher as unknown as EventTarget).dispatchEvent(
      new CustomEvent(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, {
        detail: { graphId: 'g-target', documentId: 'd-target' },
      }),
    )
    await Promise.resolve()
    expect(calls).toHaveLength(0)
  })
})
