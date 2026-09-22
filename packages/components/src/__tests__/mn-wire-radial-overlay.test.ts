import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../mn-wire-radial-overlay.js'
import type {
  MnWireRadialContextRequestDetail,
  MnWireRadialNavigateDetail,
  MnWireRadialOverlay,
  MnWireRadialPinDetail,
  MnWireRadialSuggestionDetail,
  MnWireRadialWire,
} from '../mn-wire-radial-overlay.js'

const wires: readonly MnWireRadialWire[] = [
  {
    id: 'wire-out',
    predicate: 'http://mnemosyne.ai/vocab#supports',
    predicateLabel: 'supports',
    otherDocumentId: 'doc-target',
    otherGraphId: 'graph-a',
    otherBlockId: 'block-target',
    localBlockId: 'block-source',
    otherTitle: 'Target document',
    otherSnippet: 'Target block text',
    localSnippet: 'Source block text',
    bidirectional: true,
  },
  {
    id: 'wire-in',
    predicate: 'http://mnemosyne.ai/vocab#critiques',
    predicateLabel: 'critiques',
    otherDocumentId: 'doc-review',
    otherGraphId: 'graph-a',
    otherTitle: 'Review document',
    otherSnippet: 'Review snippet',
    bidirectional: false,
  },
]

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnWireRadialOverlay) => void): Promise<MnWireRadialOverlay> {
  const el = document.createElement('mn-wire-radial-overlay') as MnWireRadialOverlay
  el.anchorX = 300
  el.anchorY = 240
  el.graphId = 'graph-a'
  el.localGraphId = 'graph-a'
  el.localDocumentId = 'doc-source'
  el.localTitle = 'Source document'
  el.wires = wires
  el.outgoingWireIds = new Set(['wire-out'])
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-wire-radial-overlay', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', 768)
    document.body.replaceChildren()
  })

  it('renders wire nodes and SVG lines from shell-owned data', async () => {
    const el = await mount()
    const root = sr(el)

    expect(customElements.get('mn-wire-radial-overlay')).toBeDefined()
    expect(root.querySelector('[data-wire-radial-overlay]')).not.toBeNull()
    expect(root.querySelectorAll('[data-wire-radial-node]')).toHaveLength(2)
    expect(root.querySelectorAll('[data-wire-radial-svg] line')).toHaveLength(2)
    expect(root.querySelector('[data-node-id="wire-wire-out"]')?.textContent).toContain('Target document')
    expect(root.querySelector('[data-node-id="wire-wire-in"]')?.textContent).toContain('therecritiqueshere')
  })

  it('emits navigate and suggestion intents without shell work', async () => {
    const el = await mount(node => {
      node.suggestions = [{ docId: 'doc-suggested', blockId: null, title: 'Suggested doc', snippet: 'Suggested connection' }]
    })
    const navigated: MnWireRadialNavigateDetail[] = []
    const suggestions: MnWireRadialSuggestionDetail[] = []
    el.addEventListener('mn-wire-radial-navigate', event => {
      navigated.push((event as CustomEvent<MnWireRadialNavigateDetail>).detail)
    })
    el.addEventListener('mn-wire-radial-suggestion', event => {
      suggestions.push((event as CustomEvent<MnWireRadialSuggestionDetail>).detail)
    })

    sr(el).querySelector<HTMLElement>('[data-node-id="wire-wire-out"]')!.click()
    sr(el).querySelector<HTMLElement>('[data-node-id="suggestion-doc-suggested-doc"]')!.click()

    expect(navigated).toEqual([
      {
        wireId: 'wire-out',
        graphId: 'graph-a',
        documentId: 'doc-target',
        blockId: 'block-target',
      },
    ])
    expect(suggestions).toEqual([{ docId: 'doc-suggested', blockId: null }])
  })

  it('emits a pinned-wire payload oriented by outgoing/incoming direction', async () => {
    const el = await mount()
    const pinned: MnWireRadialPinDetail[] = []
    el.addEventListener('mn-wire-radial-pin', event => {
      pinned.push((event as CustomEvent<MnWireRadialPinDetail>).detail)
    })

    sr(el).querySelector<HTMLElement>('[data-node-id="wire-wire-out"] [data-wire-radial-pin]')!.click()
    sr(el).querySelector<HTMLElement>('[data-node-id="wire-wire-in"] [data-wire-radial-pin]')!.click()

    expect(pinned[0]).toMatchObject({
      wireId: 'wire-out',
      graphId: 'graph-a',
      predicate: 'http://mnemosyne.ai/vocab#supports',
      predicateLabel: 'supports',
      bidirectional: true,
      sourceDocumentId: 'doc-source',
      sourceBlockId: 'block-source',
      sourceTitle: 'Source document',
      sourceText: 'Source block text',
      targetDocumentId: 'doc-target',
      targetBlockId: 'block-target',
      targetTitle: 'Target document',
      targetText: 'Target block text',
    })
    expect(pinned[1]).toMatchObject({
      wireId: 'wire-in',
      sourceDocumentId: 'doc-review',
      sourceTitle: 'Review document',
      targetDocumentId: 'doc-source',
      targetTitle: 'Source document',
    })
  })

  it('emits context request and renders controlled context state', async () => {
    const el = await mount()
    const requests: MnWireRadialContextRequestDetail[] = []
    el.addEventListener('mn-wire-radial-context-request', event => {
      requests.push((event as CustomEvent<MnWireRadialContextRequestDetail>).detail)
    })

    sr(el).querySelector<HTMLElement>('[data-node-id="wire-wire-out"] [data-wire-radial-expand]')!.click()
    await el.updateComplete
    expect(requests).toEqual([
      {
        nodeId: 'wire-wire-out',
        wireId: 'wire-out',
        graphId: 'graph-a',
        documentId: 'doc-target',
        blockId: 'block-target',
      },
    ])
    expect(sr(el).querySelector('.expanded-loading')?.textContent).toBe('Loading...')

    el.contexts = {
      'wire-wire-out': {
        status: 'ready',
        data: {
          mode: 'toc',
          blocks: [
            { id: 'block-intro', text: 'Intro', isTarget: false },
            { id: 'block-target', text: 'Target text', isTarget: true },
          ],
        },
      },
    }
    await el.updateComplete

    expect(sr(el).querySelector('.expanded-mode')?.textContent).toBe('contents')
    expect(Array.from(sr(el).querySelectorAll('.expanded-block')).map(node => node.textContent)).toEqual([
      'Intro',
      'Target text',
    ])
    expect(sr(el).querySelectorAll('.expanded-block')[1]?.classList.contains('is-target')).toBe(true)
  })

  it('renders nothing without wires or suggestions', async () => {
    const el = await mount(node => {
      node.wires = []
      node.suggestions = []
    })

    expect(sr(el).querySelector('[data-wire-radial-overlay]')).toBeNull()
  })
})
