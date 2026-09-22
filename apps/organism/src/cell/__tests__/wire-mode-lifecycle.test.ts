import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import {
  MNEMO_NS,
  createWireModeController,
  type WireCreateRequest,
  type WireWriter,
} from '@shrubbery/nucleus'
import {
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
} from '@shrubbery/runtime'
import type {
  MnAdvancedWireMenu,
  MnDocumentSwitcher,
  MnDocumentSwitcherItem,
} from '@shrubbery/components'
import {
  installOrganismWireMode,
  wireModeBlockElement,
  wireModeBlockElements,
  wireModeEditorFromHost,
  type OrganismWireModeLifecycle,
} from '../wire-mode-lifecycle.js'

interface WireCall {
  readonly graphId: string
  readonly params: WireCreateRequest
}

interface Harness {
  readonly hostId: string
  readonly host: HTMLElement
  readonly editor: { setEditable: ReturnType<typeof vi.fn> }
  readonly blocks: ReadonlyMap<string, HTMLElement>
  readonly menu: MnAdvancedWireMenu
  readonly switcher: MnDocumentSwitcher
  readonly wireMode: ReturnType<typeof createWireModeController>
  readonly calls: WireCall[]
  readonly lifecycle: OrganismWireModeLifecycle
}

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.body.replaceChildren()
})

function rect(top: number): DOMRect {
  return {
    top,
    left: 10,
    width: 100,
    height: 20,
    right: 110,
    bottom: top + 20,
    x: 10,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

async function mountHarness(blockIds: readonly string[] = ['block-source', 'block-target']): Promise<Harness> {
  const calls: WireCall[] = []
  const writer: WireWriter = {
    async create(graphId, params) {
      calls.push({ graphId, params })
      return { wireId: 'wire-created-by-organism' }
    },
    async delete() {},
  }
  const wireMode = createWireModeController({ wire: writer })
  const hostId = 'organism-main-editor'
  const host = document.createElement('div')
  host.id = 'mn-editor-host'
  const shadow = host.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  mount.className = 'editor-mount'
  const proseMirror = document.createElement('div')
  proseMirror.className = 'ProseMirror'
  mount.appendChild(proseMirror)
  shadow.appendChild(mount)

  const blocks = new Map<string, HTMLElement>()
  blockIds.forEach((blockId, index) => {
    const block = document.createElement('p')
    block.textContent = blockId
    block.setAttribute('data-block-id', blockId)
    Object.defineProperty(block, 'getBoundingClientRect', {
      value: () => rect(index * 100),
      configurable: true,
    })
    proseMirror.appendChild(block)
    blocks.set(blockId, block)
  })

  const editor = {
    setEditable: vi.fn(),
    getOrderedBlockElements: () => Array.from(blocks.values()),
    getBlockElement: (blockId: string) => {
      const normalized = blockId.startsWith('block-') ? blockId.slice('block-'.length) : blockId
      return blocks.get(blockId) ?? blocks.get(normalized) ?? blocks.get(`block-${normalized}`) ?? null
    },
  }
  Object.defineProperty(host, 'liveEditor', { value: editor, configurable: true })

  const menu = document.createElement('mn-advanced-wire-menu') as MnAdvancedWireMenu
  const switcher = document.createElement('mn-document-switcher') as MnDocumentSwitcher
  document.body.append(host, switcher, menu)
  await Promise.all([menu.updateComplete, switcher.updateComplete])

  const lifecycle = installOrganismWireMode({
    contract: { wireMode },
    hostId,
    getHostElement: () => host,
    getEditor: () => wireModeEditorFromHost(host),
    getDocumentScope: () => ({ graphId: 'graph-a', documentId: 'doc-current' }),
    menu,
    switcher,
    doc: document,
  })
  cleanups.push(() => lifecycle.uninstall())
  return { hostId, host, editor, blocks, menu, switcher, wireMode, calls, lifecycle }
}

async function chooseWireOptions(
  harness: Harness,
  sourceBlockId = 'block-source',
  predicate = `${MNEMO_NS}supports`,
  direction: 'forward' | 'reverse' | 'bidirectional' = 'forward',
): Promise<void> {
  document.dispatchEvent(new CustomEvent(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, {
    detail: { blockId: sourceBlockId },
    bubbles: true,
    composed: true,
  }))
  await harness.menu.updateComplete
  expect(harness.menu.open).toBe(true)
  harness.menu.selectedPredicate = predicate
  harness.menu.direction = direction
  await harness.menu.updateComplete
  harness.menu.shadowRoot!
    .querySelector<HTMLButtonElement>('[data-wire-advanced-confirm]')!
    .click()
}

function pressDocumentKey(
  key: string,
  init: Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey'> = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  document.dispatchEvent(event)
  return event
}

describe('Organism visual wire-mode lifecycle', () => {
  it('uses the advanced menu to enter, J to target, and Enter to commit through the contract controller', async () => {
    const harness = await mountHarness()

    await chooseWireOptions(harness)

    expect(harness.wireMode.view()).toEqual({
      isActive: true,
      source: {
        graphId: 'graph-a',
        documentId: 'doc-current',
        blockId: 'block-source',
      },
      config: { predicate: `${MNEMO_NS}supports`, direction: 'forward' },
      activeHostId: harness.hostId,
    })
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(true)
    expect(harness.editor.setEditable).toHaveBeenCalledWith(false)
    expect(document.getElementById('wire-source-highlight')).not.toBeNull()
    expect(document.getElementById('wire-target-highlight')?.style.top).toBe('-4px')

    pressDocumentKey('j')
    expect(document.getElementById('wire-target-highlight')?.style.top).toBe('96px')
    pressDocumentKey('Enter')

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1))
    expect(harness.calls[0]).toEqual({
      graphId: 'graph-a',
      params: {
        sourceDocumentId: 'doc-current',
        targetDocumentId: 'doc-current',
        targetGraphId: 'graph-a',
        bidirectional: false,
        predicate: `${MNEMO_NS}supports`,
        sourceBlockId: 'block-source',
        targetBlockId: 'block-target',
      },
    })
    expect(harness.wireMode.view().isActive).toBe(false)
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(false)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(true)
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
  })

  it('hands keyboard ownership to the real document switcher and commits a cross-document target', async () => {
    const harness = await mountHarness()
    const target: MnDocumentSwitcherItem = {
      kind: 'document',
      id: 'doc-destination',
      documentId: 'doc-destination',
      graphId: 'graph-b',
      label: 'Destination',
    }
    harness.switcher.items = [target]

    await chooseWireOptions(harness)
    expect(harness.lifecycle.handoffToDocumentSwitcher()).toBe(true)
    expect(harness.switcher.wireMode).toBe(true)
    expect(harness.switcher.scope).toBe('documents')
    expect(harness.wireMode.view().activeHostId).toBe(`${harness.hostId}:document-switcher`)
    // The editor keymap is suspended while modal target selection owns keys.
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(false)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(true)

    harness.switcher.open = true
    await harness.switcher.updateComplete
    harness.switcher.shadowRoot!
      .querySelector<HTMLInputElement>('.input')!
      .dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        composed: true,
        cancelable: true,
      }))

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1))
    expect(harness.calls[0].params).toMatchObject({
      sourceDocumentId: 'doc-current',
      sourceBlockId: 'block-source',
      targetDocumentId: 'doc-destination',
      targetGraphId: 'graph-b',
      predicate: `${MNEMO_NS}supports`,
    })
    expect(harness.wireMode.view().isActive).toBe(false)
    expect(harness.switcher.wireMode).toBe(false)
    expect(harness.switcher.open).toBe(false)
  })

  it('restores an active editor when target selection is cancelled', async () => {
    const harness = await mountHarness()
    await chooseWireOptions(harness)
    harness.lifecycle.handoffToDocumentSwitcher()
    harness.switcher.open = true
    await harness.switcher.updateComplete

    harness.switcher.shadowRoot!
      .querySelector<HTMLInputElement>('.input')!
      .dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }))

    expect(harness.switcher.open).toBe(false)
    expect(harness.wireMode.view().isActive).toBe(true)
    expect(harness.wireMode.view().activeHostId).toBe(harness.hostId)
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(true)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(false)
  })

  it('lets the advanced menu receive keyboard ownership when re-opened mid-mode', async () => {
    const harness = await mountHarness()
    await chooseWireOptions(harness)

    document.dispatchEvent(new CustomEvent(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, {
      detail: { blockId: 'block-target' },
      bubbles: true,
      composed: true,
    }))
    await harness.menu.updateComplete

    expect(harness.menu.open).toBe(true)
    expect(harness.wireMode.view().activeHostId).toBe(`${harness.hostId}:advanced-menu`)
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(false)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(true)

    harness.menu.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-wire-advanced-cancel]')!
      .click()

    expect(harness.menu.open).toBe(false)
    expect(harness.wireMode.view().isActive).toBe(true)
    expect(harness.wireMode.view().activeHostId).toBe(harness.hostId)
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(true)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(false)
  })

  it('uninstall exits owned mode, restores editability, removes overlays, and detaches both bridges', async () => {
    const harness = await mountHarness()
    await chooseWireOptions(harness)
    harness.switcher.open = true

    harness.lifecycle.uninstall()

    expect(harness.wireMode.view().isActive).toBe(false)
    expect(harness.host.hasAttribute('wire-mode-active')).toBe(false)
    expect(harness.editor.setEditable).toHaveBeenLastCalledWith(true)
    expect(document.getElementById('wire-source-highlight')).toBeNull()
    expect(document.getElementById('wire-target-highlight')).toBeNull()
    expect(harness.switcher.wireMode).toBe(false)
    expect(harness.switcher.open).toBe(false)

    document.dispatchEvent(new CustomEvent(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, {
      detail: { blockId: 'block-source' },
      bubbles: true,
      composed: true,
    }))
    await harness.menu.updateComplete
    expect(harness.menu.open).toBe(false)

    harness.switcher.dispatchEvent(new CustomEvent('mn-document-switcher-wire-target', {
      detail: { graphId: 'graph-b', documentId: 'doc-after-uninstall' },
      bubbles: true,
      composed: true,
    }))
    await Promise.resolve()
    expect(harness.calls).toHaveLength(0)
  })
})

describe('Organism editor-host DOM adapter', () => {
  it('finds ordered shadow-root blocks, supports the historical id prefix, and exposes setEditable', async () => {
    const harness = await mountHarness(['alpha', 'block-beta'])
    expect(wireModeBlockElements(harness.host)).toEqual([
      harness.blocks.get('alpha'),
      harness.blocks.get('block-beta'),
    ])
    expect(wireModeBlockElement(harness.host, 'block-alpha')).toBe(harness.blocks.get('alpha'))
    expect(wireModeBlockElement(harness.host, 'beta')).toBe(harness.blocks.get('block-beta'))
    expect(wireModeEditorFromHost(harness.host)).toBe(harness.editor)
  })
})
