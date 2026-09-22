/**
 * Tests for the C4 cross-pane mousedown handler in installWireMode.
 *
 * Each install owns its own mousedown handler. The handler is installed
 * whenever wire mode is active (any host), removed when inactive. The
 * handler is local: it only acts when the click lands inside THIS host's
 * element AND this host is not the current active wire pane. In that case
 * it calls transferActiveHost(this hostId), which the other host's install
 * sees via its subscription and tears down accordingly.
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
    async delete() {},
  }
}

function mount(hostId: string, sharedWire = makeWireWriter()) {
  const wireMode = createWireModeController({ wire: sharedWire })
  const host = document.createElement('div')
  host.setAttribute('data-host-id', hostId)
  document.body.appendChild(host)
  const inner = document.createElement('div')
  host.appendChild(inner)
  const editor = { setEditable: vi.fn() }
  const handle = installWireMode({
    wireMode,
    hostId,
    getHostElement: () => host,
    getEditor: () => editor,
    getBlockElement: () => null,
  })
  return { wireMode, host, inner, handle }
}

function clickIn(target: Node): void {
  // mousedown bubbles + is composed (so it reaches document from inside
  // shadow roots via retargeting). For light DOM tests bubbles=true is enough.
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true })
  target.dispatchEvent(event)
}

describe('install-wire-mode mousedown — cross-pane transfer', () => {
  it('mousedown inside our host while we are NOT active calls transferActiveHost(us)', () => {
    const wire = makeWireWriter()
    // Two installs, same controller (simulating two panes).
    const a = mount('host-a', wire)
    const b = mount('host-b', wire)
    // Share controller — wire-mode test helper builds its own, so we need
    // to manually use ONE controller across both installs. Rebuild B against
    // A's controller.
    b.handle.uninstall()
    const editorB = { setEditable: vi.fn() }
    const hostB = document.createElement('div')
    document.body.appendChild(hostB)
    const innerB = document.createElement('div')
    hostB.appendChild(innerB)
    const handleB = installWireMode({
      wireMode: a.wireMode,
      hostId: 'host-b',
      getHostElement: () => hostB,
      getEditor: () => editorB,
      getBlockElement: () => null,
    })

    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-a',
    )
    expect(a.wireMode.view().activeHostId).toBe('host-a')

    clickIn(innerB)
    expect(a.wireMode.view().activeHostId).toBe('host-b')

    a.handle.uninstall()
    handleB.uninstall()
  })

  it('mousedown inside our host while we ARE already active is a no-op', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')
    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-a',
    )
    clickIn(a.inner)
    expect(transferSpy).not.toHaveBeenCalled()
    a.handle.uninstall()
  })

  it('mousedown outside our host is a no-op', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')
    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-OTHER',
    )
    const outsideEl = document.createElement('div')
    document.body.appendChild(outsideEl)
    clickIn(outsideEl)
    expect(transferSpy).not.toHaveBeenCalled()
    a.handle.uninstall()
  })

  it('mousedown when wire mode is INACTIVE is a no-op', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')
    clickIn(a.inner)
    expect(transferSpy).not.toHaveBeenCalled()
    a.handle.uninstall()
  })
})

describe('install-wire-mode mousedown — lifecycle', () => {
  it('handler installed when wire mode is entered (any host), removed when exited', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')

    // Before entry: mousedown is a no-op.
    clickIn(a.inner)
    expect(transferSpy).not.toHaveBeenCalled()

    // Active on OTHER host: handler is installed; click in our host transfers.
    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-OTHER',
    )
    clickIn(a.inner)
    expect(transferSpy).toHaveBeenCalledWith('host-a')

    // Exit: handler removed; subsequent clicks no-op.
    a.wireMode.exit()
    transferSpy.mockClear()
    clickIn(a.inner)
    expect(transferSpy).not.toHaveBeenCalled()

    a.handle.uninstall()
  })

  it('handler removed on uninstall even mid-mode', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')
    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-OTHER',
    )
    a.handle.uninstall()
    transferSpy.mockClear()
    clickIn(a.inner)
    expect(transferSpy).not.toHaveBeenCalled()
  })

  it('handler is installed whether or not we are the active host', () => {
    const a = mount('host-a')
    const transferSpy = vi.spyOn(a.wireMode, 'transferActiveHost')
    // Enter as US — handler still installs (per design: gating is on activeHostId,
    // not isActive). Confirm by transferring away and clicking back.
    a.wireMode.enter(
      { graphId: 'g', documentId: 'd', blockId: 'block-source' },
      { predicate: 'supports', direction: 'forward' },
      'host-a',
    )
    a.wireMode.transferActiveHost('host-OTHER')
    // Now we are not active; clicking us should transfer back.
    clickIn(a.inner)
    expect(transferSpy).toHaveBeenLastCalledWith('host-a')
    a.handle.uninstall()
  })
})
