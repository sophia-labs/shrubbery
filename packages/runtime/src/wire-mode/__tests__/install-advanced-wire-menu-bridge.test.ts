/**
 * Tests for installAdvancedWireMenuBridge — the C5 closer.
 *
 * The bridge wires three pieces of the loop:
 *   - Catches mn-editor-keyboard-wire-menu-request (kernel Mod-Shift-;)
 *     at document level and opens the menu, stashing the source blockId.
 *   - Catches the menu's mn-wire-options-confirm and calls wireMode.enter
 *     with the source built from the pending blockId + getDocumentScope.
 *   - Catches the menu's mn-close (cancel) and clears the pending blockId
 *     so a subsequent kernel event captures a fresh source.
 *
 * Tests cover: open-on-kernel-request, enter-on-confirm with correct shape
 * (predicate, direction, source), clear-on-close, no-enter without source,
 * uninstall removes all three listeners.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWireModeController } from '@shrubbery/nucleus'
import type { WireWriter } from '@shrubbery/nucleus'
import { EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT as KERNEL_MENU_REQUEST_EVENT } from '@shrubbery/editor-kernel'
import {
  ADVANCED_WIRE_MENU_CLOSE_EVENT,
  ADVANCED_WIRE_MENU_CONFIRM_EVENT,
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
  installAdvancedWireMenuBridge,
  type AdvancedWireMenuHandle,
} from '../install-advanced-wire-menu-bridge.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('installAdvancedWireMenuBridge — kernel event constant is the single source of truth', () => {
  it('re-exports the EXACT kernel constant (a kernel rename must break this, not pass silently)', () => {
    // The bridge imports + re-exports the kernel-owned event string. If these
    // ever diverge, the Mod-Shift-; loop breaks at runtime while every other
    // test passes. Ties the two so a kernel rename fails the build here.
    expect(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT).toBe(KERNEL_MENU_REQUEST_EVENT)
  })
})

function makeWireWriter(): WireWriter {
  return {
    async create() {
      return { wireId: 'w' }
    },
    async delete() {},
  }
}

function makeMenu(): AdvancedWireMenuHandle & EventTarget {
  const target = new EventTarget() as EventTarget & { open: boolean }
  target.open = false
  return target as AdvancedWireMenuHandle & EventTarget
}

function dispatchKernelRequest(blockId: string): void {
  document.dispatchEvent(
    new CustomEvent(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, {
      detail: { blockId },
      bubbles: true,
      composed: true,
    }),
  )
}

function dispatchConfirm(
  menu: EventTarget,
  detail: { predicate: string; direction: 'forward' | 'reverse' | 'bidirectional'; bidirectional: boolean },
): void {
  menu.dispatchEvent(
    new CustomEvent(ADVANCED_WIRE_MENU_CONFIRM_EVENT, { detail, bubbles: true, composed: true }),
  )
}

function dispatchClose(menu: EventTarget): void {
  menu.dispatchEvent(new CustomEvent(ADVANCED_WIRE_MENU_CLOSE_EVENT, { bubbles: true, composed: true }))
}

describe('installAdvancedWireMenuBridge — kernel request → open menu', () => {
  it('opens the menu and stashes pending source blockId on kernel request', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    expect(menu.open).toBe(false)
    dispatchKernelRequest('block-source')
    expect(menu.open).toBe(true)
    uninstall()
  })

  it('ignores kernel requests without a blockId', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })
    document.dispatchEvent(
      new CustomEvent(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, { detail: {}, bubbles: true }),
    )
    expect(menu.open).toBe(false)
    uninstall()
  })
})

describe('installAdvancedWireMenuBridge — confirm → wireMode.enter', () => {
  it('calls wireMode.enter with the captured source and confirmed config', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g-a', documentId: 'd-current' }),
    })

    dispatchKernelRequest('block-source')
    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })

    expect(enterSpy).toHaveBeenCalledWith(
      { graphId: 'g-a', documentId: 'd-current', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-1',
    )
    uninstall()
  })

  it('passes the direction through ("reverse" and "bidirectional" both reach enter())', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    dispatchKernelRequest('block-source')
    dispatchConfirm(menu, { predicate: 'contradicts', direction: 'reverse', bidirectional: false })
    expect(enterSpy).toHaveBeenLastCalledWith(
      expect.any(Object),
      { predicate: 'contradicts', direction: 'reverse' },
      'host-1',
    )

    dispatchKernelRequest('block-source-2')
    dispatchConfirm(menu, { predicate: 'relatedTo', direction: 'bidirectional', bidirectional: true })
    expect(enterSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ blockId: 'block-source-2' }),
      { predicate: 'relatedTo', direction: 'bidirectional' },
      'host-1',
    )

    uninstall()
  })

  it('confirm without a prior kernel request is a no-op (no enter)', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).not.toHaveBeenCalled()
    uninstall()
  })

  it('confirm consumes the pending source (subsequent confirm without new request is a no-op)', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    dispatchKernelRequest('block-source')
    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).toHaveBeenCalledTimes(1)

    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).toHaveBeenCalledTimes(1)
    uninstall()
  })
})

describe('installAdvancedWireMenuBridge — close → clear pending', () => {
  it('mn-close clears the pending blockId (subsequent confirm is a no-op)', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    dispatchKernelRequest('block-source')
    dispatchClose(menu)
    // A stray confirm event after close should not enter mode.
    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).not.toHaveBeenCalled()

    // A fresh kernel request still works after close.
    dispatchKernelRequest('block-second')
    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: 'block-second' }),
      expect.any(Object),
      'host-1',
    )
    uninstall()
  })
})

describe('installAdvancedWireMenuBridge — uninstall', () => {
  it('uninstall removes the kernel-request listener', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })
    uninstall()
    dispatchKernelRequest('block-source')
    expect(menu.open).toBe(false)
  })

  it('uninstall removes the confirm + close listeners', () => {
    const wireMode = createWireModeController({ wire: makeWireWriter() })
    const menu = makeMenu()
    const enterSpy = vi.spyOn(wireMode, 'enter')
    const uninstall = installAdvancedWireMenuBridge({
      wireMode,
      menu,
      hostId: 'host-1',
      getDocumentScope: () => ({ graphId: 'g', documentId: 'd' }),
    })

    dispatchKernelRequest('block-source')
    uninstall()
    dispatchConfirm(menu, { predicate: 'supports', direction: 'forward', bidirectional: false })
    expect(enterSpy).not.toHaveBeenCalled()
  })
})
