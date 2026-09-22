import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'lit'
import {
  mountWiresPanel,
  OPEN_DOCUMENT_EVENT,
  WIRE_CONTEXT_REQUEST_EVENT,
  WIRE_DOCUMENT_REQUEST_EVENT,
  WIRE_HIGHLIGHT_BLOCK_EVENT,
  WIRE_PANEL_CLOSE_EVENT,
  WIRE_PIN_BLOCK_REQUEST_EVENT,
  WIRE_PIN_DOCUMENT_REQUEST_EVENT,
  WIRE_PIN_WIRE_REQUEST_EVENT,
  WIRE_REFRESH_ALL_REQUEST_EVENT,
  WIRE_REFRESH_REQUEST_EVENT,
  type DocumentWireRequestDetail,
  type OpenDocumentDetail,
  type ShWiresPanel,
  type WireBundle,
  type WireContextMap,
  type WireContextRequestDetail,
  type WireDeleteRequestDetail,
  type WireHighlightBlockDetail,
  type WirePinBlockRequestDetail,
  type WirePinDocumentRequestDetail,
  type WirePinWireRequestDetail,
  type WireRefreshRequestDetail,
  type WiresPanelMountOptions,
} from '../index.js'

const bundle: WireBundle = {
  outgoingWires: [
    {
      id: 'wire-out',
      predicate: 'http://mnemosyne.ai/vocab#supports',
      predicateLabel: 'supports',
      otherDocumentId: 'doc-target',
      otherGraphId: 'graph-a',
      otherBlockId: 'block-target',
      localBlockId: 'block-source',
      otherTitle: 'Target document',
      otherSnippet: 'remote context',
      localSnippet: 'local context',
      bidirectional: false,
    },
  ],
  incomingWires: [
    {
      id: 'wire-in',
      predicate: 'http://mnemosyne.ai/vocab#qualifies',
      predicateLabel: 'qualifies',
      otherDocumentId: 'doc-source',
      otherGraphId: 'graph-a',
      otherTitle: 'Source document',
      bidirectional: true,
    },
  ],
  wiredBlockIds: ['block-source'],
}

async function mount(
  bundleArg: WireBundle | null = bundle,
  wireContexts: WireContextMap | null = null,
  options: Omit<WiresPanelMountOptions, 'wireContexts'> = {},
): Promise<ShWiresPanel> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(mountWiresPanel(bundleArg, { wireContexts, ...options }), container)
  await customElements.whenDefined('sh-wires-panel')
  const panel = container.querySelector('sh-wires-panel') as ShWiresPanel
  await panel.updateComplete
  return panel
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('sh-wires-panel', () => {
  it('renders outgoing and incoming wire cards from a read bundle', async () => {
    const panel = await mount()
    const root = panel.shadowRoot!

    expect(root.querySelector('.count')?.textContent?.trim()).toBe('2')
    const cards = Array.from(root.querySelectorAll('[data-wire-panel-item]'))
    expect(cards.map((card) => card.getAttribute('data-wire-id'))).toEqual(['wire-out', 'wire-in'])
    expect(cards.map((card) => card.getAttribute('data-wire-direction'))).toEqual(['outgoing', 'incoming'])
    expect(root.textContent).toContain('Target document')
    expect(root.textContent).toContain('remote context')
    expect(root.textContent).toContain('Source document')
    expect(root.textContent).toContain('↔ bidirectional')
  })

  it('renders the oriented here-relation-there flow for outgoing and incoming wires', async () => {
    const panel = await mount(bundle, null, {
      localGraphId: 'graph-a',
      localDocumentId: 'doc-current',
      localDocumentTitle: 'Current document title',
    })
    const root = panel.shadowRoot!
    const outgoing = root.querySelector('[data-wire-id="wire-out"]')!
    const incoming = root.querySelector('[data-wire-id="wire-in"]')!

    expect(Array.from(outgoing.querySelectorAll('[data-wire-endpoint]')).map(endpoint => ({
      label: endpoint.getAttribute('data-wire-endpoint'),
      title: endpoint.querySelector('.endpoint-title')?.textContent?.trim(),
      snippet: endpoint.querySelector('.snippet')?.textContent?.trim(),
    }))).toEqual([
      { label: 'here', title: 'Current document title', snippet: 'local context' },
      { label: 'there', title: 'Target document', snippet: 'remote context' },
    ])
    expect(Array.from(incoming.querySelectorAll('[data-wire-endpoint]')).map(endpoint => ({
      label: endpoint.getAttribute('data-wire-endpoint'),
      title: endpoint.querySelector('.endpoint-title')?.textContent?.trim(),
    }))).toEqual([
      { label: 'there', title: 'Source document' },
      { label: 'here', title: 'Current document title' },
    ])
  })

  it('shows missing-snapshot copy only for block endpoints, not document-level wires', async () => {
    const sparse: WireBundle = {
      outgoingWires: [{
        ...bundle.outgoingWires[0],
        localSnippet: undefined,
        otherBlockId: undefined,
        otherSnippet: undefined,
      }],
      incomingWires: [{
        ...bundle.incomingWires[0],
        otherBlockId: 'source-block',
        otherSnippet: undefined,
        localBlockId: undefined,
        localSnippet: undefined,
      }],
      wiredBlockIds: ['block-source'],
    }
    const panel = await mount(sparse)
    const outgoing = panel.shadowRoot!.querySelector('[data-wire-id="wire-out"]')!
    const incoming = panel.shadowRoot!.querySelector('[data-wire-id="wire-in"]')!

    expect(outgoing.querySelector('[data-wire-endpoint="here"] .snippet')?.textContent?.trim()).toBe('No here snippet yet')
    expect(outgoing.querySelector('[data-wire-endpoint="there"] .snippet')).toBeNull()
    expect(incoming.querySelector('[data-wire-endpoint="there"] .snippet')?.textContent?.trim()).toBe('No there snippet yet')
    expect(incoming.querySelector('[data-wire-endpoint="here"] .snippet')).toBeNull()
  })

  it('dispatches the shared open-document event for connected documents', async () => {
    const panel = await mount()
    const opened: OpenDocumentDetail[] = []
    panel.addEventListener(OPEN_DOCUMENT_EVENT, ((event: CustomEvent<OpenDocumentDetail>) => {
      opened.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] .endpoint-title') as HTMLElement).click()

    expect(opened).toEqual([
      {
        graphId: 'graph-a',
        documentId: 'doc-target',
        blockId: 'block-target',
      },
    ])
  })

  it('opens cards by pointer or keyboard without leaking action clicks into navigation', async () => {
    const panel = await mount()
    const opened: OpenDocumentDetail[] = []
    panel.addEventListener(OPEN_DOCUMENT_EVENT, ((event: CustomEvent<OpenDocumentDetail>) => {
      opened.push(event.detail)
    }) as EventListener)
    const card = panel.shadowRoot!.querySelector('[data-wire-id="wire-out"]') as HTMLElement

    ;(card.querySelector('[data-wire-panel-refresh]') as HTMLButtonElement).click()
    ;(card.querySelector('[data-wire-panel-context]') as HTMLButtonElement).click()
    await panel.updateComplete
    ;(card.querySelector('.context-inline') as HTMLElement).click()
    expect(opened).toEqual([])

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(opened).toEqual([
      { graphId: 'graph-a', documentId: 'doc-target', blockId: 'block-target' },
      { graphId: 'graph-a', documentId: 'doc-target', blockId: 'block-target' },
    ])
  })

  it('dispatches a shell-handled delete request without owning the backend seam', async () => {
    const panel = await mount()
    const deleted: WireDeleteRequestDetail[] = []
    panel.addEventListener('mn-wire-delete-request', ((event: CustomEvent<WireDeleteRequestDetail>) => {
      deleted.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-panel-delete]') as HTMLButtonElement).click()

    expect(deleted).toEqual([{ wireId: 'wire-out' }])
  })

  it('dispatches Garden-compatible block highlight events while cards are hovered', async () => {
    const panel = await mount()
    const highlighted: WireHighlightBlockDetail[] = []
    panel.addEventListener(WIRE_HIGHLIGHT_BLOCK_EVENT, ((event: CustomEvent<WireHighlightBlockDetail>) => {
      highlighted.push(event.detail)
    }) as EventListener)

    const card = panel.shadowRoot!.querySelector('[data-wire-id="wire-out"]') as HTMLElement
    card.dispatchEvent(new MouseEvent('mouseenter'))
    card.dispatchEvent(new MouseEvent('mouseleave'))

    expect(highlighted).toEqual([{ blockId: 'block-source' }, { blockId: null }])
  })

  it('dispatches shell-owned context and refresh requests from panel actions', async () => {
    const panel = await mount()
    const contextRequests: WireContextRequestDetail[] = []
    const refreshRequests: WireRefreshRequestDetail[] = []
    let refreshAllCount = 0
    panel.addEventListener(WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WireContextRequestDetail>) => {
      contextRequests.push(event.detail)
    }) as EventListener)
    panel.addEventListener(WIRE_REFRESH_REQUEST_EVENT, ((event: CustomEvent<WireRefreshRequestDetail>) => {
      refreshRequests.push(event.detail)
    }) as EventListener)
    panel.addEventListener(WIRE_REFRESH_ALL_REQUEST_EVENT, () => {
      refreshAllCount += 1
    })

    ;(panel.shadowRoot!.querySelector('[data-wire-panel-refresh-all]') as HTMLButtonElement).click()
    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-refresh]') as HTMLButtonElement).click()
    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-context]') as HTMLButtonElement).click()
    await panel.updateComplete

    expect(refreshAllCount).toBe(1)
    expect(refreshRequests).toEqual([{ wireId: 'wire-out' }])
    expect(contextRequests).toEqual([
      {
        wireId: 'wire-out',
        graphId: 'graph-a',
        documentId: 'doc-target',
        blockId: 'block-target',
        title: 'Target document',
      },
    ])
    expect(panel.shadowRoot!.textContent).toContain('Loading…')
  })

  it('dispatches a shell-owned document wire request from the header affordance', async () => {
    const panel = await mount()
    const requests: DocumentWireRequestDetail[] = []
    panel.addEventListener(WIRE_DOCUMENT_REQUEST_EVENT, ((event: CustomEvent<DocumentWireRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-panel-wire-document]') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        shiftKey: true,
        altKey: true,
        ctrlKey: true,
      }),
    )

    expect(requests).toEqual([
      {
        shiftKey: true,
        altKey: true,
        metaKey: false,
        ctrlKey: true,
      },
    ])
  })

  it('dispatches a shell-owned pin request for a connected document', async () => {
    const panel = await mount()
    const requests: WirePinDocumentRequestDetail[] = []
    panel.addEventListener(WIRE_PIN_DOCUMENT_REQUEST_EVENT, ((event: CustomEvent<WirePinDocumentRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-pin]') as HTMLButtonElement).click()

    expect(requests).toEqual([
      {
        graphId: 'graph-a',
        documentId: 'doc-target',
        title: 'Target document',
      },
    ])
  })

  it('dispatches a shell-owned pin request for the local block endpoint', async () => {
    const panel = await mount(bundle, null, {
      localGraphId: 'graph-a',
      localDocumentId: 'doc-source',
      localDocumentTitle: 'Source document',
    })
    const requests: WirePinBlockRequestDetail[] = []
    panel.addEventListener(WIRE_PIN_BLOCK_REQUEST_EVENT, ((event: CustomEvent<WirePinBlockRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-pin-block]') as HTMLButtonElement).click()

    expect(requests).toEqual([
      {
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
        text: 'local context',
        documentTitle: 'Source document',
      },
    ])
  })

  it('dispatches a shell-owned pin request for the full oriented wire', async () => {
    const panel = await mount(bundle, null, {
      localGraphId: 'graph-a',
      localDocumentId: 'doc-source',
      localDocumentTitle: 'Source document',
    })
    const requests: WirePinWireRequestDetail[] = []
    panel.addEventListener(WIRE_PIN_WIRE_REQUEST_EVENT, ((event: CustomEvent<WirePinWireRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-pin-wire]') as HTMLButtonElement).click()

    expect(requests).toEqual([
      {
        wireId: 'wire-out',
        graphId: 'graph-a',
        predicate: 'http://mnemosyne.ai/vocab#supports',
        predicateLabel: 'supports',
        bidirectional: false,
        sourceGraphId: 'graph-a',
        sourceDocumentId: 'doc-source',
        sourceBlockId: 'block-source',
        sourceTitle: 'Source document',
        sourceText: 'local context',
        targetGraphId: 'graph-a',
        targetDocumentId: 'doc-target',
        targetBlockId: 'block-target',
        targetTitle: 'Target document',
        targetText: 'remote context',
      },
    ])
  })

  it('renders shell-provided inline context without owning the fetch seam', async () => {
    const panel = await mount(bundle, new Map([
      ['wire-out', {
        status: 'ready',
        data: {
          mode: 'context',
          title: 'Target document context',
          blocks: [
            { id: 'intro', type: 'heading', level: 2, text: 'Context heading', isTarget: false },
            { id: 'block-target', type: 'paragraph', level: null, text: 'Remote target block', isTarget: true },
          ],
        },
      }],
    ]))
    const requests: WireContextRequestDetail[] = []
    panel.addEventListener(WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WireContextRequestDetail>) => {
      requests.push(event.detail)
    }) as EventListener)

    ;(panel.shadowRoot!.querySelector('[data-wire-id="wire-out"] [data-wire-panel-context]') as HTMLButtonElement).click()
    await panel.updateComplete

    expect(requests).toEqual([])
    expect(panel.shadowRoot!.textContent).toContain('Target document context')
    expect(panel.shadowRoot!.textContent).toContain('H2')
    expect(panel.shadowRoot!.textContent).toContain('Remote target block')
    expect(panel.shadowRoot!.querySelector('.context-block.is-target')?.textContent).toContain('Remote target block')
  })

  it('limits long sections and expands them on demand like Garden', async () => {
    const many: WireBundle = {
      outgoingWires: Array.from({ length: 10 }, (_, index) => ({
        ...bundle.outgoingWires[0],
        id: `wire-out-${index}`,
        otherDocumentId: `doc-target-${index}`,
        otherTitle: `Target ${index}`,
      })),
      incomingWires: [],
      wiredBlockIds: ['block-source'],
    }
    const panel = await mount(many)

    expect(panel.shadowRoot!.querySelectorAll('[data-wire-panel-item]').length).toBe(8)
    expect(panel.shadowRoot!.textContent).toContain('Show 2 more...')

    ;(panel.shadowRoot!.querySelector('[data-wire-panel-show-more="outgoing"]') as HTMLButtonElement).click()
    await panel.updateComplete

    expect(panel.shadowRoot!.querySelectorAll('[data-wire-panel-item]').length).toBe(10)
  })

  it('renders an honest empty state when no wire bundle is available', async () => {
    const panel = await mount(null)

    expect(panel.shadowRoot!.querySelectorAll('[data-wire-panel-item]').length).toBe(0)
    expect(panel.shadowRoot!.textContent).toContain('No wires yet')
  })

  it('renders shell-controlled loading and error states without mistaking them for empty data', async () => {
    const panel = await mount(bundle, null, { status: 'loading' })

    expect(panel.shadowRoot!.querySelector('[data-wire-panel-state="loading"]')).not.toBeNull()
    expect(panel.shadowRoot!.querySelectorAll('[data-wire-panel-item]')).toHaveLength(0)

    panel.status = 'error'
    panel.error = 'Projection endpoint timed out'
    await panel.updateComplete

    expect(panel.shadowRoot!.querySelector('[data-wire-panel-state="error"]')?.textContent)
      .toContain('Projection endpoint timed out')
    expect(panel.shadowRoot!.textContent).not.toContain('No wires yet')
  })

  it('removes unavailable affordances and exposes close only through a host-owned callback', async () => {
    let closeCallbacks = 0
    let closeEvents = 0
    const panel = await mount(bundle, null, {
      capabilities: {
        createDocumentWire: false,
        open: false,
        context: false,
        refresh: false,
        pin: false,
        delete: false,
      },
      onClose: () => { closeCallbacks += 1 },
    })
    panel.addEventListener(WIRE_PANEL_CLOSE_EVENT, () => { closeEvents += 1 })
    const root = panel.shadowRoot!
    const card = root.querySelector('[data-wire-id="wire-out"]') as HTMLElement
    const opened: OpenDocumentDetail[] = []
    panel.addEventListener(OPEN_DOCUMENT_EVENT, ((event: CustomEvent<OpenDocumentDetail>) => {
      opened.push(event.detail)
    }) as EventListener)

    expect(root.querySelector('[data-wire-panel-wire-document]')).toBeNull()
    expect(root.querySelector('[data-wire-panel-refresh-all]')).toBeNull()
    expect(root.querySelector('.actions')).toBeNull()
    expect(card.getAttribute('role')).toBeNull()
    expect(card.hasAttribute('tabindex')).toBe(false)
    card.click()
    expect(opened).toEqual([])

    ;(root.querySelector('[data-wire-panel-close]') as HTMLButtonElement).click()
    expect(closeCallbacks).toBe(1)
    expect(closeEvents).toBe(1)
  })
})
