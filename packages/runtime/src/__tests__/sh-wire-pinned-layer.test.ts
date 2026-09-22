import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'lit'
import {
  mountWirePinnedLayer,
  WIRE_PINNED_BLOCK_CLOSE_EVENT,
  WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_BLOCK_MOVE_EVENT,
  WIRE_PINNED_BLOCK_OPEN_EVENT,
  WIRE_PINNED_BLOCK_REFRESH_EVENT,
  WIRE_PINNED_DOC_CLOSE_EVENT,
  WIRE_PINNED_DOC_MOVE_EVENT,
  WIRE_PINNED_DOC_OPEN_EVENT,
  WIRE_PINNED_WIRE_CLOSE_EVENT,
  WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_WIRE_MOVE_EVENT,
  WIRE_PINNED_WIRE_OPEN_EVENT,
  WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT,
  type PinnedWireBlock,
  type PinnedWireBlockContextMap,
  type PinnedWireDocument,
  type PinnedWireNode,
  type PinnedWireNodeContextMap,
  type BlockWireRequestDetail,
  type ShWirePinnedLayer,
  type WirePinnedBlockCloseDetail,
  type WirePinnedBlockContextRequestDetail,
  type WirePinnedBlockMoveDetail,
  type WirePinnedBlockOpenDetail,
  type WirePinnedBlockRefreshDetail,
  type WirePinnedDocCloseDetail,
  type WirePinnedDocMoveDetail,
  type WirePinnedDocOpenDetail,
  type WirePinnedWireCloseDetail,
  type WirePinnedWireContextRequestDetail,
  type WirePinnedWireMoveDetail,
  type WirePinnedWireOpenDetail,
  type WirePinnedWireUpdateRequestDetail,
} from '../index.js'

const docs: PinnedWireDocument[] = [
  {
    id: 'pindoc-graph-a-doc-target',
    graphId: 'graph-a',
    documentId: 'doc-target',
    title: 'Target document',
    x: 32,
    y: 72,
  },
]

const blocks: PinnedWireBlock[] = [
  {
    id: 'pinblock-graph-a-doc-source-block-source',
    graphId: 'graph-a',
    documentId: 'doc-source',
    blockId: 'block-source',
    text: 'Source block text',
    documentTitle: 'Source document',
    x: 260,
    y: 72,
  },
]

const nodes: PinnedWireNode[] = [
  {
    id: 'pinwire-graph-a-wire-out',
    wireId: 'wire-out',
    graphId: 'graph-a',
    predicate: 'http://mnemosyne.ai/vocab#supports',
    predicateLabel: 'supports',
    bidirectional: true,
    sourceGraphId: 'graph-a',
    sourceDocumentId: 'doc-source',
    sourceBlockId: 'block-source',
    sourceTitle: 'Source document',
    sourceText: 'Source block text',
    targetGraphId: 'graph-a',
    targetDocumentId: 'doc-target',
    targetBlockId: 'block-target',
    targetTitle: 'Target document',
    targetText: 'Target block text',
    x: 32,
    y: 72,
  },
]

const editableNodes: PinnedWireNode[] = [
  {
    ...nodes[0],
    bidirectional: false,
  },
]

async function mount(
  nodesArg: readonly PinnedWireNode[] = [],
  docsArg: readonly PinnedWireDocument[] = docs,
  blocksArg: readonly PinnedWireBlock[] = [],
  blockContexts: PinnedWireBlockContextMap | null = null,
  nodeContexts: PinnedWireNodeContextMap | null = null,
): Promise<ShWirePinnedLayer> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(mountWirePinnedLayer({ nodes: nodesArg, docs: docsArg, blocks: blocksArg, blockContexts, nodeContexts }), container)
  await customElements.whenDefined('sh-wire-pinned-layer')
  const layer = container.querySelector('sh-wire-pinned-layer') as ShWirePinnedLayer
  await layer.updateComplete
  return layer
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('sh-wire-pinned-layer', () => {
  it('renders pinned document cards from shell-owned data', async () => {
    const layer = await mount()
    const root = layer.shadowRoot!

    expect(root.querySelector('[data-wire-pinned-layer]')).not.toBeNull()
    expect(root.querySelector('[data-wire-pinned-doc]')?.getAttribute('data-pinned-doc-id')).toBe('pindoc-graph-a-doc-target')
    expect(root.textContent).toContain('Target document')
  })

  it('renders pinned block cards from shell-owned data', async () => {
    const layer = await mount([], [], blocks)
    const root = layer.shadowRoot!

    expect(root.querySelector('[data-wire-pinned-layer]')).not.toBeNull()
    expect(root.querySelector('[data-wire-pinned-block]')?.getAttribute('data-pinned-block-id')).toBe('pinblock-graph-a-doc-source-block-source')
    expect(root.textContent).toContain('Source document')
    expect(root.textContent).toContain('Source block text')
  })

  it('renders pinned wire node cards from shell-owned data', async () => {
    const layer = await mount(nodes, [], [])
    const root = layer.shadowRoot!

    expect(root.querySelector('[data-wire-pinned-wire]')?.getAttribute('data-pinned-wire-id')).toBe('pinwire-graph-a-wire-out')
    expect(root.textContent).toContain('Source document')
    expect(root.textContent).toContain('Source block text')
    expect(root.textContent).toContain('supports')
    expect(root.textContent).toContain('Both')
    expect(root.textContent).toContain('Target document')
    expect(root.textContent).toContain('Target block text')
  })

  it('brings interacted pinned cards to the front without shell state', async () => {
    const layer = await mount(nodes, docs, blocks)
    const root = layer.shadowRoot!
    const wire = root.querySelector('[data-wire-pinned-wire]') as HTMLElement
    const doc = root.querySelector('[data-wire-pinned-doc]') as HTMLElement
    const block = root.querySelector('[data-wire-pinned-block]') as HTMLElement

    expect(wire.style.zIndex).toBe('900')
    expect(doc.style.zIndex).toBe('901')
    expect(block.style.zIndex).toBe('902')

    wire.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await layer.updateComplete
    expect(wire.style.zIndex).toBe('902')
    expect(doc.style.zIndex).toBe('900')
    expect(block.style.zIndex).toBe('901')

    doc.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await layer.updateComplete
    expect(wire.style.zIndex).toBe('901')
    expect(doc.style.zIndex).toBe('902')
    expect(block.style.zIndex).toBe('900')

    block.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await layer.updateComplete
    expect(wire.style.zIndex).toBe('900')
    expect(doc.style.zIndex).toBe('901')
    expect(block.style.zIndex).toBe('902')
  })

  it('dispatches shell-owned open, close, and move events', async () => {
    const layer = await mount()
    const opened: WirePinnedDocOpenDetail[] = []
    const closed: WirePinnedDocCloseDetail[] = []
    const moved: WirePinnedDocMoveDetail[] = []
    layer.addEventListener(WIRE_PINNED_DOC_OPEN_EVENT, ((event: CustomEvent<WirePinnedDocOpenDetail>) => {
      opened.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_DOC_CLOSE_EVENT, ((event: CustomEvent<WirePinnedDocCloseDetail>) => {
      closed.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_DOC_MOVE_EVENT, ((event: CustomEvent<WirePinnedDocMoveDetail>) => {
      moved.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-doc-open]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-doc-close]') as HTMLButtonElement).click()

    const drag = root.querySelector('[data-wire-pinned-doc-drag]') as HTMLElement
    drag.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 42, clientY: 82 }))
    drag.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 92, clientY: 132 }))
    drag.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(opened).toEqual([{ graphId: 'graph-a', documentId: 'doc-target' }])
    expect(closed).toEqual([{ id: 'pindoc-graph-a-doc-target' }])
    expect(moved).toEqual([{ id: 'pindoc-graph-a-doc-target', x: 82, y: 122 }])
  })

  it('dispatches shell-owned block open, wire, refresh, close, and move events', async () => {
    const layer = await mount([], [], blocks)
    const opened: WirePinnedBlockOpenDetail[] = []
    const wired: BlockWireRequestDetail[] = []
    const refreshed: WirePinnedBlockRefreshDetail[] = []
    const closed: WirePinnedBlockCloseDetail[] = []
    const moved: WirePinnedBlockMoveDetail[] = []
    layer.addEventListener(WIRE_PINNED_BLOCK_OPEN_EVENT, ((event: CustomEvent<WirePinnedBlockOpenDetail>) => {
      opened.push(event.detail)
    }) as EventListener)
    document.addEventListener('mn-block-wire-request', ((event: CustomEvent<BlockWireRequestDetail>) => {
      wired.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_BLOCK_REFRESH_EVENT, ((event: CustomEvent<WirePinnedBlockRefreshDetail>) => {
      refreshed.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_BLOCK_CLOSE_EVENT, ((event: CustomEvent<WirePinnedBlockCloseDetail>) => {
      closed.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_BLOCK_MOVE_EVENT, ((event: CustomEvent<WirePinnedBlockMoveDetail>) => {
      moved.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-block-open]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-block-wire]') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: 312,
        clientY: 140,
        shiftKey: true,
        altKey: true,
      }),
    )
    ;(root.querySelector('[data-wire-pinned-block-refresh]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-block-close]') as HTMLButtonElement).click()

    const drag = root.querySelector('[data-wire-pinned-block-drag]') as HTMLElement
    drag.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 270, clientY: 82 }))
    drag.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 320, clientY: 132 }))
    drag.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(opened).toEqual([{ graphId: 'graph-a', documentId: 'doc-source', blockId: 'block-source' }])
    expect(wired).toEqual([
      {
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
        clientX: 312,
        clientY: 140,
        shiftKey: true,
        altKey: true,
        metaKey: false,
        ctrlKey: false,
      },
    ])
    expect(refreshed).toEqual([
      {
        id: 'pinblock-graph-a-doc-source-block-source',
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
      },
    ])
    expect(closed).toEqual([{ id: 'pinblock-graph-a-doc-source-block-source' }])
    expect(moved).toEqual([{ id: 'pinblock-graph-a-doc-source-block-source', x: 310, y: 122 }])
  })

  it('dispatches shell-owned wire node open, close, and move events', async () => {
    const layer = await mount(nodes, [], [])
    const opened: WirePinnedWireOpenDetail[] = []
    const closed: WirePinnedWireCloseDetail[] = []
    const moved: WirePinnedWireMoveDetail[] = []
    layer.addEventListener(WIRE_PINNED_WIRE_OPEN_EVENT, ((event: CustomEvent<WirePinnedWireOpenDetail>) => {
      opened.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_WIRE_CLOSE_EVENT, ((event: CustomEvent<WirePinnedWireCloseDetail>) => {
      closed.push(event.detail)
    }) as EventListener)
    layer.addEventListener(WIRE_PINNED_WIRE_MOVE_EVENT, ((event: CustomEvent<WirePinnedWireMoveDetail>) => {
      moved.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-wire-source-title]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-wire-endpoint-title][data-wire-endpoint="target"]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-wire-close]') as HTMLButtonElement).click()

    const drag = root.querySelector('[data-wire-pinned-wire-drag]') as HTMLElement
    drag.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 42, clientY: 82 }))
    drag.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 92, clientY: 132 }))
    drag.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(opened).toEqual([
      { graphId: 'graph-a', documentId: 'doc-source', blockId: 'block-source' },
      { graphId: 'graph-a', documentId: 'doc-target', blockId: 'block-target' },
    ])
    expect(closed).toEqual([{ id: 'pinwire-graph-a-wire-out' }])
    expect(moved).toEqual([{ id: 'pinwire-graph-a-wire-out', x: 82, y: 122 }])
  })

  it('dispatches shell-owned wire node predicate, bidirectional, and swap update requests', async () => {
    const layer = await mount(editableNodes, [], [])
    const updates: WirePinnedWireUpdateRequestDetail[] = []
    layer.addEventListener(WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT, ((event: CustomEvent<WirePinnedWireUpdateRequestDetail>) => {
      updates.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-wire-predicate-button]') as HTMLButtonElement).click()
    await layer.updateComplete
    const predicateButton = Array.from(root.querySelectorAll('[data-wire-pinned-wire-predicate-option]'))
      .find((button) => button.getAttribute('data-predicate-uri') === 'http://mnemosyne.ai/vocab#qualifies') as HTMLButtonElement
    predicateButton.click()
    ;(root.querySelector('[data-wire-pinned-wire-bidirectional]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-wire-swap]') as HTMLButtonElement).click()

    expect(updates).toEqual([
      {
        id: 'pinwire-graph-a-wire-out',
        wireId: 'wire-out',
        predicate: 'http://mnemosyne.ai/vocab#qualifies',
        bidirectional: false,
        swap: false,
      },
      {
        id: 'pinwire-graph-a-wire-out',
        wireId: 'wire-out',
        predicate: 'http://mnemosyne.ai/vocab#supports',
        bidirectional: true,
        swap: false,
      },
      {
        id: 'pinwire-graph-a-wire-out',
        wireId: 'wire-out',
        predicate: 'http://mnemosyne.ai/vocab#supports',
        bidirectional: false,
        swap: true,
      },
    ])
  })

  it('requests and renders pinned block above/below context slots', async () => {
    const layer = await mount([], [], blocks)
    const requests: WirePinnedBlockContextRequestDetail[] = []
    layer.addEventListener(WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedBlockContextRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-block-context-above]') as HTMLButtonElement).click()
    await layer.updateComplete

    expect(requests).toEqual([
      {
        id: 'pinblock-graph-a-doc-source-block-source',
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
      },
    ])
    expect(root.textContent).toContain('Loading...')

    layer.blockContexts = new Map([
      ['pinblock-graph-a-doc-source-block-source', {
        status: 'ready',
        data: {
          blocks: [
            { id: 'before-1', text: 'Earlier block', isTarget: false },
            { id: 'before-2', text: 'Previous block', isTarget: false },
            { id: 'block-source', text: 'Source block text', isTarget: true },
            { id: 'after-1', text: 'Next block', isTarget: false },
            { id: 'after-2', text: 'Later block', isTarget: false },
            { id: 'after-3', text: 'Not shown', isTarget: false },
          ],
        },
      }],
    ])
    await layer.updateComplete
    expect(root.textContent).toContain('Earlier block')
    expect(root.textContent).toContain('Previous block')

    ;(root.querySelector('[data-wire-pinned-block-context-below]') as HTMLButtonElement).click()
    await layer.updateComplete

    expect(requests).toHaveLength(1)
    expect(root.textContent).toContain('Next block')
    expect(root.textContent).toContain('Later block')
    expect(root.textContent).not.toContain('Not shown')
  })

  it('eagerly requests pinned block context so above/below is preloaded', async () => {
    const requests: WirePinnedBlockContextRequestDetail[] = []
    const container = document.createElement('div')
    container.addEventListener(WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedBlockContextRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)
    document.body.appendChild(container)
    render(mountWirePinnedLayer({ nodes: [], docs: [], blocks }), container)
    await customElements.whenDefined('sh-wire-pinned-layer')
    const layer = container.querySelector('sh-wire-pinned-layer') as ShWirePinnedLayer
    await layer.updateComplete

    expect(requests).toEqual([
      {
        id: 'pinblock-graph-a-doc-source-block-source',
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
      },
    ])

    layer.blockContexts = new Map([
      ['pinblock-graph-a-doc-source-block-source', {
        status: 'ready',
        data: {
          blocks: [
            { id: 'before-1', text: 'Preloaded previous block', isTarget: false },
            { id: 'block-source', text: 'Source block text', isTarget: true },
            { id: 'after-1', text: 'Preloaded next block', isTarget: false },
          ],
        },
      }],
    ])
    await layer.updateComplete

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-block-context-above]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-wire-pinned-block-context-below]') as HTMLButtonElement).click()
    await layer.updateComplete
    expect(requests).toHaveLength(1)
    expect(root.textContent).toContain('Preloaded previous block')
    expect(root.textContent).toContain('Preloaded next block')

    layer.blocks = [...blocks]
    await layer.updateComplete
    expect(requests).toHaveLength(1)
  })

  it('eagerly requests endpoint context so full wire endpoint text can arrive without expansion', async () => {
    const requests: WirePinnedWireContextRequestDetail[] = []
    const container = document.createElement('div')
    container.addEventListener(WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedWireContextRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)
    document.body.appendChild(container)
    render(mountWirePinnedLayer({ nodes, docs: [], blocks: [] }), container)
    await customElements.whenDefined('sh-wire-pinned-layer')
    const layer = container.querySelector('sh-wire-pinned-layer') as ShWirePinnedLayer
    await layer.updateComplete

    expect(requests).toEqual([
      {
        id: 'pinwire-graph-a-wire-out:source',
        side: 'source',
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
      },
      {
        id: 'pinwire-graph-a-wire-out:target',
        side: 'target',
        graphId: 'graph-a',
        documentId: 'doc-target',
        blockId: 'block-target',
      },
    ])

    layer.nodeContexts = new Map([
      ['pinwire-graph-a-wire-out:source', {
        status: 'ready',
        data: {
          blocks: [
            { id: 'block-source', text: 'Full source block text', isTarget: true },
          ],
        },
      }],
      ['pinwire-graph-a-wire-out:target', {
        status: 'ready',
        data: {
          blocks: [
            { id: 'block-target', text: 'Full target block text', isTarget: true },
          ],
        },
      }],
    ])
    await layer.updateComplete

    const root = layer.shadowRoot!
    expect((root.querySelector('[data-wire-pinned-wire-source-body]') as HTMLElement).textContent).toContain(
      'Full source block text',
    )
    expect((root.querySelector('[data-wire-pinned-wire-endpoint-body][data-wire-endpoint="target"]') as HTMLElement).textContent).toContain(
      'Full target block text',
    )

    layer.nodes = [...nodes]
    await layer.updateComplete
    expect(requests).toHaveLength(2)
  })

  it('requests and renders pinned wire endpoint above/below context slots', async () => {
    const layer = await mount(nodes, [], [])
    const requests: WirePinnedWireContextRequestDetail[] = []
    layer.addEventListener(WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedWireContextRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    const root = layer.shadowRoot!
    ;(root.querySelector('[data-wire-pinned-wire-context-above][data-wire-endpoint="source"]') as HTMLButtonElement).click()
    await layer.updateComplete

    expect(requests).toEqual([
      {
        id: 'pinwire-graph-a-wire-out:source',
        side: 'source',
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
      },
    ])
    expect(root.textContent).toContain('Loading...')

    layer.nodeContexts = new Map([
      ['pinwire-graph-a-wire-out:source', {
        status: 'ready',
        data: {
          blocks: [
            { id: 'source-before-1', text: 'Source earlier block', isTarget: false },
            { id: 'source-before-2', text: 'Source previous block', isTarget: false },
            { id: 'block-source', text: 'Full source block text', isTarget: true },
            { id: 'source-after-1', text: 'Source next block', isTarget: false },
            { id: 'source-after-2', text: 'Source later block', isTarget: false },
            { id: 'source-after-3', text: 'Source hidden block', isTarget: false },
          ],
        },
      }],
    ])
    await layer.updateComplete

    const sourceBody = root.querySelector('[data-wire-pinned-wire-source-body]') as HTMLElement
    expect(sourceBody.textContent).toContain('Full source block text')
    expect(root.textContent).toContain('Source earlier block')
    expect(root.textContent).toContain('Source previous block')

    ;(root.querySelector('[data-wire-pinned-wire-context-below][data-wire-endpoint="source"]') as HTMLButtonElement).click()
    await layer.updateComplete
    expect(requests).toHaveLength(1)
    expect(root.textContent).toContain('Source next block')
    expect(root.textContent).toContain('Source later block')
    expect(root.textContent).not.toContain('Source hidden block')

    ;(root.querySelector('[data-wire-pinned-wire-context-below][data-wire-endpoint="target"]') as HTMLButtonElement).click()
    await layer.updateComplete
    expect(requests[1]).toEqual({
      id: 'pinwire-graph-a-wire-out:target',
      side: 'target',
      graphId: 'graph-a',
      documentId: 'doc-target',
      blockId: 'block-target',
    })
  })

  it('renders nothing when no cards are pinned', async () => {
    const layer = await mount([], [], [])

    expect(layer.shadowRoot!.querySelector('[data-wire-pinned-layer]')).toBeNull()
  })
})
