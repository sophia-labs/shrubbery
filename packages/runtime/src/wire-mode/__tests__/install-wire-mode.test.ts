/**
 * Tests for installWireMode — the subscription + side-effect lifecycle.
 *
 * Uses a real WireModeController (from nucleus) and asserts the side effects
 * happen at the right times:
 *   - enter(active host) → host attribute set, editor.setEditable(false),
 *     source overlay mounted on the source block.
 *   - enter(different active host) → no side effects on this install.
 *   - transferActiveHost(other) → tear down this install's side effects.
 *   - transferActiveHost(self) → re-apply.
 *   - enter() while already active with a NEW source → source overlay
 *     swaps to the new block.
 *   - exit() → full teardown.
 *   - uninstall() → unsubscribe + teardown, even mid-mode.
 *   - setTarget() forwards to the target overlay.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWireModeController } from '@shrubbery/nucleus'
import type { WireWriter } from '@shrubbery/nucleus'
import { installWireMode } from '../install-wire-mode.js'

afterEach(() => {
  document.body.innerHTML = ''
})

function makeWireWriter(): WireWriter {
  return {
    async create() {
      return { wireId: 'w' }
    },
    async delete() {
      /* unused here */
    },
  }
}

function makeBlock(blockId: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-block-id', blockId)
  document.body.appendChild(el)
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  })
  return el
}

function mountInstall(hostId = 'host-1') {
  const wire = makeWireWriter()
  const wireMode = createWireModeController({ wire })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = { setEditable: vi.fn() }
  const blocks = new Map<string, HTMLElement>()
  const getBlockElement = (id: string): HTMLElement | null => blocks.get(id) ?? null
  const ensureBlock = (id: string): HTMLElement => {
    let el = blocks.get(id)
    if (!el) {
      el = makeBlock(id)
      blocks.set(id, el)
    }
    return el
  }
  const handle = installWireMode({
    wireMode,
    hostId,
    getHostElement: () => host,
    getEditor: () => editor,
    getBlockElement,
  })
  return { wireMode, host, editor, ensureBlock, handle }
}

describe('installWireMode — entering wire mode as the active host', () => {
  it('sets wire-mode-active attribute, calls setEditable(false), mounts source overlay', () => {
    const { wireMode, host, editor, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )

    expect(host.hasAttribute('wire-mode-active')).toBe(true)
    expect(editor.setEditable).toHaveBeenCalledWith(false)
    expect(document.getElementById('wire-source-highlight')).not.toBeNull()
    expect(document.getElementById('wire-target-highlight')).not.toBeNull()
    handle.uninstall()
  })

  it('mounts the source overlay over the source block element (BCR-positioned)', () => {
    const { wireMode, ensureBlock, handle } = mountInstall('host-1')
    const sourceEl = ensureBlock('block-source')
    Object.defineProperty(sourceEl, 'getBoundingClientRect', {
      value: () => ({ top: 200, left: 10, width: 50, height: 20, right: 60, bottom: 220, x: 10, y: 200, toJSON: () => ({}) }),
      configurable: true,
    })

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )

    const overlay = document.getElementById('wire-source-highlight') as HTMLElement
    expect(overlay.style.top).toBe('196px') // 200 - 4 padding
    expect(overlay.style.left).toBe('6px')
    handle.uninstall()
  })
})

describe('installWireMode — host-id gating', () => {
  it('does not apply side effects when activeHostId is a different host', () => {
    const { wireMode, host, editor, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-OTHER',
    )

    expect(host.hasAttribute('wire-mode-active')).toBe(false)
    expect(editor.setEditable).not.toHaveBeenCalled()
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    handle.uninstall()
  })

  it('tears down on transferActiveHost AWAY from this install', () => {
    const { wireMode, host, editor, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(host.hasAttribute('wire-mode-active')).toBe(true)

    wireMode.transferActiveHost('host-2')
    expect(host.hasAttribute('wire-mode-active')).toBe(false)
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    handle.uninstall()
  })

  it('re-applies on transferActiveHost BACK to this install', () => {
    const { wireMode, host, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    wireMode.transferActiveHost('host-2')
    expect(host.hasAttribute('wire-mode-active')).toBe(false)

    wireMode.transferActiveHost('host-1')
    expect(host.hasAttribute('wire-mode-active')).toBe(true)
    expect(document.getElementById('wire-source-highlight')).not.toBeNull()
    handle.uninstall()
  })
})

describe('installWireMode — source-block change mid-mode', () => {
  it('swaps the source overlay to the new block on enter()-while-active', () => {
    const { wireMode, ensureBlock, handle } = mountInstall('host-1')
    const a = ensureBlock('block-a')
    const b = ensureBlock('block-b')
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 0, width: 1, height: 1, right: 1, bottom: 101, x: 0, y: 100, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(b, 'getBoundingClientRect', {
      value: () => ({ top: 500, left: 0, width: 1, height: 1, right: 1, bottom: 501, x: 0, y: 500, toJSON: () => ({}) }),
      configurable: true,
    })

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-a' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(document.getElementById('wire-source-highlight')?.style.top).toBe('96px')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-b' },
      { predicate: 'contradicts', direction: 'forward' },
      'host-1',
    )
    expect(document.getElementById('wire-source-highlight')?.style.top).toBe('496px')
    handle.uninstall()
  })

  it('handles a null source block id (document-level wire) without crashing', () => {
    const { wireMode, host, handle } = mountInstall('host-1')
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: null },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(host.hasAttribute('wire-mode-active')).toBe(true)
    // No source overlay — there is no source block element to position over.
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    // Target overlay scaffold is still mounted (C3/C4 will move it).
    expect(document.getElementById('wire-target-highlight')).not.toBeNull()
    handle.uninstall()
  })
})

describe('installWireMode — exit and uninstall', () => {
  it('exit() tears down all side effects', () => {
    const { wireMode, host, editor, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    wireMode.exit()

    expect(host.hasAttribute('wire-mode-active')).toBe(false)
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
    handle.uninstall()
  })

  it('uninstall() unsubscribes and tears down mid-mode', () => {
    const { wireMode, host, editor, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')

    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    handle.uninstall()

    expect(host.hasAttribute('wire-mode-active')).toBe(false)
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
    expect(document.getElementById('wire-source-highlight')).toBeNull()

    // Post-uninstall: a subsequent wireMode.enter should NOT re-apply effects.
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(host.hasAttribute('wire-mode-active')).toBe(false)
  })

  it('apply current state on install (late mount into an already-active mode)', () => {
    const wire = makeWireWriter()
    const wireMode = createWireModeController({ wire })
    const sourceEl = makeBlock('block-source')
    Object.defineProperty(sourceEl, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, width: 1, height: 1, right: 1, bottom: 1, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })

    // Wire mode already active before we install.
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )

    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = { setEditable: vi.fn() }
    const handle = installWireMode({
      wireMode,
      hostId: 'host-1',
      getHostElement: () => host,
      getEditor: () => editor,
      getBlockElement: (id) => (id === 'block-source' ? sourceEl : null),
    })

    expect(host.hasAttribute('wire-mode-active')).toBe(true)
    expect(editor.setEditable).toHaveBeenCalledWith(false)
    expect(document.getElementById('wire-source-highlight')).not.toBeNull()
    handle.uninstall()
  })
})

describe('installWireMode — setTarget forwarding', () => {
  it('setTarget(element) shows + positions the target overlay', () => {
    const { wireMode, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    const t = document.createElement('div')
    document.body.appendChild(t) // connected — positionOverTarget skips detached nodes
    Object.defineProperty(t, 'getBoundingClientRect', {
      value: () => ({ top: 50, left: 5, width: 30, height: 12, right: 35, bottom: 62, x: 5, y: 50, toJSON: () => ({}) }),
      configurable: true,
    })
    handle.setTarget(t)
    const overlay = document.getElementById('wire-target-highlight') as HTMLElement
    expect(overlay.style.display).toBe('')
    expect(overlay.style.top).toBe('46px')
    handle.uninstall()
  })

  it('setTarget(null) hides the target overlay', () => {
    const { wireMode, ensureBlock, handle } = mountInstall('host-1')
    ensureBlock('block-source')
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    const t = document.createElement('div')
    Object.defineProperty(t, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, width: 1, height: 1, right: 1, bottom: 1, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    handle.setTarget(t)
    handle.setTarget(null)
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.display).toBe('none')
    handle.uninstall()
  })

  it('setTarget pre-enter is a no-op (overlay not yet mounted)', () => {
    const { handle } = mountInstall('host-1')
    expect(() => handle.setTarget(document.createElement('div'))).not.toThrow()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
    handle.uninstall()
  })
})

describe('installWireMode — teardown reverses on cached refs (null-getter robustness)', () => {
  it('clears wire-mode-active on the cached host even when getHostElement() returns null at teardown', () => {
    const wire = makeWireWriter()
    const wireMode = createWireModeController({ wire })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const sourceEl = makeBlock('block-source')
    let hostVisible = true
    const handle = installWireMode({
      wireMode,
      hostId: 'host-1',
      getHostElement: () => (hostVisible ? host : null),
      getEditor: () => ({ setEditable: vi.fn() }),
      getBlockElement: (id) => (id === 'block-source' ? sourceEl : null),
    })
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(host.hasAttribute('wire-mode-active')).toBe(true)

    // The getter goes null right before teardown (transient unavailability).
    hostVisible = false
    wireMode.exit()
    // Reversed on the CACHED host despite the null getter.
    expect(host.hasAttribute('wire-mode-active')).toBe(false)

    // Re-enter with the getter back: the attribute re-applies (flag not stuck).
    hostVisible = true
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(host.hasAttribute('wire-mode-active')).toBe(true)
    handle.uninstall()
  })

  it('restores setEditable(true) on the cached editor even when getEditor() returns null at teardown', () => {
    const wire = makeWireWriter()
    const wireMode = createWireModeController({ wire })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const sourceEl = makeBlock('block-source')
    const editor = { setEditable: vi.fn() }
    let editorVisible = true
    const handle = installWireMode({
      wireMode,
      hostId: 'host-1',
      getHostElement: () => host,
      getEditor: () => (editorVisible ? editor : null),
      getBlockElement: (id) => (id === 'block-source' ? sourceEl : null),
    })
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    expect(editor.setEditable).toHaveBeenLastCalledWith(false)

    // Editor getter transiently null at teardown — must STILL re-enable on the
    // cached editor (the frozen-editor bug).
    editorVisible = false
    wireMode.exit()
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
    handle.uninstall()
  })
})
