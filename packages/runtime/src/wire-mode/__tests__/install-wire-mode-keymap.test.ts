/**
 * Tests for the C3 document-level keymap layered onto installWireMode.
 *
 * The keymap is installed in capture phase on the document when wire mode is
 * active AND this host is the active host; removed otherwise. Bindings:
 *
 *   - Escape          → wireMode.exit()
 *   - Enter           → wireMode.commit({scope.graphId, scope.documentId, currentTarget.blockId})
 *   - j / ArrowDown   → navigate target down (wraps)
 *   - k / ArrowUp     → navigate target up (wraps)
 *   - Mod-;           → wireMode.exit() (prevents re-firing the picker on top of active mode)
 *   - Mod-Shift-;     → PASSES THROUGH (so the advanced menu can re-open mid-mode)
 *
 * On enter, the target is seeded to the first ordered block (if any) so
 * Enter alone can commit a wire to that block without first navigating.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWireModeController } from '@shrubbery/nucleus'
import type { WireWriter } from '@shrubbery/nucleus'
import { installWireMode } from '../install-wire-mode.js'

afterEach(() => {
  document.body.innerHTML = ''
})

interface MountOptions {
  hostId?: string
  blocks?: string[]
  scope?: { graphId: string; documentId: string }
  source?: { graphId: string; documentId: string; blockId: string | null }
  withScope?: boolean
  withOrderedBlocks?: boolean
}

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

function mountInstall(opts: MountOptions = {}) {
  const hostId = opts.hostId ?? 'host-1'
  const blockIds = opts.blocks ?? []
  const scope = opts.scope ?? { graphId: 'graph-a', documentId: 'doc-current' }
  const source = opts.source ?? { graphId: scope.graphId, documentId: scope.documentId, blockId: 'block-source' }

  const { writer, calls } = makeWireWriter()
  const wireMode = createWireModeController({ wire: writer })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = { setEditable: vi.fn() }
  const blockEls: HTMLElement[] = []
  const blockMap = new Map<string, HTMLElement>()
  for (const id of blockIds) {
    const el = document.createElement('div')
    el.setAttribute('data-block-id', id)
    document.body.appendChild(el)
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, width: 1, height: 1, right: 1, bottom: 1, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    blockEls.push(el)
    blockMap.set(id, el)
  }
  // Source block (so applyLocalEffects can find it). If the source blockId is
  // also in `blocks`, reuse the same element; otherwise create a fresh one.
  if (source.blockId && !blockMap.has(source.blockId)) {
    const el = document.createElement('div')
    el.setAttribute('data-block-id', source.blockId)
    document.body.appendChild(el)
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, width: 1, height: 1, right: 1, bottom: 1, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    blockMap.set(source.blockId, el)
  }

  const withOrderedBlocks = opts.withOrderedBlocks ?? true
  const withScope = opts.withScope ?? true

  const handle = installWireMode({
    wireMode,
    hostId,
    getHostElement: () => host,
    getEditor: () => editor,
    getBlockElement: (id) => blockMap.get(id) ?? null,
    ...(withOrderedBlocks ? { getOrderedBlockElements: () => blockEls } : {}),
    ...(withScope ? { getDocumentScope: () => scope } : {}),
  })

  const enter = (config = { predicate: 'supports' as const, direction: 'forward' as const }): void => {
    wireMode.enter(source, config, hostId)
  }

  return { wireMode, host, editor, blockEls, blockMap, handle, calls, enter, scope, source }
}

function press(key: string, opts: { metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  document.dispatchEvent(event)
  return event
}

describe('install-wire-mode keymap — Escape', () => {
  it('Escape exits wire mode', () => {
    const { wireMode, enter, handle } = mountInstall({ blocks: ['b1'] })
    enter()
    expect(wireMode.view().isActive).toBe(true)
    press('Escape')
    expect(wireMode.view().isActive).toBe(false)
    handle.uninstall()
  })

  it('Escape is ignored when wire mode is inactive (keymap not installed)', () => {
    const { wireMode, handle } = mountInstall({ blocks: ['b1'] })
    const exitSpy = vi.spyOn(wireMode, 'exit')
    press('Escape')
    expect(exitSpy).not.toHaveBeenCalled()
    handle.uninstall()
  })
})

describe('install-wire-mode keymap — Mod-;', () => {
  it('Mod-; exits wire mode', () => {
    const { wireMode, enter, handle } = mountInstall({ blocks: ['b1'] })
    enter()
    press(';', { metaKey: true })
    expect(wireMode.view().isActive).toBe(false)
    handle.uninstall()
  })

  it('Ctrl-; also exits (non-mac modifier)', () => {
    const { wireMode, enter, handle } = mountInstall({ blocks: ['b1'] })
    enter()
    press(';', { ctrlKey: true })
    expect(wireMode.view().isActive).toBe(false)
    handle.uninstall()
  })

  it('Mod-Shift-; passes through and does NOT exit', () => {
    const { wireMode, enter, handle } = mountInstall({ blocks: ['b1'] })
    enter()
    const event = press(';', { metaKey: true, shiftKey: true })
    expect(wireMode.view().isActive).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    handle.uninstall()
  })

  it('plain ; (no Mod) does NOT exit', () => {
    const { wireMode, enter, handle } = mountInstall({ blocks: ['b1'] })
    enter()
    press(';')
    expect(wireMode.view().isActive).toBe(true)
    handle.uninstall()
  })
})

describe('install-wire-mode keymap — navigation', () => {
  it('seeds the target to the first block on enter', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2', 'b3'] })
    enter()
    const overlay = document.getElementById('wire-target-highlight') as HTMLElement
    expect(overlay.style.display).toBe('')
    // Position pulled from first block's BCR.
    expect(blockEls[0].getBoundingClientRect().top).toBe(0)
    handle.uninstall()
  })

  it('j moves target down through the block list', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2', 'b3'] })
    // Position blocks at distinct y so we can identify which one the overlay tracks.
    Object.defineProperty(blockEls[1], 'getBoundingClientRect', {
      value: () => ({ top: 200, left: 0, width: 1, height: 1, right: 1, bottom: 201, x: 0, y: 200, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(blockEls[2], 'getBoundingClientRect', {
      value: () => ({ top: 400, left: 0, width: 1, height: 1, right: 1, bottom: 401, x: 0, y: 400, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    press('j')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('196px')
    press('j')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('396px')
    handle.uninstall()
  })

  it('ArrowDown is an alias for j', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2'] })
    Object.defineProperty(blockEls[1], 'getBoundingClientRect', {
      value: () => ({ top: 200, left: 0, width: 1, height: 1, right: 1, bottom: 201, x: 0, y: 200, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    press('ArrowDown')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('196px')
    handle.uninstall()
  })

  it('k moves target up; wraps from first to last', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2', 'b3'] })
    Object.defineProperty(blockEls[2], 'getBoundingClientRect', {
      value: () => ({ top: 999, left: 0, width: 1, height: 1, right: 1, bottom: 1000, x: 0, y: 999, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    // Seed = blocks[0]; k from index 0 wraps to last = blocks[2].
    press('k')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('995px')
    handle.uninstall()
  })

  it('ArrowUp is an alias for k', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2'] })
    Object.defineProperty(blockEls[1], 'getBoundingClientRect', {
      value: () => ({ top: 500, left: 0, width: 1, height: 1, right: 1, bottom: 501, x: 0, y: 500, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    press('ArrowUp')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('496px')
    handle.uninstall()
  })

  it('j wraps from last back to first', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2'] })
    Object.defineProperty(blockEls[0], 'getBoundingClientRect', {
      value: () => ({ top: 10, left: 0, width: 1, height: 1, right: 1, bottom: 11, x: 0, y: 10, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(blockEls[1], 'getBoundingClientRect', {
      value: () => ({ top: 999, left: 0, width: 1, height: 1, right: 1, bottom: 1000, x: 0, y: 999, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    press('j') // 0 → 1
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('995px')
    press('j') // 1 → 0 (wrap)
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('6px')
    handle.uninstall()
  })

  it('j is a no-op when there are no ordered blocks', () => {
    const { handle, enter } = mountInstall({ blocks: [] })
    enter()
    expect(() => press('j')).not.toThrow()
    handle.uninstall()
  })

  it('j is a no-op when getOrderedBlockElements is undefined', () => {
    const { handle, enter } = mountInstall({ blocks: ['b1', 'b2'], withOrderedBlocks: false })
    enter()
    expect(() => press('j')).not.toThrow()
    // No target overlay was seeded either.
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.display).toBe('none')
    handle.uninstall()
  })
})

describe('install-wire-mode keymap — Enter commit', () => {
  it('Enter commits the wire to the current target block', async () => {
    const { handle, enter, calls } = mountInstall({
      blocks: ['b1'],
      scope: { graphId: 'graph-a', documentId: 'doc-current' },
      source: { graphId: 'graph-a', documentId: 'doc-current', blockId: 'block-source' },
    })
    enter()
    press('Enter')
    // commit() is async; flush a microtask.
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0].graphId).toBe('graph-a')
    expect(calls[0].params).toMatchObject({
      sourceDocumentId: 'doc-current',
      targetDocumentId: 'doc-current',
      targetGraphId: 'graph-a',
      sourceBlockId: 'block-source',
      targetBlockId: 'b1',
      predicate: 'supports',
      bidirectional: false,
    })
    handle.uninstall()
  })

  it('Enter is a no-op when scope is not provided', async () => {
    const { handle, enter, calls } = mountInstall({ blocks: ['b1'], withScope: false })
    enter()
    press('Enter')
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    handle.uninstall()
  })

  it('Enter is a no-op when there is no current target (no blocks)', async () => {
    const { handle, enter, calls } = mountInstall({ blocks: [] })
    enter()
    press('Enter')
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    handle.uninstall()
  })

  it('Cmd-Enter / Ctrl-Enter does NOT commit (pass-through)', async () => {
    const { handle, enter, calls } = mountInstall({ blocks: ['b1'] })
    enter()
    press('Enter', { metaKey: true })
    press('Enter', { ctrlKey: true })
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    handle.uninstall()
  })

  it('Enter after navigation commits to the navigated block', async () => {
    const { handle, enter, calls } = mountInstall({ blocks: ['b1', 'b2', 'b3'] })
    enter() // target = b1
    press('j') // target = b2
    press('j') // target = b3
    press('Enter')
    await Promise.resolve()
    expect(calls[0].params).toMatchObject({ targetBlockId: 'b3' })
    handle.uninstall()
  })

  it('Enter is a no-op when the current target has been detached from the DOM', async () => {
    // Collaborative deletion: the highlighted block is removed mid-mode. The
    // detached element still answers getAttribute, so without the isConnected
    // guard this would silently commit a wire to a nonexistent block.
    const { handle, enter, calls, blockEls } = mountInstall({ blocks: ['b1', 'b2'] })
    enter() // target seeded to blockEls[0]
    blockEls[0].remove() // detach the current target
    press('Enter')
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    handle.uninstall()
  })
})

describe('install-wire-mode keymap — gating + cleanup', () => {
  it('keymap is not installed when wire mode activates on a different host', () => {
    const { wireMode, handle } = mountInstall({ blocks: ['b1'], hostId: 'host-1' })
    const exitSpy = vi.spyOn(wireMode, 'exit')
    wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-OTHER',
    )
    press('Escape')
    expect(exitSpy).not.toHaveBeenCalled()
    handle.uninstall()
  })

  it('keymap is removed after exit (subsequent presses are no-op)', () => {
    const { wireMode, handle, enter } = mountInstall({ blocks: ['b1'] })
    enter()
    press('Escape') // exits
    const exitSpy = vi.spyOn(wireMode, 'exit')
    press('Escape')
    expect(exitSpy).not.toHaveBeenCalled()
    handle.uninstall()
  })

  it('keymap is removed on transferActiveHost away, re-installed on transfer back', () => {
    const { wireMode, handle, enter } = mountInstall({ blocks: ['b1'] })
    enter()
    wireMode.transferActiveHost('host-2')
    const exitSpy = vi.spyOn(wireMode, 'exit')
    press('Escape')
    expect(exitSpy).not.toHaveBeenCalled()

    wireMode.transferActiveHost('host-1')
    press('Escape')
    expect(exitSpy).toHaveBeenCalled()
    handle.uninstall()
  })

  it('uninstall removes the keymap', () => {
    const { wireMode, handle, enter } = mountInstall({ blocks: ['b1'] })
    enter()
    handle.uninstall()
    const exitSpy = vi.spyOn(wireMode, 'exit')
    press('Escape')
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

describe('install-wire-mode keymap — preventDefault and stopImmediatePropagation', () => {
  it('Escape, Enter, J, K, Mod-; all call preventDefault when handled', () => {
    const { handle, enter } = mountInstall({ blocks: ['b1', 'b2'] })
    enter()
    expect(press('Escape').defaultPrevented).toBe(true)
    enter()
    expect(press('Enter').defaultPrevented).toBe(true)
    enter()
    expect(press('j').defaultPrevented).toBe(true)
    enter()
    expect(press('k').defaultPrevented).toBe(true)
    enter()
    expect(press(';', { metaKey: true }).defaultPrevented).toBe(true)
    handle.uninstall()
  })

  it('Mod-Shift-; and untracked keys do NOT call preventDefault', () => {
    const { handle, enter } = mountInstall({ blocks: ['b1'] })
    enter()
    expect(press(';', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false)
    expect(press('a').defaultPrevented).toBe(false)
    expect(press('Tab').defaultPrevented).toBe(false)
    handle.uninstall()
  })
})

describe('install-wire-mode keymap — interaction with existing setTarget API', () => {
  it('external setTarget(element) wins; subsequent j navigates from that element', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2', 'b3'] })
    Object.defineProperty(blockEls[2], 'getBoundingClientRect', {
      value: () => ({ top: 800, left: 0, width: 1, height: 1, right: 1, bottom: 801, x: 0, y: 800, toJSON: () => ({}) }),
      configurable: true,
    })
    enter() // seed = blocks[0]
    handle.setTarget(blockEls[1]) // external bump
    press('j')
    // j from blockEls[1] → blockEls[2]
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('796px')
    handle.uninstall()
  })

  it('external setTarget(null) clears current target; next j seeds the first block', () => {
    const { handle, enter, blockEls } = mountInstall({ blocks: ['b1', 'b2'] })
    Object.defineProperty(blockEls[0], 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 0, width: 1, height: 1, right: 1, bottom: 101, x: 0, y: 100, toJSON: () => ({}) }),
      configurable: true,
    })
    enter()
    handle.setTarget(null)
    press('j')
    expect((document.getElementById('wire-target-highlight') as HTMLElement).style.top).toBe('96px')
    handle.uninstall()
  })
})
